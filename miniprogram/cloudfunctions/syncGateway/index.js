/**
 * 云函数：syncGateway
 *
 * 职责（EP-SYNC-001 §6）：
 *   微信小程序端唯一同步网络代理。仅允许访问 `/api/sync/v1/*` 严格路由白名单，
 *   计算不可逆的限流主体（HMAC-SHA256(secret, "wechat:" + OPENID)）与请求签名
 *   后透传给 Go 同步服务，使小程序无需单独申请 ICP 备案域名即可稳定同步。
 *
 * 环境变量（在 CloudBase 云函数控制台配置，切勿硬编码进仓库）：
 *   - SYNC_BASE_URL       Go 同步服务根地址，例如 https://sync.example.com
 *   - SYNC_GATEWAY_SECRET 与 Go SYNC_GATEWAY_SECRET 一致的共享 HMAC 密钥
 */

'use strict';

const crypto = require('node:crypto');

const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 10000;
const PAIRING_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ-]{8,9}$/i;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TOKEN_RE = /^[0-9a-fA-F]{32,128}$/;

function response(status, ok, data) {
  return {
    status,
    ok,
    data,
  };
}

function errorResponse(status, code, message, extra = {}) {
  return response(status, false, {
    error: {
      code,
      message,
      ...extra,
    },
  });
}

function sha256Hex(bufferOrString) {
  return crypto.createHash('sha256').update(bufferOrString).digest('hex');
}

function hmacSha256Hex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * 与 Go auth.ComputeGatewaySignature 完全一致的请求签名算法：
 * canonical = UPPER(method) + "\n" + pathAndQuery + "\n" + timestamp + "\n" + subject + "\n" + sha256Hex(rawBody)
 */
function computeGatewaySignature(secret, method, pathAndQuery, timestamp, subject, bodyBuf) {
  const canonical =
    String(method).toUpperCase() +
    '\n' +
    pathAndQuery +
    '\n' +
    timestamp +
    '\n' +
    subject +
    '\n' +
    sha256Hex(bodyBuf);
  return hmacSha256Hex(secret, canonical);
}

/** 将微信 OPENID 单向派生为限流主题，不在外网或上游泄露明文 OPENID。 */
function deriveGatewaySubject(secret, openid) {
  return hmacSha256Hex(secret, `wechat:${openid}`);
}

/**
 * 严格路由白名单校验（防 SSRF / 路径穿越 / 任意 URL 代理）。
 */
function resolveAllowlistedRoute(rawMethod, rawPath, rawQuery) {
  const method = typeof rawMethod === 'string' ? rawMethod.trim().toUpperCase() : '';
  const path = typeof rawPath === 'string' ? rawPath.trim() : '';
  const query = rawQuery && typeof rawQuery === 'object' && !Array.isArray(rawQuery) ? rawQuery : {};

  if (!path || path.includes('..') || path.includes('%') || path.includes('//') || path.includes('?') || path.includes('#')) {
    return null;
  }

  if (method === 'POST' && path === '/api/sync/v1/pair/create') {
    return { method, pathAndQuery: path, authMode: 'optional', hasBody: true };
  }

  if (method === 'GET' && path === '/api/sync/v1/pair/status') {
    const code = typeof query.code === 'string' ? query.code.trim() : '';
    if (!PAIRING_CODE_RE.test(code)) {
      return null;
    }
    return {
      method,
      pathAndQuery: `${path}?code=${encodeURIComponent(code)}`,
      authMode: 'required',
      hasBody: false,
    };
  }

  if (method === 'POST' && path === '/api/sync/v1/pair/claim') {
    return { method, pathAndQuery: path, authMode: 'none', hasBody: true };
  }

  if (method === 'POST' && path === '/api/sync/v1/sync/push') {
    return { method, pathAndQuery: path, authMode: 'required', hasBody: true };
  }

  if (method === 'GET' && path === '/api/sync/v1/sync/pull') {
    let sinceSeq = 0;
    if (query.since_seq !== undefined && query.since_seq !== null && query.since_seq !== '') {
      const parsed = Number(query.since_seq);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return null;
      }
      sinceSeq = parsed;
    }
    return {
      method,
      pathAndQuery: `${path}?since_seq=${sinceSeq}`,
      authMode: 'required',
      hasBody: false,
    };
  }

  if (method === 'GET' && path === '/api/sync/v1/devices') {
    return { method, pathAndQuery: path, authMode: 'required', hasBody: false };
  }

  if (method === 'PATCH' && path === '/api/sync/v1/devices/me') {
    return { method, pathAndQuery: path, authMode: 'required', hasBody: true };
  }

  if (method === 'DELETE' && path.startsWith('/api/sync/v1/devices/')) {
    const deviceId = path.slice('/api/sync/v1/devices/'.length);
    if (deviceId !== 'me' && !UUID_RE.test(deviceId)) {
      return null;
    }
    return {
      method,
      pathAndQuery: `/api/sync/v1/devices/${deviceId}`,
      authMode: 'required',
      hasBody: false,
    };
  }

  return null;
}

function normalizeBaseUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    // 同步后端必须直接挂载在站点根路径下，确保 Go 侧 r.URL.RequestURI() 与签名完全一致。
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
      return null;
    }
    if (parsed.search || parsed.hash) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * 构造可注入依赖的 syncGateway 处理函数，便于离线单测与云端复用。
 */
function createSyncGatewayHandler(deps = {}) {
  const getEnv = typeof deps.env === 'function' ? deps.env : () => deps.env || process.env;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const getWXContext = deps.getWXContext;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const timeoutMs = typeof deps.timeoutMs === 'number' && deps.timeoutMs > 0 ? deps.timeoutMs : REQUEST_TIMEOUT_MS;

  return async function handleEvent(event = {}) {
    const env = getEnv() || {};
    const baseUrl = normalizeBaseUrl(env.SYNC_BASE_URL);
    const secret = typeof env.SYNC_GATEWAY_SECRET === 'string' ? env.SYNC_GATEWAY_SECRET.trim() : '';

    if (!baseUrl || !secret) {
      return errorResponse(503, 'SYNC_NOT_CONFIGURED', '同步服务暂未完成服务端配置');
    }

    if (typeof fetchImpl !== 'function') {
      return errorResponse(500, 'RUNTIME_UNSUPPORTED', '当前云函数运行环境缺少 fetch 实现');
    }

    const wxContext = typeof getWXContext === 'function' ? getWXContext() : {};
    const openid = wxContext && typeof wxContext.OPENID === 'string' ? wxContext.OPENID.trim() : '';
    if (!openid) {
      return errorResponse(401, 'MISSING_OPENID', '无法识别当前微信用户上下文');
    }

    const route = resolveAllowlistedRoute(event.method, event.path, event.query);
    if (!route) {
      return errorResponse(400, 'INVALID_ROUTE', '不支持的同步接口或参数格式无效');
    }

    const rawToken = typeof event.token === 'string' ? event.token.trim() : '';
    if (route.authMode === 'required' && !rawToken) {
      return errorResponse(401, 'UNAUTHORIZED', '缺少设备同步凭据');
    }
    if (rawToken && route.authMode !== 'none' && !TOKEN_RE.test(rawToken)) {
      return errorResponse(401, 'UNAUTHORIZED', '设备同步凭据格式无效');
    }

    let bodyBuf = Buffer.alloc(0);
    if (route.hasBody && event.body !== undefined && event.body !== null) {
      if (typeof event.body !== 'object' || Array.isArray(event.body)) {
        return errorResponse(400, 'INVALID_BODY', '同步请求体必须为 JSON 对象');
      }
      bodyBuf = Buffer.from(JSON.stringify(event.body), 'utf8');
      if (bodyBuf.length > MAX_BODY_BYTES) {
        return errorResponse(413, 'PAYLOAD_TOO_LARGE', '单次同步请求超过 64 KB 上限');
      }
    }

    const timestamp = String(Math.trunc(now()));
    const subject = deriveGatewaySubject(secret, openid);
    const signature = computeGatewaySignature(
      secret,
      route.method,
      route.pathAndQuery,
      timestamp,
      subject,
      bodyBuf,
    );

    const headers = {
      Accept: 'application/json',
      'X-Gateway-Timestamp': timestamp,
      'X-Gateway-Subject': subject,
      'X-Gateway-Signature': signature,
    };
    if (rawToken && route.authMode !== 'none') {
      headers.Authorization = `Bearer ${rawToken}`;
    }
    if (bodyBuf.length > 0) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const upstream = await fetchImpl(`${baseUrl}${route.pathAndQuery}`, {
        method: route.method,
        headers,
        body: bodyBuf.length > 0 ? bodyBuf : undefined,
        signal: controller.signal,
      });

      const text = await upstream.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text };
        }
      }

      if (upstream.ok) {
        return response(upstream.status, true, parsed ?? { ok: true });
      }
      if (parsed && typeof parsed === 'object' && parsed.error) {
        return response(upstream.status, false, parsed);
      }
      return errorResponse(upstream.status || 502, 'UPSTREAM_ERROR', '同步服务返回异常状态');
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return errorResponse(504, 'UPSTREAM_TIMEOUT', '连接同步服务超时，请稍后重试');
      }
      return errorResponse(502, 'UPSTREAM_UNREACHABLE', '暂时无法连接同步服务，请检查网络或稍后重试');
    } finally {
      clearTimeout(timer);
    }
  };
}

let cachedCloudMain = null;

function getCloudMain() {
  if (cachedCloudMain) {
    return cachedCloudMain;
  }
  const cloud = require('wx-server-sdk');
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  cachedCloudMain = createSyncGatewayHandler({
    env: () => process.env,
    getWXContext: () => cloud.getWXContext(),
    fetchImpl: globalThis.fetch,
    now: () => Date.now(),
  });
  return cachedCloudMain;
}

exports.MAX_BODY_BYTES = MAX_BODY_BYTES;
exports.computeGatewaySignature = computeGatewaySignature;
exports.deriveGatewaySubject = deriveGatewaySubject;
exports.resolveAllowlistedRoute = resolveAllowlistedRoute;
exports.normalizeBaseUrl = normalizeBaseUrl;
exports.createSyncGatewayHandler = createSyncGatewayHandler;

exports.main = async (event) => getCloudMain()(event);

/**
 * WeChat Mini Program Server-side OpenAPI helper.
 * Retrieves access_token using AppID + AppSecret via the whitelisted proxy,
 * and inspects latest platform version and audit status.
 */
import { writeSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const request = require('request');

function sanitize(str, secret) {
  if (!str || typeof str !== 'string') return str;
  let out = str.replace(/:\/\/([^:@]+):([^@]+)@/g, '://$1:***@');
  if (secret) {
    out = out.split(secret).join('***REDACTED_SECRET***');
  }
  return out;
}

function note(msg, secret) {
  const safeMsg = sanitize(msg, secret);
  try {
    writeSync(2, `[wechat-api] ${safeMsg}\n`);
  } catch {
    console.error(`[wechat-api] ${safeMsg}`);
  }
}

async function getAccessToken({ appid, secret, proxy }) {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
  return new Promise((resolve, reject) => {
    const opts = { url, json: true, timeout: 15000 };
    if (proxy) opts.proxy = proxy;
    request.get(opts, (err, res, body) => {
      if (err) return reject(new Error(sanitize(err.message, secret)));
      if (body && body.errcode && body.errcode !== 0) {
        return reject(new Error(`WeChat API error ${body.errcode}: ${body.errmsg}`));
      }
      if (!body || !body.access_token) {
        return reject(new Error('WeChat API returned empty access_token'));
      }
      resolve(body.access_token);
    });
  });
}

async function getLatestAuditStatus({ token, proxy }) {
  const url = `https://api.weixin.qq.com/wxa/get_latest_auditstatus?access_token=${token}`;
  return new Promise((resolve, reject) => {
    const opts = { url, json: true, timeout: 15000 };
    if (proxy) opts.proxy = proxy;
    request.get(opts, (err, res, body) => {
      if (err) return reject(err);
      resolve(body || {});
    });
  });
}

async function getVersionInfo({ token, proxy }) {
  const url = `https://api.weixin.qq.com/wxa/getversioninfo?access_token=${token}`;
  return new Promise((resolve, reject) => {
    const opts = { url, method: 'POST', json: {}, timeout: 15000 };
    if (proxy) opts.proxy = proxy;
    request(opts, (err, res, body) => {
      if (err) return reject(err);
      resolve(body || {});
    });
  });
}

async function main() {
  const appid = process.env.WECHAT_APPID || 'wxf9bd7099653c6159';
  const secret = process.env.WECHAT_APPSECRET;
  const proxy = process.env.WECHAT_CI_PROXY;

  if (!secret) {
    note('WECHAT_APPSECRET not set. Skipping server OpenAPI check.');
    process.exit(0);
  }

  note(`Retrieving access_token via whitelisted proxy for appid=${appid}`, secret);
  try {
    const token = await getAccessToken({ appid, secret, proxy });
    note('phase=token-retrieved token-length=' + (token ? token.length : 0), secret);
    console.log('[wechat-api] Successfully authenticated with WeChat OpenAPI (access_token acquired).');

    // Query version info
    try {
      const verRes = await getVersionInfo({ token, proxy });
      if (verRes.errcode === 0) {
        if (verRes.exp_info?.exp_version) {
          const expDate = verRes.exp_info.exp_time ? new Date(verRes.exp_info.exp_time * 1000).toISOString() : 'N/A';
          console.log(`[wechat-api] Platform Experience Version: ${verRes.exp_info.exp_version} (updated: ${expDate})`);
        }
        if (verRes.release_info?.release_version) {
          const relDate = verRes.release_info.release_time ? new Date(verRes.release_info.release_time * 1000).toISOString() : 'N/A';
          console.log(`[wechat-api] Platform Released Version: ${verRes.release_info.release_version} (released: ${relDate})`);
        }
      } else {
        note(`Version info query: code=${verRes.errcode} msg=${verRes.errmsg}`, secret);
      }
    } catch (verErr) {
      note(`Version info inspection non-fatal error: ${verErr.message}`, secret);
    }

    // Query audit status
    try {
      const auditRes = await getLatestAuditStatus({ token, proxy });
      if (auditRes.errcode === 0) {
        const statusMap = {
          0: '审核成功 (APPROVED)',
          1: '审核被拒绝 (REJECTED)',
          2: '审核中 (PENDING)',
          3: '已撤回 (REVOKED)',
          4: '延后审核 (DELAYED)',
        };
        console.log(`[wechat-api] Latest Audit Status: [${auditRes.status}] ${statusMap[auditRes.status] || 'UNKNOWN'}`);
        if (auditRes.reason) console.log(`[wechat-api] Rejection Reason: ${auditRes.reason}`);
        if (auditRes.user_version) console.log(`[wechat-api] Audit Version: ${auditRes.user_version}`);
      } else {
        note(`Audit status query: code=${auditRes.errcode} msg=${auditRes.errmsg}`, secret);
      }
    } catch (auditErr) {
      note(`Audit status inspection non-fatal error: ${auditErr.message}`, secret);
    }
  } catch (err) {
    note(`WeChat OpenAPI call failed: ${err.message}`, secret);
    // Non-zero exit code indicates OpenAPI check failure
    process.exit(1);
  }
}

main();

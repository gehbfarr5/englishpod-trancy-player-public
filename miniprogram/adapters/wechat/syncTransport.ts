/**
 * ============================================================================
 *  微信端同步传输适配器（adapters/wechat/syncTransport.ts）
 * ============================================================================
 *  规范来源：EP-SYNC-001 §6
 *    - 默认经由 Tencent CloudBase 云函数 `syncGateway` 透传 Go 同步服务，
 *      使微信小程序无需单独申请 ICP 备案域名；
 *    - 保留 `directBaseUrl` 可选构造参数：未来若切到已备案直连域名，
 *      仅需替换传输构造，不改动上层 SyncEngine / ProgressJournal / UI。
 * ============================================================================
 */

import { CLOUD_FUNCTION_NAMES } from '../../config/env';
import {
  ClaimPairResult,
  PairingStatusResult,
  PairingTicket,
  SyncApiError,
  SyncDeviceSummary,
  SyncPlatform,
  SyncPullResult,
  SyncPushRequest,
  SyncPushResult,
  SyncTransport,
  sanitizeDeviceName,
} from '../../core/syncModels';

export interface SyncGatewayEnvelope {
  readonly ok: boolean;
  readonly status: number;
  readonly data?: Record<string, unknown> & {
    readonly error?: {
      readonly code?: string;
      readonly message?: string;
      readonly retryAfterSec?: number;
    };
  };
}

export type CloudCallFn = (args: {
  name: string;
  data: {
    method: string;
    path: string;
    query?: Record<string, string | number>;
    body?: unknown;
    token?: string;
  };
}) => Promise<{ result?: unknown }>;

export interface WechatSyncTransportOptions {
  readonly callFunction?: CloudCallFn;
  readonly functionName?: string;
}

/** 采集可读且脱敏的微信宿主设备名称（最长 32 字符）。 */
export function detectWechatDeviceName(): string {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getDeviceInfo === 'function') {
      const info = wx.getDeviceInfo();
      const brand = typeof info?.brand === 'string' ? info.brand.trim() : '';
      const model = typeof info?.model === 'string' ? info.model.trim() : '';
      const combined = model && brand && !model.toLowerCase().startsWith(brand.toLowerCase())
        ? `${brand} ${model}`
        : model || brand;
      if (combined) {
        return sanitizeDeviceName(combined, '微信小程序');
      }
    }
  } catch {
    // 降级兜底
  }
  return '微信小程序';
}

function defaultWxCallFunction(args: {
  name: string;
  data: Record<string, unknown>;
}): Promise<{ result?: unknown }> {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      reject(new Error('wx.cloud.callFunction unavailable'));
      return;
    }
    wx.cloud.callFunction({
      name: args.name,
      data: args.data,
      success: (res) => resolve(res as { result?: unknown }),
      fail: (err) => reject(err),
    });
  });
}

function toSyncApiError(res: SyncGatewayEnvelope): SyncApiError {
  const errObj = res.data?.error;
  return new SyncApiError({
    status: res.status || 502,
    code: typeof errObj?.code === 'string' && errObj.code ? errObj.code : 'SYNC_ERROR',
    message: typeof errObj?.message === 'string' && errObj.message ? errObj.message : '同步请求失败',
    retryAfterSec: typeof errObj?.retryAfterSec === 'number' ? errObj.retryAfterSec : undefined,
  });
}

export class WechatSyncTransport implements SyncTransport {
  private readonly callFn: CloudCallFn;
  private readonly functionName: string;

  constructor(options: WechatSyncTransportOptions = {}) {
    this.callFn = options.callFunction ?? defaultWxCallFunction;
    this.functionName = options.functionName ?? CLOUD_FUNCTION_NAMES.syncGateway;
  }

  private async request<T>(params: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    query?: Record<string, string | number>;
    body?: unknown;
    token?: string;
  }): Promise<T> {
    let raw: { result?: unknown };
    try {
      raw = await this.callFn({
        name: this.functionName,
        data: {
          method: params.method,
          path: params.path,
          query: params.query,
          body: params.body,
          token: params.token,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SyncApiError({
        status: 502,
        code: 'UPSTREAM_UNREACHABLE',
        message: message || '云端同步网关调用失败',
      });
    }

    const envelope = raw?.result as SyncGatewayEnvelope | undefined;
    if (!envelope || typeof envelope !== 'object' || typeof envelope.ok !== 'boolean') {
      throw new SyncApiError({
        status: 502,
        code: 'UPSTREAM_UNREACHABLE',
        message: '同步网关返回格式异常',
      });
    }
    if (!envelope.ok) {
      throw toSyncApiError(envelope);
    }
    return envelope.data as unknown as T;
  }

  pairCreate(params: {
    token?: string;
    deviceName: string;
    platform: SyncPlatform;
  }): Promise<PairingTicket> {
    return this.request<PairingTicket>({
      method: 'POST',
      path: '/api/sync/v1/pair/create',
      token: params.token,
      body: {
        deviceName: params.deviceName,
        platform: params.platform,
      },
    });
  }

  pairStatus(params: { token: string; code: string }): Promise<PairingStatusResult> {
    return this.request<PairingStatusResult>({
      method: 'GET',
      path: '/api/sync/v1/pair/status',
      token: params.token,
      query: { code: params.code },
    });
  }

  pairClaim(params: {
    token?: string;
    code: string;
    deviceName: string;
    platform: SyncPlatform;
  }): Promise<ClaimPairResult> {
    return this.request<ClaimPairResult>({
      method: 'POST',
      path: '/api/sync/v1/pair/claim',
      token: params.token,
      body: {
        code: params.code,
        deviceName: params.deviceName,
        platform: params.platform,
      },
    });
  }

  push(params: { token: string; payload: SyncPushRequest }): Promise<SyncPushResult> {
    return this.request<SyncPushResult>({
      method: 'POST',
      path: '/api/sync/v1/sync/push',
      token: params.token,
      body: params.payload,
    });
  }

  pull(params: { token: string; sinceSeq: number }): Promise<SyncPullResult> {
    return this.request<SyncPullResult>({
      method: 'GET',
      path: '/api/sync/v1/sync/pull',
      token: params.token,
      query: { since_seq: params.sinceSeq },
    });
  }

  listDevices(params: { token: string }): Promise<{
    serverTimeMs: number;
    devices: readonly SyncDeviceSummary[];
  }> {
    return this.request({
      method: 'GET',
      path: '/api/sync/v1/devices',
      token: params.token,
    });
  }

  renameSelf(params: { token: string; deviceName: string }): Promise<{
    serverTimeMs: number;
    device: SyncDeviceSummary;
  }> {
    return this.request({
      method: 'PATCH',
      path: '/api/sync/v1/devices/me',
      token: params.token,
      body: { deviceName: params.deviceName },
    });
  }

  revokeDevice(params: { token: string; deviceId: string }): Promise<{
    serverTimeMs: number;
    revokedDeviceId: string;
  }> {
    return this.request({
      method: 'DELETE',
      path: `/api/sync/v1/devices/${params.deviceId}`,
      token: params.token,
    });
  }
}

/**
 * ============================================================================
 *  用户权限与购买服务（services/entitlementService.ts）
 * ============================================================================
 *  管理课程解锁状态、本地落盘、云端同步与微信官方虚拟支付发起。
 * ============================================================================
 */

import { SyncKeyValue, createWxKeyValue } from '../adapters/wechat/learningStore';
import {
  LIFETIME_PRODUCT_ID,
  LIFETIME_PRODUCT_NAME,
  LIFETIME_UNLOCK_PRICE_FEN,
  isLessonLocked,
} from '../core/entitlement';

/** 本地存储键。 */
export const ENTITLEMENT_STORAGE_KEY = 'ep_user_entitlement_v1';

export interface UserEntitlement {
  readonly isVip: boolean;
  readonly orderId?: string;
  readonly unlockedAt?: number;
  readonly expireTime?: number | null;
}

const DEFAULT_ENTITLEMENT: UserEntitlement = {
  isVip: false,
};

/**
 * 校验 iOS 端微信客户端版本是否满足微信官方虚拟支付最低要求（>= 8.0.68）。
 * 微信官方政策：低于 8.0.68 的 iOS 微信客户端不支持原生虚拟支付。
 */
export function isIosWeChatVersionSupported(systemInfo?: { platform?: string; version?: string }): boolean {
  try {
    let sys = systemInfo;
    if (!sys && typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') {
      sys = wx.getSystemInfoSync();
    }
    if (!sys || !sys.platform || sys.platform.toLowerCase() !== 'ios') {
      return true; // 非 iOS 终端放行
    }
    const versionStr = sys.version || '';
    const cur = versionStr.split('.').map(Number);
    const base = [8, 0, 68];
    for (let i = 0; i < 3; i++) {
      const curPart = cur[i] || 0;
      const basePart = base[i] || 0;
      if (curPart > basePart) return true;
      if (curPart < basePart) return false;
    }
    return true;
  } catch {
    return true;
  }
}

export class EntitlementService {
  private readonly kv: SyncKeyValue;
  private cache: UserEntitlement | null = null;
  private readonly listeners = new Set<(isVip: boolean) => void>();

  constructor(kv?: SyncKeyValue) {
    this.kv = kv || createWxKeyValue();
  }

  /**
   * 获取当前用户权限信息（优先内存缓存，次选本地存储）。
   */
  public getEntitlement(): UserEntitlement {
    if (this.cache) {
      return this.cache;
    }

    try {
      const raw = this.kv.get(ENTITLEMENT_STORAGE_KEY);
      if (typeof raw === 'string' && raw.trim().length > 0) {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          this.cache = {
            isVip: Boolean(parsed.isVip),
            orderId: typeof parsed.orderId === 'string' ? parsed.orderId : undefined,
            unlockedAt: typeof parsed.unlockedAt === 'number' ? parsed.unlockedAt : undefined,
            expireTime: parsed.expireTime ?? null,
          };
          return this.cache;
        }
      }
    } catch (err) {
      console.warn('[entitlementService] 读取权限失败，使用默认值：', err);
    }

    this.cache = { ...DEFAULT_ENTITLEMENT };
    return this.cache;
  }

  /**
   * 用户是否拥有全套解锁权益。
   */
  public isVip(): boolean {
    return this.getEntitlement().isVip === true;
  }

  /**
   * 判断指定课程是否已解锁。
   */
  public isLessonUnlocked(lessonId: string | number | undefined | null): boolean {
    return !isLessonLocked(lessonId, this.isVip());
  }

  /**
   * 设置/更新权限信息，并向所有观察者广播。
   */
  public setEntitlement(update: Partial<UserEntitlement>): void {
    const current = this.getEntitlement();
    const next: UserEntitlement = {
      ...current,
      ...update,
    };

    const isVipChanged = current.isVip !== next.isVip;
    this.cache = next;

    try {
      this.kv.set(ENTITLEMENT_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.error('[entitlementService] 保存权限失败：', err);
    }

    if (isVipChanged) {
      this.notifyListeners(next.isVip);
    }
  }

  /**
   * 订阅 VIP 状态变更事件。
   */
  public subscribe(listener: (isVip: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(isVip: boolean): void {
    for (const listener of this.listeners) {
      try {
        listener(isVip);
      } catch (err) {
        console.error('[entitlementService] 监听器执行异常：', err);
      }
    }
  }

  /**
   * 从云端异步拉取最新权益（对账防刷）。
   */
  public async refreshFromCloud(): Promise<boolean> {
    if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      return false;
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'getEntitlement',
      });
      const data = (res && res.result && (res.result as Record<string, unknown>).data) as Record<string, unknown> | undefined;
      if (data && typeof data.isVip === 'boolean') {
        this.setEntitlement({
          isVip: data.isVip,
          unlockedAt: typeof data.unlockedAt === 'number' ? data.unlockedAt : Date.now(),
        });
        return true;
      }
    } catch (err) {
      console.warn('[entitlementService] 从云端同步权益失败：', err);
    }

    return false;
  }

  /**
   * 发起终身通卡虚拟支付购买。
   */
  public async requestUnlockPayment(): Promise<{ success: boolean; errMsg?: string }> {
    if (this.isVip()) {
      return { success: true };
    }

    if (typeof wx === 'undefined') {
      return { success: false, errMsg: 'wx not available' };
    }

    // 1. 调用云函数获取虚拟支付双签参数
    let signResult: Record<string, unknown> | null = null;
    try {
      if (wx.cloud && typeof wx.cloud.callFunction === 'function') {
        let clientPlatform = 'android';
        try {
          const sys = wx.getSystemInfoSync();
          if (sys && sys.platform) {
            clientPlatform = sys.platform.toLowerCase() === 'ios' ? 'ios' : 'android';
          }
        } catch {
          // fallback to android
        }

        const signCall = await wx.cloud.callFunction({
          name: 'virtualPaySign',
          data: {
            productId: LIFETIME_PRODUCT_ID,
            productName: LIFETIME_PRODUCT_NAME,
            priceFen: LIFETIME_UNLOCK_PRICE_FEN,
            platform: clientPlatform,
          },
        });
        signResult = ((signCall && signCall.result) as Record<string, unknown>) || null;
      }
    } catch (err) {
      console.warn('[entitlementService] virtualPaySign 调用失败或未配置：', err);
    }

    // 2. 检查是否有原生虚拟支付支持
    if (typeof (wx as unknown as Record<string, unknown>).requestVirtualPayment === 'function') {
      // 官方合规：iOS 端必须运行在微信客户端 >= 8.0.68
      if (!isIosWeChatVersionSupported()) {
        if (typeof (wx as unknown as { showModal?: (o: Record<string, unknown>) => void }).showModal === 'function') {
          (wx as unknown as { showModal: (o: Record<string, unknown>) => void }).showModal({
            title: '提示',
            content: '当前微信版本较低，请将微信更新至最新版后再进行支付',
            showCancel: false,
          });
        }
        return { success: false, errMsg: '请将微信更新至最新版后再进行支付' };
      }

      return new Promise((resolve) => {
        const signData = (signResult && signResult.signData) || {};
        const paySig = (signResult && signResult.paySig) || '';
        const signature = (signResult && signResult.signature) || '';

        (wx as unknown as { requestVirtualPayment: (options: Record<string, unknown>) => void }).requestVirtualPayment({
          signData: typeof signData === 'string' ? signData : JSON.stringify(signData),
          paySig,
          signature,
          mode: 'short_series_goods',
          success: async (res: unknown) => {
            console.log('[entitlementService] 虚拟支付调起成功：', res);
            // 支付成功后优先尝试从云端对账更新，本地乐观更新保障离线可用
            this.setEntitlement({
              isVip: true,
              unlockedAt: Date.now(),
            });
            await this.refreshFromCloud();
            resolve({ success: true });
          },
          fail: (err: { errMsg?: string }) => {
            console.warn('[entitlementService] 虚拟支付取消或失败：', err);
            resolve({ success: false, errMsg: err.errMsg || '支付已取消' });
          },
        });
      });
    }

    // 兜底模拟体验（当不在真机环境或沙箱调试时）
    console.info('[entitlementService] 当前环境不支持 requestVirtualPayment，模拟解锁成功');
    this.setEntitlement({
      isVip: true,
      unlockedAt: Date.now(),
    });
    return { success: true };
  }
}

/** 全局单例。 */
export const entitlementService = new EntitlementService();

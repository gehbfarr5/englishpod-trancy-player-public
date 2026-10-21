/**
 * ============================================================================
 *  品牌封面 HTTPS 链接解析器（adapters/wechat/brandCover.ts）
 * ============================================================================
 *  iOS 微信锁屏与控制中心音频控件（BAM.coverImgUrl）仅支持真实的 HTTP/HTTPS 链接，
 *  不支持本地文件沙盒路径（wx.env.USER_DATA_PATH）。
 *  本模块将本地 brand_icon_dark.png 确保上传至云存储 brand/ 并换取 HTTPS 链接。
 *
 *  缓存策略（保守有界；远端临时链接的实际寿命未经验证，此处不做断言）：
 *    - 内存与持久缓存统一 schema v2（ep_brand_cover_https_v2），有效期至多 1 小时；
 *      provider 响应 maxAge 更短时取更短值；
 *    - 仅复用「未过期 + https://」的缓存值，过期后重新解析；
 *    - v1（24 小时过期）不可证明合规：一律不再读取，成功写入 v2 后尽力清除。
 * ============================================================================
 */

/** 持久缓存键（v2 schema）。 */
const COVER_CACHE_KEY_V2 = 'ep_brand_cover_https_v2';

/** 已弃用的 v1 持久缓存键（24 小时过期，不再信任）。 */
const COVER_CACHE_KEY_V1 = 'ep_brand_cover_https_v1';

/** 本地缓存有效期上限（毫秒）：保守策略，非对远端链接寿命的断言。 */
const MAX_CACHE_TTL_MS = 60 * 60 * 1000;

/** 缓存项（内存与持久共用 v2 schema）。 */
interface BrandCoverCacheEntry {
  url: string;
  expireAtMs: number;
}

/** 内存单例缓存（带过期）。 */
let memoryCache: BrandCoverCacheEntry | null = null;

function isHttpsUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https:\/\/[^/?#\s]+(?:[/?#][^\s]*)?$/.test(url);
}

/** 校验缓存原文：仅「未过期 + https」的 v2 项可用，否则返回 null。 */
function parseCacheEntry(raw: unknown, nowMs: number): BrandCoverCacheEntry | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const { url, expireAtMs } = raw as { url?: unknown; expireAtMs?: unknown };
  if (
    !isHttpsUrl(url) ||
    typeof expireAtMs !== 'number' ||
    !Number.isFinite(expireAtMs) ||
    expireAtMs <= nowMs ||
    expireAtMs - nowMs > MAX_CACHE_TTL_MS
  ) {
    return null;
  }
  return { url, expireAtMs };
}

/** 读取并校验持久缓存（读取异常按未命中处理）。 */
function readValidPersistentEntry(nowMs: number): BrandCoverCacheEntry | null {
  try {
    return parseCacheEntry(wx.getStorageSync(COVER_CACHE_KEY_V2), nowMs);
  } catch {
    // 忽略缓存读取容错
  }
  return null;
}

export async function resolveBrandCoverHttps(): Promise<string> {
  const nowMs = Date.now();

  if (memoryCache && isHttpsUrl(memoryCache.url) && memoryCache.expireAtMs > nowMs) {
    return memoryCache.url;
  }
  memoryCache = null;

  const persistent = readValidPersistentEntry(nowMs);
  if (persistent) {
    memoryCache = persistent;
    return memoryCache.url;
  }

  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
    return '';
  }

  try {
    const fs = wx.getFileSystemManager();
    const localTarget = `${wx.env.USER_DATA_PATH}/brand_icon_dark.png`;
    try {
      fs.accessSync(localTarget);
    } catch {
      fs.copyFileSync('assets/branding/brand_icon_dark.png', localTarget);
    }

    const uploadRes = await wx.cloud.uploadFile({
      cloudPath: 'brand/brand_icon_dark.png',
      filePath: localTarget,
    });

    const fileID = uploadRes.fileID;
    const tempRes = await wx.cloud.getTempFileURL({ fileList: [fileID] });
    const item = tempRes.fileList && tempRes.fileList[0];
    if (item && item.tempFileURL) {
      const url = item.tempFileURL;
      const ttlMs =
        Number.isFinite(item.maxAge) && item.maxAge > 0
          ? Math.min(item.maxAge * 1000, MAX_CACHE_TTL_MS)
          : MAX_CACHE_TTL_MS;
      if (isHttpsUrl(url)) {
        memoryCache = { url, expireAtMs: Date.now() + ttlMs };
        try {
          wx.setStorageSync(COVER_CACHE_KEY_V2, memoryCache);
        } catch {
          // 忽略写入容错
        }
        try {
          wx.removeStorageSync(COVER_CACHE_KEY_V1);
        } catch {
          // 忽略 v1 清理容错
        }
      }
      return url;
    }
  } catch {
    console.warn('[brandCover] 解析封面 HTTPS 链接失败');
  }

  return '';
}

/** 清空内存缓存（仅测试/诊断用；不影响持久缓存）。 */
export function clearBrandCoverMemoryCache(): void {
  memoryCache = null;
}

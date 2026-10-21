/**
 * ============================================================================
 *  云存储 fileID → 可播放 HTTPS 链接 解析器（adapters/wechat/cloudAudioUrl.ts）
 * ============================================================================
 *  ⚠️ 关键事实：**`InnerAudioContext.src` 不接受 `cloud://` fileID**
 *  （微信仅对 `BackgroundAudioManager.src` 承诺「2.2.3 起支持云文件ID」）。
 *  因此凡是喂给音频播放器的地址，都必须先用 `wx.cloud.getTempFileURL()` 换成
 *  **临时 HTTPS 链接**。
 *
 *  本模块把该解析逻辑收敛到**一处**，供 `audio.ts`（前台 InnerAudioContext）
 *  与 `backgroundAudio.ts`（BAM）共用，并内置：
 *    - 缓存（key=fileID；返回体带 `maxAge` 用其值，否则保守 2 小时）；
 *    - 统一可读错误（抛出 `Error`，含 fileID 与原因，调用方不吞异常）。
 *
 *  说明：解析结果只与 fileID 有关，与具体播放器无关，故做成模块级缓存。
 * ============================================================================
 */

/** 云存储 fileID 前缀。 */
const CLOUD_FILE_PREFIX = 'cloud://';

/** 临时链接缓存兜底有效期（毫秒）：响应未带 maxAge 时保守缓存 2 小时。 */
const DEFAULT_TEMP_URL_TTL_MS = 2 * 60 * 60 * 1000;

/** 缓存项。 */
interface CachedTempUrl {
  url: string;
  expireAtMs: number;
}

/** fileID → 临时链接（模块级共享）。 */
const tempUrlCache = new Map<string, CachedTempUrl>();

/** 是否为云存储 fileID。 */
export function isCloudFileId(src: string): boolean {
  return typeof src === 'string' && src.indexOf(CLOUD_FILE_PREFIX) === 0;
}

/**
 * 把（可能是 fileID 的）音频地址解析为**可播放地址**。
 *
 * - 非 `cloud://`：原样返回（如已是 https 链接）；
 * - `cloud://`：命中未过期缓存直接返回，否则调 `wx.cloud.getTempFileURL` 后缓存。
 *
 * @throws Error 当解析失败（`wx.cloud` 不可用 / 未返回链接 / 调用异常）时抛出，
 *         调用方应记录日志并向上反馈，**不要吞掉**。
 */
export async function resolvePlayableUrl(src: string): Promise<string> {
  if (!isCloudFileId(src)) {
    return src;
  }

  const cached = tempUrlCache.get(src);
  if (cached && cached.expireAtMs > Date.now()) {
    return cached.url;
  }

  if (!wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') {
    throw new Error(
      `wx.cloud.getTempFileURL 不可用（fileID=${src}）。请确认已开通云开发并完成 wx.cloud.init。`,
    );
  }

  const res = await wx.cloud.getTempFileURL({ fileList: [src] });
  const item = res && res.fileList && res.fileList[0];
  const url = item && item.tempFileURL;
  if (!url) {
    throw new Error(
      `getTempFileURL 未返回可用链接（fileID=${src}，errMsg=${(item && item.errMsg) || '无'}）。`,
    );
  }

  const ttlMs =
    item && Number.isFinite(item.maxAge) && item.maxAge > 0
      ? item.maxAge * 1000
      : DEFAULT_TEMP_URL_TTL_MS;
  tempUrlCache.set(src, { url, expireAtMs: Date.now() + ttlMs });
  return url;
}

/** 清空缓存（仅测试/诊断用）。 */
export function clearTempUrlCache(): void {
  tempUrlCache.clear();
}

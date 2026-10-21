/**
 * ============================================================================
 *  微信端音频适配器（adapters/wechat/audio.ts）
 * ============================================================================
 *  实现 `core/types.ts` 的 {@link AudioAdapter} 端口，基于 `InnerAudioContext`
 *  提供**前台**播放 / seek / 倍速能力。
 *
 *  ⚠️ M4 起：默认播放器改用 `backgroundAudio.ts`（`BackgroundAudioManager`，支持后台/锁屏）。
 *  本文件保留为**前台低延迟**实现（见 `playerAudio.ts` 的模式选择），逻辑不删。
 *
 *  ⚠️ 已核验的坑（务必记住）：
 *    1. `InnerAudioContext.playbackRate` 在 **iOS 长音频下不受支持**（Android 需系统 6+）。
 *    2. **`InnerAudioContext.src` 不接受 `cloud://` fileID**——必须先经
 *       `cloudAudioUrl.ts` 的 `resolvePlayableUrl()` 换成临时 HTTPS 再赋给 `src`。
 *    3. 临时 HTTPS 链接必须在 `downloadFile` 合法域名白名单内（否则 onError 报 10002）。
 *    4. `onError` 的 `errCode` 需分类：10001 内部 / 10002 网络 / 10003 资源 / 10004 解码。
 *    5. `onTimeUpdate` 为**前台回调**且**无 payload**，进度需读 `currentTime`。
 *    6. `destroy()` 必须在页面 `onUnload` 调用。
 *
 *  竞态守卫：`load()` 递增 `loadToken`；异步解析 tempFileURL 完成时若 token 已过期则不赋值。
 * ============================================================================
 */

import {
  AudioAdapter,
  AudioAdapterError,
  AudioAdapterEvents,
  PlaybackRate,
} from '../../core/types';
import { isCloudFileId, resolvePlayableUrl } from './cloudAudioUrl';

/** 日志中 URL 展示的前缀长度。 */
const URL_LOG_PREFIX_LEN = 56;

/** errCode → 可读描述 / 是否可重试 / 排查提示。 */
const ERROR_TABLE: Record<number, { message: string; retriable: boolean; hint?: string }> = {
  10001: { message: '内部错误', retriable: true, hint: '底层播放器/资源异常，可重试或换源。' },
  10002: {
    message: '网络错误',
    retriable: true,
    hint: '大概率是 downloadFile 合法域名白名单未配置（或网络不可达）。',
  },
  10003: {
    message: '资源加载失败',
    retriable: false,
    hint: '文件不存在 / 无权限 / 临时链接已过期。',
  },
  10004: { message: '解码失败', retriable: false, hint: '音频格式或编码不受支持。' },
  [-1]: { message: '未知错误', retriable: true },
};

/** 截断展示：超长时只留前缀，便于日志一眼定位。 */
function shortenUrl(url: string): string {
  if (!url) {
    return '(空)';
  }
  return url.length <= URL_LOG_PREFIX_LEN ? url : `${url.slice(0, URL_LOG_PREFIX_LEN)}…`;
}

/** 把原始 errCode 归类为可读错误（可附上下文，如当前用的是 fileID 还是 URL）。 */
export function classifyAudioError(
  errCode: number,
  errMsg: string,
  context?: string,
): AudioAdapterError {
  const info = ERROR_TABLE[errCode] ?? { message: '未知错误', retriable: true };
  const hint = info.hint ? ` ${info.hint}` : '';
  const ctx = context ? ` 【${context}】` : '';
  return {
    errCode,
    message: `[audio] ${info.message}（errCode=${errCode}）：${errMsg || '无详细信息'}。${hint}${ctx}`,
    retriable: info.retriable,
  };
}

/** 微信 `InnerAudioContext` 实现（前台）。 */
export class WechatAudioAdapter implements AudioAdapter {
  private readonly ctx: WechatMiniprogram.InnerAudioContext;

  private events: AudioAdapterEvents = {};

  /** 是否已销毁（销毁后忽略一切迟到事件）。 */
  private destroyed = false;

  /** 载入竞态令牌：每次 load 递增。 */
  private loadToken = 0;

  /** 未 canplay 前的 seek 暂存（canplay 后补做）。 */
  private pendingSeekSec: number | null = null;

  /** 最近一次已知时长（秒）。 */
  private lastDurationSec = 0;

  /** 当前 src 类型（`fileID` / `url` / `none`），用于错误日志定位。 */
  private currentSrcKind: 'fileID' | 'url' | 'none' = 'none';

  /** 当前 src 展示串（fileID 或 https 链接的截断）。 */
  private currentSrcDisplay = '';

  constructor() {
    this.ctx = wx.createInnerAudioContext();
    this.ctx.autoplay = false;
    this.ctx.loop = false;
    this.bindHandlers();
  }

  /** 当前载入令牌（供调试/诊断）。 */
  getLoadToken(): number {
    return this.loadToken;
  }

  setEvents(events: AudioAdapterEvents): void {
    this.events = events;
  }

  /**
   * 载入音频源：`cloud://` fileID 先换临时 HTTPS（带缓存 + 竞态守卫）再赋 `src`；
   * 其它地址直接赋。端口签名保持 `load(src: string): void`——异步解析是适配层内部职责。
   */
  load(src: string): void {
    this.loadToken += 1;
    const token = this.loadToken;
    this.pendingSeekSec = null;
    this.lastDurationSec = 0;

    if (!src) {
      console.warn('[audio] load 收到空 src，已忽略（无音频源）。');
      this.currentSrcKind = 'none';
      this.currentSrcDisplay = '';
      return;
    }

    if (isCloudFileId(src)) {
      this.currentSrcKind = 'fileID';
      this.currentSrcDisplay = src;
      void this.resolveAndAssign(src, token);
      return;
    }

    this.currentSrcKind = 'url';
    this.currentSrcDisplay = src;
    this.assignSrc(src, token);
  }

  play(): void {
    if (this.destroyed) {
      return;
    }
    this.ctx.play();
  }

  pause(): void {
    if (this.destroyed) {
      return;
    }
    this.ctx.pause();
  }

  seek(positionSec: number): void {
    if (this.destroyed) {
      return;
    }
    const dur = this.getDurationSec();
    const target = Number.isFinite(positionSec) ? Math.max(0, positionSec) : 0;
    if (dur <= 0) {
      this.pendingSeekSec = target;
      return;
    }
    try {
      this.ctx.seek(Math.min(target, dur));
    } catch (err) {
      console.error('[audio] seek 失败：', err);
    }
  }

  setPlaybackRate(rate: PlaybackRate): void {
    if (this.destroyed) {
      return;
    }
    try {
      this.ctx.playbackRate = rate;
    } catch (err) {
      console.warn('[audio] 设置 playbackRate 失败（iOS 长音频可能不支持）：', err);
    }
  }

  isPaused(): boolean {
    return this.ctx.paused !== false;
  }

  getPositionSec(): number {
    const t = this.ctx.currentTime;
    return Number.isFinite(t) && t > 0 ? t : 0;
  }

  getDurationSec(): number {
    const d = this.ctx.duration;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.pendingSeekSec = null;
    try {
      this.ctx.destroy();
    } catch (err) {
      console.warn('[audio] destroy 失败：', err);
    }
  }

  /** 把（已可用的）地址赋给 `src`，并做竞态/销毁守卫。**本类唯一的 `ctx.src` 写点**。 */
  private assignSrc(src: string, token: number): void {
    if (this.destroyed || token !== this.loadToken) {
      return; // 已被更新的 load 取代或已销毁：丢弃，避免旧 URL 覆盖新音轨
    }
    try {
      this.ctx.src = src;
    } catch (err) {
      console.error('[audio] 设置 src 失败：', err);
    }
  }

  /** 解析 fileID → tempFileURL 并赋值；失败时记录并回调 onError（不吞异常）。 */
  private async resolveAndAssign(fileID: string, token: number): Promise<void> {
    try {
      const url = await resolvePlayableUrl(fileID);
      console.info(`[audio] fileID 已解析：${shortenUrl(fileID)} → ${shortenUrl(url)}`);
      this.assignSrc(url, token);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const msg = `[audio] 解析 cloud fileID 失败（fileID=${fileID}）：${detail}`;
      console.error(msg, err);
      if (!this.destroyed && token === this.loadToken) {
        this.events.onError?.({ errCode: -1, message: msg, retriable: true });
      }
    }
  }

  /** 绑定一次事件（读取 this.events，避免重复绑定导致抖动）。 */
  private bindHandlers(): void {
    const ctx = this.ctx;

    ctx.onCanplay(() => {
      if (this.destroyed) {
        return;
      }
      const dur = this.getDurationSec();
      if (dur > 0 && dur !== this.lastDurationSec) {
        this.lastDurationSec = dur;
        this.events.onDurationChange?.(dur);
      }
      if (this.pendingSeekSec !== null && dur > 0) {
        const target = Math.min(this.pendingSeekSec, dur);
        this.pendingSeekSec = null;
        try {
          ctx.seek(target);
        } catch (err) {
          console.warn('[audio] 补做 pendingSeek 失败：', err);
        }
      }
      this.events.onCanplay?.();
    });

    ctx.onPlay(() => {
      if (!this.destroyed) {
        this.events.onPlay?.();
      }
    });

    ctx.onPause(() => {
      if (!this.destroyed) {
        this.events.onPause?.();
      }
    });

    ctx.onEnded(() => {
      if (!this.destroyed) {
        this.events.onEnded?.();
      }
    });

    ctx.onWaiting(() => {
      if (!this.destroyed) {
        this.events.onWaiting?.();
      }
    });

    ctx.onTimeUpdate(() => {
      if (!this.destroyed) {
        this.events.onTimeUpdate?.(this.getPositionSec());
      }
    });

    ctx.onSeeked(() => {
      if (!this.destroyed) {
        this.events.onSeeked?.(this.getPositionSec());
      }
    });

    ctx.onError((res: WechatMiniprogram.InnerAudioContextOnErrorListenerResult) => {
      if (this.destroyed) {
        return;
      }
      const context = `源类型=${this.currentSrcKind}，URL=${shortenUrl(this.currentSrcDisplay)}`;
      const error = classifyAudioError(res.errCode, res.errMsg, context);
      console.error(error.message);
      this.events.onError?.(error);
    });
  }
}

/**
 * ============================================================================
 *  微信端后台音频适配器（adapters/wechat/backgroundAudio.ts）
 * ============================================================================
 *  基于 `BackgroundAudioManager`（简称 BAM）实现 {@link AudioAdapter}，提供
 *  **后台播放 + 锁屏控制条 + 耳机按键**能力，是 M4 起的**默认播放器**。
 *
 *  ⚠️ 已核验的平台事实（据此设计，勿再假设）：
 *    1. **BAM 支持 `playbackRate`**（基础库 2.11.0 起，0.5–2.0）→ 倍速与后台**不冲突**。
 *    2. **BAM 是单例**：切换 pb/dg 音轨必须重建 `src`；赋值前快照 `{posSec, segIdx}`，
 *       赋新 `src` 后 seek 回去（断音窗口尽量压小）。
 *    3. **设置 `src` 会自动开始播放**（官方明确）→ 不想播放时需在赋值后立即 `pause()`；
 *       但这次 `pause()` 常打在「src 已赋值、尚未开播」的空窗里被吞掉（自动播放是异步的），
 *       故本模块用 `pendingPause` 记录意图，在 `onCanplay` / `onPlay` 时补兑现。
 *    4. **`onPrev` / `onNext` 仅 iOS 支持，Android 无回调** → Android 端必须依赖应用内按钮。
 *       此差异在 `AudioAdapterEvents.onPrev/onNext` 的注释中亦已标注。
 *    5. `onTimeUpdate` 仅小程序**前台**回调 → 后台靠 `core/timelineEngine` 插值外推推进，
 *       回前台用真实采样重锚（页面负责）。
 *    6. BAM **无 `off*` 方法**且为单例 → 本模块在**模块级只绑定一次**事件，
 *       通过 `activeAdapter` 分发到当前实例，避免反复进出播放器导致事件重复叠加。
 *    7. `coverImgUrl`/`title` 等元数据用于原生播放器与分享卡片；`title` 必填非空。
 *    8. **换 `src` 后到 `onCanplay` 前的 `seek()` / `play()` 会被平台静默丢弃**（真机
 *       观察：切轨与重进丢恢复位、点播回弹，Issue #52 / #53）→ 本适配器在该窗口把
 *       意图缓冲到 `pendingSeekSec` / `pendingPlay`，`onCanplay`（或首个已知时长的
 *       `onTimeUpdate`）后补做一次；就绪后的 seek/play 仍直发，行为不变。
 *
 *  端口契约：`AudioAdapter.load(src: string): void` 签名不变；`cloud://` fileID 的
 *  异步解析（含缓存）复用 `cloudAudioUrl.ts`，`src` 赋值收敛到唯一 `assignSrc`。
 * ============================================================================
 */

import {
  AudioAdapter,
  AudioAdapterEvents,
  AudioMetadata,
  PlaybackRate,
} from '../../core/types';
import { playbackSession } from '../../services/playbackSession';
import { classifyAudioError } from './audio';
import { BrandCoverTheme, resolveBrandCoverHttps } from './brandCover';
import { isCloudFileId, resolvePlayableUrl } from './cloudAudioUrl';

/** 当前活动的后台适配器实例（BAM 单例，事件模块级只绑一次）。 */
let activeAdapter: BackgroundAudioAdapter | null = null;

/** 事件是否已绑定（模块级一次性）。 */
let handlersBound = false;

/** 日志中 URL 展示的前缀长度。 */
const URL_LOG_PREFIX_LEN = 56;

/**
 * 「暂停意图」保护期（ms）。
 *
 * BAM 赋 `src` 后的自动播放发生在加载窗口内（通常 < 1s）；给 3s 足够覆盖慢机与
 * `cloud://` 异步解析，又不会长到拦掉用户随后从锁屏按下的播放。
 */
const PAUSE_INTENT_WINDOW_MS = 3000;

/** 截断展示。 */
function shortenUrl(url: string): string {
  if (!url) {
    return '(空)';
  }
  return url.length <= URL_LOG_PREFIX_LEN ? url : `${url.slice(0, URL_LOG_PREFIX_LEN)}…`;
}

/** 模块级绑定 BAM 事件（仅一次），统一分发给 activeAdapter。 */
function ensureHandlersBound(manager: WechatMiniprogram.BackgroundAudioManager): void {
  if (handlersBound) {
    return;
  }
  handlersBound = true;

  manager.onCanplay(() => activeAdapter?.handleCanplay());
  manager.onPlay(() => activeAdapter?.handlePlay());
  manager.onPause(() => activeAdapter?.handlePause());
  manager.onStop(() => activeAdapter?.handleStop());
  manager.onEnded(() => activeAdapter?.handleEnded());
  manager.onTimeUpdate(() => activeAdapter?.handleTimeUpdate());
  manager.onSeeked(() => activeAdapter?.handleSeeked());
  manager.onWaiting(() => activeAdapter?.handleWaiting());
  manager.onError((res: WechatMiniprogram.GeneralCallbackResult) =>
    activeAdapter?.handleError(res),
  );
  // ⚠️ 仅 iOS 有回调；Android 无回调（应用内按钮兜底）。
  manager.onPrev(() => activeAdapter?.handlePrev());
  manager.onNext(() => activeAdapter?.handleNext());

  if (typeof wx !== 'undefined' && typeof wx.onThemeChange === 'function') {
    wx.onThemeChange((res: { theme: string }) => {
      activeAdapter?.handleThemeChange(res.theme === 'light' ? 'light' : 'dark');
    });
  }
}



/** 微信 `BackgroundAudioManager` 实现。 */
export class BackgroundAudioAdapter implements AudioAdapter {
  private readonly manager: WechatMiniprogram.BackgroundAudioManager;

  private events: AudioAdapterEvents = {};

  private destroyed = false;

  /** 载入竞态令牌。 */
  private loadToken = 0;

  /** 锁屏元数据（load 时应用到 BAM）。 */
  private metadata: AudioMetadata | null = null;

  /** 本轮 load 未就绪（尚未 canplay）期间缓冲的 seek 目标（秒）。 */
  private pendingSeekSec: number | null = null;

  /** 本轮 load 未就绪期间缓冲的播放意图（Issue #53：无源 play 被平台静默吞掉）。 */
  private pendingPlay = false;

  /**
   * 未兑现的暂停意图（仅在「load 未就绪窗口」内布防）。
   *
   * BAM 在 `src` 赋值后**异步**自动开播（事实 3），而切轨时 `load()` 之后紧跟的
   * `pause()` 往往落在「还没开始播」的空窗里 → 这次 pause 被吞，随后的自动播放触发
   * `onPlay`，页面把 UI 改成播放中。表现就是**暂停态切轨会自己播起来**。
   *
   * 因此暂停也像 seek/play 一样需要「意图」：置位后由 `onCanplay` / `onPlay` 补兑现。
   * 只在 load 未就绪时布防，并带 {@link PAUSE_INTENT_WINDOW_MS} 保护期 —— 否则会
   * 顺带拦掉「暂停后隔一会儿从锁屏按播放」的真实用户意图。
   */
  private pendingPause = false;

  /** 暂停意图的失效时刻（ms）；过了这个点说明自动播放窗口已过，不再拦截。 */
  private pendingPauseUntil = 0;

  /** 最近一次 canplay 所属的 loadToken（0 = 尚无；等于 loadToken 即「本轮已就绪」）。 */
  private readyToken = 0;

  /** 当前倍速（load/切轨后应用）。 */
  private pendingRate: PlaybackRate = 1.0;

  /** 最近一次已知时长（秒）。 */
  private lastDurationSec = 0;

  private currentSrcKind: 'fileID' | 'url' | 'none' = 'none';

  private currentSrcDisplay = '';

  constructor() {
    this.manager = wx.getBackgroundAudioManager();
    activeAdapter = this;
    ensureHandlersBound(this.manager);
  }

  setEvents(events: AudioAdapterEvents): void {
    this.events = events;
  }

  /** 设置锁屏 / 通知栏元数据（title/epname/singer/coverImgUrl）。 */
  setMetadata(meta: AudioMetadata): void {
    this.metadata = meta;
  }

  /**
   * 载入音频源。
   *
   * ⚠️ BAM 在设置 `src` 时会**自动播放**；调用方若不想播放，需在 load 后立即 `pause()`。
   */
  load(src: string): void {
    this.loadToken += 1;
    const token = this.loadToken;
    this.pendingSeekSec = null;
    this.pendingPlay = false;
    this.lastDurationSec = 0;

    if (!src) {
      console.warn('[bgAudio] load 收到空 src，已忽略（无音频源）。');
      this.currentSrcKind = 'none';
      this.currentSrcDisplay = '';
      // 空 src 不产生待定轮次：不进入缓冲窗口，play/seek 维持直发（防御路径）。
      this.readyToken = token;
      return;
    }

    this.applyMetadata();
    this.applyRate();

    // 换轨前若旧音频正在播放，立即暂停旧源，防止在解析新源/缓冲期间旧声音继续外放
    if (!this.isPaused()) {
      try {
        this.manager.pause();
      } catch {
        // 容错忽略
      }
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
    // 显式播放是新的最新意图：撤销此前未被兑现的暂停。
    this.pendingPause = false;
    if (this.isLoadPending()) {
      // src 未就绪（本轮 load 尚未 canplay）：无源 play() 会被平台静默吞掉
      // （Issue #53 回弹），缓冲意图，canplay 后自动恢复。
      this.pendingPlay = true;
      return;
    }
    this.manager.play();
  }

  pause(): void {
    if (this.destroyed) {
      return;
    }
    // 最新意图覆盖：暂停取消此前缓冲的播放意图。
    this.pendingPlay = false;
    // 仅当本轮 src 尚未就绪时才需要「意图」：此时同步 pause 打在空窗上会被平台吞掉，
    // 必须等 onCanplay / onPlay 再兑现一次，否则会被 BAM 的自动播放顶掉。
    if (this.isLoadPending()) {
      this.pendingPause = true;
      this.pendingPauseUntil = Date.now() + PAUSE_INTENT_WINDOW_MS;
    }
    this.manager.pause();
  }

  /** 是否仍处于「暂停意图有效」窗口。 */
  private hasPauseIntent(): boolean {
    return this.pendingPause && Date.now() < this.pendingPauseUntil;
  }

  seek(positionSec: number): void {
    if (this.destroyed) {
      return;
    }
    const dur = this.getDurationSec();
    const target = Number.isFinite(positionSec) ? Math.max(0, positionSec) : 0;
    const seekPos = dur > 0 ? Math.min(target, dur) : target;
    // 最新 seek 意图总是覆盖旧缓冲（无论走缓冲还是直发路径）。
    this.pendingSeekSec = null;
    if (this.isLoadPending() || dur <= 0) {
      // src 未就绪（本轮 load 尚未 canplay）或时长未知：此刻直发会被平台静默丢弃
      // （Issue #52），且 fileID 异步解析期间直发会误伤仍在播的旧 src → 缓冲待补做。
      this.pendingSeekSec = seekPos;
      return;
    }
    try {
      this.manager.seek(seekPos);
    } catch (err) {
      console.error('[bgAudio] seek 失败：', err);
    }
  }

  setPlaybackRate(rate: PlaybackRate): void {
    this.pendingRate = rate;
    this.applyRate();
  }

  isPaused(): boolean {
    return this.manager.paused !== false;
  }

  getPositionSec(): number {
    const t = this.manager.currentTime;
    return Number.isFinite(t) && t > 0 ? t : 0;
  }

  getDurationSec(): number {
    const d = this.manager.duration;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.pendingSeekSec = null;
    this.pendingPlay = false;
    if (activeAdapter === this) {
      activeAdapter = null;
    }
    try {
      this.manager.stop();
    } catch (err) {
      console.warn('[bgAudio] stop 失败：', err);
    }
  }

  // ---- 事件处理（由模块级绑定分发，供 activeAdapter 调用） ----

  handleCanplay(): void {
    if (this.destroyed) {
      return;
    }
    // 本轮 load 的 src 已就绪：解除缓冲窗口，后续 seek/play 直发。
    this.readyToken = this.loadToken;
    // onCanplay 同样置位「本进程 src 已加载」：覆盖不经 assignSrc 的赋源路径。
    playbackSession.markSrcLoaded();
    const dur = this.getDurationSec();
    if (dur > 0 && dur !== this.lastDurationSec) {
      this.lastDurationSec = dur;
      this.events.onDurationChange?.(dur);
    }
    this.consumePendingSeek(dur);
    // 未兑现的暂停优先于缓冲的播放（两者互斥，由 play/pause 互相清除）：
    // BAM 赋 src 后会自动开播，若此处不补一次 pause，就会出现「暂停态切轨自己播起来」。
    if (this.hasPauseIntent()) {
      try {
        this.manager.pause();
      } catch (err) {
        console.warn('[bgAudio] 补做 pendingPause 失败：', err);
      }
    } else if (this.pendingPlay) {
      this.pendingPlay = false;
      try {
        this.manager.play();
      } catch (err) {
        console.warn('[bgAudio] 补做 pendingPlay 失败：', err);
      }
    }
    this.applyRate();
    this.events.onCanplay?.();
  }

  handlePlay(): void {
    if (this.destroyed) {
      return;
    }
    // 迟到的自动播放撞上未兑现的暂停：立即压回去，且**不**向页面广播「已播放」，
    // 否则 UI 会闪一下播放态并被 store 记成 playing（暂停态切轨的假播放）。
    if (this.hasPauseIntent()) {
      try {
        this.manager.pause();
      } catch (err) {
        console.warn('[bgAudio] 拦截自动播放失败：', err);
      }
      return;
    }
    this.applyRate();
    playbackSession.setIsPlaying(true);
    this.events.onPlay?.();
  }

  handlePause(): void {
    if (this.destroyed || this.isLoadPending()) {
      return;
    }
    playbackSession.setIsPlaying(false);
    this.events.onPause?.();
  }

  /** BAM `onStop`：视为暂停（停止播放状态）。 */
  handleStop(): void {
    if (this.destroyed || this.isLoadPending()) {
      return;
    }
    playbackSession.setIsPlaying(false);
    this.events.onPause?.();
  }

  handleEnded(): void {
    if (this.destroyed || this.isLoadPending()) {
      return;
    }
    if (this.events.onEnded) {
      this.events.onEnded();
    } else {
      playbackSession.handleNaturalEnded();
    }
  }

  handleTimeUpdate(): void {
    if (this.destroyed || this.isLoadPending()) {
      return;
    }
    const pos = this.getPositionSec();
    const dur = this.getDurationSec();
    this.consumePendingSeek(dur);
    playbackSession.onTimeUpdate(pos, dur);
    this.events.onTimeUpdate?.(pos);
  }

  handleSeeked(): void {
    if (this.destroyed || this.isLoadPending()) {
      return;
    }
    this.events.onSeeked?.(this.getPositionSec());
  }

  handleWaiting(): void {
    if (!this.destroyed) {
      this.events.onWaiting?.();
    }
  }

  handleError(res: WechatMiniprogram.GeneralCallbackResult): void {
    if (this.destroyed) {
      return;
    }
    const errCode = typeof (res as { errCode?: number }).errCode === 'number'
      ? ((res as { errCode?: number }).errCode as number)
      : -1;
    const context = `源类型=${this.currentSrcKind}，URL=${shortenUrl(this.currentSrcDisplay)}`;
    const error = classifyAudioError(errCode, res.errMsg || '', context);
    console.error(error.message);
    this.events.onError?.(error);
  }

  /** 耳机/锁屏「上一句」（仅 iOS 有回调）。 */
  handlePrev(): void {
    if (!this.destroyed) {
      this.events.onPrev?.();
    }
  }

  /** 耳机/锁屏「下一句」（仅 iOS 有回调）。 */
  handleNext(): void {
    if (!this.destroyed) {
      this.events.onNext?.();
    }
  }

  // ---- 内部 ----

  /** 本轮 load 是否尚未就绪（load 之后、canplay 之前，含 fileID 异步解析窗口）。 */
  private isLoadPending(): boolean {
    return this.loadToken !== this.readyToken;
  }

  /** 就绪后补做缓冲的 seek（时长已知才消费；消费即清空，幂等）。 */
  private consumePendingSeek(dur: number): void {
    if (this.pendingSeekSec === null || dur <= 0) {
      return;
    }
    const target = Math.min(this.pendingSeekSec, dur);
    this.pendingSeekSec = null;
    try {
      this.manager.seek(target);
    } catch (err) {
      console.warn('[bgAudio] 补做 pendingSeek 失败：', err);
    }
  }

  private detectTheme(): BrandCoverTheme {
    try {
      const info = wx.getSystemInfoSync?.();
      if (info && info.theme === 'light') {
        return 'light';
      }
    } catch {
      // 忽略
    }
    return 'dark';
  }

  private resolveThemeFromCover(cover: string): BrandCoverTheme {
    if (cover.includes('light')) return 'light';
    if (cover.includes('dark')) return 'dark';
    return this.detectTheme();
  }

  /** 系统主题切换时同步更新锁屏与控制中心封面（支持 iOS 深浅色切换）。 */
  handleThemeChange(theme: BrandCoverTheme): void {
    if (this.destroyed || !this.manager) return;
    const cover = this.metadata?.coverImgUrl || '';
    if (cover.startsWith('http://') || cover.startsWith('https://')) return;
    void resolveBrandCoverHttps(theme).then((httpsUrl) => {
      if (httpsUrl && !this.destroyed) {
        try {
          this.manager.coverImgUrl = httpsUrl;
        } catch {
          // 忽略
        }
      }
    });
  }

  /** 应用锁屏元数据（title 必填非空，否则告警）。 */
  private applyMetadata(): void {
    const meta = this.metadata;
    if (!meta) {
      return;
    }
    try {
      if (!meta.title) {
        console.warn('[bgAudio] 锁屏元数据 title 为空，可能导致 BAM 拒绝播放。');
      }
      this.manager.title = meta.title || 'EnglishPod';
      this.manager.epname = meta.album || 'EnglishPod';
      this.manager.singer = meta.artist || 'EnglishPod';
      const cover = meta.coverImgUrl || '';
      if (cover.startsWith('http://') || cover.startsWith('https://')) {
        this.manager.coverImgUrl = cover;
      } else {
        const theme = this.resolveThemeFromCover(cover);
        void resolveBrandCoverHttps(theme).then((httpsUrl) => {
          if (httpsUrl && !this.destroyed) {
            this.manager.coverImgUrl = httpsUrl;
          }
        });
      }
    } catch (err) {
      console.warn('[bgAudio] 设置锁屏元数据失败：', err);
    }
  }

  /** 应用倍速（BAM 支持 playbackRate，2.11.0+）。 */
  private applyRate(): void {
    try {
      this.manager.playbackRate = this.pendingRate;
    } catch (err) {
      console.warn('[bgAudio] 设置 playbackRate 失败：', err);
    }
  }

  /** **本类唯一的 `manager.src` 写点**：带竞态/销毁守卫。⚠️ 赋值即自动播放。 */
  private assignSrc(src: string, token: number): void {
    if (this.destroyed || token !== this.loadToken) {
      return;
    }
    try {
      this.applyMetadata();
      this.applyRate();
      this.manager.src = src;
      // 赋值成功即置位（赋值抛错走 catch，不置位）。
      playbackSession.markSrcLoaded();
      this.applyRate();
    } catch (err) {
      console.error('[bgAudio] 设置 src 失败：', err);
    }
  }

  /** 解析 fileID → tempFileURL 并赋值；失败记录并回调 onError（不吞异常）。 */
  private async resolveAndAssign(fileID: string, token: number): Promise<void> {
    try {
      const url = await resolvePlayableUrl(fileID);
      console.info(`[bgAudio] fileID 已解析：${shortenUrl(fileID)} → ${shortenUrl(url)}`);
      this.assignSrc(url, token);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const msg = `[bgAudio] 解析 cloud fileID 失败（fileID=${fileID}）：${detail}`;
      console.error(msg, err);
      if (!this.destroyed && token === this.loadToken) {
        this.events.onError?.({ errCode: -1, message: msg, retriable: true });
      }
    }
  }
}

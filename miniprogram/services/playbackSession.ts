/**
 * ============================================================================
 *  全局播放会话（services/playbackSession.ts）
 * ============================================================================
 *  职责（重构后收窄）：
 *    1. 跨页面（课程库 ↔ 播放页 ↔ 后台播放）维护**运行时**播放状态；
 *    2. 自然播完切下一课（Auto Next Lesson）调度；
 *    3. 后台播放期间按 §4.1.1 周期提交断点——**只经由 progressJournal**。
 *
 *  重构要点（对齐 EP-PBC-001）：
 *    - **不再自己读写进度存储**。旧实现里的 `saveProgressSnapshot()` + 1s 节流 +
 *      30s 防回退阈值已删除：它与 `pages/player` 的写入方互为竞争，是「重进丢进度」
 *      与「双写串扰」的结构性原因（§4.1.4）。现在唯一写入通道是
 *      `services/progressJournal.ts`。
 *    - **`isLessonActive()` 增加「本进程已赋过 src」门控**（§4.1.2）。冷启动时
 *      `initFromStorage` 会恢复 lessonId/track，但 BAM 在本进程从未载入音频源，
 *      此时若判为「正在活跃播放」，播放页会跳过 `load()/seek()`，播放头停在
 *      BAM 的 currentTime=0——这就是 0.3.5 真机「退出微信重进、打开原课程、
 *      位置从 0 开始」的直接成因。
 * ============================================================================
 */

import { WechatCloudAdapter } from '../adapters/wechat/cloud';
import { USE_MOCK_DATA } from '../config/env';
import { formatLessonAttributes } from '../core/lessonAttributes';
import { CommitReason } from '../core/learningRecord';
import { MOBILE_AUTO_NEXT_ENABLED, nextLessonIndex } from '../core/entryPlan';
import { AudioTrackKey, CloudAdapter, LessonIndexItem, PlaybackRate } from '../core/types';
import { MockCloudAdapter } from '../mock/index';
import { ProgressJournal, progressJournal } from './progressJournal';

/** 后台播放期间的断点提交周期（§4.1.1 推荐约 3s）。 */
export const BACKGROUND_COMMIT_INTERVAL_MS = 3000;

export interface PlaybackSessionState {
  lessonId: string;
  track: AudioTrackKey;
  title: string;
  attributes: string;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  progressPct: number;
  repeatEpisode: boolean;
  singleSentenceLoop: boolean;
  rate: PlaybackRate;
}

type ProgressListener = (positionSec: number, durationSec: number, progressPct: number) => void;
type StateListener = (state: PlaybackSessionState) => void;
type LessonChangeListener = (newLessonId: string) => void;

/** canplay 后延迟解锁：让紧随其后的 0.0s timeUpdate 事件先冲刷。 */
export const AUDIO_LOAD_UNLOCK_DELAY_MS = 60;

/** 加载锁兜底超时：canplay 永不到达时强制解锁，避免永久抑制保存。 */
export const AUDIO_LOAD_LOCK_TIMEOUT_MS = 10000;

/** 定时器句柄（可注入，便于单测确定性推进）。 */
export type SessionTimerHandle = ReturnType<typeof setTimeout>;

export interface PlaybackSessionOptions {
  readonly setTimer?: (fn: () => void, ms: number) => SessionTimerHandle;
  readonly clearTimer?: (handle: SessionTimerHandle) => void;
  /** 进度写入通道（单测注入；生产共用全局单例）。 */
  readonly journal?: ProgressJournal;
  /** 时钟（单测注入）。 */
  readonly now?: () => number;
}

export class PlaybackSessionService {
  private readonly adapter: CloudAdapter;

  private readonly journal: ProgressJournal;

  private readonly now: () => number;

  private state: PlaybackSessionState = {
    lessonId: '',
    track: 'pb',
    title: '',
    attributes: '',
    isPlaying: false,
    positionSec: 0,
    durationSec: 0,
    progressPct: 0,
    repeatEpisode: false,
    singleSentenceLoop: false,
    rate: 1.0,
  };

  private progressListeners: Set<ProgressListener> = new Set();
  private stateListeners: Set<StateListener> = new Set();
  private lessonChangeListeners: Set<LessonChangeListener> = new Set();

  /** 最近一次后台提交的时间戳（§4.1.1 约 3s 周期）。 */
  private lastBackgroundCommitMs = 0;

  /** 本进程是否已为 BackgroundAudioManager 赋过 `src`（冷启动恒为 false，不持久化）。 */
  private srcLoadedInProcess = false;

  /** 播放页是否在前台（前台由页面自己提交；后台由本会话提交，避免重复写）。 */
  private foregroundOwner = false;

  /** 加载锁令牌：每次 beginAudioLoad 递增，过期 canplay 事件据此丢弃。 */
  private audioLoadToken = 0;

  /** 当前加载锁所属课程/音轨（解锁时需要回传 journal）。 */
  private loadScope: { lessonId: string; track: AudioTrackKey } | null = null;

  /** 解锁定时器（60ms 延迟解锁 / 10s 兜底解锁共用）。 */
  private unlockTimer: SessionTimerHandle | null = null;

  private readonly setTimer: (fn: () => void, ms: number) => SessionTimerHandle;

  private readonly clearTimer: (handle: SessionTimerHandle) => void;

  constructor(options: PlaybackSessionOptions = {}) {
    this.adapter = USE_MOCK_DATA ? new MockCloudAdapter() : new WechatCloudAdapter();
    this.journal = options.journal ?? progressJournal;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.initFromJournal();
  }

  /** 冷启动：从持久化记录恢复「最后打开的课程」与断点，仅用于课程库展示。 */
  private initFromJournal(): void {
    const lastId = this.journal.lastOpenedLessonId();
    if (!lastId) {
      return;
    }
    const record = this.journal.readRecord(lastId);
    this.state.lessonId = lastId;
    // 音轨不持久化（§4：selectedTab 属 RuntimeState），默认 PB。
    this.state.track = 'pb';
    this.state.positionSec = this.journal.resolveResumeMs(lastId, 'pb') / 1000;
    const podcast = record.podcast;
    this.state.durationSec =
      podcast && podcast.durationMs !== undefined ? podcast.durationMs / 1000 : 0;
    this.state.progressPct =
      this.state.durationSec > 0
        ? Math.min(100, Math.round((this.state.positionSec / this.state.durationSec) * 100))
        : 0;
  }

  getState(): PlaybackSessionState {
    // 实时结合 BackgroundAudioManager 校验当前播放态与位置（仅本进程已载源时有意义）
    if (this.srcLoadedInProcess) {
      try {
        const bam = wx.getBackgroundAudioManager();
        if (bam) {
          this.state.isPlaying =
            !bam.paused && typeof bam.currentTime === 'number' && bam.currentTime > 0;
          if (typeof bam.currentTime === 'number' && bam.currentTime > 0) {
            this.state.positionSec = bam.currentTime;
          }
          if (typeof bam.duration === 'number' && bam.duration > 0) {
            this.state.durationSec = bam.duration;
          }
          if (this.state.durationSec > 0) {
            this.state.progressPct = Math.min(
              100,
              Math.round((this.state.positionSec / this.state.durationSec) * 100),
            );
          }
        }
      } catch {
        // 忽略
      }
    }
    return { ...this.state };
  }

  setLessonInfo(info: {
    lessonId: string;
    track?: AudioTrackKey;
    title?: string;
    attributes?: string;
    durationSec?: number;
    repeatEpisode?: boolean;
    singleSentenceLoop?: boolean;
    rate?: PlaybackRate;
  }): void {
    let changed = false;
    if (info.lessonId && info.lessonId !== this.state.lessonId) {
      this.state.lessonId = info.lessonId;
      changed = true;
    }
    if (info.track !== undefined) this.state.track = info.track;
    if (info.title !== undefined) this.state.title = info.title;
    if (info.attributes !== undefined) this.state.attributes = info.attributes;
    if (info.durationSec !== undefined && info.durationSec > 0) {
      this.state.durationSec = info.durationSec;
    }
    if (info.repeatEpisode !== undefined) this.state.repeatEpisode = info.repeatEpisode;
    if (info.singleSentenceLoop !== undefined) {
      this.state.singleSentenceLoop = info.singleSentenceLoop;
    }
    if (info.rate !== undefined) this.state.rate = info.rate;

    if (changed) {
      for (const listener of this.lessonChangeListeners) {
        listener(this.state.lessonId);
      }
    }
    this.notifyState();
  }

  setIsPlaying(isPlaying: boolean): void {
    if (this.state.isPlaying !== isPlaying) {
      this.state.isPlaying = isPlaying;
      this.notifyState();
    }
  }

  /**
   * 标记「本进程已为 BAM 加载音频源」。
   *
   * 微信杀进程重启后模块状态归零 → 冷启动恒为 false，此时 BAM 没有可播放的源，
   * 任何 `play()`/`seek()` 都会被平台静默吞掉。
   */
  markSrcLoaded(): void {
    this.srcLoadedInProcess = true;
  }

  /** 本进程是否已为 BAM 加载过音频源。 */
  isSrcLoadedInProcess(): boolean {
    return this.srcLoadedInProcess;
  }

  /**
   * 声明播放页是否在前台。
   *
   * 前台由播放页提交断点（能拿到句索引与真实媒体位置）；后台才由本会话按 3s
   * 周期提交。两者共用同一个 `progressJournal`，不会产生第二条写入通道。
   */
  setForegroundOwner(owner: boolean): void {
    this.foregroundOwner = owner;
  }

  /**
   * 进入音频加载锁（§4.1.2）。
   *
   * 锁定期内该课该轨的位置提交一律拒绝——此刻播放器位置来自尚未就绪的媒体。
   *
   * @returns 本轮令牌；`endAudioLoad(token)` 需原样传回。
   */
  beginAudioLoad(lessonId: string, track: AudioTrackKey): number {
    this.audioLoadToken += 1;
    const token = this.audioLoadToken;
    this.loadScope = { lessonId, track };
    this.journal.beginLoad(lessonId, track);
    this.clearUnlockTimer();
    // 兜底：canplay 永不到达（网络/源错误）时也必须解锁，否则进度永不落盘。
    this.unlockTimer = this.setTimer(() => {
      this.unlockTimer = null;
      if (token !== this.audioLoadToken) return;
      this.unlockAudioLoad();
    }, AUDIO_LOAD_LOCK_TIMEOUT_MS);
    return token;
  }

  /**
   * canplay 后解除加载锁（延迟 60ms，让缓冲的 0.0s 事件先冲刷）。
   *
   * 令牌不匹配表示这是过期事件（期间又发起了新一轮 load），直接丢弃。
   */
  endAudioLoad(token: number): void {
    if (token !== this.audioLoadToken) return;
    this.clearUnlockTimer();
    this.unlockTimer = this.setTimer(() => {
      this.unlockTimer = null;
      if (token !== this.audioLoadToken) return;
      this.unlockAudioLoad();
    }, AUDIO_LOAD_UNLOCK_DELAY_MS);
  }

  private clearUnlockTimer(): void {
    if (this.unlockTimer !== null) {
      this.clearTimer(this.unlockTimer);
      this.unlockTimer = null;
    }
  }

  private unlockAudioLoad(): void {
    if (this.loadScope) {
      this.journal.endLoad(this.loadScope.lessonId, this.loadScope.track);
      this.loadScope = null;
    }
  }

  /**
   * 媒体时间推进回调（来自 BAM `onTimeUpdate`，仅前台回调）。
   *
   * 只更新运行时状态 + 在「播放页不在前台」时按 3s 周期提交断点（§4.1.1）。
   */
  onTimeUpdate(positionSec: number, durationSec?: number): void {
    if (!Number.isFinite(positionSec)) return;
    this.state.positionSec = positionSec;
    if (durationSec && durationSec > 0) {
      this.state.durationSec = durationSec;
    }
    if (this.state.durationSec > 0) {
      this.state.progressPct = Math.min(
        100,
        Math.round((positionSec / this.state.durationSec) * 100),
      );
    }

    if (!this.foregroundOwner) {
      this.commitFromMedia(positionSec, durationSec, 'periodic');
    }

    for (const listener of this.progressListeners) {
      listener(this.state.positionSec, this.state.durationSec, this.state.progressPct);
    }
  }

  /**
   * 后台侧提交：位置取自 BAM 真实时间（不是插值）。
   *
   * 节流到 {@link BACKGROUND_COMMIT_INTERVAL_MS}；失败不重试风暴，交给 flush/下次周期。
   */
  private commitFromMedia(positionSec: number, durationSec: number | undefined, reason: CommitReason): boolean {
    const now = this.now();
    if (reason === 'periodic' && now - this.lastBackgroundCommitMs < BACKGROUND_COMMIT_INTERVAL_MS) {
      return false;
    }
    if (!this.state.lessonId) {
      return false;
    }
    this.lastBackgroundCommitMs = now;
    const result = this.journal.commit({
      lessonId: this.state.lessonId,
      track: this.state.track,
      positionMs: Math.round(positionSec * 1000),
      segmentIndex: undefined,
      durationMs: durationSec && durationSec > 0 ? Math.round(durationSec * 1000) : undefined,
      reason,
    });
    return result.committed;
  }

  /** 立即提交一次（页面隐藏 / 后台）。 */
  commitNow(reason: CommitReason = 'appHide'): boolean {
    try {
      const bam = wx.getBackgroundAudioManager();
      const pos = typeof bam.currentTime === 'number' ? bam.currentTime : this.state.positionSec;
      const dur = typeof bam.duration === 'number' ? bam.duration : this.state.durationSec;
      return this.commitFromMedia(pos, dur, reason);
    } catch {
      return this.commitFromMedia(this.state.positionSec, this.state.durationSec, reason);
    }
  }

  /**
   * 某课某轨是否正在本进程的后台活跃播放。
   *
   * 关键门控：本进程从未为 BAM 赋过 `src` 时恒为「不活跃」——否则冷启动会把
   * 持久化恢复出来的课程误判为「正在播放」，播放页跳过载源，播放头回到 0。
   */
  isLessonActive(lessonId: string, track: AudioTrackKey): {
    isActive: boolean;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
  } {
    const idle = { isActive: false, isPlaying: false, currentTime: 0, duration: 0 };
    if (!this.srcLoadedInProcess) {
      return idle;
    }
    if (this.state.lessonId !== lessonId || this.state.track !== track) {
      return idle;
    }
    try {
      const bam = wx.getBackgroundAudioManager();
      if (!bam) {
        return idle;
      }
      const curTime = typeof bam.currentTime === 'number' ? bam.currentTime : 0;
      const dur = typeof bam.duration === 'number' ? bam.duration : 0;
      return {
        isActive: true,
        isPlaying: !bam.paused && curTime > 0,
        currentTime: curTime,
        duration: dur,
      };
    } catch {
      return idle;
    }
  }

  /**
   * 后台播放自然播完当前课程的处理（自然切下一课）。
   *
   * §3.1 / §4.1.5：完成标记与位置提交分开做，且只由 PB 决定完成。
   */
  handleNaturalEnded(): void {
    if (this.state.lessonId) {
      this.commitFromMedia(this.state.durationSec, this.state.durationSec, 'naturalEnd');
      if (this.state.track === 'pb') {
        this.journal.commitCompleted(this.state.lessonId);
      }
    }

    if (this.state.repeatEpisode) {
      try {
        const bam = wx.getBackgroundAudioManager();
        bam.seek(0);
        bam.play();
      } catch {
        // 忽略
      }
      return;
    }

    if (this.state.track === 'dg') {
      // §3.2：DG 绝不自然切到下课 DG，也不自行返回 PB。
      return;
    }

    // 寻找下一课（§3.2 第 3 条 + 首尾循环规则：末课**环绕回第一课**）。
    // 这里是「自动连播目标」，与手动「下一课」按钮的末课禁用是两套规则。
    try {
      const cached = wx.getStorageSync('ep_cached_lesson_index_v1');
      if (Array.isArray(cached) && cached.length > 0) {
        const list = cached as LessonIndexItem[];
        const currentIdx = list.findIndex((l) => l.lessonId === this.state.lessonId);
        const targetIdx = MOBILE_AUTO_NEXT_ENABLED
          ? nextLessonIndex(currentIdx, list.length)
          : null;
        if (targetIdx === null) {
          return;
        }
        const target = list[targetIdx];
        if (target.lessonId === this.state.lessonId) {
          // F13 单课库：同一课 00:00 重播（等价于音轨循环），不换源、不停止。
          this.replayCurrentFromZero();
          return;
        }
        this.switchToNextLesson(target);
      }
    } catch (err) {
      console.warn('[playbackSession] 自然切下一课失败：', err);
    }
  }

  /** 后台侧「同课 00:00 重播」：不换源，把播放头放回开头并继续（F13）。 */
  private replayCurrentFromZero(): void {
    this.state.positionSec = 0;
    this.state.progressPct = 0;
    this.state.isPlaying = true;
    try {
      const bam = wx.getBackgroundAudioManager();
      bam.seek(0);
      bam.play();
    } catch {
      // 忽略
    }
    this.notifyState();
  }

  private switchToNextLesson(nextLesson: LessonIndexItem): void {
    const fileId = this.adapter.resolveAudioFileId(nextLesson.lessonId, 'pb');
    const attrs = formatLessonAttributes(nextLesson);

    this.state.lessonId = nextLesson.lessonId;
    this.state.track = 'pb';
    this.state.title = nextLesson.title;
    this.state.attributes = attrs;
    this.state.positionSec = 0;
    this.state.durationSec = 0;
    this.state.progressPct = 0;
    this.state.isPlaying = true;

    // §2 自动连播：目标课程成功打开后更新锚点（与播放位置解耦，§4.1.7）。
    this.journal.setLastOpenedLesson(nextLesson.lessonId);

    try {
      const bam = wx.getBackgroundAudioManager();
      bam.title = nextLesson.title;
      bam.epname = 'EnglishPod';
      bam.singer = 'EnglishPod';
      if (fileId) {
        bam.src = fileId;
        this.markSrcLoaded();
      }
    } catch {
      // 忽略
    }

    for (const listener of this.lessonChangeListeners) {
      listener(nextLesson.lessonId);
    }
    this.notifyState();
  }

  togglePlay(): void {
    try {
      const bam = wx.getBackgroundAudioManager();
      if (!bam.paused && typeof bam.currentTime === 'number' && bam.currentTime > 0) {
        bam.pause();
        this.setIsPlaying(false);
      } else {
        bam.play();
        this.setIsPlaying(true);
      }
    } catch {
      // 忽略
    }
  }

  subscribeProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  subscribeState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  subscribeLessonChange(listener: LessonChangeListener): () => void {
    this.lessonChangeListeners.add(listener);
    return () => this.lessonChangeListeners.delete(listener);
  }

  private notifyState(): void {
    const state = { ...this.state };
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }
}

export const playbackSession = new PlaybackSessionService();

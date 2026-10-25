/**
 * ============================================================================
 *  EnglishPod 沉浸播放器页面（pages/player/index.ts）
 * ============================================================================
 *  纯 WebView 原生页面，对齐 iOS 黄金基线。
 *  - 顶部栏：胶囊避让、Podcast / Dialogue / Vocab 三合一平滑分段胶囊、音轨下划线
 *  - 舞台：Apple Podcasts 32% Sweet Spot 黄金阅读线 + 物理触底 0 像素停靠
 *  - 词汇：词汇卡片手风琴折叠与例句跳转
 *  - 控制坞：可拖拽进度条、跳句/跳课、单句循环、整课重复、0.8x-2.0x 倍速
 *  - 返回：原生左滑返回与顶部按钮无缝对齐
 * ============================================================================
 */

import { WechatCloudAdapter } from '../../adapters/wechat/cloud';
import { createPlayerAudio } from '../../adapters/wechat/playerAudio';
import { prefetchPlayableUrls } from '../../adapters/wechat/cloudAudioUrl';
import { PlaybackDiagnosticSession } from '../../core/playbackDiagnostics';
import { APP_DISPLAY_NAME, USE_MOCK_DATA } from '../../config/env';
import { HighlightCursorTracker } from '../../core/highlightCursor';
import { formatLessonAttributes } from '../../core/lessonAttributes';
import { isWithinFocusViewport } from '../../core/locateBar';
import { CommitReason, PB_COMPLETED_PCT, isContinuousMediaAdvance } from '../../core/learningRecord';
import { reconcileActivePlayhead } from '../../core/resumeReconcile';
import {
  EntryMode,
  MOBILE_AUTO_NEXT_ENABLED,
  manualNextIndex,
  manualPrevIndex,
  nextLessonIndex,
  planEntry,
} from '../../core/entryPlan';
import { computePodcastScrollTarget, scrollTopSequence } from '../../core/scrollAnim';
import {
  REANCHOR_RETRY_DELAYS_MS,
  RowSample,
  averageRowHeight,
  estimateAnchorScrollTop,
  estimateContentHeight,
  fitRowHeightModel,
} from '../../core/transcriptAnchor';
import { SWITCH_SETTLE_MS, decideSettle } from '../../core/switchSettle';
import { ClockSample, correctSample, extrapolatePosition } from '../../core/timelineEngine';
import { TrackStateMachine } from '../../core/trackStateMachine';
import { playbackSession } from '../../services/playbackSession';
import { progressJournal } from '../../services/progressJournal';
import {
  TranscriptBlockVM,
  VocabEntryVM,
  buildVocabEntries,
  buildVocabMatcher,
  findLiveSentenceText,
  toTranscriptBlocks,
} from '../../core/transcriptView';
import {
  AudioAdapter,
  AudioTrackKey,
  CloudAdapter,
  LessonDetail,
  LessonIndexItem,
  Segment,
} from '../../core/types';
import { MockCloudAdapter } from '../../mock/index';

type ViewTab = 'pb' | 'dg' | 'vocab';

/** 模块级内存缓存：避免切课/重复进入时重新请求网络，达到 0ms 瞬间切换 */
const detailMemoryCache = new Map<string, LessonDetail>();

const TICK_MS = 250;
const TRANSPORT_MS = 500;
const LOCATE_SECONDS = 5;
const LOCATE_MEASURE_THROTTLE_MS = 120;

/**
 * 播放中周期提交断点的间隔（EP-PBC-001 §4.1.1「建议每约 3 秒保存一次」）。
 *
 * 为什么不复用 500ms 的传输层刷新：断点写入现在一次就是一次同步落盘，
 * 500ms 节流会把写盘频率放大 6 倍，且并不会提高恢复精度。
 */
const PROGRESS_COMMIT_INTERVAL_MS = 3000;

/**
 * 「拖动到末尾」的识别窗口（毫秒）：显式 Seek 落在末尾附近后的这段窗口内，
 * 引擎的 completed 回调不得被当成自然结束（§3.1 / §5.2）。
 */
const SYNTHETIC_END_WINDOW_MS = 3000;

/** 打开播放页的入口意图（§2 行为矩阵：不同入口的默认音轨与位置规则不同）。 */
export type PlayerEntryIntent = 'library' | 'resume' | 'manual';

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem < 10 ? '0' : ''}${rem}`;
}

function formatLessonDisplayIndex(lessonId: string): string {
  const num = parseInt(lessonId, 10);
  if (Number.isFinite(num) && num > 0) {
    return num < 10 ? `0${num}` : String(num);
  }
  return lessonId;
}

function lastEnd(segs: Segment[]): number {
  return segs.length > 0 ? segs[segs.length - 1].end : 0;
}

function trackLabelOf(track: AudioTrackKey): string {
  return track === 'dg' ? 'Dialogue' : 'Podcast';
}

function tabIndexOf(tab: ViewTab): number {
  switch (tab) {
    case 'pb':
      return 0;
    case 'dg':
      return 1;
    case 'vocab':
      return 2;
  }
}

/**
 * 解析入口意图 → 首次加载模式；未知/缺省按「普通列表」处理（§2 行为矩阵第一行）。
 *
 * 迁移兼容：旧调用方只带 lessonId；`intent=manual` 视同页内手动切课（00:00 + 继承播放态）。
 */
function toInitialMode(raw: string | undefined): EntryMode {
  if (raw === 'resume') {
    return 'resume';
  }
  if (raw === 'manual') {
    return 'manualNav';
  }
  return 'library';
}

/** 单音轨的台本布局缓存（BUG-004 首帧重锚的数据来源）。 */
interface TrackLayoutCache {
  /** 已量到过的行（按 `segIdx` 去重；保留最近一次的顶部偏移与行高）。 */
  samples: RowSample[];
  /** 最近一次量到的内容总高（px）；未知为 0。 */
  contentHeight: number;
}

interface PageData {
  safeTopPx: number;
  navBarPx: number;
  capsuleRightPadding: number;
  playerLoading: boolean;
  isAudioLoading: boolean;
  playerErrorMsg: string;
  lessonTitle: string;
  lessonLevel: string;
  displayTitle: string;
  trackLabel: string;
  playerProgressPct: number;
  activeTab: ViewTab;
  activeTrack: AudioTrackKey;
  tabIndex: number;
  showPbUnderline: boolean;
  showDgUnderline: boolean;
  blocks: TranscriptBlockVM[];
  blocksPb: TranscriptBlockVM[];
  blocksDg: TranscriptBlockVM[];
  playerScrollTop: number;
  playerScrollTopPb: number;
  playerScrollTopDg: number;
  /** 首进或重锚期间的透明遮罩（对齐 iOS/Web 的首帧确定性落位，避免 00:00 闪跳）。 */
  isPendingAnchor: boolean;
  /** 双阶段装载门禁：落位完成前遮罩骨架屏，落定后平滑淡出（对齐成熟音乐/听书播放器规范）。 */
  isTranscriptReady: boolean;
  /** 换轨重锚期间临时关掉滚动动画：校正必须「就在这一帧」，不能滑 300ms 被看见。 */
  scrollAnimated: boolean;
  activeSegIdx: number;
  collapsedBoxIds: number[];
  vocabEntries: VocabEntryVM[];
  expandedVocabIndex: number;
  isPlaying: boolean;
  /** 当前音轨已自然结束并停住（手机端只有 DG，§3.2 / F05）：主按钮显示 ↺。 */
  ended: boolean;
  positionLabel: string;
  durationLabel: string;
  singleSentenceLoop: boolean;
  repeatEpisode: boolean;
  speedLabel: string;
  hasPrevLesson: boolean;
  hasNextLesson: boolean;
  showLocateBar: boolean;
  locateSentence: string;
}

interface PageCustom {
  adapter?: CloudAdapter;
  audio?: AudioAdapter;
  localDiagnostics?: PlaybackDiagnosticSession | null;
  saveLocalDiagnostics(): void;
  machine?: TrackStateMachine;
  tracker?: HighlightCursorTracker;
  lessonIds?: string[];
  lessonIndexItems?: LessonIndexItem[];
  indexReady?: Promise<void>;
  currentLessonId?: string;
  /**
   * 当前**期望**播放态（用户最新意图，§5.2）。
   *
   * 与 `data.isPlaying` 的区别：`data` 是引擎回报的可观察状态，本字段是「加载完成后
   * 该不该发声」。加载期间用户点了暂停 → 本字段 false → 迟到的加载完成不得覆盖它。
   */
  playRequested?: boolean;
  /** 本轮加载的入口意图（§2 行为矩阵）；仅供诊断与自身判断，不参与位置决策。 */
  loadMode?: EntryMode;
  detail?: LessonDetail | null;
  segmentsByTrack?: { dg: Segment[]; pb: Segment[] };
  blocksByTrack?: { dg: TranscriptBlockVM[]; pb: TranscriptBlockVM[] };
  durations?: { dg: number; pb: number };
  segBoxIds?: number[];
  clockSample?: ClockSample;
  /**
   * 换源 / 切轨后的显示镇定（见 `core/switchSettle.ts`）。
   *
   * `load()` 到 `pendingSeek` 生效之间，平台会先上报 `currentTime=0`；若直接采纳，
   * 进度条会归零、台本跳回首句再「闪」回目标位置。窗口内若实测位置明显落后于
   * `settleTargetMs`，渲染继续用目标位置。
   */
  settleTargetMs?: number;
  /** 镇定窗口截止时间；0 表示当前没有窗口。 */
  settleUntilMs?: number;
  loadToken?: number;
  /** 本轮 BAM 加载锁令牌（EP-PBC-001 §4.1.2）：canplay 时原样交回 endAudioLoad。 */
  audioLoadToken?: number;
  /** 上次周期提交断点的时间戳（§4.1.1 约 3s）。 */
  lastCommitMs?: number;
  /** 上一次的媒体真实采样（用于区分「真实推进」与「Seek 跳变」，§3.1）。 */
  lastMediaSample?: { positionSec: number; atMs: number } | null;
  /** 显式 Seek 到末尾后的合成结束窗口（§3.1 F04）。 */
  syntheticEndUntilMs?: number;
  /** 课程切换进行中（detail 已换、音频还是上一条）：禁止任何断点写入（§5.2）。 */
  progressSuspended?: boolean;
  tickTimer?: ReturnType<typeof setInterval> | null;
  lastTransportMs?: number;
  autoScroll?: boolean;
  scrubbing?: boolean;
  programmaticUntil?: number;
  lastPlayerScrollTop?: number;
  lastPlayerScrollTopPb?: number;
  lastPlayerScrollTopDg?: number;
  locateDeadlineMs?: number;
  locateMeasureAt?: number;
  locateThrottleTimer?: ReturnType<typeof setTimeout> | null;
  locateTimer?: ReturnType<typeof setInterval> | null;
  isUserInteracting?: boolean;
  keepScreenOn?: boolean;
  /**
   * 台本行位置样本（BUG-004 首帧重锚用）。
   *
   * 换轨时 `blocks` 整体替换，新内容尚未渲染 → 无法量测；但同一课同一排版的行位置
   * 是稳定的，历史量测样本可以插值/外推出目标句的偏移，让**首帧**就落在目标附近。
   * 换课即作废（行高随文本变化，跨课复用会放大误差）。
   */
  transcriptLayout?: { pb: TrackLayoutCache; dg: TrackLayoutCache } | null;
  /** 上面那份样本属于哪一课；不同课即重置。 */
  transcriptLayoutLessonId?: string;
  /** 上一次量到的视口高度（换轨时还没有新量测，先用它估算）。 */
  transcriptViewportHeight?: number;
  /** 重锚轮次令牌：切轨/切课自增，作废上一轮未完成的重试。 */
  reanchorToken?: number;
  /** 最近一次执行 tick 的时间戳，用于去重降频。 */
  lastTickMs?: number;
  /** 诊断（`?diagnostics=1`）：记录每次重锚的首帧落位，供 e2e 断言。 */
  reseatTrace?: Array<Record<string, unknown>>;

  initNavMetrics(): void;
  setupAudio(): void;
  loadLessonDetail(lessonId: string, mode?: EntryMode): Promise<void>;
  prefetchAdjacentLessons(lessonId: string): void;
  startTick(): void;
  stopTick(): void;
  tick(force?: boolean): void;
  onThemeChange?(): void;
  /** 供渲染使用的播放位置：镇定窗口内忽略换源瞬间的假 0（见 `core/switchSettle.ts`）。 */
  effectivePositionSec(): number;
  /** 布防换源镇定窗口；`targetSec <= 0` 时不布防。 */
  armSettle(targetSec: number): void;
  /** 切轨后重定位台本：内容整体换掉，需复位 scroll-top 并补一次重试。 */
  reseatTranscript(segIdx: number): void;
  /** 计算换轨首帧要下发的 `scroll-top`（无样本时返回 null，此时保留当前偏移、不下发 0）。 */
  estimateSwitchScrollTop(track: AudioTrackKey, segIdx: number): number | null;
  /** 台本行字符数序列（供内容总高预测）。 */
  rowCharsForTrack(track: AudioTrackKey): number[];
  /** 记录一次行量测，作为后续换轨首帧估算的样本。 */
  noteTranscriptLayout(
    track: AudioTrackKey,
    sample: RowSample,
    viewportHeight: number,
    contentHeight: number,
  ): void;
  /** 换轨后的重锚：按退避阶梯补试精确落位；全部失败则放开「找回当前句」条。 */
  reanchorTranscript(segIdx: number, onSettled?: (ok: boolean) => void): void;
  /** 取（或按课重建）台本布局缓存。 */
  transcriptLayoutFor(
    lessonId: string | undefined,
  ): { pb: TrackLayoutCache; dg: TrackLayoutCache };
  /** 重锚诊断记录（仅 `?diagnostics=1`）。 */
  traceReseat(entry: Record<string, unknown>): void;
  currentPositionSec(): number;
  currentDurationSec(): number;
  currentSegments(): Segment[];
  updateTransport(positionSec: number, durationSec: number): void;
  updateLocateCountdown(nowMs: number): void;
  updateSegBoxIds(): void;
  refreshTrackUnderline(): void;
  expandBoxForSegment(segIdx: number): void;
  scrollToSegment(
    segIdx: number,
    opts?: { animated?: boolean; onResult?: (applied: boolean) => void },
  ): void;
  currentLiveSentence(): string;
  startLocateCountdown(): void;
  hideLocateBar(): void;
  isActiveSegmentVisible(cb: (visible: boolean) => void): void;
  evaluateActiveVisibility(): void;
  returnToActive(): void;
  applyMetadata(): void;
  mediaPositionSec(): number | null;
  commitProgress(reason: CommitReason): boolean;
  maybeCommitCompleted(previousSec: number, positionSec: number, durationSec: number): void;
  flushStorage(): void;
  setKeepScreenOn(on: boolean): void;

  play(): void;
  pause(): void;
  togglePlay(): void;
  /** 按 `playRequested` 落定播放态（加载完成后调用；被用户更新的意图覆盖）。 */
  syncPlayState(): void;
  /** 主按钮在「已结束」态的重新开始：从本音轨 00:00 重播（§3.2 / F05）。 */
  restartFromEnd(): void;
  /** 当前课程在索引中的下标；未知 -1。 */
  currentLessonIndex(): number;
  seekTo(positionSec: number, commit?: boolean): void;
  prevSentence(): void;
  nextSentence(): void;
  goPrevLesson(): void;
  goNextLesson(): void;
  switchTab(tab: ViewTab): void;
  switchTrack(track: AudioTrackKey, seekSegIdx?: number): void;
  scrollViewportTo(track: AudioTrackKey, top: number, animated?: boolean): void;
  handleEnded(): void;

  onBack(): void;
  onTabTap(event: WechatMiniprogram.TouchEvent): void;
  onToggle(): void;
  onPrevSentence(): void;
  onNextSentence(): void;
  onPrevLesson(): void;
  onNextLesson(): void;
  onToggleLoop(): void;
  onToggleRepeat(): void;
  onCycleSpeed(): void;
  onScrubStart(): void;
  onScrubMove(): void;
  onScrubEnd(event: WechatMiniprogram.CustomEvent<{ ratio: number }>): void;
  onLineTap(event: WechatMiniprogram.CustomEvent<{ segIdx: number }>): void;
  onToggleBox(event: WechatMiniprogram.CustomEvent<{ boxGroupId: number }>): void;
  onVocabToggle(event: WechatMiniprogram.CustomEvent<{ index: number }>): void;
  onVocabExample(event: WechatMiniprogram.CustomEvent<{ track: string; segIdx: number }>): void;
  onTranscriptDragStart(): void;
  onTranscriptDragEnd(): void;
  onTranscriptScroll(event: WechatMiniprogram.ScrollViewScroll): void;
  onLocateTap(): void;
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent;
  onShareTimeline(): WechatMiniprogram.Page.ICustomTimelineContent;
}

Page<PageData, PageCustom>({
  data: {
    safeTopPx: 44,
    navBarPx: 44,
    capsuleRightPadding: 96,
    playerLoading: true,
    isAudioLoading: false,
    playerErrorMsg: '',
    lessonTitle: '',
    lessonLevel: '',
    displayTitle: '',
    trackLabel: 'Podcast',
    playerProgressPct: 0,
    activeTab: 'pb',
    activeTrack: 'pb',
    tabIndex: 0,
    showPbUnderline: false,
    showDgUnderline: false,
    blocks: [],
    blocksPb: [],
    blocksDg: [],
    playerScrollTop: 0,
    playerScrollTopPb: 0,
    playerScrollTopDg: 0,
    isPendingAnchor: false,
    isTranscriptReady: false,
    scrollAnimated: true,
    activeSegIdx: 0,
    collapsedBoxIds: [],
    vocabEntries: [],
    expandedVocabIndex: -1,
    isPlaying: false,
    ended: false,
    positionLabel: '0:00',
    durationLabel: '0:00',
    singleSentenceLoop: false,
    repeatEpisode: false,
    speedLabel: '1.0x',
    hasPrevLesson: false,
    hasNextLesson: false,
    showLocateBar: false,
    locateSentence: '',
  },

  autoScroll: true,
  scrubbing: false,

  onLoad(query: Record<string, string | undefined>) {
    this.initNavMetrics();
    // Explicit preview-only opt-in; production release and ordinary sessions never record.
    this.localDiagnostics = null;
    if (query.diagnostics === '1') {
      try {
        if (wx.getAccountInfoSync().miniProgram.envVersion === 'develop') {
          this.localDiagnostics = new PlaybackDiagnosticSession();
        }
      } catch {
        // Fail closed if runtime cannot attest development mode.
      }
    }
    this.adapter = USE_MOCK_DATA ? new MockCloudAdapter() : new WechatCloudAdapter();
    const prefs = progressJournal.preferences();
    this.machine = new TrackStateMachine('pb', prefs.playbackRate);
    this.setData({
      speedLabel: TrackStateMachine.formatRate(this.machine.getRate()),
    });
    this.tracker = new HighlightCursorTracker();

    // 入口意图：普通列表 / 继续收听 / 页内手动切课（§2 行为矩阵）。
    // 迁移兼容：旧调用方只带 lessonId，按普通列表入口处理。
    const initialMode = toInitialMode(query.intent);
    // 进入播放页即请求播放（0.3.x 已发布行为；§2「新启动默认暂停」的差异见方案 R6）。
    this.playRequested = true;

    // 载源未就绪窗口内的进度写入被拒（§4.1.2）：只接一条白名单诊断事件。
    progressJournal.setHoldListener(() => {
      this.localDiagnostics?.guardHold();
    });

    const lessonId = query.lessonId || '1';

    // 优先从缓存加载课程列表与当前课程元数据（实现 0ms 标题/难度直出）
    try {
      const cached = wx.getStorageSync('ep_cached_lesson_index_v1');
      if (Array.isArray(cached) && cached.length > 0) {
        this.lessonIndexItems = cached as LessonIndexItem[];
        this.lessonIds = this.lessonIndexItems.map((l) => l.lessonId);
        const currentItem = this.lessonIndexItems.find((l) => l.lessonId === lessonId);
        if (currentItem) {
          const pos = this.lessonIds.indexOf(lessonId);
          this.setData({
            lessonTitle: currentItem.title,
            lessonLevel: currentItem.level,
            displayTitle: `${formatLessonDisplayIndex(currentItem.lessonId)} · ${currentItem.title}`,
            hasPrevLesson: pos > 0,
            hasNextLesson: pos >= 0 && pos < this.lessonIds.length - 1,
          });
        }
      }
    } catch {
      // 容错
    }

    // 缓存中的课程条目不含云端 file_ids；当前播放器实例仍需索引预热。
    // 无论缓存是否存在，都发起一次索引请求，音频 load 必须等索引返回。
    this.indexReady = this.adapter.getLessonIndex().then((index) => {
      this.lessonIndexItems = index;
      this.lessonIds = index.map((l) => l.lessonId);
      if (this.currentLessonId) {
        const pos = this.lessonIds.indexOf(this.currentLessonId);
        const currentItem = index.find((l) => l.lessonId === this.currentLessonId);
        this.setData({
          lessonTitle: currentItem ? currentItem.title : this.data.lessonTitle,
          lessonLevel: currentItem ? currentItem.level : this.data.lessonLevel,
          displayTitle: currentItem
            ? `${formatLessonDisplayIndex(currentItem.lessonId)} · ${currentItem.title}`
            : this.data.displayTitle,
          hasPrevLesson: pos > 0,
          hasNextLesson: pos >= 0 && pos < this.lessonIds.length - 1,
        });
      }
    }).catch((err: unknown) => {
      // 网络索引失败时，详情若有合法相对路径，仍能安全回退。
      console.warn('[player] 未获取到音频索引，将使用详情合法路径回退。', err);
    });

    this.setupAudio();

    // §5.2：播放/暂停由 `playRequested` 决定，加载完成时只服从用户最新意图，
    // 因此这里不再挂 `.then(() => this.play())`（迟到回调会覆盖用户暂停）。
    void this.loadLessonDetail(lessonId, initialMode);
  },

  onShow() {
    playbackSession.setForegroundOwner(true);
    this.localDiagnostics?.foreground(!!this.audio && !this.audio.isPaused());
    if (this.audio && !this.audio.isPaused()) {
      this.setData({ isPlaying: true });
      this.startTick();
    }
    // 回前台时以引擎真实状态校准「播放意图」：后台可能被通知栏/系统暂停过。
    // 首次 onShow 时 detail 尚未就绪（加载进行中），不能据此覆盖 onLoad 的初始意图。
    if (this.detail && !this.progressSuspended) {
      this.playRequested = Boolean(this.audio && !this.audio.isPaused());
    }
  },

  onHide() {
    this.localDiagnostics?.background();
    this.saveLocalDiagnostics();
    // §4.1.1：页面隐藏立即尝试保存；§4.1.7 锚点已在打开课程时写入，这里不动。
    this.commitProgress('appHide');
    this.flushStorage();
    // 退到后台后由会话接管后台周期提交（若平台仍给 timeUpdate）。
    playbackSession.setForegroundOwner(false);
  },

  onUnload() {
    this.saveLocalDiagnostics();
    this.stopTick();
    this.hideLocateBar();
    // 诊断接线随页面卸载断开，避免闭包持有已销毁页面。
    progressJournal.setHoldListener(null);
    this.commitProgress('lessonSwitch');
    this.flushStorage();
    playbackSession.setForegroundOwner(false);
    this.setKeepScreenOn(false);
  },

  initNavMetrics(): void {
    try {
      const windowInfo = wx.getWindowInfo();
      const safeTop = windowInfo.safeArea ? windowInfo.safeArea.top : windowInfo.statusBarHeight || 44;
      const capsule = wx.getMenuButtonBoundingClientRect();
      const capsuleRight = windowInfo.windowWidth - capsule.left + 10;
      const navBarHeight = Math.max(44, (capsule.top - safeTop) * 2 + capsule.height);

      this.setData({
        safeTopPx: safeTop,
        navBarPx: navBarHeight,
        capsuleRightPadding: Math.max(capsuleRight, 96),
      });

      if (!this.transcriptViewportHeight || this.transcriptViewportHeight <= 0) {
        const estH = windowInfo.windowHeight - safeTop - navBarHeight - 180;
        if (estH > 0) {
          this.transcriptViewportHeight = estH;
        }
      }
    } catch {
      this.setData({
        safeTopPx: 44,
        navBarPx: 44,
        capsuleRightPadding: 96,
      });
      if (!this.transcriptViewportHeight || this.transcriptViewportHeight <= 0) {
        this.transcriptViewportHeight = 520;
      }
    }
  },


  saveLocalDiagnostics(): void {
    if (!this.localDiagnostics) return;
    try {
      wx.setStorageSync('ep_preview_playback_diag_v1', this.localDiagnostics.snapshot());
    } catch {
      // Diagnostics must never interrupt audio or progress persistence.
    }
  },

  setupAudio(): void {
    if (this.audio) return;
    this.audio = createPlayerAudio();
    this.audio.setEvents({
      onTimeUpdate: (positionSec: number) => {
        // 音频加载锁定期（load 后、canplay 解锁前）：
        // 平台上报的旧轨尾值或瞬时假 0 绝不校正新轨采样点，防止进度条与台本错乱。
        if (playbackSession.isAudioLoading()) {
          return;
        }
        // 换源 / 切轨后的镇定窗口内，平台上报的是新 src 的假 0（或旧 src 的尾值），
        // 不能拿来校正采样点，否则整条渲染链（tick → 进度条 → 台本高亮）都会闪回起点。
        const settleUntilMs = Number.isFinite(this.settleUntilMs) ? (this.settleUntilMs as number) : 0;
        if (settleUntilMs > 0) {
          const decision = decideSettle({
            targetMs: this.settleTargetMs ?? 0,
            untilMs: settleUntilMs,
            nowMs: Date.now(),
            liveMs: Math.round(positionSec * 1000),
          });
          if (decision === 'hold') return;
          this.settleUntilMs = 0;
        }
        const base = this.clockSample ?? { positionSec, atMs: Date.now() };
        this.clockSample = correctSample(base, positionSec, Date.now(), this.currentDurationSec());
        this.tick();
      },
      onPlay: () => {
        this.localDiagnostics?.playEvent();
        this.setData({ isPlaying: true, isAudioLoading: false });
        this.setKeepScreenOn(true);
        this.refreshTrackUnderline();
        this.startTick();
      },
      onPause: () => {
        this.localDiagnostics?.pauseEvent();
        this.setData({ isPlaying: false });
        this.setKeepScreenOn(false);
        this.commitProgress('pause');
        this.refreshTrackUnderline();
        this.stopTick();
      },
      onEnded: () => this.handleEnded(),
      onSeeked: (positionSec: number) => {
        this.clockSample = { positionSec, atMs: Date.now() };
        this.tick(true);
      },
      onCanplay: () => {
        // Issue #58 P0a：解除本轮加载锁（延迟 60ms，让紧随 canplay 的
        // 0.0s timeUpdate 先冲刷）。过期令牌会被服务端丢弃。
        if (this.audioLoadToken !== undefined) {
          playbackSession.endAudioLoad(this.audioLoadToken);
        }
        this.setData({ isAudioLoading: false });
        this.localDiagnostics?.canplay();
      },
      onWaiting: () => {
        this.localDiagnostics?.waiting();
        this.setData({ isAudioLoading: true });
      },
      onError: (err) => {
        if (this.audioLoadToken !== undefined) {
          playbackSession.endAudioLoad(this.audioLoadToken);
        }
        this.localDiagnostics?.error(err.errCode);
        this.saveLocalDiagnostics();
        this.setData({ playerErrorMsg: err.message, isPlaying: false, isAudioLoading: false });
      },
    });
  },

  async loadLessonDetail(lessonId: string, mode: EntryMode = 'library'): Promise<void> {
    if (!this.adapter) return;
    const token = (this.loadToken ?? 0) + 1;
    this.loadToken = token;
    this.loadMode = mode;
    const previousLessonId = this.currentLessonId;
    this.currentLessonId = lessonId;

    // §4.1.1 / §5.2：切课前保存**离开音轨**的有效断点（此时 detail 仍是旧课）。
    if (previousLessonId && previousLessonId !== lessonId) {
      this.commitProgress('lessonSwitch');
    }

    // §5.2：切课期间 this.detail 会先换成新课，而音频仍是上一条；这段窗口内的
    // 任何提交都会把旧音频的位置串写到新课记录上，因此整体挂起。
    this.progressSuspended = true;

    const cachedDetail = detailMemoryCache.get(lessonId);
    const pbActive = (mode === 'library' || mode === 'resume')
      ? playbackSession.isLessonActive(lessonId, 'pb')
      : { isActive: false, isPlaying: false, currentTime: 0, duration: 0 };
    const dgActive = (mode === 'library' || mode === 'resume')
      ? playbackSession.isLessonActive(lessonId, 'dg')
      : { isActive: false, isPlaying: false, currentTime: 0, duration: 0 };
    const isCurrentlyActiveLesson = pbActive.isActive || dgActive.isActive;

    if (!isCurrentlyActiveLesson) {
      this.setData({ isTranscriptReady: false, playerErrorMsg: '', ended: false });
    } else {
      this.setData({ isTranscriptReady: true, playerErrorMsg: '', ended: false });
    }

    if (!cachedDetail) {
      if (this.lessonIndexItems) {
        const item = this.lessonIndexItems.find((l) => l.lessonId === lessonId);
        if (item) {
          const displayTitle = `${formatLessonDisplayIndex(item.lessonId)} · ${item.title}`;
          this.setData({
            lessonTitle: item.title,
            lessonLevel: item.level,
            displayTitle,
          });
          try {
            wx.setNavigationBarTitle({
              title: displayTitle,
            });
          } catch {
            // 忽略
          }
        }
      }
      this.setData({ playerLoading: true, playerErrorMsg: '' });
    }

    try {
      const detail = cachedDetail ?? (await this.adapter.getLessonDetail(lessonId));
      if (!cachedDetail) {
        detailMemoryCache.set(lessonId, detail);
      }
      if (this.loadToken !== token) return;

      const matcher = buildVocabMatcher(detail.vocabulary);
      const dgSegments = detail.tracks.dg;
      const pbSegments = detail.tracks.pb;

      this.detail = detail;
      this.segmentsByTrack = { dg: dgSegments, pb: pbSegments };
      this.blocksByTrack = {
        dg: toTranscriptBlocks(dgSegments, 'dg', matcher),
        pb: toTranscriptBlocks(pbSegments, 'pb', matcher),
      };
      this.durations = { dg: lastEnd(dgSegments), pb: lastEnd(pbSegments) };

      const entries = buildVocabEntries(detail.vocabulary, { dg: dgSegments, pb: pbSegments });

      const record = progressJournal.readRecord(lessonId);
      // §2 行为矩阵：音轨 / 起播位置 / 播放态 / 单句循环 / 上一课下一课按钮可用性
      // 全部由 core/entryPlan 决策，页面只按计划执行（纯函数可在单测里锁死）。
      const targetIndex = this.currentLessonIndex();
      const plan = planEntry({
        mode,
        targetIndex,
        indexLength: this.lessonIds ? this.lessonIds.length : 0,
        record,
        currentTrack: this.data.activeTrack,
        // 继承的是「用户意图」而不是引擎回包：加载期间用户点暂停，这里已经是 false。
        wasPlaying: this.playRequested === true,
      });
      // §5.2：加载完成后的发声意图随计划落定，之后只服从用户更新的意图。
      this.playRequested = plan.autoPlay;
      // §2：手动切课 / 自动连播关闭单句循环；音轨循环与连播设置保持不变。
      if (plan.resetSingleSentenceLoop && this.machine) {
        if (this.machine.resetSingleSentenceLoop()) {
          playbackSession.setLessonInfo({ lessonId, singleSentenceLoop: false });
        }
      }
      // 页面已精简：仅响应 Podcast (pb) 音轨与文本台本
      const initialTrack: AudioTrackKey = 'pb';
      const initialPos = plan.startMs / 1000;
      const initialSegIdx =
        initialTrack === 'pb'
          ? (record.podcast ? record.podcast.committedSegmentIndex : 0)
          : (record.dialogue ? record.dialogue.committedSegmentIndex : 0);

      if (this.machine) {
        this.machine.setSnapshot('pb', {
          positionSec: progressJournal.resolveResumeMs(lessonId, 'pb') / 1000,
          segIdx: record.podcast ? record.podcast.committedSegmentIndex : 0,
          durationSec: this.durations.pb,
        });
      }

      const initialSegs = pbSegments;
      if (this.tracker) {
        this.tracker.setSegments(initialSegs);
        this.tracker.update(initialPos);
      }

      const activeSeg = this.tracker ? this.tracker.current().segIdx : initialSegIdx;
      const pbResumeSeg = record.podcast ? record.podcast.committedSegmentIndex : 0;
      const initialScrollPb = this.estimateSwitchScrollTop('pb', pbResumeSeg) ?? 0;
      const activeInitialScroll = initialScrollPb;
      const shouldShieldAnchor = !isCurrentlyActiveLesson && activeSeg > 0;

      const displayTitle = `${formatLessonDisplayIndex(detail.lessonId)} · ${detail.title}`;
      try {
        wx.setNavigationBarTitle({
          title: displayTitle,
        });
      } catch {
        // 忽略
      }

      this.setData({
        lessonTitle: detail.title,
        lessonLevel: detail.level,
        displayTitle,
        trackLabel: trackLabelOf(initialTrack),
        activeTab: initialTrack,
        activeTrack: initialTrack,
        tabIndex: tabIndexOf(initialTrack),
        blocks: this.blocksByTrack[initialTrack],
        blocksPb: this.blocksByTrack.pb,
        blocksDg: this.blocksByTrack.dg,
        vocabEntries: entries,
        expandedVocabIndex: -1,
        collapsedBoxIds: [],
        activeSegIdx: activeSeg,
        durationLabel: formatTime(this.durations[initialTrack]),
        positionLabel: formatTime(initialPos),
        playerProgressPct: 0,
        playerScrollTop: activeInitialScroll,
        playerScrollTopPb: initialScrollPb,
        playerScrollTopDg: 0,
        isPendingAnchor: shouldShieldAnchor,
        isTranscriptReady: !shouldShieldAnchor,
        scrollAnimated: false,
        // §2 边界条：按钮可用性取**手动导航**规则（末课下一课禁用、不环绕），
        // 与自动连播的末课环绕是两件事（D7）。
        hasPrevLesson: plan.canGoPrev,
        hasNextLesson: plan.canGoNext,
        playerLoading: false,
        ended: false,
        singleSentenceLoop: this.machine ? this.machine.isSingleSentenceLoop() : false,
        repeatEpisode: this.machine ? this.machine.isRepeatEpisode() : false,
        speedLabel: this.machine ? TrackStateMachine.formatRate(this.machine.getRate()) : '1.0x',
      });

      this.localDiagnostics?.detailReady();
      this.updateSegBoxIds();
      this.applyMetadata();
      this.refreshTrackUnderline();

      // 先等待当前适配器的 file_ids 索引，避免旧缓存触发过时的 .m4a 地址。
      if (this.indexReady) {
        await this.indexReady;
        if (this.loadToken !== token) return;
      }

      // 检查当前音频是否正在**本进程**后台活跃播放此课此轨。
      // 冷启动时 src 从未载入 → isLessonActive 恒为 false → 走下面的载源+seek
      // 分支，按已提交断点恢复（§4.1.2；这是「重进丢进度」的修复点）。
      //
      // 只有「重新进入同一课」的入口（列表 / 继续收听）才允许复用活跃音频源；
      // 手动导航与自动连播**必须重新装载**，否则 F13（单课库循环回 00:00）会
      // 复用停在末尾的播放头。
      const canReuseActiveSource = mode === 'library' || mode === 'resume';
      const sessionActive = canReuseActiveSource
        ? playbackSession.isLessonActive(lessonId, initialTrack)
        : { isActive: false, isPlaying: false, currentTime: 0, duration: 0 };
      if (sessionActive.isActive) {
        // 复用活跃音源（不重新 load，避免断音）：实时播放头与磁盘记录的恢复位置
        // 可能不一致，交给纯函数对账（§2.2 / E15、E14）。
        const liveMs = Math.round(sessionActive.currentTime * 1000);
        const reconcile = reconcileActivePlayhead({
          plannedStartMs: plan.startMs,
          livePositionMs: liveMs,
        });
        const effectiveMs = reconcile.action === 'seek' ? reconcile.seekToMs : liveMs;
        if (reconcile.action === 'seek') {
          // 就地前跳：规范明确要求「不重新装载音频」（§2.2 例外 / E15）。
          // src 未 canplay 时适配器会缓冲 seek，就绪后补做。
          this.audio?.seek(effectiveMs / 1000);
        }
        const currentPos = effectiveMs / 1000;
        this.clockSample = { positionSec: currentPos, atMs: Date.now() };
        // 复用源上前跳同样是异步生效的，期间平台可能短暂上报旧位置（0），布防镇定。
        this.armSettle(currentPos);
        const dismissGate = (): void => {
          if (this.loadToken !== token) return;
          if (!this.data.isTranscriptReady || this.data.isPendingAnchor) {
            this.setData({
              isTranscriptReady: true,
              isPendingAnchor: false,
              scrollAnimated: true,
            });
          }
        };

        // 锚点必须等于**本次要求**的媒体位置：若前跳被平台吞掉，后续倒退提交
        // 会被 `resume-seek-missed` 拦下，历史断点不会被写成 0:0x。
        progressJournal.setPlayheadAnchor(lessonId, initialTrack, effectiveMs);
        this.updateTransport(currentPos, this.durations[initialTrack]);
        if (this.tracker) {
          this.tracker.update(currentPos);
          this.scrollToSegment(this.tracker.current().segIdx, {
            animated: false,
            onResult: (applied) => {
              if (applied) {
                dismissGate();
              }
            },
          });
        }
        if (sessionActive.isPlaying) {
          this.setData({ isPlaying: true });
          this.startTick();
        }
      } else {
        const dismissGate = (): void => {
          if (this.loadToken !== token) return;
          if (!this.data.isTranscriptReady || this.data.isPendingAnchor) {
            this.setData({
              isTranscriptReady: true,
              isPendingAnchor: false,
              scrollAnimated: true,
            });
          }
        };

        // 新载入课程或切轨
        this.clockSample = { positionSec: initialPos, atMs: Date.now() };
        // `load()` 后到 seek 生效前平台会上报 0：布防镇定，避免进度条与台本闪回起点。
        this.armSettle(initialPos);
        this.updateTransport(initialPos, this.durations[initialTrack]);
        if (this.audio) {
          const pbSrc = this.adapter.resolveAudioFileId(lessonId, 'pb', detail.audio['pb']);
          void prefetchPlayableUrls([pbSrc]);

          const src = pbSrc;
          if (!src) {
            throw new Error('该课程音频地址不可用，请检查云端索引及音频文件。');
          }
          this.localDiagnostics?.loadRequested();
          // §4.1.2：load 前上锁，canplay 后（60ms）解锁；锁定期不写断点。
          this.audioLoadToken = playbackSession.beginAudioLoad(lessonId, initialTrack);
          this.audio.load(src);
          if (this.machine) {
            this.audio.setPlaybackRate(this.machine.getRate());
          }
          this.audio.seek(initialPos);
          // 记录播放头锚点：本次载入我们要求媒体停在哪里（0 = 确实有意从 00:00 开始）。
          progressJournal.setPlayheadAnchor(
            lessonId,
            initialTrack,
            Math.round(initialPos * 1000),
          );
        }
        this.scrollToSegment(this.tracker ? this.tracker.current().segIdx : initialSegIdx, {
          animated: false,
          onResult: (applied) => {
            if (applied) {
              dismissGate();
            }
          },
        });
      }

      if (shouldShieldAnchor) {
        setTimeout(() => {
          if (this.loadToken !== token) return;
          if (!this.data.isTranscriptReady || this.data.isPendingAnchor) {
            this.setData({
              isTranscriptReady: true,
              isPendingAnchor: false,
              scrollAnimated: true,
            });
          }
        }, 360);
      }

      // §4.1.7：成功打开课程元数据即更新锚点，与是否播放无关。
      progressJournal.setLastOpenedLesson(lessonId);
      // 音频已（重新）载入或已复用后台活跃源，从此可以安全写断点。
      this.progressSuspended = false;
      // §5.2：按用户最新意图落定播放态（加载期间点暂停 → 这里保持暂停）。
      this.syncPlayState();

      playbackSession.setLessonInfo({
        lessonId,
        track: initialTrack,
        title: detail.title,
        attributes: formatLessonAttributes(detail),
        durationSec: this.durations[initialTrack],
        repeatEpisode: this.machine ? this.machine.isRepeatEpisode() : false,
        singleSentenceLoop: this.machine ? this.machine.isSingleSentenceLoop() : false,
        rate: this.machine ? this.machine.getRate() : 1.0,
      });

      this.prefetchAdjacentLessons(lessonId);
    } catch (err) {
      if (this.loadToken !== token) return;
      console.error('[player] 课程加载失败：', err);
      // 载源失败必须解锁，否则该课该轨的断点会被永久抑制（§4.1.2 兜底）。
      playbackSession.endAudioLoad(this.audioLoadToken ?? 0);
      this.progressSuspended = false;
      this.setData({
        playerLoading: false,
        isTranscriptReady: true,
        playerErrorMsg: err instanceof Error ? err.message : 'Failed to load lesson',
      });
    }
  },

  prefetchAdjacentLessons(lessonId: string): void {
    if (!this.adapter || !this.lessonIds) return;
    const pos = this.lessonIds.indexOf(lessonId);
    if (pos === -1) return;

    const targets: string[] = [];
    if (pos > 0) targets.push(this.lessonIds[pos - 1]);
    if (pos < this.lessonIds.length - 1) targets.push(this.lessonIds[pos + 1]);

    for (const targetId of targets) {
      if (!detailMemoryCache.has(targetId)) {
        this.adapter.getLessonDetail(targetId).then((detail) => {
          detailMemoryCache.set(targetId, detail);
        }).catch(() => {
          // 静默容错预加载
        });
      }
    }
  },

  startTick(): void {
    if (this.tickTimer) return;
    if (!this.data.isPlaying) return;
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  },

  stopTick(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  },

  tick(force: boolean = false): void {
    if (!this.detail || !this.tracker) return;
    const now = Date.now();
    if (!force && this.lastTickMs && now - this.lastTickMs < 80) {
      return;
    }
    this.lastTickMs = now;
    // 换源瞬间的假 0 不能进入渲染（进度条归零 + 台本跳回首句 = 真机闪屏）。
    const pos = this.effectivePositionSec();
    const dur = this.currentDurationSec();

    // 单句循环 (Single Sentence Loop) 判定：预留自然发音释放时间 (+80ms)，避免提前切断吞掉最后一个词的尾音
    if (this.data.singleSentenceLoop) {
      const segs = this.currentSegments();
      const curIdx = this.data.activeSegIdx;
      if (segs && curIdx >= 0 && curIdx < segs.length) {
        const seg = segs[curIdx];
        const loopThreshold = Math.max(seg.end, seg.start + 0.5) + 0.08;
        if (pos >= loopThreshold) {
          // 内部循环回跳：不是用户意图，不提交断点（周期提交会覆盖）。
          this.seekTo(seg.start, false);
          return;
        }
      }
    }

    const changed = this.tracker.update(pos);
    if (changed) {
      // 只有当前发音句跨越改变时才触发 1 次轻量 setData
      if (this.data.showLocateBar) {
        this.setData({
          activeSegIdx: changed.segIdx,
          locateSentence: this.currentLiveSentence(),
        });
      } else {
        this.setData({ activeSegIdx: changed.segIdx });
      }

      if (this.autoScroll && this.data.activeTab !== 'vocab') {
        this.scrollToSegment(changed.segIdx);
      }
      this.expandBoxForSegment(changed.segIdx);
    }

    if (this.machine) {
      this.machine.updateActive(pos, this.tracker.current().segIdx, dur);
    }

    // §3.1：完成只能由「真实播放连续推进跨过 95%」触发，Seek 跳变不算。
    // §4.1.1：断点按约 3s 周期提交，位置取媒体真实位置（不是上面的插值 pos）。
    const mediaSec = this.mediaPositionSec();
    if (this.data.isPlaying && mediaSec !== null) {
      const previous = this.lastMediaSample;
      const advancing = previous
        ? isContinuousMediaAdvance({
          deltaMs: (mediaSec - previous.positionSec) * 1000,
          elapsedMs: now - previous.atMs,
          rate: this.machine ? this.machine.getRate() : 1,
        })
        : false;
      this.lastMediaSample = { positionSec: mediaSec, atMs: now };
      if (advancing && previous) {
        this.maybeCommitCompleted(previous.positionSec, mediaSec, dur);
      }
    } else if (!this.data.isPlaying) {
      this.lastMediaSample = null;
    }

    if (!this.scrubbing && now - (this.lastTransportMs ?? 0) >= TRANSPORT_MS) {
      this.lastTransportMs = now;
      this.updateTransport(pos, dur);
      if (this.data.isPlaying && now - (this.lastCommitMs ?? 0) >= PROGRESS_COMMIT_INTERVAL_MS) {
        this.lastCommitMs = now;
        this.commitProgress('periodic');
      }
    }

    this.updateLocateCountdown(now);
  },

  /**
   * 供渲染使用的播放位置。
   *
   * `load()` 之后平台会先上报 `currentTime=0`，`correctSample()` 因漂移过大而把采样点
   * 重建为 0；若直接用 `currentPositionSec()` 渲染，进度条会归零、台本高亮跳回首句并
   * 滚到顶部，随后 seek 生效再跳回目标位置——即真机反馈的切轨闪屏。
   *
   * 镇定窗口内实测位置明显落后于目标位置时，渲染继续用目标位置；追上或窗口过期后
   * 立即交还实测值。**只影响渲染**，断点写入仍走 `mediaPositionSec()`。
   */
  effectivePositionSec(): number {
    const live = this.currentPositionSec();
    const targetMs = Number.isFinite(this.settleTargetMs) ? (this.settleTargetMs as number) : 0;
    const untilMs = Number.isFinite(this.settleUntilMs) ? (this.settleUntilMs as number) : 0;
    if (targetMs <= 0 || untilMs <= 0) return live;

    const decision = decideSettle({
      targetMs,
      untilMs,
      nowMs: Date.now(),
      liveMs: Math.round(live * 1000),
    });
    if (decision === 'hold') return targetMs / 1000;

    this.settleUntilMs = 0;
    return live;
  },

  /** 布防换源镇定窗口；目标为 00:00 时不布防（没有「先 0 后跳」的问题）。 */
  armSettle(targetSec: number): void {
    const targetMs = Math.round(targetSec * 1000);
    if (!Number.isFinite(targetMs) || targetMs <= 0) {
      this.settleTargetMs = 0;
      this.settleUntilMs = 0;
      return;
    }
    this.settleTargetMs = targetMs;
    this.settleUntilMs = Date.now() + SWITCH_SETTLE_MS;
  },

  /**
   * 切轨后重新落位台本（BUG-004）。
   *
   * 修复要点：**不再先把 `playerScrollTop` 复位为 0**。那一步是「首帧显示第 1 条」的
   * 直接来源 —— 换轨时 `blocks` 与 scroll 偏移必须同时替换，否则视图必然先从顶部画一帧。
   *
   * 现在的链路：
   *   1. `switchTrack()` 用历史行位置估算目标偏移，与 `blocks` 放同一次 `setData`（首帧即目标附近）；
   *   2. 渲染完成后按 `REANCHOR_RETRY_DELAYS_MS` 退避补试精确量测（32% 黄金线），校正无动画；
   *   3. 全部失败则放开 `programmaticUntil`，「找回当前句」条立即可用（旧实现会压住 1.5s）。
   */
  reseatTranscript(segIdx: number): void {
    this.reanchorTranscript(segIdx);
  },

  /** 取（或重建）某一课的台本布局缓存；换课即重置。 */
  transcriptLayoutFor(
    lessonId: string | undefined,
  ): { pb: TrackLayoutCache; dg: TrackLayoutCache } {
    if (!this.transcriptLayout || this.transcriptLayoutLessonId !== lessonId) {
      this.transcriptLayout = {
        pb: { samples: [], contentHeight: 0 },
        dg: { samples: [], contentHeight: 0 },
      };
      this.transcriptLayoutLessonId = lessonId;
    }
    return this.transcriptLayout;
  },

  /** 记录一次行量测（换轨首帧估算的样本来源）。 */
  noteTranscriptLayout(
    track: AudioTrackKey,
    sample: RowSample,
    viewportHeight: number,
    contentHeight: number,
  ): void {
    if (Number.isFinite(viewportHeight) && viewportHeight > 0) {
      this.transcriptViewportHeight = viewportHeight;
    }
    const cache = this.transcriptLayoutFor(this.currentLessonId)[track];
    cache.contentHeight = Number.isFinite(contentHeight) && contentHeight > 0 ? contentHeight : cache.contentHeight;
    const idx = cache.samples.findIndex((s) => s.segIdx === sample.segIdx);
    if (idx >= 0) {
      cache.samples[idx] = sample;
    } else {
      cache.samples.push(sample);
      // 只留最近的若干个样本，避免长时间播放把数组撑大（插值只需要稀疏锚点）。
      if (cache.samples.length > 48) {
        cache.samples.splice(0, cache.samples.length - 48);
      }
    }
  },

  /**
   * 估算换轨首帧要下发的 `scroll-top`。
   *
   * 目标音轨如果还没被量过（本次会话第一次切过去），用「字数 → 行高」模型预测它的内容
   * 总高 —— 台词行按宽度换行，行高主要由字数决定，同一课同宽同字号下斜率可跨音轨迁移；
   * 再按播放进度定位到目标句。返回 `null` 表示连兜底都缺参数：此时**保留当前偏移**，
   * 绝不下发 0（旧实现下发 0 就是「先显示第 1 条」的直接原因）。
   */
  estimateSwitchScrollTop(track: AudioTrackKey, segIdx: number): number | null {
    const segs = this.segmentsByTrack ? this.segmentsByTrack[track] : [];
    if (segs.length === 0) return null;
    const index = Math.max(0, Math.min(segs.length - 1, Math.round(segIdx)));
    const layout = this.transcriptLayoutFor(this.currentLessonId)[track];
    const duration = this.durations ? this.durations[track] : 0;
    const seg = segs[index];
    const progressRatio =
      duration > 0 && seg ? Math.max(0, Math.min(1, seg.start / duration)) : null;

    let contentHeight = layout.contentHeight;
    if (!(contentHeight > 0)) {
      const other: AudioTrackKey = track === 'pb' ? 'dg' : 'pb';
      const otherLayout = this.transcriptLayoutFor(this.currentLessonId)[other];
      const ownPoints = layout.samples.map((s) => ({ chars: s.chars ?? 0, height: s.itemHeight }));
      const otherPoints = otherLayout.samples.map((s) => ({
        chars: s.chars ?? 0,
        height: s.itemHeight,
      }));
      const model = fitRowHeightModel(ownPoints) ?? fitRowHeightModel(otherPoints);
      const fallbackRowHeight =
        averageRowHeight(layout.samples) ?? averageRowHeight(otherLayout.samples) ?? undefined;
      contentHeight = estimateContentHeight({
        rowChars: this.rowCharsForTrack(track),
        model,
        fallbackRowHeight,
      });
    }

    const estimate = estimateAnchorScrollTop({
      targetIndex: index,
      totalCount: segs.length,
      viewportHeight: this.transcriptViewportHeight ?? 0,
      contentHeight: contentHeight > 0 ? contentHeight : null,
      samples: layout.samples,
      avgRowHeight: averageRowHeight(layout.samples) ?? undefined,
      progressRatio,
    });
    return estimate ? estimate.scrollTop : null;
  },

  /** 台本行字符数序列（舞台盒子内每一行各算一行，与渲染行一一对应）。 */
  rowCharsForTrack(track: AudioTrackKey): number[] {
    const blocks = this.blocksByTrack ? this.blocksByTrack[track] : [];
    const chars: number[] = [];
    for (const b of blocks) {
      if (b.kind === 'host') {
        chars.push(b.line.text.length);
      } else {
        for (const line of b.lines) chars.push(line.text.length);
      }
    }
    return chars;
  },

  /** 诊断记录（仅 `?diagnostics=1` 时写入，生产零成本）。 */
  traceReseat(entry: Record<string, unknown>): void {
    if (!this.localDiagnostics) return;
    const list = this.reseatTrace ?? (this.reseatTrace = []);
    list.push({ at: Date.now(), ...entry });
    if (list.length > 32) list.splice(0, list.length - 32);
  },

  /**
   * 换轨后的重锚：精确量测 + 退避重试 + 失败兜底。
   *
   * `attempt` 从 0 开始：第 0 次在 `setData` 渲染回调里立刻试；之后按
   * 16/60/200/400ms 补试。定位彻底失败时**必须**放开 `programmaticUntil`，
   * 否则「找回当前句」条被压住，用户连手动补救都没有（BUG-004 ⑤）。
   */
  reanchorTranscript(segIdx: number, onSettled?: (ok: boolean) => void): void {
    const token = (this.reanchorToken = (this.reanchorToken ?? 0) + 1);
    const delays = REANCHOR_RETRY_DELAYS_MS;
    this.programmaticUntil = Math.max(this.programmaticUntil ?? 0, Date.now() + 900);
    let attempt = 0;

    const finish = (ok: boolean): void => {
      if (this.reanchorToken !== token) return;
      if (!ok) {
        this.programmaticUntil = 0;
        this.evaluateActiveVisibility();
      }
      if (this.data.scrollAnimated === false) {
        this.setData({ scrollAnimated: true });
      }
      this.traceReseat({ stage: 'final', segIdx, attempt, ok });
      onSettled?.(ok);
    };

    const run = (): void => {
      if (this.reanchorToken !== token) return;
      if (!this.autoScroll || this.data.activeTab === 'vocab') {
        finish(true);
        return;
      }
      this.scrollToSegment(segIdx, {
        animated: false,
        onResult: (applied) => {
          if (this.reanchorToken !== token) return;
          if (applied) {
            finish(true);
            return;
          }
          attempt += 1;
          if (attempt >= delays.length) {
            finish(false);
            return;
          }
          setTimeout(run, delays[attempt]);
        },
      });
    };

    run();
  },

  currentPositionSec(): number {
    if (!this.audio) return 0;
    const sample = this.clockSample ?? {
      positionSec: this.audio.getPositionSec(),
      atMs: Date.now(),
    };
    return extrapolatePosition(sample, Date.now(), {
      rate: this.machine ? this.machine.getRate() : 1,
      durationSec: this.currentDurationSec(),
      playing: !this.audio.isPaused(),
    });
  },

  currentDurationSec(): number {
    const track = this.data.activeTrack;
    return this.durations ? this.durations[track] : 0;
  },

  currentSegments(): Segment[] {
    const track = this.data.activeTrack;
    return this.segmentsByTrack ? this.segmentsByTrack[track] : [];
  },

  updateTransport(positionSec: number, durationSec: number): void {
    const pct =
      durationSec > 0 ? Math.min(100, Math.max(0, (positionSec / durationSec) * 100)) : 0;
    const roundedPct = Math.round(pct);
    const posLabel = formatTime(positionSec);
    if (this.data.positionLabel !== posLabel || this.data.playerProgressPct !== roundedPct) {
      this.setData({
        positionLabel: posLabel,
        playerProgressPct: roundedPct,
      });
    }
  },

  updateLocateCountdown(nowMs: number): void {
    if (!this.data.showLocateBar || !this.locateDeadlineMs) return;
    if (nowMs >= this.locateDeadlineMs) {
      this.hideLocateBar();
    }
  },

  updateSegBoxIds(): void {
    const track = this.data.activeTrack;
    const blocks = this.blocksByTrack ? this.blocksByTrack[track] : [];
    const segs = this.segmentsByTrack ? this.segmentsByTrack[track] : [];
    const map = new Array<number>(segs.length).fill(-1);
    for (const b of blocks) {
      if (b.kind === 'box') {
        for (const l of b.lines) {
          map[l.segIdx] = b.boxGroupId;
        }
      }
    }
    this.segBoxIds = map;
  },

  refreshTrackUnderline(): void {
    const playing = this.data.isPlaying;
    const track = this.data.activeTrack;
    const tab = this.data.activeTab;
    const showPbUnderline = playing && track === 'pb' && tab !== 'pb';
    const showDgUnderline = playing && track === 'dg' && tab !== 'dg';
    if (this.data.showPbUnderline !== showPbUnderline || this.data.showDgUnderline !== showDgUnderline) {
      this.setData({
        showPbUnderline,
        showDgUnderline,
      });
    }
  },

  expandBoxForSegment(segIdx: number): void {
    const map = this.segBoxIds;
    if (!map) return;
    const gid = map[segIdx];
    if (typeof gid !== 'number' || gid < 0) return;
    const current = this.data.collapsedBoxIds;
    const idx = current.indexOf(gid);
    if (idx >= 0) {
      const next = current.slice();
      next.splice(idx, 1);
      this.setData({ collapsedBoxIds: next });
    }
  },

  /**
   * 原生直接落位视口（微信原生增强型 scroll-view）。
   *
   * 视口独立常驻，通过 scroll-top 与 scroll-with-animation 原生驱动平滑停靠。
   */
  scrollViewportTo(
    track: AudioTrackKey,
    top: number,
    animated: boolean = false,
  ): void {
    const isDg = track === 'dg';
    const trackProp = isDg ? 'playerScrollTopDg' : 'playerScrollTopPb';

    this.lastPlayerScrollTop = top;
    if (isDg) {
      this.lastPlayerScrollTopDg = top;
    } else {
      this.lastPlayerScrollTopPb = top;
    }

    const current = isDg ? this.data.playerScrollTopDg : this.data.playerScrollTopPb;
    const effectiveTop = Math.abs(current - top) < 0.5 ? (top > 1 ? top - 0.5 : top + 0.5) : top;

    const patch: Record<string, unknown> = {
      playerScrollTop: effectiveTop,
      [trackProp]: effectiveTop,
      scrollAnimated: animated,
    };
    this.setData(patch);
  },

  /**
   * Apple Podcasts 台词精准平滑停靠（Sweet Spot 32% + 自然触底 0 像素位移停靠）。
   *
   * @param opts.animated  是否带滚动动画（重锚校正必须 `false`，否则用户会看到一次滑动）
   * @param opts.onResult  是否成功量测并落位（`false` = 行节点未渲染/视口高度为 0，可重试）
   */
  scrollToSegment(
    segIdx: number,
    opts: { animated?: boolean; onResult?: (applied: boolean) => void } = {},
  ): void {
    if (this.data.activeTab === 'vocab') {
      opts.onResult?.(false);
      return;
    }
    const currentTrack = this.data.activeTrack;
    const compId = currentTrack === 'dg' ? '#transcript-dg' : '#transcript-pb';
    const comp = (this.selectComponent(compId) || this.selectComponent('#transcript')) as unknown as {
      measureRow(seg: number, cb: (rect: { top: number; bottom: number } | null) => void): void;
    } | null;
    if (!comp) {
      opts.onResult?.(false);
      return;
    }

    comp.measureRow(segIdx, (rowRect) => {
      if (!rowRect) {
        opts.onResult?.(false);
        return;
      }
      const viewportId = currentTrack === 'dg' ? '#dgViewport' : '#pbViewport';
      wx.createSelectorQuery()
        .select(viewportId)
        .boundingClientRect()
        .select(compId)
        .boundingClientRect()
        // 真实滚动事实：`scrollTop` 由平台给出，不再依赖页面自己对上次下发值的记忆
        // （BUG-001 的根因就是「以为还在上次下发的位置」）；`scrollHeight` 是
        // 含课头与底部留白的**可滚动内容总高**，比 `#transcript` 的高度更接近上界，
        // 用它才能把末尾几句滚进视口（否则短台本尾部会「当前句看不见」）。
        .select(viewportId)
        .fields({ scrollOffset: true })
        .exec(
          (
            res: Array<
              | { top: number; bottom: number; height: number; width: number }
              | { scrollTop?: number; scrollHeight?: number }
              | null
            >,
          ) => {
            const viewport = res && (res[0] as { top: number; height: number } | null);
            const content = res && (res[1] as { top: number; height: number } | null);
            const offset = res && (res[2] as { scrollTop?: number; scrollHeight?: number } | null);
            if (!viewport || !content || !(viewport.height > 0)) {
              opts.onResult?.(false);
              return;
            }

            const segs = this.currentSegments();
            const totalCount = segs.length;
            const currentScroll =
              offset && typeof offset.scrollTop === 'number'
                ? offset.scrollTop
                : (currentTrack === 'dg' ? this.data.playerScrollTopDg : this.data.playerScrollTopPb);
            const headerOffset = Math.max(0, content.top - viewport.top);
            const totalContentHeight = content.height + headerOffset;
            const itemTop =
              rowRect.top - viewport.top + (currentScroll ?? this.lastPlayerScrollTop ?? 0);
            const itemHeight = rowRect.bottom - rowRect.top;

            // 量测结果既是本次落位依据，也是**下次换轨首帧**的估算样本（BUG-004）。
            // `chars` 让「字数 → 行高」模型可以迁移到还没显示过的另一条音轨。
            this.noteTranscriptLayout(
              this.data.activeTrack,
              { segIdx, itemTop, itemHeight, chars: segs[segIdx] ? segs[segIdx].text.length : 0 },
              viewport.height,
              totalContentHeight,
            );
            // 首帧落位诊断：rowRect.top 是相对视口的位置，正是「第一眼看到哪一行」。
            this.traceReseat({
              stage: 'measure',
              segIdx,
              rowTop: Math.round(rowRect.top),
              viewportHeight: Math.round(viewport.height),
              ratio: viewport.height > 0 ? Number((rowRect.top / viewport.height).toFixed(3)) : null,
            });

            const scrollResult = computePodcastScrollTarget({
              targetIndex: segIdx,
              totalCount,
              itemTop,
              itemHeight,
              viewportHeight: viewport.height,
              totalContentHeight,
              currentScrollTop: currentScroll ?? this.lastPlayerScrollTop ?? 0,
            });

            if (scrollResult.shouldScroll) {
              this.programmaticUntil = Math.max(this.programmaticUntil ?? 0, Date.now() + 1500);
              this.scrollViewportTo(this.data.activeTrack, scrollResult.targetScrollTop, opts.animated !== false);
            }
            opts.onResult?.(true);
          },
        );
    });
  },

  currentLiveSentence(): string {
    if (!this.tracker) return '';
    const segs = this.currentSegments();
    const live = findLiveSentenceText(segs, this.tracker.current().segIdx);
    return live ? `"${live}"` : '';
  },

  startLocateCountdown(): void {
    if (Date.now() < (this.programmaticUntil ?? 0)) return;
    this.autoScroll = false;
    this.locateDeadlineMs = Date.now() + LOCATE_SECONDS * 1000;
    if (!this.data.showLocateBar) {
      this.setData({
        showLocateBar: true,
        locateSentence: this.currentLiveSentence(),
      });
    }
    if (this.locateTimer) {
      clearInterval(this.locateTimer);
    }
    this.locateTimer = setInterval(() => {
      const now = Date.now();
      if (!this.data.showLocateBar || !this.locateDeadlineMs) {
        if (this.locateTimer) {
          clearInterval(this.locateTimer);
          this.locateTimer = null;
        }
        return;
      }
      if (now >= this.locateDeadlineMs) {
        if (this.locateTimer) {
          clearInterval(this.locateTimer);
          this.locateTimer = null;
        }
        // 5秒倒计时结束：自动平滑归位当前句（对齐 iOS）
        this.returnToActive();
      }
    }, 400);
  },

  hideLocateBar(): void {
    this.locateDeadlineMs = 0;
    if (this.locateThrottleTimer) {
      clearTimeout(this.locateThrottleTimer);
      this.locateThrottleTimer = null;
    }
    if (this.locateTimer) {
      clearInterval(this.locateTimer);
      this.locateTimer = null;
    }
    if (this.data.showLocateBar) {
      this.setData({ showLocateBar: false });
    }
  },

  isActiveSegmentVisible(cb: (visible: boolean) => void): void {
    if (this.data.activeTab === 'vocab') {
      cb(true);
      return;
    }
    const segIdx = this.tracker ? this.tracker.current().segIdx : -1;
    if (segIdx < 0) {
      cb(true);
      return;
    }

    const currentTrack = this.data.activeTrack;
    const compId = currentTrack === 'dg' ? '#transcript-dg' : '#transcript-pb';
    const viewportId = currentTrack === 'dg' ? '#dgViewport' : '#pbViewport';
    const comp = (this.selectComponent(compId) || this.selectComponent('#transcript')) as unknown as {
      measureRow(seg: number, callback: (rect: { top: number; bottom: number } | null) => void): void;
    } | null;

    wx.createSelectorQuery()
      .select(viewportId)
      .boundingClientRect()
      .exec((res: Array<{ top: number; bottom: number; height: number } | null>) => {
        const viewport = res && res[0];
        if (!viewport || !(viewport.height > 0) || !comp) {
          cb(false);
          return;
        }
        comp.measureRow(segIdx, (row) => {
          if (!row) {
            cb(false);
            return;
          }
          const leadingEdge = (row.top - viewport.top) / viewport.height;
          const trailingEdge = (row.bottom - viewport.top) / viewport.height;
          cb(isWithinFocusViewport(leadingEdge, trailingEdge));
        });
      });
  },

  evaluateActiveVisibility(): void {
    if (Date.now() < (this.programmaticUntil ?? 0)) return;
    this.isActiveSegmentVisible((visible) => {
      if (Date.now() < (this.programmaticUntil ?? 0)) return;
      if (visible) {
        this.hideLocateBar();
      } else {
        this.startLocateCountdown();
      }
    });
  },

  returnToActive(): void {
    this.autoScroll = true;
    this.isUserInteracting = false;
    this.programmaticUntil = Date.now() + 1500;
    this.hideLocateBar();
    const segIdx = this.tracker ? this.tracker.current().segIdx : 0;
    this.scrollToSegment(segIdx);
  },

  applyMetadata(): void {
    if (!this.audio || !this.detail) return;
    const track = this.data.activeTrack;
    let theme: 'dark' | 'light' = 'dark';
    try {
      const sys = wx.getSystemInfoSync?.();
      theme = sys?.theme === 'light' ? 'light' : 'dark';
    } catch {
      // 忽略
    }
    this.audio.setMetadata?.({
      title: this.detail.title,
      album: APP_DISPLAY_NAME,
      artist: `${this.detail.level} · ${trackLabelOf(track)}`,
      coverImgUrl: `assets/branding/brand_icon_${theme}.png`,
    });
  },

  onThemeChange(): void {
    this.applyMetadata();
  },

  /**
   * 媒体真实位置（秒）；无有效媒体事实时返回 null。
   *
   * 这是断点写入的唯一位置来源（§4.1.2）。绝不返回 `currentPositionSec()` 的插值：
   * 恢复 seek 被平台静默丢弃后，插值会把播放头算成 0 附近，落盘即污染历史断点。
   * 位置 ≤ 0 时也返回 null——0 位置没有保存价值，且会把断点写成 00:00。
   */
  mediaPositionSec(): number | null {
    if (!this.audio) return null;
    const pos = this.audio.getPositionSec();
    if (!Number.isFinite(pos) || pos <= 0) return null;
    return pos;
  },

  /**
   * 提交一次断点（**唯一写入通道**，§4.1.1–4.1.4）。
   *
   * @param reason 触发意图；`userSeek` 允许写入 0 与倒退（§4.1.3）。
   * @returns 是否真的落盘（false 会在控制台告警，不谎报已保存，§4.1.8）。
   */
  commitProgress(reason: CommitReason): boolean {
    if (!this.detail) return false;
    if (this.progressSuspended) return false;
    const positionSec = this.mediaPositionSec();
    if (positionSec === null) return false;
    const track = this.data.activeTrack;
    const durations = this.durations;
    const result = progressJournal.commit({
      lessonId: this.detail.lessonId,
      track,
      positionMs: Math.round(positionSec * 1000),
      segmentIndex: this.tracker ? this.tracker.current().segIdx : 0,
      durationMs: durations && durations[track] > 0 ? Math.round(durations[track] * 1000) : undefined,
      reason,
    });
    if (!result.committed && result.failureReason !== 'zero-overwrite') {
      console.warn('[player] 断点未保存：', result.failureReason, reason);
    }
    return result.committed;
  },

  /**
   * 跨过 PB 95% 时置完成（§3.1 / §4.1.5）。
   *
   * 「跨越」严格指本次连续推进从阈值下方走到上方：Seek 到 95% 以上不算
   * （F02/F04），只有之后真正播到自然结束才由 handleEnded 置完成（F03）。
   */
  maybeCommitCompleted(previousSec: number, positionSec: number, durationSec: number): void {
    if (!this.detail || durationSec <= 0) return;
    if (this.progressSuspended) return;
    if (this.data.activeTrack !== 'pb') return;
    const threshold = PB_COMPLETED_PCT / 100;
    if (previousSec / durationSec >= threshold) return;
    if (positionSec / durationSec < threshold) return;
    progressJournal.commitCompleted(this.detail.lessonId);
  },

  flushStorage(): void {
    progressJournal.flush();
  },

  setKeepScreenOn(on: boolean): void {
    if (this.keepScreenOn === on) return;
    this.keepScreenOn = on;
    try {
      wx.setKeepScreenOn({ keepScreenOn: on });
    } catch {
      // 忽略
    }
  },

  play(): void {
    // §5.2：先记录**用户意图**，再交给引擎；加载完成时以意图为准。
    this.playRequested = true;
    if (!this.audio || !this.detail) return;
    if (this.machine) {
      this.audio.setPlaybackRate(this.machine.getRate());
    }
    this.audio.play();
    this.startTick();
  },

  pause(): void {
    // 加载期间点暂停同样有效：意图置 false，迟到的加载完成不得再发声（F15 / S05）。
    this.playRequested = false;
    this.audio?.pause();
  },

  togglePlay(): void {
    // §3.2：「已播放完且停止」≠「中途暂停」——结束后主按钮从头播放。
    if (this.data.ended) {
      this.restartFromEnd();
      return;
    }
    if (this.data.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  },

  /**
   * 按最新意图落定播放态（加载完成后调用）。
   *
   * 只做「意图 → 动作」，不判断业务规则；所有规则已在 {@link planEntry} 里决定。
   */
  syncPlayState(): void {
    if (!this.audio || !this.detail) return;
    if (this.progressSuspended) return;
    if (this.playRequested) {
      this.play();
    } else {
      // 不经过 `pause()`：这里不是用户意图，不能把 playRequested 再改回去。
      this.audio.pause();
      this.setData({ isPlaying: false });
    }
  },

  /** ↺：从本音轨 00:00 重播（§3.2 / F05；显式 Seek，允许把断点写回 0）。 */
  restartFromEnd(): void {
    if (!this.detail) return;
    this.setData({ ended: false });
    this.seekTo(0);
    this.play();
  },

  /** 当前课程在索引中的下标；未就绪或找不到为 -1。 */
  currentLessonIndex(): number {
    const ids = this.lessonIds ?? [];
    return this.detail ? ids.indexOf(this.detail.lessonId) : -1;
  },

  seekTo(positionSec: number, commit = true): void {
    if (!this.audio) return;
    // 任何显式定位都离开「已结束」态（§3.2：ended 只属于停在末尾那一刻）。
    if (this.data.ended) {
      this.setData({ ended: false });
    }
    const dur = this.currentDurationSec();
    const target = Math.min(Math.max(0, positionSec), dur > 0 ? dur : positionSec);
    this.audio.seek(target);
    this.clockSample = { positionSec: target, atMs: Date.now() };
    if (this.tracker) {
      const changed = this.tracker.update(target);
      if (changed) {
        this.setData({ activeSegIdx: changed.segIdx });
      }
    }
    this.autoScroll = true;
    this.hideLocateBar();
    this.updateTransport(target, dur);
    this.scrollToSegment(this.tracker ? this.tracker.current().segIdx : 0);

    // 用户把播放头放到了新位置：锚点跟随，后续周期提交以它为参照。
    if (this.detail) {
      progressJournal.setPlayheadAnchor(
        this.detail.lessonId,
        this.data.activeTrack,
        Math.round(target * 1000),
      );
    }

    // §3.1 / §5.2：显式 Seek 到末尾不得被当成自然结束（不完成、不自动连播）。
    if (dur > 0 && target >= dur - 1.5) {
      this.syntheticEndUntilMs = Date.now() + SYNTHETIC_END_WINDOW_MS;
    }

    // §4.1.3：显式 Seek 是主动改变断点的意图 → 立即保存（即便保持暂停）。
    // 这里不用 mediaPositionSec()：BAM 的 currentTime 在 seek 完成前仍是旧值。
    if (commit && this.detail) {
      progressJournal.commit({
        lessonId: this.detail.lessonId,
        track: this.data.activeTrack,
        positionMs: Math.round(target * 1000),
        segmentIndex: this.tracker ? this.tracker.current().segIdx : 0,
        durationMs: dur > 0 ? Math.round(dur * 1000) : undefined,
        reason: 'userSeek',
      });
    }
  },

  prevSentence(): void {
    const segs = this.currentSegments();
    const cur = this.tracker ? this.tracker.current().segIdx : 0;
    if (cur > 0) {
      this.seekTo(segs[cur - 1].start);
    } else {
      this.seekTo(0);
    }
  },

  nextSentence(): void {
    const segs = this.currentSegments();
    const cur = this.tracker ? this.tracker.current().segIdx : 0;
    if (cur >= 0 && cur < segs.length - 1) {
      this.seekTo(segs[cur + 1].start);
    }
  },

  goPrevLesson(): void {
    const ids = this.lessonIds ?? [];
    const target = manualPrevIndex(this.currentLessonIndex());
    // §2 边界条：首课禁用、不环绕。
    if (target === null || !ids[target]) return;
    this.commitProgress('lessonSwitch');
    this.flushStorage();
    // 位置 / 音轨 / 播放态全部由 loadLessonDetail 里的 planEntry 决定（D1–D3）。
    void this.loadLessonDetail(ids[target], 'manualNav');
  },

  goNextLesson(): void {
    const ids = this.lessonIds ?? [];
    const target = manualNextIndex(this.currentLessonIndex(), ids.length);
    // §2 边界条：末课禁用、不环绕；连播的末课环绕走 handleEnded（F09）。
    if (target === null || !ids[target]) return;
    this.commitProgress('lessonSwitch');
    this.flushStorage();
    void this.loadLessonDetail(ids[target], 'manualNav');
  },

  switchTab(tab: ViewTab): void {
    if (tab === this.data.activeTab) return;
    if (tab === 'vocab') {
      this.setData({ activeTab: 'vocab', tabIndex: tabIndexOf('vocab') });
      this.hideLocateBar();
      this.refreshTrackUnderline();
      return;
    }
    this.switchTrack(tab);
  },

  switchTrack(track: AudioTrackKey, seekSegIdx?: number): void {
    if (!this.machine || !this.tracker || !this.detail || !this.audio) return;
    const wasPlaying = this.data.isPlaying;

    // §4.1.1 / §5.2：切轨前把**离开音轨**的有效断点落盘，不让新音轨的瞬时
    // 位置串写到旧音轨上。
    this.commitProgress('trackSwitch');
    this.machine.switchTrack(track);
    const segs = this.segmentsByTrack ? this.segmentsByTrack[track] : [];
    this.tracker.setSegments(segs);

    // §2 / §4.1.6：目标音轨按它自己的有效断点恢复（已完成 PB、停在末尾的 DG → 00:00）。
    let targetSec = progressJournal.resolveResumeMs(this.detail.lessonId, track) / 1000;
    if (seekSegIdx !== undefined && segs[seekSegIdx]) {
      targetSec = segs[seekSegIdx].start;
    }
    this.tracker.update(targetSec);
    this.clockSample = { positionSec: targetSec, atMs: Date.now() };

    // BUG-004 核心：`blocks` 与首帧滚动偏移必须在**同一次** setData 里替换。
    // 旧实现先下发 `playerScrollTop: 0` 再靠量测补充，必然先画一帧第 1 条。
    const switchSegIdx = this.tracker.current().segIdx;
    const anchorTop = this.estimateSwitchScrollTop(track, switchSegIdx);
    const switchPatch: Partial<PageData> = {
      activeTrack: track,
      activeTab: track,
      tabIndex: tabIndexOf(track),
      trackLabel: trackLabelOf(track),
      blocks: this.blocksByTrack ? this.blocksByTrack[track] : [],
      activeSegIdx: switchSegIdx,
      collapsedBoxIds: [],
      durationLabel: formatTime(this.durations ? this.durations[track] : 0),
      isAudioLoading: true,
      // 换轨离开「已结束」态（DG 播完 → 切到 PB 不应再显示 ↺）。
      ended: false,
      // 校正必须发生在这一帧，不能被 300ms 滚动动画暴露出来。
      scrollAnimated: false,
    };
    if (anchorTop !== null) {
      switchPatch.playerScrollTop = anchorTop;
      if (track === 'dg') {
        switchPatch.playerScrollTopDg = anchorTop;
        this.lastPlayerScrollTopDg = anchorTop;
      } else {
        switchPatch.playerScrollTopPb = anchorTop;
        this.lastPlayerScrollTopPb = anchorTop;
      }
      this.lastPlayerScrollTop = anchorTop;
    }
    // 重锚期间不评估「找回当前句」的可见性（否则会闪一下定位条）。
    this.programmaticUntil = Math.max(this.programmaticUntil ?? 0, Date.now() + 900);
    this.setData(switchPatch, () => {
      this.traceReseat({ stage: 'switch', track, segIdx: switchSegIdx, anchorTop });
      if (anchorTop !== null) {
        this.scrollViewportTo(track, anchorTop, false);
      }
      this.reanchorTranscript(switchSegIdx, () => {
        // 校正完毕后，开启平滑过渡动画
        this.setData({ scrollAnimated: true });
      });
    });

    // 从切换的第一帧起就按**目标位置**渲染，并布防镇定窗口：`load()` 之后平台会先
    // 上报 `currentTime=0`，否则进度条会归零、台本高亮跳回首句再「闪」回目标位置。
    this.armSettle(targetSec);
    this.updateTransport(targetSec, this.durations ? this.durations[track] : 0);

    this.autoScroll = true;
    this.hideLocateBar();
    this.updateSegBoxIds();
    this.refreshTrackUnderline();
    this.applyMetadata();

    const src = this.adapter?.resolveAudioFileId(
      this.detail.lessonId, track, this.detail.audio[track],
    ) || '';
    if (!src) {
      this.audio.pause();
      this.setData({ isPlaying: false, playerErrorMsg: '该音轨音频地址不可用。' });
      return;
    }
    this.setData({ playerErrorMsg: '' });
    // §4.1.2：切轨同样是「load 后 seek」，必须上锁，
    // 否则切轨瞬间的 0.0s 位置会覆盖目标音轨的好进度。
    this.audioLoadToken = playbackSession.beginAudioLoad(this.detail.lessonId, track);
    this.audio.load(src);
    this.audio.setPlaybackRate(this.machine.getRate());
    // §4.1.1 单一写入通道：后台侧（PlaybackSessionService）提交时读的是自己的
    // `state.track`，页面切轨后必须同步，否则「PB→DG 继续播放」期间的后台周期提交
    // 会把 DG 的位置写进 PB 记录（串写），切回 PB 就看不到断点了。
    playbackSession.setLessonInfo({
      lessonId: this.detail.lessonId,
      track,
      durationSec: this.durations && this.durations[track] > 0 ? this.durations[track] : undefined,
    });
    this.audio.seek(targetSec);
    // §2：同课切轨继承现有播放/暂停；意图位随之一致，避免后续加载用旧意图。
    this.playRequested = wasPlaying;
    if (wasPlaying) {
      this.play();
    } else {
      this.audio.pause();
    }

    progressJournal.setPlayheadAnchor(
      this.detail.lessonId,
      track,
      Math.round(targetSec * 1000),
    );
    // 台本重锚已在上面 setData 的回调里启动（与 blocks 同一次下发，首帧即目标附近），
    // 这里不再重复复位 —— `reseatTranscript()` 的旧「先归零」路径已删除。
    if (seekSegIdx !== undefined) {
      // 词条例句跳转属于显式 Seek：目标位置可能小于该轨已存进度，按主动意图写入（§4.1.3）。
      progressJournal.commit({
        lessonId: this.detail.lessonId,
        track,
        positionMs: Math.round(targetSec * 1000),
        segmentIndex: this.tracker.current().segIdx,
        durationMs: this.durations && this.durations[track] > 0
          ? Math.round(this.durations[track] * 1000)
          : undefined,
        reason: 'userSeek',
      });
    }
  },

  handleEnded(): void {
    if (!this.machine) return;

    // §3.1 F04 / §5.2：显式 Seek 到末尾后引擎发来的 completed 不是自然结束，
    // 不标完成、不自动连播、不算重播。
    if (Date.now() < (this.syntheticEndUntilMs ?? 0)) {
      this.syntheticEndUntilMs = 0;
      // F04 / R5：这是显式 Seek 到末尾后的引擎回调，不是自然结束——
      // 不置完成、不自动连播、也**不置 ended**（避免把 Seek 说成「已播完」）。
      this.playRequested = false;
      this.setData({ isPlaying: false });
      return;
    }

    const action = this.machine.decideEndedAction();
    if (action === 'loopSentence') {
      const segs = this.currentSegments();
      const cur = this.tracker ? this.tracker.current().segIdx : 0;
      this.seekTo(segs[cur] ? segs[cur].start : 0);
      this.play();
      return;
    }
    if (action === 'repeatEpisode') {
      this.seekTo(0);
      this.play();
      return;
    }

    // 可信自然结束：先落断点，再独立置完成（§4.1.5 两者解耦，互不覆盖）。
    this.commitProgress('naturalEnd');
    if (this.data.activeTrack !== 'pb') {
      // §3.2 / F05：DG 自然结束即停止，不自动切课、不回到 PB；主按钮显示 ↺。
      this.playRequested = false;
      this.setKeepScreenOn(false);
      this.setData({ isPlaying: false, ended: true });
      return;
    }
    if (this.detail) {
      progressJournal.commitCompleted(this.detail.lessonId);
    }

    // §3.2 / §3.2 首尾循环边界规则（v1.2）：
    //   手机端连播恒生效（无开关，F08 记 N/A）；目标位置恒 00:00；
    //   末课**循环回第一课**（F09），单课库同课 00:00 重播（F13）。
    //   注意这里**不能用** `hasNextLesson`：那个是手动按钮的边界（末课禁用）。
    const ids = this.lessonIds ?? [];
    const target = MOBILE_AUTO_NEXT_ENABLED
      ? nextLessonIndex(this.currentLessonIndex(), ids.length)
      : null;
    if (target === null || !ids[target]) {
      // 索引未知（网络失败且无缓存）：无法确定下一课，但手机端 PB **不能停在末尾**。
      // 按 F13 同口径兜底：本课 00:00 重播；不写 0 断点，末尾断点保留到真实推进。
      this.seekTo(0, false);
      this.play();
      return;
    }
    this.playRequested = true;
    void this.loadLessonDetail(ids[target], 'autoNext');
  },

  onBack(): void {
    this.commitProgress('lessonSwitch');
    this.flushStorage();
    wx.navigateBack();
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const title = this.data.lessonTitle || 'EnglishPod';
    const id = this.currentLessonId || '';
    return {
      title: `跟我一起听《${title}》`,
      path: `/pages/player/index?lessonId=${id}&intent=share`,
    };
  },

  onShareTimeline(): WechatMiniprogram.Page.ICustomTimelineContent {
    const title = this.data.lessonTitle || 'EnglishPod';
    const id = this.currentLessonId || '';
    return {
      title: `EnglishPod: ${title}`,
      query: `lessonId=${id}&intent=share`,
    };
  },

  onTabTap(): void {
    // 页面已精简为纯粹响应 Podcast 音频与台词，无需切换音轨
  },

  onToggle(): void {
    this.togglePlay();
  },

  onPrevSentence(): void {
    this.prevSentence();
  },

  onNextSentence(): void {
    this.nextSentence();
  },

  onPrevLesson(): void {
    if (this.data.hasPrevLesson) this.goPrevLesson();
  },

  onNextLesson(): void {
    if (this.data.hasNextLesson) this.goNextLesson();
  },

  onToggleLoop(): void {
    if (this.machine) {
      const loop = this.machine.toggleSingleSentenceLoop();
      this.setData({ singleSentenceLoop: loop });
      playbackSession.setLessonInfo({ lessonId: this.currentLessonId || '', singleSentenceLoop: loop });
    }
  },

  onToggleRepeat(): void {
    if (this.machine) {
      const rep = this.machine.toggleRepeatEpisode();
      this.setData({ repeatEpisode: rep });
      playbackSession.setLessonInfo({ lessonId: this.currentLessonId || '', repeatEpisode: rep });
    }
  },

  onCycleSpeed(): void {
    // 精简交互：已取消倍速播放，恒定保持 1.0x 默认倍速
  },

  onScrubStart(): void {
    this.scrubbing = true;
  },

  onScrubMove(): void {
    // 进度条内部处理
  },

  onScrubEnd(event: WechatMiniprogram.CustomEvent<{ ratio: number }>): void {
    this.scrubbing = false;
    const ratio = event.detail && Number.isFinite(event.detail.ratio) ? event.detail.ratio : 0;
    this.seekTo(ratio * this.currentDurationSec());
  },

  onLineTap(event: WechatMiniprogram.CustomEvent<{ segIdx: number }>): void {
    const segIdx = event.detail && event.detail.segIdx;
    const segs = this.currentSegments();
    if (typeof segIdx === 'number' && segs[segIdx]) {
      this.seekTo(segs[segIdx].start);
    }
  },

  onToggleBox(event: WechatMiniprogram.CustomEvent<{ boxGroupId: number }>): void {
    const gid = event.detail && event.detail.boxGroupId;
    if (typeof gid !== 'number') return;
    const current = this.data.collapsedBoxIds.slice();
    const idx = current.indexOf(gid);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(gid);
    }
    this.setData({ collapsedBoxIds: current });
  },

  onVocabToggle(event: WechatMiniprogram.CustomEvent<{ index: number }>): void {
    const index = event.detail && event.detail.index;
    if (typeof index !== 'number') return;
    this.setData({ expandedVocabIndex: this.data.expandedVocabIndex === index ? -1 : index });
  },

  onVocabExample(event: WechatMiniprogram.CustomEvent<{ track: string; segIdx: number }>): void {
    const track = event.detail && (event.detail.track as AudioTrackKey);
    const segIdx = event.detail && event.detail.segIdx;
    if ((track !== 'pb' && track !== 'dg') || typeof segIdx !== 'number') return;
    this.switchTrack(track, segIdx);
  },

  onTranscriptDragStart(): void {
    this.isUserInteracting = true;
    this.programmaticUntil = 0;
  },

  onTranscriptDragEnd(): void {
    this.isUserInteracting = false;
  },

  onTranscriptScroll(event: WechatMiniprogram.ScrollViewScroll): void {
    const top = event && event.detail ? event.detail.scrollTop : undefined;
    const track =
      ((event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.track) as AudioTrackKey) ||
      this.data.activeTrack;
    if (typeof top === 'number' && Number.isFinite(top)) {
      this.lastPlayerScrollTop = top;
      if (track === 'dg') {
        this.lastPlayerScrollTopDg = top;
      } else {
        this.lastPlayerScrollTopPb = top;
      }
    }
    // 编程式滚动保护期内（例如点击找回条、跳句、自动切句）：完全静默，绝不触碰找回条
    if (Date.now() < (this.programmaticUntil ?? 0)) return;

    // 用户滚动（包括手动拖拽与惯性滑行）：48ms 极速响应（约 3 帧），即时感知脱离活跃焦点
    const now = Date.now();
    const elapsed = now - (this.locateMeasureAt ?? 0);
    const THROTTLE_MS = 48;
    if (elapsed >= THROTTLE_MS) {
      this.locateMeasureAt = now;
      this.evaluateActiveVisibility();
      return;
    }
    if (this.locateThrottleTimer) {
      clearTimeout(this.locateThrottleTimer);
    }
    this.locateThrottleTimer = setTimeout(() => {
      this.locateThrottleTimer = null;
      if (Date.now() < (this.programmaticUntil ?? 0)) return;
      this.locateMeasureAt = Date.now();
      this.evaluateActiveVisibility();
    }, THROTTLE_MS - elapsed);
  },

  onLocateTap(): void {
    this.returnToActive();
  },
});

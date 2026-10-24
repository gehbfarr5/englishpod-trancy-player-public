/**
 * ============================================================================
 *  EnglishPod 课程库页面（pages/library/index.ts）
 * ============================================================================
 *  纯 WebView 原生页面，对齐 iOS 黄金基线。
 *  - 顶部栏：置顶标题、完成度计数、右上原生胶囊避让
 *  - 聚光灯：继续收听卡（无进度记录时优雅隐藏）
 *  - 筛选栏：All / In Progress / Completed 动态计数胶囊
 *  - 课程列表：本地同步存储秒开（335 课 0ms 首屏），首发骨架屏，分片增量呈现
 *  - 原生导航：通过 wx.navigateTo 打开播放器，支持 iOS 原生右滑返回
 * ============================================================================
 */

import { WechatCloudAdapter } from '../../adapters/wechat/cloud';
import { APP_DISPLAY_NAME, USE_MOCK_DATA } from '../../config/env';
import {
  LibraryFilterKey,
  countByFilter,
  deriveCardStatus,
  filterLessonIds,
  pickContinueLesson,
  resolveContinueToggleAction,
} from '../../core/progressEngine';
import {
  CloudAdapter,
  LessonIndexItem,
  ProgressMap,
} from '../../core/types';
import { MockCloudAdapter } from '../../mock/index';
import { playbackSession } from '../../services/playbackSession';
import { progressJournal } from '../../services/progressJournal';

const CACHE_KEY_LESSON_INDEX = 'ep_cached_lesson_index_v1';
const CHUNK_SIZE = 30;

const FILTER_EMPTY_HINT: Record<LibraryFilterKey, string> = {
  all: 'No listening lessons available yet',
  in_progress: 'No lessons in progress yet. Pick one from "All" to start!',
  completed: 'No completed lessons yet. Finish one to light it up!',
};

function zeroPad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 课程卡片展示模型。 */
interface LessonCardModel {
  lessonId: string;
  indexText: string;
  title: string;
  level: string;
  statusLabel: string;
  isDone: boolean;
  isCurrent: boolean;
  highlight: boolean;
  barValue: number;
}

/** 筛选 pill 模型。 */
interface FilterPillModel {
  key: LibraryFilterKey;
  label: string;
}

/** 继续收听卡展示模型。 */
interface ContinueViewModel {
  badge: string;
  attributes: string;
  progressPct: number;
}

interface PageData {
  appName: string;
  subtitle: string;
  completionText: string;
  safeTopPx: number;
  navBarPx: number;
  isIndexLoading: boolean;
  filters: FilterPillModel[];
  activeFilter: LibraryFilterKey;
  visibleLessons: LessonCardModel[];
  renderedLessons: LessonCardModel[];
  continueInfo: ContinueViewModel | null;
  continueTitle: string;
  continueAttributes: string;
  continueFallback: string;
  scrollTop: number;
  emptyHint: string;
  isPlaying: boolean;
}

interface PageCustom {
  adapter?: CloudAdapter;
  lessons?: LessonIndexItem[];
  records?: ProgressMap;
  lastPlayedId?: string;
  renderedCount: number;
  scrollTops?: Record<LibraryFilterKey, number>;
  unsubscribeProgress?: () => void;
  unsubscribeLessonChange?: () => void;
  unsubscribeState?: () => void;

  initNavMetrics(): void;
  loadLibraryData(): Promise<void>;
  reloadFromStorage(): void;
  refreshLibraryView(): void;
  buildFilters(): FilterPillModel[];
  buildVisibleLessons(filter: LibraryFilterKey): LessonCardModel[];
  updateRenderedLessons(): void;
  buildContinueView(): ContinueViewModel | null;
  getContinueLessonId(): string;
  syncBackgroundAudioState(): void;

  onFilterChange(event: WechatMiniprogram.CustomEvent<{ key: string }>): void;
  onWellScroll(event: WechatMiniprogram.ScrollViewScroll): void;
  onWellScrollToLower(): void;
  onLessonTap(event: WechatMiniprogram.CustomEvent<{ lessonId: string }>): void;
  onContinueTap(): void;
  onContinueToggle(): void;
}

function playerPath(): string {
  try {
    const version = wx.getAccountInfoSync().miniProgram.envVersion;
    if (version === 'develop' || version === 'trial') return '/pages/rebuildPlayer/index';
  } catch { /* Production fallback retains the established entry. */ }
  return '/pages/player/index';
}

Page<PageData, PageCustom>({
  data: {
    appName: APP_DISPLAY_NAME,
    subtitle: 'Elementary · 335 Lessons',
    completionText: '0 / 335 Done',
    safeTopPx: 44,
    navBarPx: 44,
    isIndexLoading: true,
    filters: [
      { key: 'all', label: 'All' },
      { key: 'in_progress', label: 'In Progress' },
      { key: 'completed', label: 'Completed' },
    ],
    activeFilter: 'all',
    visibleLessons: [],
    renderedLessons: [],
    continueInfo: null,
    continueTitle: '',
    continueAttributes: '',
    continueFallback: 'Ready to listen',
    scrollTop: 0,
    emptyHint: FILTER_EMPTY_HINT.all,
    isPlaying: false,
  },

  renderedCount: CHUNK_SIZE,

  onLoad() {
    this.initNavMetrics();
    this.adapter = USE_MOCK_DATA ? new MockCloudAdapter() : new WechatCloudAdapter();
    this.scrollTops = { all: 0, in_progress: 0, completed: 0 };

    this.reloadFromStorage();

    // 订阅全局后台播放进度，主页仅更新进度条与状态，避免逐句解析的高昂开销
    this.unsubscribeProgress = playbackSession.subscribeProgress((_pos, _dur, pct) => {
      if (this.data.continueInfo && this.data.continueInfo.progressPct !== pct) {
        this.setData({ 'continueInfo.progressPct': pct });
      }
    });

    // 订阅自然播完自动切下一课事件
    this.unsubscribeLessonChange = playbackSession.subscribeLessonChange((newLessonId) => {
      this.lastPlayedId = newLessonId;
      this.reloadFromStorage();
      this.refreshLibraryView();
    });

    // 订阅播放/暂停状态变更
    this.unsubscribeState = playbackSession.subscribeState((session) => {
      if (this.data.isPlaying !== session.isPlaying) {
        this.setData({ isPlaying: session.isPlaying });
      }
    });

    // 1. 同步尝试从 Storage 读取已缓存的 335 课索引，实现 0ms 秒开呈现
    try {
      const cached = wx.getStorageSync(CACHE_KEY_LESSON_INDEX);
      if (Array.isArray(cached) && cached.length > 0) {
        this.lessons = cached as LessonIndexItem[];
        this.setData({ isIndexLoading: false });
        this.refreshLibraryView();
      }
    } catch {
      // 容错降级
    }

    // 2. 异步向网络/云端获取最新列表并在后台更新
    void this.loadLibraryData();
  },

  onShow() {
    this.reloadFromStorage();
    const session = playbackSession.getState();
    if (session.lessonId) {
      this.lastPlayedId = session.lessonId;
    }
    this.setData({ isPlaying: session.isPlaying });
    if (this.lessons && this.lessons.length > 0) {
      this.refreshLibraryView();
    }
  },

  onUnload() {
    this.unsubscribeProgress?.();
    this.unsubscribeLessonChange?.();
    this.unsubscribeState?.();
  },

  initNavMetrics(): void {
    try {
      const windowInfo = wx.getWindowInfo();
      const safeTop = windowInfo.safeArea ? windowInfo.safeArea.top : windowInfo.statusBarHeight || 44;
      const capsule = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = Math.max(44, (capsule.top - safeTop) * 2 + capsule.height);

      this.setData({
        safeTopPx: safeTop,
        navBarPx: navBarHeight,
      });
    } catch {
      this.setData({
        safeTopPx: 44,
        navBarPx: 44,
      });
    }
  },


  syncBackgroundAudioState(): void {
    try {
      const session = playbackSession.getState();
      this.setData({ isPlaying: session.isPlaying });
    } catch {
      // 忽略
    }
  },

  async loadLibraryData(): Promise<void> {
    if (!this.adapter) return;
    try {
      const index = await this.adapter.getLessonIndex();
      this.lessons = index;

      // 写入同步存储，供下次启动 0ms 秒开
      try {
        wx.setStorageSync(CACHE_KEY_LESSON_INDEX, index);
      } catch {
        // 忽略存储超限错误
      }

      this.setData({ isIndexLoading: false });
      this.refreshLibraryView();
    } catch (err) {
      console.error('[library] 课程列表加载失败：', err);
      this.setData({ isIndexLoading: false });
    }
  },

  reloadFromStorage(): void {
    // 唯一读取源：进度提交日志（EP-PBC-001 §4）。课程库只拿 UI 投影，
    // 不再直接碰存储，也不持有第二份内存镜像。
    this.records = progressJournal.progressViews();
    this.lastPlayedId = progressJournal.lastOpenedLessonId();
  },

  refreshLibraryView(): void {
    if (!this.lessons) return;
    const filter = this.data.activeFilter;
    const visibleLessons = this.buildVisibleLessons(filter);
    const filters = this.buildFilters();
    const continueInfo = this.buildContinueView();
    const targetLessonId = this.getContinueLessonId();

    const lessonIds = this.lessons.map((l) => l.lessonId);
    const counts = countByFilter(this.records || {}, lessonIds);
    const doneCount = counts.completed;
    const totalCount = this.lessons.length;
    const completionText = `${doneCount} / ${totalCount} Done`;
    const subtitle = `Elementary · ${totalCount} Lessons`;

    let continueTitle = '';
    let continueAttributes = '';
    if (continueInfo && targetLessonId) {
      const item = this.lessons.find((l) => l.lessonId === targetLessonId);
      continueTitle = item ? item.title : `Lesson ${targetLessonId}`;
      continueAttributes = item ? item.level : '';
    }

    this.setData({
      completionText,
      subtitle,
      filters,
      visibleLessons,
      continueInfo,
      continueTitle,
      continueAttributes,
      emptyHint: FILTER_EMPTY_HINT[filter],
    });
    this.updateRenderedLessons();
  },

  buildFilters(): FilterPillModel[] {
    const lessons = this.lessons || [];
    const lessonIds = lessons.map((l) => l.lessonId);
    const recs = this.records || {};
    const counts = countByFilter(recs, lessonIds);
    return [
      { key: 'all', label: `All (${counts.all})` },
      { key: 'in_progress', label: 'In Progress' },
      { key: 'completed', label: 'Completed' },
    ];
  },

  buildVisibleLessons(filter: LibraryFilterKey): LessonCardModel[] {
    const lessons = this.lessons || [];
    const lessonIds = lessons.map((l) => l.lessonId);
    const recs = this.records || {};
    const filteredIds = new Set(filterLessonIds(recs, lessonIds, filter));
    const lastId = this.lastPlayedId || (lessons[0] && lessons[0].lessonId);

    const result: LessonCardModel[] = [];
    let displaySeq = 1;
    for (const item of lessons) {
      if (!filteredIds.has(item.lessonId)) continue;
      const rec = recs[item.lessonId];
      const status = deriveCardStatus(rec);
      const isCurrent = item.lessonId === lastId;
      result.push({
        lessonId: item.lessonId,
        indexText: zeroPad2(displaySeq++),
        title: item.title,
        level: item.level,
        statusLabel: status.statusLabel,
        isDone: status.isDone,
        isCurrent,
        highlight: isCurrent || status.highlight,
        barValue: status.barValue,
      });
    }
    return result;
  },

  updateRenderedLessons(): void {
    const all = this.data.visibleLessons;
    const count = Math.min(all.length, this.renderedCount);
    this.setData({ renderedLessons: all.slice(0, count) });
  },

  buildContinueView(): ContinueViewModel | null {
    if (!this.lessons || this.lessons.length === 0) return null;
    const recs = this.records || {};
    const info = pickContinueLesson(recs, this.lastPlayedId);
    if (!info) return null;

    const targetLessonId = info.lessonId;
    const item = this.lessons.find((l) => l.lessonId === targetLessonId);
    const attributes = item ? item.level : '';

    return {
      badge: info.badge,
      attributes,
      progressPct: info.progressPct,
    };
  },

  getContinueLessonId(): string {
    if (!this.lessons || this.lessons.length === 0) return '';
    const info = pickContinueLesson(this.records || {}, this.lastPlayedId);
    return info ? info.lessonId : (this.lessons[0] ? this.lessons[0].lessonId : '');
  },

  onFilterChange(event: WechatMiniprogram.CustomEvent<{ key: string }>): void {
    const key = event.detail.key as LibraryFilterKey;
    if (key === this.data.activeFilter) return;
    if (this.scrollTops) {
      this.scrollTops[this.data.activeFilter] = this.data.scrollTop;
    }
    this.renderedCount = CHUNK_SIZE;
    const restoredScroll = (this.scrollTops && this.scrollTops[key]) || 0;
    this.setData({
      activeFilter: key,
      scrollTop: restoredScroll,
    });
    this.refreshLibraryView();
  },

  onWellScroll(event: WechatMiniprogram.ScrollViewScroll): void {
    const top = event.detail.scrollTop;
    if (Number.isFinite(top) && this.scrollTops) {
      this.scrollTops[this.data.activeFilter] = top;
    }
  },

  onWellScrollToLower(): void {
    const all = this.data.visibleLessons;
    if (this.renderedCount < all.length) {
      this.renderedCount = Math.min(all.length, this.renderedCount + CHUNK_SIZE);
      this.updateRenderedLessons();
    }
  },

  onLessonTap(event: WechatMiniprogram.CustomEvent<{ lessonId: string }>): void {
    const lessonId = event.detail.lessonId;
    if (!lessonId) return;
    // §2：普通列表进入 → 目标 PB（未完成恢复 PB 断点，已完成 00:00）。
    wx.navigateTo({
      url: `${playerPath()}?lessonId=${lessonId}&intent=library`,
    });
  },

  onContinueTap(): void {
    const targetId = this.getContinueLessonId();
    if (!targetId) return;
    // §2：继续收听 → 最后打开课程的 PB（不改课程锚点）。
    wx.navigateTo({
      url: `${playerPath()}?lessonId=${targetId}&intent=resume`,
    });
  },

  onContinueToggle(): void {
    if (playerPath() === '/pages/rebuildPlayer/index') {
      this.onContinueTap();
      return;
    }
    const session = playbackSession.getState();
    const targetId = this.getContinueLessonId();
    const action = resolveContinueToggleAction({
      targetLessonId: targetId,
      sessionLessonId: session.lessonId,
      isPlaying: session.isPlaying,
      positionSec: session.positionSec,
      srcLoadedInProcess: playbackSession.isSrcLoadedInProcess(),
    });
    if (action === 'toggle') {
      playbackSession.togglePlay();
      this.setData({ isPlaying: playbackSession.getState().isPlaying });
    } else if (action === 'navigate') {
      wx.navigateTo({
        url: `${playerPath()}?lessonId=${targetId}&intent=resume`,
      });
    }
  },
});

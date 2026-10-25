/**
 * ============================================================================
 *  EnglishPod 课程库页面（pages/library/index.ts）
 * ============================================================================
 *  精简原生架构：
 *  - 顶部栏：置顶标题、完成度计数，点击标题栏（EnglishPod）直接跳转当前正在收听的课程。
 *  - 课程列表：取消三态筛选与冗余卡片，全量单一列表秒开呈现，在列表中直接展示进度与完成态。
 *  - 分享支持：原生支持小程序会话分享与朋友圈分享。
 * ============================================================================
 */

import { WechatCloudAdapter } from '../../adapters/wechat/cloud';
import { APP_DISPLAY_NAME, USE_MOCK_DATA } from '../../config/env';
import {
  countByFilter,
  deriveCardStatus,
  pickContinueLesson,
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
  barPercent: number;
}

interface PageData {
  appName: string;
  subtitle: string;
  completionText: string;
  safeTopPx: number;
  navBarPx: number;
  isIndexLoading: boolean;
  visibleLessons: LessonCardModel[];
  renderedLessons: LessonCardModel[];
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
  unsubscribeProgress?: () => void;
  unsubscribeLessonChange?: () => void;
  unsubscribeState?: () => void;

  initNavMetrics(): void;
  loadLibraryData(): Promise<void>;
  reloadFromStorage(): void;
  refreshLibraryView(): void;
  buildVisibleLessons(): LessonCardModel[];
  updateRenderedLessons(): void;
  getContinueLessonId(): string;
  syncBackgroundAudioState(): void;

  onWellScroll(event: WechatMiniprogram.ScrollViewScroll): void;
  onWellScrollToLower(): void;
  onLessonTap(event: WechatMiniprogram.CustomEvent<{ lessonId: string }>): void;
  onTitleTap(): void;

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent;
  onShareTimeline(): WechatMiniprogram.Page.ICustomTimelineContent;
}

Page<PageData, PageCustom>({
  data: {
    appName: APP_DISPLAY_NAME,
    subtitle: 'Elementary · 335 Lessons',
    completionText: '0 / 335 Done',
    safeTopPx: 44,
    navBarPx: 44,
    isIndexLoading: true,
    visibleLessons: [],
    renderedLessons: [],
    scrollTop: 0,
    emptyHint: 'No listening lessons available yet',
    isPlaying: false,
  },

  renderedCount: CHUNK_SIZE,

  onLoad() {
    this.initNavMetrics();
    this.adapter = USE_MOCK_DATA ? new MockCloudAdapter() : new WechatCloudAdapter();

    this.reloadFromStorage();

    // 订阅全局后台播放进度
    this.unsubscribeProgress = playbackSession.subscribeProgress((_pos, _dur, _pct) => {
      // 保持轻量
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
        this.refreshLibraryView();
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
    this.records = progressJournal.progressViews();
    this.lastPlayedId = progressJournal.lastOpenedLessonId();
  },

  refreshLibraryView(): void {
    if (!this.lessons) return;
    const visibleLessons = this.buildVisibleLessons();

    const lessonIds = this.lessons.map((l) => l.lessonId);
    const counts = countByFilter(this.records || {}, lessonIds);
    const doneCount = counts.completed;
    const totalCount = this.lessons.length;
    const completionText = `${doneCount} / ${totalCount} Done`;

    const targetLessonId = this.getContinueLessonId();
    let subtitle = `Elementary · ${totalCount} Lessons`;
    if (this.data.isPlaying && targetLessonId) {
      subtitle = `Now Playing · Lesson ${targetLessonId} (Tap to return)`;
    } else if (targetLessonId) {
      subtitle = `Elementary · Tap title to resume Lesson ${targetLessonId}`;
    }

    this.setData({
      completionText,
      subtitle,
      visibleLessons,
      emptyHint: 'No listening lessons available yet',
    });
    this.updateRenderedLessons();
  },

  buildVisibleLessons(): LessonCardModel[] {
    const lessons = this.lessons || [];
    const recs = this.records || {};
    const lastId = this.lastPlayedId || (lessons[0] && lessons[0].lessonId);

    const result: LessonCardModel[] = [];
    let displaySeq = 1;
    for (const item of lessons) {
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
        barPercent: Math.round(Math.max(0, Math.min(1, Number.isFinite(status.barValue) ? status.barValue : 0)) * 100),
      });
    }
    return result;
  },

  updateRenderedLessons(): void {
    const all = this.data.visibleLessons;
    const count = Math.min(all.length, this.renderedCount);
    this.setData({ renderedLessons: all.slice(0, count) });
  },

  getContinueLessonId(): string {
    if (!this.lessons || this.lessons.length === 0) return '';
    const info = pickContinueLesson(this.records || {}, this.lastPlayedId);
    return info ? info.lessonId : (this.lessons[0] ? this.lessons[0].lessonId : '');
  },

  onWellScroll(event: WechatMiniprogram.ScrollViewScroll): void {
    const top = event.detail.scrollTop;
    if (Number.isFinite(top)) {
      this.setData({ scrollTop: top });
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
    wx.navigateTo({
      url: `/pages/player/index?lessonId=${lessonId}&intent=library`,
    });
  },

  onTitleTap(): void {
    const targetId = this.getContinueLessonId();
    if (!targetId) return;
    wx.navigateTo({
      url: `/pages/player/index?lessonId=${targetId}&intent=resume`,
    });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: 'EnglishPod · 沉浸听课与精听',
      path: '/pages/library/index',
    };
  },

  onShareTimeline(): WechatMiniprogram.Page.ICustomTimelineContent {
    return {
      title: 'EnglishPod · 沉浸听课与精听',
    };
  },
});

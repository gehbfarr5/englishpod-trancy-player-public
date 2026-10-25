/**
 * ============================================================================
 *  EnglishPod 课程库页面（pages/library/index.ts）
 * ============================================================================
 *  精简原生架构：
 *  - 顶部栏：置顶标题、完成度计数，不响应点击跳转。
 *  - 播放空间：保留继续收听聚光灯卡（continue-card），直接在主页展示当前进度与播放/暂停控制。
 *  - 课程列表：取消三态筛选胶囊，全量单一列表秒开呈现，在卡片内直接展示进度与完成态。
 *  - 分享支持：原生支持小程序会话分享与朋友圈分享。
 * ============================================================================
 */

import { WechatCloudAdapter } from '../../adapters/wechat/cloud';
import { APP_DISPLAY_NAME, USE_MOCK_DATA } from '../../config/env';
import {
  countByFilter,
  deriveCardStatus,
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
  totalLessonCount: number;
  renderedLessons: LessonCardModel[];
  continueInfo: ContinueViewModel | null;
  continueTitle: string;
  continueAttributes: string;
  continueFallback: string;
  emptyHint: string;
  isPlaying: boolean;
}

interface PageCustom {
  adapter?: CloudAdapter;
  lessons?: LessonIndexItem[];
  records?: ProgressMap;
  lastPlayedId?: string;
  renderedCount: number;
  allLessonCards: LessonCardModel[];
  unsubscribeProgress?: () => void;
  unsubscribeLessonChange?: () => void;
  unsubscribeState?: () => void;

  initNavMetrics(): void;
  loadLibraryData(): Promise<void>;
  reloadFromStorage(): void;
  refreshLibraryView(): void;
  buildVisibleLessons(): LessonCardModel[];
  updateRenderedLessons(reset?: boolean): void;
  buildContinueView(): ContinueViewModel | null;
  getContinueLessonId(): string;
  syncBackgroundAudioState(): void;

  onWellScrollToLower(): void;
  onLessonTap(event: WechatMiniprogram.CustomEvent<{ lessonId: string }>): void;
  onContinueTap(): void;
  onContinueToggle(): void;

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
    totalLessonCount: 0,
    renderedLessons: [],
    continueInfo: null,
    continueTitle: '',
    continueAttributes: '',
    continueFallback: 'Ready to listen',
    emptyHint: 'No listening lessons available yet',
    isPlaying: false,
  },

  renderedCount: CHUNK_SIZE,
  allLessonCards: [],

  onLoad() {
    this.initNavMetrics();
    this.adapter = USE_MOCK_DATA ? new MockCloudAdapter() : new WechatCloudAdapter();

    this.reloadFromStorage();

    // 订阅全局后台播放进度，更新主页常驻播放空间的进度条
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
    this.allLessonCards = visibleLessons;
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
      totalLessonCount: visibleLessons.length,
      continueInfo,
      continueTitle,
      continueAttributes,
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

  updateRenderedLessons(reset = false): void {
    const all = this.allLessonCards || [];
    if (reset) {
      this.renderedCount = CHUNK_SIZE;
      const count = Math.min(all.length, this.renderedCount);
      this.setData({ renderedLessons: all.slice(0, count) });
      return;
    }

    const currentList = this.data.renderedLessons || [];
    const currentLen = currentList.length;
    const targetCount = Math.min(all.length, this.renderedCount);

    if (currentLen === 0) {
      this.setData({ renderedLessons: all.slice(0, targetCount) });
    } else if (targetCount > currentLen) {
      // 腾讯官方规范：使用路径更新局部追加新增卡片，避免全量重新传输和 diff 已渲染节点
      const patch: Record<string, LessonCardModel> = {};
      for (let i = currentLen; i < targetCount; i++) {
        patch[`renderedLessons[${i}]`] = all[i];
      }
      this.setData(patch);
    } else if (currentLen > 0) {
      // 细粒度状态局部更新（当前正在听、进度百分比、完成标记）
      const patch: Record<string, unknown> = {};
      for (let i = 0; i < currentLen; i++) {
        const old = currentList[i];
        const updated = all[i];
        if (!old || !updated) continue;
        if (old.isCurrent !== updated.isCurrent) {
          patch[`renderedLessons[${i}].isCurrent`] = updated.isCurrent;
          patch[`renderedLessons[${i}].highlight`] = updated.highlight;
        }
        if (old.isDone !== updated.isDone) {
          patch[`renderedLessons[${i}].isDone`] = updated.isDone;
          patch[`renderedLessons[${i}].statusLabel`] = updated.statusLabel;
        }
        if (old.barPercent !== updated.barPercent) {
          patch[`renderedLessons[${i}].barPercent`] = updated.barPercent;
          patch[`renderedLessons[${i}].barValue`] = updated.barValue;
        }
      }
      if (Object.keys(patch).length > 0) {
        this.setData(patch);
      }
    }
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

  onWellScrollToLower(): void {
    const all = this.allLessonCards || [];
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

  onContinueTap(): void {
    const targetId = this.getContinueLessonId();
    if (!targetId) return;
    wx.navigateTo({
      url: `/pages/player/index?lessonId=${targetId}&intent=resume`,
    });
  },

  onContinueToggle(): void {
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
        url: `/pages/player/index?lessonId=${targetId}&intent=resume`,
      });
    }
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

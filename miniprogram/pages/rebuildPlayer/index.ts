import { LessonDetail } from '../../core/types';
import { readM1ViewKey, M1ContentView } from '../../rebuild/singlePodcastExperiment';
import { getPodcastRuntime, PodcastRuntime } from '../../rebuild/wechatPodcastRuntime';
import { progressJournal } from '../../services/progressJournal';

interface CourseOption { id: string; title: string; level: string }
interface Data {
 titles: string[]; selected: number; title: string; position: number; duration: number;
 playing: boolean; loading: boolean; error: string; view: M1ContentView; detail: LessonDetail | null; completed: boolean;
 query: string; courses: CourseOption[]; courseCount: number; matchCount: number; activeSegment: number; transcriptTarget: string;
 surface: 'catalog' | 'player'; currentId: string; level: string; positionLabel: string; durationLabel: string;
 continueId: string; continueTitle: string; continuePct: number; shareEntry: boolean;
}
interface Custom {
 runtime?: PodcastRuntime; detach?: () => void; visible: boolean; disposed: boolean; detailId?: string; detailGeneration: number;
 onChoose(event: WechatMiniprogram.CustomEvent<{ id: string }>): void; onContinue(): void; onToggle(): void;
 onSeek(event: WechatMiniprogram.SliderChange): void; onPrev(): void; onNext(): void;
 onView(event: WechatMiniprogram.TouchEvent): void; onSearch(event: WechatMiniprogram.Input): void;
 onMoreCourses(): void; onClearSearch(): void; onCatalog(): void;
 onTranscriptTap(event: WechatMiniprogram.CustomEvent<{ start: number }>): void; onLocate(): void; onRetry(): void;
 onShareAppMessage(options: WechatMiniprogram.Page.IShareAppMessageOption): WechatMiniprogram.Page.ICustomShareContent;
 refresh(): void; loadDetail(id: string): Promise<void>; refreshCourses(): void; activeSegment(position: number): number;
}

Page<Data, Custom>({
 data: {
  titles: [], selected: 0, title: 'EnglishPod', position: 0, duration: 0, playing: false,
  loading: true, error: '', view: 'pb', detail: null, completed: false, query: '', courses: [], courseCount: 30,
  matchCount: 0, activeSegment: -1, transcriptTarget: '', surface: 'catalog', currentId: '', level: '',
  positionLabel: '00:00', durationLabel: '00:00', continueId: '', continueTitle: '', continuePct: 0, shareEntry: false,
 },
 visible: true,
 disposed: false,
 detailGeneration: 0,

 async onLoad(query: Record<string, string | undefined>) {
  try {
   this.runtime = await getPodcastRuntime();
   if (this.disposed) return;
   const lessonId = query?.lessonId;
   const shared = query?.intent === 'share';
   this.setData({
    titles: this.runtime.index.map(item => `${item.lessonId} ${item.title}`),
    loading: false,
    surface: lessonId ? 'player' : 'catalog',
    shareEntry: Boolean(shared && lessonId),
   });
   this.refreshCourses();
   this.detach = this.runtime.session.subscribe(() => this.refresh());
   if (lessonId && this.runtime.index.some(item => item.lessonId === lessonId)) {
    const mode = shared ? 'shareEntry' : query?.intent === 'resume' ? 'resume' : 'library';
    await this.runtime.session.open(lessonId, mode);
   }
  } catch (error) {
   if (!this.disposed) this.setData({ loading: false, error: error instanceof Error ? error.message : 'Loading failed' });
  }
 },

 onShow() { this.visible = true; this.refresh(); },
 onHide() { this.visible = false; this.runtime?.session.hide(); },
 onUnload() { this.disposed = true; this.visible = false; this.detach?.(); this.runtime?.session.hide(); },

 refresh() {
  if (!this.runtime || !this.visible || this.disposed) return;
  const state = this.runtime.session.state();
  const id = state.course?.id || '';
  const indexItem = this.runtime.index.find(item => item.lessonId === id);
  const continueId = progressJournal.lastOpenedLessonId() || '';
  const continueItem = this.runtime.index.find(item => item.lessonId === continueId);
  const continuePoint = continueId ? progressJournal.readRecord(continueId).podcast : null;
  const continuePct = continuePoint?.durationMs
   ? Math.min(100, Math.round(continuePoint.committedPositionMs / continuePoint.durationMs * 100)) : 0;
  const seconds = state.playback.positionMs / 1000;
  const patch: Partial<Data> = {};
  const update = <K extends keyof Data>(key: K, value: Data[K]) => {
   if (this.data[key] !== value) patch[key] = value;
  };
  update('title', state.course?.title || '选择一门课程');
  update('currentId', id);
  update('level', indexItem?.level || '');
  update('selected', Math.max(0, this.runtime.index.findIndex(item => item.lessonId === id)));
  update('position', seconds);
  update('duration', state.playback.durationMs / 1000);
  update('positionLabel', formatTime(seconds));
  update('durationLabel', formatTime(state.playback.durationMs / 1000));
  update('playing', state.playback.playing);
  update('loading', Boolean(state.pendingId) || Boolean(id && !state.ready && !state.error));
  update('error', state.error || (state.saveFailed ? 'Progress could not be saved; retry when storage is available.' : ''));
  update('completed', id ? progressJournal.readRecord(id).lessonCompleted : false);
  update('activeSegment', this.activeSegment(seconds));
  update('continueId', continueId);
  update('continueTitle', continueItem?.title || '');
  update('continuePct', continuePct);
  if (Object.keys(patch).length) this.setData(patch);
  if (id && id !== this.detailId) void this.loadDetail(id);
 },

 async loadDetail(id: string) {
  if (!this.runtime) return;
  this.detailId = id;
  const generation = ++this.detailGeneration;
  this.setData({ detail: null });
  try {
   const detail = await this.runtime.detail(id);
   if (!this.disposed && generation === this.detailGeneration) this.setData({ detail });
  } catch {
   if (!this.disposed && generation === this.detailGeneration) this.setData({ error: 'Transcript unavailable' });
  }
 },

 refreshCourses() {
  if (!this.runtime) return;
  const query = this.data.query.trim().toLowerCase();
  const matches = this.runtime.index.filter(item => !query || item.lessonId.includes(query)
   || item.title.toLowerCase().includes(query) || (item.level || '').toLowerCase().includes(query));
  const courses = matches.slice(0, this.data.courseCount).map(item => ({
   id: item.lessonId, title: item.title, level: item.level || '',
  }));
  const currentId = this.runtime.session.state().course?.id;
  this.setData({
   courses, matchCount: matches.length,
   selected: Math.max(0, this.runtime.index.findIndex(item => item.lessonId === currentId)),
  });
 },

 activeSegment(position: number): number {
  const segments = this.data.detail?.tracks.pb || [];
  const found = segments.find(segment => !segment.isSection && position >= segment.start && position < segment.end);
  return found?.id ?? -1;
 },

 onChoose(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
  const id = event.detail.id;
  if (id) {
   this.setData({ surface: 'player', shareEntry: false });
   void this.runtime?.session.open(id);
  }
 },
 onSearch(event: WechatMiniprogram.Input) {
  this.setData({ query: event.detail.value, courseCount: 30 });
  this.refreshCourses();
 },
 onMoreCourses() { this.setData({ courseCount: this.data.courseCount + 30 }); this.refreshCourses(); },
 onClearSearch() { this.setData({ query: '', courseCount: 30 }); this.refreshCourses(); },
 onCatalog() { this.setData({ surface: 'catalog', shareEntry: false }); this.refreshCourses(); },
 onTranscriptTap(event: WechatMiniprogram.CustomEvent<{ start: number }>) {
  // Sentence replay seeks the one Podcast source and preserves play/pause intent.
  this.runtime?.session.seek(Number(event.detail.start) * 1000);
 },
 onLocate() {
  if (this.data.activeSegment >= 0) this.setData({ transcriptTarget: `pb-segment-${this.data.activeSegment}` });
 },
 onContinue() {
  const id = progressJournal.lastOpenedLessonId() || this.runtime?.index[0]?.lessonId;
  if (id) {
   this.setData({ surface: 'player', shareEntry: false });
   void this.runtime?.session.open(id, 'resume');
  }
 },
 onRetry() {
  const id = this.runtime?.session.state().course?.id;
  if (id) void this.runtime?.session.open(id, 'library');
  else if (this.runtime?.index[0]) void this.runtime.session.open(this.runtime.index[0].lessonId, 'library');
 },
 onToggle() {
  if (this.runtime?.session.state().wantsPlay) this.runtime.session.pause();
  else {
   this.setData({ shareEntry: false });
   this.runtime?.session.play();
  }
 },
 onSeek(event: WechatMiniprogram.SliderChange) { this.runtime?.session.seek(Number(event.detail.value) * 1000); },
 onPrev() { void this.runtime?.session.navigate(-1); },
 onNext() { void this.runtime?.session.navigate(1); },
 onView(event: WechatMiniprogram.TouchEvent) {
  const view = readM1ViewKey(event);
  if (view) this.setData({ view });
 },
 onShareAppMessage(_options: WechatMiniprogram.Page.IShareAppMessageOption) {
  const id = this.runtime?.session.state().course?.id;
  const item = this.runtime?.index.find(course => course.lessonId === id);
  if (!id || !item) return { title: 'EnglishPod · 一起学英语', path: '/pages/library/index' };
  return {
   title: `跟我一起听《${item.title}》`,
   path: `/pages/rebuildPlayer/index?lessonId=${id}&intent=share`,
  };
 },
});

function formatTime(totalSeconds: number): string {
 const seconds = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
 const minutes = Math.floor(seconds / 60);
 return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

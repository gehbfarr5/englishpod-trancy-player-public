import { getPodcastRuntime, PodcastRuntime } from '../../rebuild/wechatPodcastRuntime';
import { progressJournal } from '../../services/progressJournal';
import { readM1ViewKey, M1ContentView } from '../../rebuild/singlePodcastExperiment';
import { LessonDetail } from '../../core/types';
interface CourseOption { id: string; title: string; level: string }
interface Data { titles: string[]; selected: number; title: string; position: number; duration: number;
 playing: boolean; loading: boolean; error: string; view: M1ContentView; detail: LessonDetail | null; completed: boolean;
 query: string; courses: CourseOption[]; courseCount: number; activeSegment: number; transcriptTarget: string }
interface Custom { runtime?: PodcastRuntime; detach?: () => void; visible: boolean; disposed: boolean;
 onChoose(event: WechatMiniprogram.CustomEvent<{ id: string }>): void; onContinue(): void; onToggle(): void;
 onSeek(event: WechatMiniprogram.SliderChange): void; onPrev(): void; onNext(): void;
 onView(event: WechatMiniprogram.TouchEvent): void; onSearch(event: WechatMiniprogram.Input): void;
 onMoreCourses(): void; onTranscriptTap(event: WechatMiniprogram.CustomEvent<{ start: number }>): void; onLocate(): void;
 detailId?: string; detailGeneration: number; refresh(): void; loadDetail(id: string): Promise<void>;
 refreshCourses(): void; activeSegment(position:number):number }
Page<Data, Custom>({
 data: { titles: [], selected: 0, title: 'EnglishPod', position: 0, duration: 0, playing: false,
 loading: true, error: '', view: 'pb', detail: null, completed: false, query: '', courses: [], courseCount: 30,
 activeSegment: -1, transcriptTarget: '' },
 visible: true, disposed: false, detailGeneration: 0,
 async onLoad(query: Record<string, string | undefined>) {
  try {
   if (wx.getAccountInfoSync().miniProgram.envVersion === 'release') throw new Error('Development build required');
   this.runtime = await getPodcastRuntime();
   if (this.disposed) return;
   this.setData({titles: this.runtime.index.map(x => `${x.lessonId} ${x.title}`), loading: false});
   this.refreshCourses();
   this.detach = this.runtime.session.subscribe(() => this.refresh());
   const lessonId = query?.lessonId;
   if (lessonId && this.runtime.index.some(item => item.lessonId === lessonId)) {
     await this.runtime.session.open(lessonId, query.intent === 'resume' ? 'resume' : 'library');
   }
  } catch (error) {
   if (!this.disposed) this.setData({loading: false, error: error instanceof Error ? error.message : 'Loading failed'});
  }
 },
 onShow() { this.visible = true; this.refresh(); },
 onHide() { this.visible = false; this.runtime?.session.hide(); },
 onUnload() { this.disposed = true; this.visible = false; this.detach?.(); this.runtime?.session.hide(); },
 refresh() {
  if (!this.runtime || !this.visible || this.disposed) return;
  const state = this.runtime.session.state();
  const id = state.course?.id;
  this.setData({ title: state.course?.title || 'Choose a course',
   selected: Math.max(0, this.runtime.index.findIndex(x => x.lessonId === id)),
   position: state.playback.positionMs / 1000, duration: state.playback.durationMs / 1000,
   playing: state.playback.playing, loading: Boolean(state.pendingId) || Boolean(id && !state.ready && !state.error),
   error: state.error || (state.saveFailed ? 'Progress could not be saved; retry when storage is available.' : ''), completed: id ? progressJournal.readRecord(id).lessonCompleted : false,
   activeSegment: this.activeSegment(state.playback.positionMs / 1000) });
  if (id && id !== this.detailId) void this.loadDetail(id);
 },
 async loadDetail(id: string) {
  if (!this.runtime) return;
  this.detailId = id; const generation = ++this.detailGeneration;
  this.setData({detail: null});
  try {
   const detail = await this.runtime.detail(id);
   if (!this.disposed && generation === this.detailGeneration) this.setData({detail});
  } catch { if (!this.disposed && generation === this.detailGeneration) this.setData({error:'Transcript unavailable'}); }
 },
 refreshCourses() {
  if (!this.runtime) return;
  const q = this.data.query.trim().toLowerCase();
  const matches = this.runtime.index.filter(item => !q || item.lessonId.includes(q) || item.title.toLowerCase().includes(q) || (item.level || '').toLowerCase().includes(q));
  const courses = matches.slice(0, this.data.courseCount).map(item => ({id:item.lessonId,title:item.title,level:item.level || ''}));
  const currentId = this.runtime.session.state().course?.id;
  this.setData({courses, selected:Math.max(0,this.runtime.index.findIndex(item => item.lessonId === currentId))});
 },
 activeSegment(position: number): number {
  const segments = this.data.detail?.tracks.pb || [];
  const found = segments.find(segment => !segment.isSection && position >= segment.start && position < segment.end);
  return found?.id ?? -1;
 },
 onChoose(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
  const id = event.detail.id;
  if (id) void this.runtime?.session.open(id);
 },
 onSearch(event: WechatMiniprogram.Input) { this.setData({query:event.detail.value,courseCount:30}); this.refreshCourses(); },
 onMoreCourses() { this.setData({courseCount:this.data.courseCount + 30}); this.refreshCourses(); },
 onTranscriptTap(event: WechatMiniprogram.CustomEvent<{ start: number }>) {
  // Explicit sentence replay seeks within the single PB track and preserves play/pause intent.
  this.runtime?.session.seek(Number(event.detail.start) * 1000);
 },
 onLocate() {
  if (this.data.activeSegment >= 0) this.setData({transcriptTarget:`pb-segment-${this.data.activeSegment}`});
 },
 onContinue() {
  const id = progressJournal.lastOpenedLessonId() || this.runtime?.index[0]?.lessonId;
  if (id) void this.runtime?.session.open(id, 'resume');
 },
 onToggle() { if (this.runtime?.session.state().wantsPlay) this.runtime.session.pause(); else this.runtime?.session.play(); },
 onSeek(event: WechatMiniprogram.SliderChange) { this.runtime?.session.seek(Number(event.detail.value) * 1000); },
 onPrev() { void this.runtime?.session.navigate(-1); },
 onNext() { void this.runtime?.session.navigate(1); },
 onView(event: WechatMiniprogram.TouchEvent) { const view = readM1ViewKey(event); if (view) this.setData({view}); },
});

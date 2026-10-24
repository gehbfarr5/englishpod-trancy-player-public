import { getPodcastRuntime, PodcastRuntime } from '../../rebuild/wechatPodcastRuntime';
import { progressJournal } from '../../services/progressJournal';
import { readM1ViewKey, M1ContentView } from '../../rebuild/singlePodcastExperiment';
import { LessonDetail } from '../../core/types';
interface Data { titles: string[]; selected: number; title: string; position: number; duration: number;
 playing: boolean; loading: boolean; error: string; view: M1ContentView; detail: LessonDetail | null; completed: boolean }
interface Custom { runtime?: PodcastRuntime; detach?: () => void; visible: boolean; disposed: boolean;
 onChoose(event: WechatMiniprogram.PickerChange): void; onContinue(): void; onToggle(): void;
 onSeek(event: WechatMiniprogram.SliderChange): void; onPrev(): void; onNext(): void;
 onView(event: WechatMiniprogram.TouchEvent): void;
 detailId?: string; detailGeneration: number; refresh(): void; loadDetail(id: string): Promise<void> }
Page<Data, Custom>({
 data: { titles: [], selected: 0, title: 'EnglishPod', position: 0, duration: 0, playing: false,
 loading: true, error: '', view: 'pb', detail: null, completed: false },
 visible: true, disposed: false, detailGeneration: 0,
 async onLoad() {
  try {
   if (wx.getAccountInfoSync().miniProgram.envVersion === 'release') throw new Error('Development build required');
   this.runtime = await getPodcastRuntime();
   if (this.disposed) return;
   this.setData({titles: this.runtime.index.map(x => `${x.lessonId} ${x.title}`), loading: false});
   this.detach = this.runtime.session.subscribe(() => this.refresh());
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
   error: state.error || (state.saveFailed ? 'Progress could not be saved; retry when storage is available.' : ''), completed: id ? progressJournal.readRecord(id).lessonCompleted : false });
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
 onChoose(event: WechatMiniprogram.PickerChange) {
  const item = this.runtime?.index[Number(event.detail.value)];
  if (item) void this.runtime?.session.open(item.lessonId);
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

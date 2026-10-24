import { EntryMode, planEntry } from '../core/entryPlan';
import { CommitReason } from '../core/learningRecord';
import { ProgressJournal } from '../services/progressJournal';

export interface PodcastCourse { id: string; title: string; source: string }
export interface PodcastMediaState { positionMs: number; durationMs: number; playing: boolean }
export interface PodcastPort {
  load(course: PodcastCourse, startMs: number, generation: number): void;
  play(): void;
  pause(): void;
  seek(positionMs: number): void;
  snapshot(): PodcastMediaState;
}
export type PodcastEvent = 'ready' | 'time' | 'play' | 'pause' | 'ended' | 'error';

/** App-owned single-Podcast coordinator. Pages only subscribe; view changes have no media API. */
export class PodcastSession {
  private generation = 0;
  private ready = false;
  private wantsPlay = false;
  private awaitingPause = false;
  private seekPending = false;
  private previousPosition = 0;
  private progressObserved = false;
  private startMs = 0;
  private lastPeriodic = 0;
  private course: PodcastCourse | null = null;
  private pendingId = '';
  private error = '';
  private saveFailed = false;
  private listeners = new Set<() => void>();
  constructor(private readonly media: PodcastPort, private readonly journal: ProgressJournal,
    private readonly resolve: (id: string) => Promise<PodcastCourse>,
    private readonly ids: readonly string[], private readonly now = () => Date.now()) {}

  state() { return { course: this.course, pendingId: this.pendingId, ready: this.ready,
    wantsPlay: this.wantsPlay, error: this.error, saveFailed: this.saveFailed, generation: this.generation,
    playback: this.media.snapshot() }; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener); listener(); return () => this.listeners.delete(listener);
  }
  private emit() { for (const listener of this.listeners) listener(); }
  async open(id: string, mode: EntryMode = 'library'): Promise<void> {
    if (!this.ids.includes(id)) throw new Error('Unknown course');
    if (this.course?.id === id && this.ready && (mode === 'library' || mode === 'resume')) {
      this.play(); return;
    }
    this.save('lessonSwitch');
    const wasPlaying = this.wantsPlay;
    const generation = ++this.generation;
    this.ready = false;
    this.pendingId = id;
    this.error = '';
    const plan = planEntry({ mode, targetIndex: this.ids.indexOf(id), indexLength: this.ids.length,
      currentTrack: 'pb', wasPlaying, record: this.journal.readRecord(id) });
    this.wantsPlay = plan.autoPlay;
    // Silence the previous source while resolving; no stale course keeps playing under the new title.
    this.media.pause();
    this.emit();
    try {
      const course = await this.resolve(id);
      if (generation !== this.generation) return;
      if (course.id !== id || !course.source.trim()) throw new Error('Invalid Podcast course');
      this.course = course;
      this.seekPending = false;
      this.previousPosition = plan.startMs;
      this.startMs = plan.startMs;
      this.progressObserved = false;
      this.journal.beginLoad(id, 'pb');
      this.journal.setPlayheadAnchor(id, 'pb', plan.startMs);
      this.pendingId = '';
      this.media.load(course, plan.startMs, generation);
      this.journal.setLastOpenedLesson(id);
      this.pendingId = '';
      this.emit();
    } catch {
      if (generation !== this.generation) return;
      this.pendingId = '';
      this.error = 'Podcast could not be loaded';
      this.wantsPlay = false;
      this.emit();
    }
  }
  play() { this.wantsPlay = true; if (this.ready) this.media.play(); this.emit(); }
  pause() { this.awaitingPause = true; this.wantsPlay = false; this.media.pause(); this.save('pause'); this.emit(); }
  seek(positionMs: number) {
    const duration = this.media.snapshot().durationMs;
    if (!this.ready || !Number.isFinite(positionMs) || positionMs < 0 || duration <= 0) return;
    this.seekPending = true;
    this.progressObserved = false;
    this.previousPosition = Math.min(positionMs, duration);
    this.media.seek(Math.min(positionMs, duration));
    // An explicit seek is a valid resume point, but never a completion event.
    if (this.course) {
      const result = this.journal.commit({ lessonId: this.course.id, track: 'pb',
        positionMs: Math.min(positionMs, duration), durationMs: duration, reason: 'userSeek' });
      this.saveFailed = result.failureReason === 'write-failed';
    }
    this.emit();
  }
  async navigate(delta: -1 | 1) {
    const index = this.course ? this.ids.indexOf(this.course.id) : -1;
    const id = this.ids[index + delta];
    if (index >= 0 && id) await this.open(id, 'manualNav');
  }
  hide() { this.save('appHide'); this.saveFailed = !this.journal.flush(); }
  private save(reason: CommitReason) {
    if (!this.course || !this.ready) return;
    const state = this.media.snapshot();
    const result = this.journal.commit({ lessonId: this.course.id, track: 'pb',
      positionMs: state.positionMs, durationMs: state.durationMs, reason });
    this.saveFailed = result.failureReason === 'write-failed';
  }
  async event(event: PodcastEvent, generation: number) {
    if (generation !== this.generation || !this.course || this.pendingId) return;
    if (event === 'ready' && !this.ready) {
      if (this.startMs > 0) this.media.seek(this.startMs);
      this.ready = true;
      this.journal.endLoad(this.course.id, 'pb');
      if (this.wantsPlay) this.media.play(); else { this.awaitingPause = true; this.media.pause(); }
    } else if (event === 'error') {
      this.error = 'Podcast playback failed'; this.ready = false; this.wantsPlay = false;
      this.media.pause();
    } else if (this.ready) {
      const state = this.media.snapshot();
      if (event === 'time') {
        const normalPlayback = state.playing && !this.seekPending && state.positionMs > this.previousPosition;
        if (normalPlayback) this.progressObserved = true;
        this.previousPosition = state.positionMs;
        this.seekPending = false;
        if (normalPlayback && state.durationMs > 0 && state.positionMs / state.durationMs >= 0.95)
          this.journal.commitCompleted(this.course.id);
        if (this.now() - this.lastPeriodic >= 3000) {
          this.save('periodic'); this.lastPeriodic = this.now();
        }
      } else if (event === 'play') {
        if (this.awaitingPause) this.media.pause(); else this.wantsPlay = true;
      } else if (event === 'pause') {
        this.awaitingPause = false;
        this.wantsPlay = false;
        this.save('pause');
      } else if (event === 'ended' && this.wantsPlay && !this.seekPending && this.progressObserved) {
        this.save('naturalEnd');
        this.journal.commitCompleted(this.course.id);
        const next = (this.ids.indexOf(this.course.id) + 1) % this.ids.length;
        await this.open(this.ids[next], 'autoNext');
        return;
      }
    }
    this.emit();
  }
}

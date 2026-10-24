export type M1ContentView = 'pb' | 'dg' | 'vocab';

export interface M1PlaybackSnapshot {
  readonly sourceLoaded: boolean;
  readonly positionSec: number;
  readonly durationSec: number;
  readonly isPlaying: boolean;
}

export interface M1MediaPort {
  snapshot(): M1PlaybackSnapshot;
  loadPodcast(source: string, title: string): void;
  play(): void;
  pause(): void;
  seek(positionSec: number): void;
}

export interface M1CommandCounts {
  readonly sourceLoads: number;
  readonly playRequests: number;
  readonly pauseRequests: number;
  readonly seeks: number;
  readonly viewSelections: number;
}

export interface M1ExperimentState {
  readonly view: M1ContentView;
  readonly playback: M1PlaybackSnapshot;
  readonly commands: M1CommandCounts;
}

/**
 * M1-only coordinator for proving that content selection cannot issue media
 * commands. It deliberately owns one PB media port and has no Dialogue-audio
 * API. It contains no wx calls, persistence, timers, or UI behavior.
 */
export class SinglePodcastExperiment {
  private view: M1ContentView = 'pb';
  private counts: M1CommandCounts = {
    sourceLoads: 0,
    playRequests: 0,
    pauseRequests: 0,
    seeks: 0,
    viewSelections: 0,
  };

  constructor(private readonly media: M1MediaPort) {}

  state(): M1ExperimentState {
    return {
      view: this.view,
      playback: this.media.snapshot(),
      commands: { ...this.counts },
    };
  }

  selectView(view: M1ContentView): M1ExperimentState {
    this.view = view;
    this.counts = { ...this.counts, viewSelections: this.counts.viewSelections + 1 };
    return this.state();
  }

  startPodcast(source: string, title: string): M1ExperimentState {
    if (!source.trim()) throw new Error('Podcast source is required');
    if (!title.trim()) throw new Error('Podcast title is required');
    this.media.loadPodcast(source, title);
    this.counts = { ...this.counts, sourceLoads: this.counts.sourceLoads + 1 };
    return this.state();
  }

  play(): M1ExperimentState {
    this.media.play();
    this.counts = { ...this.counts, playRequests: this.counts.playRequests + 1 };
    return this.state();
  }

  pause(): M1ExperimentState {
    this.media.pause();
    this.counts = { ...this.counts, pauseRequests: this.counts.pauseRequests + 1 };
    return this.state();
  }

  seek(positionSec: number): M1ExperimentState {
    if (!Number.isFinite(positionSec) || positionSec < 0) {
      throw new Error('Seek position must be a non-negative finite number');
    }
    this.media.seek(positionSec);
    this.counts = { ...this.counts, seeks: this.counts.seeks + 1 };
    return this.state();
  }
}

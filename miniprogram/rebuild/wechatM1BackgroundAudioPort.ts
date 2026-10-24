import {
  M1MediaPort,
  M1PlaybackSnapshot,
} from './singlePodcastExperiment';

/**
 * M1-only adapter over WeChat's process-global BackgroundAudioManager.
 * The API has no event unregistration methods, so callbacks bind once per
 * module and dispatch only to the currently mounted experiment page.
 */
type M1Observer = () => void;
let activePort: WechatM1BackgroundAudioPort | null = null;
let handlersBound = false;
let lastTimeUpdateSecond = -1;
let sharedManager: WechatMiniprogram.BackgroundAudioManager | null = null;

function bindHandlers(manager: WechatMiniprogram.BackgroundAudioManager): void {
  if (handlersBound) return;
  handlersBound = true;
  manager.onPlay(() => activePort?.notify());
  manager.onPause(() => activePort?.notify());
  manager.onStop(() => activePort?.notify());
  manager.onEnded(() => activePort?.notify());
  manager.onCanplay(() => activePort?.notify());
  manager.onTimeUpdate(() => {
    const second = Math.floor(manager.currentTime || 0);
    if (second === lastTimeUpdateSecond) return;
    lastTimeUpdateSecond = second;
    activePort?.notify();
  });
  manager.onError((event) => activePort?.notifyError(event.errCode));
}

export class WechatM1BackgroundAudioPort implements M1MediaPort {
  private observer: M1Observer | null = null;
  private errorCode = 0;
  private readonly manager: WechatMiniprogram.BackgroundAudioManager;

  constructor() {
    if (!sharedManager) sharedManager = wx.getBackgroundAudioManager();
    this.manager = sharedManager;
    activePort = this;
    bindHandlers(this.manager);
  }

  snapshot(): M1PlaybackSnapshot {
    return {
      sourceLoaded: Boolean(this.manager.src),
      positionSec: Number.isFinite(this.manager.currentTime) ? this.manager.currentTime : 0,
      durationSec: Number.isFinite(this.manager.duration) ? this.manager.duration : 0,
      isPlaying: !this.manager.paused,
    };
  }

  loadPodcast(source: string, title: string): void {
    this.manager.title = title;
    this.manager.epname = 'EnglishPod';
    this.manager.singer = 'EnglishPod';
    this.manager.src = source;
  }

  play(): void {
    this.manager.play();
  }

  pause(): void {
    this.manager.pause();
  }

  seek(positionSec: number): void {
    this.manager.seek(positionSec);
  }

  setObserver(observer: M1Observer | null): void {
    this.observer = observer;
  }

  getLastErrorCode(): number {
    return this.errorCode;
  }

  releaseObserver(): void {
    this.observer = null;
    if (activePort === this) activePort = null;
  }

  notify(): void {
    this.observer?.();
  }

  notifyError(code: number): void {
    this.errorCode = Number.isFinite(code) ? code : -1;
    this.observer?.();
  }
}

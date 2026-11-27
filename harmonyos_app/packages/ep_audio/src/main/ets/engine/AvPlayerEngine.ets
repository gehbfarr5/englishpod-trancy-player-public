import { common } from '@kit.AbilityKit';
import { media } from '@kit.MediaKit';
import { audio } from '@kit.AudioKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const LOG_DOMAIN = 0xE001;
const LOG_TAG = 'EpAvPlayer';

export interface AudioCallbacks {
  onDurationReady: (durationSec: number) => void;
  onPositionUpdate: (positionSec: number) => void;
  onSeekDone: (positionSec: number) => void;
  onStateChanged: (isPlaying: boolean) => void;
  onCompleted: () => void;
  onError: (message: string) => void;
}

export class AvPlayerEngine {
  private player?: media.AVPlayer;
  private callbacks?: AudioCallbacks;
  private currentSpeed: number = 1.0;
  private pendingSeekMs: number = -1;
  private pendingAutoPlay: boolean = false;
  private isPrepared: boolean = false;
  private lastPositionSec: number = 0;
  private activeContext?: common.Context;
  private activeRawPath: string = '';

  async init(callbacks: AudioCallbacks): Promise<void> {
    this.callbacks = callbacks;
    if (this.player) {
      return;
    }
    this.player = await media.createAVPlayer();
    this.bindEvents(this.player);
  }

  private bindEvents(player: media.AVPlayer): void {
    player.on('stateChange', async (state: media.AVPlayerState) => {
      hilog.info(LOG_DOMAIN, LOG_TAG, 'AVPlayer state -> %{public}s', state);
      switch (state) {
        case 'initialized':
          player.audioRendererInfo = {
            usage: audio.StreamUsage.STREAM_USAGE_MEDIA,
            rendererFlags: 0
          };
          await player.prepare();
          break;
        case 'prepared':
          this.isPrepared = true;
          this.callbacks?.onDurationReady(player.duration / 1000.0);
          this.applySpeed(this.currentSpeed);
          if (this.pendingSeekMs > 0) {
            player.seek(this.pendingSeekMs, media.SeekMode.SEEK_CLOSEST);
            this.pendingSeekMs = -1;
          } else {
            this.callbacks?.onSeekDone(0.0);
          }
          if (this.pendingAutoPlay) {
            this.pendingAutoPlay = false;
            await player.play();
          }
          break;
        case 'playing':
          this.callbacks?.onStateChanged(true);
          break;
        case 'paused':
          this.callbacks?.onStateChanged(false);
          break;
        case 'completed':
          this.callbacks?.onStateChanged(false);
          this.callbacks?.onCompleted();
          break;
        case 'stopped':
        case 'idle':
          this.isPrepared = false;
          this.callbacks?.onStateChanged(false);
          break;
        default:
          break;
      }
    });

    player.on('seekDone', (seekDoneTimeMs: number) => {
      const sec = seekDoneTimeMs / 1000.0;
      this.lastPositionSec = sec;
      this.callbacks?.onSeekDone(sec);
    });

    player.on('timeUpdate', (timeMs: number) => {
      this.lastPositionSec = timeMs / 1000.0;
      this.callbacks?.onPositionUpdate(this.lastPositionSec);
    });

    player.on('error', (err) => {
      hilog.error(LOG_DOMAIN, LOG_TAG, 'AVPlayer error %{public}d: %{public}s', err.code, err.message);
      this.callbacks?.onError(`${err.code}: ${err.message}`);
    });
  }

  async loadRawAudio(
    context: common.Context,
    rawFilePath: string,
    initialPositionSec: number,
    autoPlay: boolean
  ): Promise<void> {
    if (!this.player) {
      return;
    }
    this.isPrepared = false;
    this.pendingSeekMs = Math.max(0, Math.round(initialPositionSec * 1000));
    this.pendingAutoPlay = autoPlay;

    const prevContext = this.activeContext;
    const prevPath = this.activeRawPath;
    await this.player.reset();
    if (prevContext && prevPath) {
      try {
        await prevContext.resourceManager.closeRawFd(prevPath);
      } catch {
        // Ignore if already closed
      }
    }

    this.activeContext = context;
    this.activeRawPath = rawFilePath;
    const rawFd = await context.resourceManager.getRawFd(rawFilePath);
    hilog.info(LOG_DOMAIN, LOG_TAG, 'Loaded rawFd path=%{public}s len=%{public}d', rawFilePath, rawFd.length);
    this.player.fdSrc = {
      fd: rawFd.fd,
      offset: rawFd.offset,
      length: rawFd.length
    };
  }

  async play(): Promise<void> {
    if (!this.player || !this.isPrepared) {
      this.pendingAutoPlay = true;
      return;
    }
    await this.player.play();
  }

  async pause(): Promise<void> {
    this.pendingAutoPlay = false;
    if (!this.player || !this.isPrepared) {
      return;
    }
    await this.player.pause();
  }

  seekToSeconds(seconds: number): void {
    const ms = Math.max(0, Math.round(seconds * 1000));
    if (!this.player || !this.isPrepared) {
      this.pendingSeekMs = ms;
      return;
    }
    this.player.seek(ms, media.SeekMode.SEEK_CLOSEST);
  }

  setSpeed(speed: number): void {
    this.currentSpeed = speed;
    this.applySpeed(speed);
  }

  private applySpeed(speed: number): void {
    if (!this.player || !this.isPrepared) {
      return;
    }
    try {
      this.player.setPlaybackRate(speed);
      return;
    } catch {
      // Fallback to discrete PlaybackSpeed enum if continuous rate is rejected on a device
    }
    let mode = media.PlaybackSpeed.SPEED_FORWARD_1_00_X;
    if (speed <= 0.85) {
      mode = media.PlaybackSpeed.SPEED_FORWARD_0_75_X;
    } else if (speed <= 1.15) {
      mode = media.PlaybackSpeed.SPEED_FORWARD_1_00_X;
    } else {
      mode = media.PlaybackSpeed.SPEED_FORWARD_1_25_X;
    }
    this.player.setSpeed(mode);
  }

  async release(): Promise<void> {
    if (this.activeContext && this.activeRawPath) {
      try {
        await this.activeContext.resourceManager.closeRawFd(this.activeRawPath);
      } catch {
        // Ignore
      }
      this.activeRawPath = '';
    }
    if (this.player) {
      await this.player.release();
      this.player = undefined;
    }
  }
}

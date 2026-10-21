/**
 * ============================================================================
 *  ⚠️ dev-only：虚拟音频时钟（adapters/wechat/fakeAudio.ts）
 * ============================================================================
 *  由 `config/env.ts` 的 {@link USE_FAKE_AUDIO_CLOCK} 控制。
 *
 *  作用：真实音频要等后端打通；本适配器用**真实时间**推进一个虚拟 `currentTime`，
 *  从而在「无音频」的前提下驱动**逐词高亮**、进度条与跨句跳转，让 M3 的关键逻辑
 *  可被肉眼与脚本验证（这是本轮最重要的可验证点）。
 *
 *  实现要点：
 *   - 用 `setInterval`（200ms）按真实时间差推进位置（`Δ真实时间 × 倍速`）；
 *   - `setDuration()` 由播放器页在课程详情就绪后注入（虚拟时钟无法自己得知时长）；
 *   - 时间语义、事件回调与真实适配器**完全一致**，页面无需区分二者。
 *
 *  🚨 上线前：把 `USE_FAKE_AUDIO_CLOCK` 置为 `false`。
 * ============================================================================
 */

import { clampPosition, END_EPSILON_SEC } from '../../core/timelineEngine';
import { AudioAdapter, AudioAdapterEvents, PlaybackRate } from '../../core/types';

/** 虚拟时钟推进步长（毫秒）。 */
export const FAKE_CLOCK_TICK_MS = 200;

/** 虚拟音频源实现。 */
export class FakeClockAudioAdapter implements AudioAdapter {
  private events: AudioAdapterEvents = {};

  /** 总时长（秒），由 `setDuration` 注入。 */
  private durationSec = 0;

  /** 当前位置（秒）。 */
  private positionSec = 0;

  /** 是否播放中。 */
  private playing = false;

  /** 倍速。 */
  private rate: PlaybackRate = 1.0;

  /** 定时器句柄。 */
  private timer: ReturnType<typeof setInterval> | null = null;

  /** 上次 tick 的本地时间戳（毫秒）。 */
  private lastTickMs = 0;

  /** 是否已销毁。 */
  private destroyed = false;

  /** 是否虚拟时钟（供页面判断）。 */
  readonly isFakeClock = true;

  setEvents(events: AudioAdapterEvents): void {
    this.events = events;
  }

  /**
   * 注入时长并模拟「就绪」事件流（`onCanplay` + `onDurationChange`）。
   *
   * 页面在课程详情解析出 `pb`/`dg` 时长后调用；切换音轨时重新注入。
   */
  setDuration(durationSec: number): void {
    if (this.destroyed) {
      return;
    }
    const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
    if (dur === this.durationSec) {
      return;
    }
    this.durationSec = dur;
    this.positionSec = clampPosition(this.positionSec, dur);
    this.events.onDurationChange?.(dur);
    this.events.onCanplay?.();
  }

  /** 虚拟源忽略 src（无网络资源）。 */
  load(_src: string): void {
    // 虚拟时钟不依赖真实音频源。
    this.positionSec = 0;
    this.events.onCanplay?.();
  }

  play(): void {
    if (this.destroyed) {
      return;
    }
    if (!(this.durationSec > 0)) {
      console.warn('[fakeAudio] 时长未知，play() 忽略（等待 setDuration）。');
      return;
    }
    if (this.playing) {
      return;
    }
    this.playing = true;
    this.lastTickMs = Date.now();
    this.startTimer();
    this.events.onPlay?.();
  }

  pause(): void {
    if (this.destroyed || !this.playing) {
      return;
    }
    this.playing = false;
    this.stopTimer();
    this.events.onPause?.();
  }

  seek(positionSec: number): void {
    if (this.destroyed) {
      return;
    }
    this.positionSec = clampPosition(positionSec, this.durationSec);
    this.lastTickMs = Date.now();
    this.events.onSeeked?.(this.positionSec);
    this.events.onTimeUpdate?.(this.positionSec);
  }

  setPlaybackRate(rate: PlaybackRate): void {
    this.rate = rate;
  }

  isPaused(): boolean {
    return !this.playing;
  }

  getPositionSec(): number {
    return this.positionSec;
  }

  getDurationSec(): number {
    return this.durationSec;
  }

  destroy(): void {
    this.destroyed = true;
    this.stopTimer();
    this.playing = false;
  }

  private startTimer(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => this.tick(), FAKE_CLOCK_TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 按真实时间差推进位置并派发时间事件。 */
  private tick(): void {
    if (this.destroyed || !this.playing) {
      return;
    }
    const now = Date.now();
    const deltaSec = Math.max(0, now - this.lastTickMs) / 1000;
    this.lastTickMs = now;

    this.positionSec = clampPosition(this.positionSec + deltaSec * this.rate, this.durationSec);
    this.events.onTimeUpdate?.(this.positionSec);

    if (this.durationSec > 0 && this.positionSec >= this.durationSec - END_EPSILON_SEC) {
      this.playing = false;
      this.stopTimer();
      this.events.onPause?.();
      this.events.onEnded?.();
    }
  }
}

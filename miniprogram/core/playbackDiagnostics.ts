/**
 * Opt-in WeChat device-preview diagnostics: memory-only, fixed schema, no
 * identifying fields, network calls, CloudBase writes or freeform strings.
 *
 * Timings are event proxies, NOT the first audible PCM frame. A participant
 * must manually confirm audible-first-frame timing on their real device.
 */
export type SafePlaybackEvent =
  | 'screen_open'
  | 'detail_ready'
  | 'audio_load_requested'
  | 'audio_canplay'
  | 'audio_play_event'
  | 'audio_pause_event'
  | 'audio_waiting'
  | 'progress_guard_hold'
  | 'background'
  | 'foreground_playing'
  | 'foreground_paused'
  | 'error_system'
  | 'error_network'
  | 'error_source'
  | 'error_format'
  | 'error_other';

export interface DiagnosticEvent {
  readonly kind: SafePlaybackEvent;
  readonly elapsedMs: number;
}

export interface SafePlaybackReport {
  readonly schema: 'ep-wechat-playback-local-v1';
  readonly measurement: 'wechat_callback_proxies_not_audible_frame';
  readonly events: DiagnosticEvent[];
  readonly screenToDetailMs: number | null;
  readonly loadToCanplayMs: number | null;
  readonly loadToPlayEventMs: number | null;
  readonly errorCount: number;
  readonly backgroundCount: number;
  readonly foregroundCount: number;
}

/** Only the whitelisted numeric code is accepted; never include errMsg. */
function errorKind(code: number): SafePlaybackEvent {
  switch (code) {
    case 10001: return 'error_system';
    case 10002: return 'error_network';
    case 10003: return 'error_source';
    case 10004: return 'error_format';
    default: return 'error_other';
  }
}

/** Clock-injected, session-scoped recorder for deterministic tests. */
export class PlaybackDiagnosticSession {
  private readonly startedAt: number;
  private readonly events: DiagnosticEvent[] = [];
  private firstLoadMs: number | null = null;
  private screenToDetailMs: number | null = null;
  private loadToCanplayMs: number | null = null;
  private loadToPlayEventMs: number | null = null;
  private errorCount = 0;
  private backgroundCount = 0;
  private foregroundCount = 0;

  constructor(private readonly nowMs: () => number = Date.now) {
    this.startedAt = nowMs();
    this.record('screen_open');
  }

  private offset(): number {
    const elapsed = this.nowMs() - this.startedAt;
    return Number.isFinite(elapsed) ? Math.max(0, Math.min(600000, Math.round(elapsed))) : 0;
  }

  private record(kind: SafePlaybackEvent): void {
    // Fixed-size ring keeps reports bounded even during long listening sessions.
    if (this.events.length >= 40) this.events.shift();
    this.events.push({ kind, elapsedMs: this.offset() });
  }

  detailReady(): void {
    if (this.screenToDetailMs === null) this.screenToDetailMs = this.offset();
    this.record('detail_ready');
  }

  loadRequested(): void {
    if (this.firstLoadMs === null) this.firstLoadMs = this.offset();
    this.record('audio_load_requested');
  }

  canplay(): void {
    if (this.firstLoadMs !== null && this.loadToCanplayMs === null) {
      this.loadToCanplayMs = Math.max(0, this.offset() - this.firstLoadMs);
    }
    this.record('audio_canplay');
  }

  playEvent(): void {
    if (this.firstLoadMs !== null && this.loadToPlayEventMs === null) {
      this.loadToPlayEventMs = Math.max(0, this.offset() - this.firstLoadMs);
    }
    this.record('audio_play_event');
  }

  pauseEvent(): void { this.record('audio_pause_event'); }
  waiting(): void { this.record('audio_waiting'); }

  /**
   * 进度写入被防回退守卫拦下（Issue #61 P0b）。
   *
   * 出现即说明「恢复/切轨 seek 失败后从 0 起播」，是区分 seek 失败与保存
   * 失败的直接证据；不新增字段、不扩采集范围。
   */
  guardHold(): void { this.record('progress_guard_hold'); }

  error(code: number): void {
    this.errorCount++;
    this.record(errorKind(code));
  }

  background(): void {
    this.backgroundCount++;
    this.record('background');
  }

  foreground(isPlaying: boolean): void {
    this.foregroundCount++;
    this.record(isPlaying ? 'foreground_playing' : 'foreground_paused');
  }

  /** Fixed schema only. No lesson ids, URLs, stack traces, device ids or transcript. */
  snapshot(): SafePlaybackReport {
    return {
      schema: 'ep-wechat-playback-local-v1',
      measurement: 'wechat_callback_proxies_not_audible_frame',
      events: this.events.map((event) => ({ ...event })),
      screenToDetailMs: this.screenToDetailMs,
      loadToCanplayMs: this.loadToCanplayMs,
      loadToPlayEventMs: this.loadToPlayEventMs,
      errorCount: this.errorCount,
      backgroundCount: this.backgroundCount,
      foregroundCount: this.foregroundCount,
    };
  }
}

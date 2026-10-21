/**
 * ============================================================================
 *  双轨状态机（core/trackStateMachine.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  职责：收敛播放器的「双音轨 + 循环 + 倍速 + 完成度」全部状态语义。
 *
 *  核心规则（对齐 Flutter `_ImmersivePlayerScreenState`）：
 *    1. `pb`（Podcast）与 `dg`（Dialogue）**各自独立**保存位置与句索引，
 *       切轨时快照当前轨、恢复目标轨；
 *    2. **总完成度严格绑定 `pb`**：切到 `dg` 播放/把它播完，都不影响 `pb` 完成度；
 *    3. 单句循环（`Loop 1`）与整课重复（`Repeat Episode`）互斥优先级：
 *       单句循环 > 整课重复 > 自动下一课；
 *    4. 倍速档位固定为 `PLAYBACK_RATES`（0.8 / 0.9 / 1.0 / 1.1 / 1.25）。
 *
 *  时间单位：秒（number, float）。
 * ============================================================================
 */

import { AudioTrackKey, PLAYBACK_RATES, PlaybackRate } from './types';

/** 已完成阈值（%），与 `PROGRESS_NEAR_END_PCT` 保持一致语义。 */
export const TRACK_COMPLETED_PCT = 95;

/**
 * 进度百分比的有效起点（秒）。
 *
 * 与 Flutter 一致：播放前 3 秒内进度记 0%，避免「刚进入就显示 1%」。
 */
export const MIN_POSITION_FOR_PCT_SEC = 3;

/** 单轨快照。 */
export interface TrackSnapshot {
  /** 播放位置（秒）。 */
  positionSec: number;
  /** 当前句索引。 */
  segIdx: number;
  /** 总时长（秒，未知为 0）。 */
  durationSec: number;
}

/** 播放自然结束时的决策。 */
export type EndedAction = 'loopSentence' | 'repeatEpisode' | 'nextEpisode' | 'stop';

/** 轨道快照的默认值。 */
function emptySnapshot(): TrackSnapshot {
  return { positionSec: 0, segIdx: 0, durationSec: 0 };
}

/**
 * 双轨状态机。
 *
 * 纯逻辑、零副作用：不触碰音频、不读写存储，便于单测与多端复用。
 */
export class TrackStateMachine {
  /** 当前活动音轨。 */
  private activeTrack: AudioTrackKey;

  /** 各轨快照。 */
  private readonly snapshots: Record<AudioTrackKey, TrackSnapshot>;

  /** 当前倍速档位在 {@link PLAYBACK_RATES} 中的下标。 */
  private rateIndex: number;

  /** 单句循环开关。 */
  private singleSentenceLoop = false;

  /** 整课重复开关。 */
  private repeatEpisode = false;

  constructor(activeTrack: AudioTrackKey = 'pb') {
    this.activeTrack = activeTrack;
    this.snapshots = { pb: emptySnapshot(), dg: emptySnapshot() };
    this.rateIndex = PLAYBACK_RATES.indexOf(1.0);
  }

  /** 当前活动音轨。 */
  getActiveTrack(): AudioTrackKey {
    return this.activeTrack;
  }

  /** 取某轨快照（副本）。 */
  getSnapshot(track: AudioTrackKey): TrackSnapshot {
    const s = this.snapshots[track];
    return { positionSec: s.positionSec, segIdx: s.segIdx, durationSec: s.durationSec };
  }

  /** 写入某轨快照。 */
  setSnapshot(track: AudioTrackKey, snapshot: Partial<TrackSnapshot>): void {
    const prev = this.snapshots[track];
    this.snapshots[track] = {
      positionSec: pickFinite(snapshot.positionSec, prev.positionSec),
      segIdx: pickFinite(snapshot.segIdx, prev.segIdx),
      durationSec: pickFinite(snapshot.durationSec, prev.durationSec),
    };
  }

  /**
   * 更新**当前活动轨**的快照（播放过程中高频调用，故只写活动轨）。
   */
  updateActive(positionSec: number, segIdx: number, durationSec: number): void {
    this.setSnapshot(this.activeTrack, { positionSec, segIdx, durationSec });
  }

  /**
   * 切换音轨：当前轨快照已由调用方通过 {@link updateActive} 保持最新；
   * 本方法只翻转 `activeTrack` 并返回**目标轨**需恢复的位置与句索引。
   */
  switchTrack(track: AudioTrackKey): TrackSnapshot {
    this.activeTrack = track;
    return this.getSnapshot(track);
  }

  /** 当前倍速。 */
  getRate(): PlaybackRate {
    return PLAYBACK_RATES[this.rateIndex];
  }

  /** 设置倍速（非法值忽略）。 */
  setRate(rate: number): PlaybackRate {
    const idx = PLAYBACK_RATES.indexOf(rate as PlaybackRate);
    if (idx >= 0) {
      this.rateIndex = idx;
    }
    return this.getRate();
  }

  /** 循环到下一档倍速（末尾回到开头）。 */
  cycleRate(): PlaybackRate {
    this.rateIndex = (this.rateIndex + 1) % PLAYBACK_RATES.length;
    return this.getRate();
  }

  /** 倍速展示文案（如 `1.25x`）。 */
  static formatRate(rate: PlaybackRate): string {
    return `${rate.toFixed(2).replace(/0$/, '')}x`;
  }

  /** 是否单句循环。 */
  isSingleSentenceLoop(): boolean {
    return this.singleSentenceLoop;
  }

  /** 切换单句循环。 */
  toggleSingleSentenceLoop(): boolean {
    this.singleSentenceLoop = !this.singleSentenceLoop;
    return this.singleSentenceLoop;
  }

  /**
   * 强制关闭单句循环（EP-PBC-001 §2：手动切课 / 自动连播都关闭它）。
   *
   * 只动单句循环：音轨循环（`repeatEpisode`）必须**保留**，自动连播设置也不受影响。
   * 幂等：已经关闭时返回 false 且不产生状态变化。
   */
  resetSingleSentenceLoop(): boolean {
    if (!this.singleSentenceLoop) {
      return false;
    }
    this.singleSentenceLoop = false;
    return true;
  }

  /** 是否整课重复。 */
  isRepeatEpisode(): boolean {
    return this.repeatEpisode;
  }

  /** 切换整课重复。 */
  toggleRepeatEpisode(): boolean {
    this.repeatEpisode = !this.repeatEpisode;
    return this.repeatEpisode;
  }

  /**
   * 计算 Podcast（`pb`）的完成度百分比（0..100）。
   *
   * **严格绑定 `pb`**：与当前活动轨无关；`dg` 的位置/时长不参与。
   */
  computePbProgressPct(): number {
    const pb = this.snapshots.pb;
    if (!(pb.durationSec > 0)) {
      return 0;
    }
    if (pb.positionSec < MIN_POSITION_FOR_PCT_SEC) {
      return 0;
    }
    return Math.min(100, Math.max(0, Math.floor((pb.positionSec / pb.durationSec) * 100)));
  }

  /** `pb` 是否已达完成阈值。 */
  isPbCompleted(): boolean {
    return this.computePbProgressPct() >= TRACK_COMPLETED_PCT;
  }

  /** 播放自然结束时的动作决策（单句循环 > 整课重复 > 自动下一课）。 */
  decideEndedAction(): EndedAction {
    if (this.singleSentenceLoop) {
      return 'loopSentence';
    }
    if (this.repeatEpisode) {
      return 'repeatEpisode';
    }
    return 'nextEpisode';
  }
}

/** 取有限数值，否则回退默认值。 */
function pickFinite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

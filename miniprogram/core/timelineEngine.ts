/**
 * ============================================================================
 *  时间轴引擎（core/timelineEngine.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  职责：把「播放位置（秒）」映射到**片段（句）下标**，并提供本地时钟的
 *        **插值外推**能力，以弥补 `onTimeUpdate` 在前台低频回调的时间空档。
 *
 *  为什么需要插值外推：
 *    微信 `InnerAudioContext` 的 `onTimeUpdate` 仅在**前台**回调，间隔不可控
 *    （可能 200ms~500ms 甚至更久）。若逐词高亮只依赖它，会出现明显的「跳字」。
 *    因此逻辑层用 250ms 的本地定时器按上次已知时间戳 + 速率外推当前位置，
 *    收到 `onTimeUpdate` 时再以真实值校正漂移（避免误差累积）。
 *
 *  关键实现：所有定位走**二分查找 O(log n)**，绝不线性扫描。
 *
 *  时间单位：秒（number, float）。
 * ============================================================================
 */

import { Segment } from './types';

/** 判定「到达结尾」的容差（秒）。 */
export const END_EPSILON_SEC = 0.02;

/** 把值限制到 [0, duration]（duration <= 0 表示未知，此时仅保证 >= 0）。 */
export function clampPosition(positionSec: number, durationSec: number): number {
  const p = Number.isFinite(positionSec) ? positionSec : 0;
  if (Number.isFinite(durationSec) && durationSec > 0) {
    return Math.min(durationSec, Math.max(0, p));
  }
  return Math.max(0, p);
}

/**
 * 二分查找：返回**最后一个 `start <= t`** 的片段下标。
 *
 * 边界语义：
 *   - `segments` 为空 → 返回 `-1`；
 *   - `t` 早于首片段 `start` → 返回 `0`（钳到首片段）；
 *   - `t` 晚于末片段 `start` → 返回最后下标（越界由 {@link hasReachedEnd} 判断）；
 *   - 恰好落在边界（上一句 `end == 下一句 start`）→ 返回**后一句**，
 *     因为后一句的 `start <= t` 成立且更靠后（「新句优先」）。
 */
export function findSegmentIndexAt(segments: readonly Segment[], t: number): number {
  const n = segments.length;
  if (n === 0) {
    return -1;
  }
  const time = Number.isFinite(t) ? t : 0;

  let lo = 0;
  let hi = n - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= time) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * 是否已到达/越过最后一段（用于「最后一句收尾」判定）。
 *
 * 空数组视为「无内容」→ 返回 `false`（交由上层处理空状态）。
 */
export function hasReachedEnd(segments: readonly Segment[], t: number): boolean {
  if (segments.length === 0) {
    return false;
  }
  const last = segments[segments.length - 1];
  const time = Number.isFinite(t) ? t : 0;
  return time >= last.end - END_EPSILON_SEC;
}

/** 时间采样点：某一时刻（毫秒）的已知播放位置（秒）。 */
export interface ClockSample {
  /** 已知播放位置（秒）。 */
  positionSec: number;
  /** 该位置被观测到的本地时间戳（毫秒，`Date.now()`）。 */
  atMs: number;
}

/** 插值外推参数。 */
export interface ExtrapolateOptions {
  /** 播放速率（1.0 = 原速）。 */
  rate: number;
  /** 总时长（秒，未知为 0）。 */
  durationSec: number;
  /** 当前是否处于播放态。 */
  playing: boolean;
}

/**
 * 由最后一次已知采样 + 经过的真实时长，插值外推当前播放位置。
 *
 * - 暂停态：原样返回采样位置（钳到有效区间）；
 * - 播放态：`position + Δt * rate`，并按 `durationSec` 钳制。
 */
export function extrapolatePosition(
  sample: ClockSample,
  nowMs: number,
  options: ExtrapolateOptions,
): number {
  const basePos = Number.isFinite(sample.positionSec) ? sample.positionSec : 0;
  if (!options.playing) {
    return clampPosition(basePos, options.durationSec);
  }
  const elapsedSec = Math.max(0, nowMs - sample.atMs) / 1000;
  const rate = Number.isFinite(options.rate) && options.rate > 0 ? options.rate : 1;
  const pos = basePos + elapsedSec * rate;
  return clampPosition(pos, options.durationSec);
}

/**
 * 用真实的 `onTimeUpdate` 值**校正**本地时钟采样点。
 *
 * 漂移保护：若真实值与本地点相差极小（< `DRIFT_TOLERANCE_SEC`），保留采样点的
 * `atMs`（避免每次回调都重置基准导致外推抖动）；否则以真实值为准重建采样点。
 */
export const DRIFT_TOLERANCE_SEC = 0.12;

export function correctSample(
  sample: ClockSample,
  realPositionSec: number,
  nowMs: number,
  durationSec: number,
): ClockSample {
  const real = clampPosition(realPositionSec, durationSec);
  const drift = Math.abs(real - sample.positionSec);
  if (drift < DRIFT_TOLERANCE_SEC) {
    return sample;
  }
  return { positionSec: real, atMs: nowMs };
}

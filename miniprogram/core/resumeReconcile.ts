/**
 * ============================================================================
 *  活跃音源播放头对账（core/resumeReconcile.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  规范来源：EP-PBC-001 v1.2
 *    - §2.2「继续收听」例外句：手动切课形成的「未开始播放的临时 00:00」，
 *      在该课 PB 存在旧有效断点时，**须在不重新装载音频的前提下**恢复该断点
 *      （§7 向量 E15）。
 *    - §2.2 / E14：目标 PB 正在播放（实时位置领先于磁盘断点）时只导航，
 *      **不得把实时位置倒退到较旧的持久化检查点**。
 *
 *  为什么需要它：
 *    「重新进入同一课」时，播放页会复用本进程已载入的音频源（不重新 load，
 *    避免断音），此时播放头来自 `BackgroundAudioManager` 的实时位置，而
 *    `plan.startMs` 来自磁盘记录 —— 两者可能不一致：
 *
 *      | 情形                        | 实时位置 | 计划位置 | 正确动作 |
 *      | --------------------------- | -------- | -------- | -------- |
 *      | E15 临时 00:00（未播放）    | 0        | 480_000  | seek 前跳 |
 *      | E14 正在播放，磁盘落后      | 600_000  | 597_000  | 保持不动  |
 *      | 已完成 / 末尾 / 无断点      | 任意     | 0        | 保持不动  |
 *
 *    若把实时位置无条件当真（旧实现），E15 会把播放头停在 0，并把播放头锚点
 *    写成 0 —— 于是 2s 之后的周期提交全部通过判定，历史断点被 0:0x 覆盖。
 *    若改成「重装音源 + seek 到记录」，则违反「不重新装载音频」且会倒退（E14）。
 *
 *  判据只有一条：**计划位置比实时位置超前超过容差时，才就地前跳。**
 */

import { PLAYHEAD_ANCHOR_TOLERANCE_MS } from './learningRecord';

/** 对账动作：`keep` = 保持实时播放头；`seek` = 就地前跳到计划位置。 */
export type ReconcileAction = 'keep' | 'seek';

/** 不动作的原因（便于单测与诊断断言，不影响运行时行为）。 */
export type ReconcileReason =
  | 'no-plan' // 计划位置为 0：已完成 / 停在末尾 / 无有效断点
  | 'invalid-plan' // 计划位置非法（NaN / 负数）
  | 'live-ahead' // 实时位置领先磁盘断点（E14）
  | 'within-tolerance' // 落后量在容差内，跳动不划算
  | 'planned-ahead'; // 需要前跳（E15）

export interface ReconcileInput {
  /** 计划恢复位置（`planEntry().startMs`），毫秒。 */
  readonly plannedStartMs: number;
  /** 音频源实时位置，毫秒。 */
  readonly livePositionMs: number;
  /** 允许的偏差，默认 {@link PLAYHEAD_ANCHOR_TOLERANCE_MS}（2s）。 */
  readonly toleranceMs?: number;
}

export interface ReconcileDecision {
  readonly action: ReconcileAction;
  readonly reason: ReconcileReason;
  /** `action === 'seek'` 时的目标位置；否则等于实时位置。 */
  readonly seekToMs: number;
  /** 计划位置相对实时位置的落后量（负值表示实时位置领先）。 */
  readonly behindMs: number;
}

/** 非负有限数归一；非法值返回 null（由调用方决定如何降级）。 */
function normalizeMs(value: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

/**
 * 对账活跃音源的播放头。
 *
 * 顺序敏感：先排除「没有恢复目标」与「实时领先」，再看落后量是否超过容差。
 */
export function reconcileActivePlayhead(input: ReconcileInput): ReconcileDecision {
  const tolerance =
    typeof input.toleranceMs === 'number' && Number.isFinite(input.toleranceMs)
      ? Math.max(0, input.toleranceMs)
      : PLAYHEAD_ANCHOR_TOLERANCE_MS;

  const planned = normalizeMs(input.plannedStartMs);
  const rawLive = typeof input.livePositionMs === 'number' ? input.livePositionMs : NaN;
  // 非法实时位置按 0 处理：宁可当作「停在开头」，也不把 NaN 传进 seek。
  const live = normalizeMs(rawLive) ?? 0;
  const behindMs = (planned ?? 0) - live;

  if (planned === null) {
    return { action: 'keep', reason: 'invalid-plan', seekToMs: live, behindMs };
  }
  if (planned === 0) {
    return { action: 'keep', reason: 'no-plan', seekToMs: live, behindMs };
  }
  if (behindMs <= 0) {
    return { action: 'keep', reason: 'live-ahead', seekToMs: live, behindMs };
  }
  if (behindMs <= tolerance) {
    return { action: 'keep', reason: 'within-tolerance', seekToMs: live, behindMs };
  }
  return { action: 'seek', reason: 'planned-ahead', seekToMs: planned, behindMs };
}

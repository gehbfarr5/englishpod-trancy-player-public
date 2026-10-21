/**
 * 换源 / 切轨后的**显示镇定窗口**（settle window）。
 *
 * 现象（0.3.9 真机反馈）：PB ↔ DG 切换时，进度条先归零、台本高亮跳回首句并滚到
 * 顶部，随后「闪」回当前台本位置。
 *
 * 原因：`BackgroundAudioManager` 在 `load(src)` 之后、`pendingSeek` 生效之前会上报
 * `currentTime = 0`。页面 `onTimeUpdate` 用 `correctSample()` 校正采样点，而该函数
 * 只在漂移 < 0.12s 时保留原基准；从目标位置（例如 320s）到 0 的漂移极大，于是采样点
 * 被重建为 0。接下来 `tick()` 用被污染的采样点算出 pos≈0，导致：
 *   - `updateTransport(0)` → 进度条归零、时间显示 0:00；
 *   - `tracker.update(0)` → 高亮回到第 1 句、`scrollToSegment(0)` 滚到顶部。
 * 等 `pendingSeek` 生效、`onSeeked` 重建采样点后，又跳回真正位置——就是用户看到的
 * 「从 0 闪到当前台本」。
 *
 * 稳定判据（本模块）：切轨后的一小段窗口内，若媒体实测位置**明显落后**于本次切轨
 * 自己算出的目标位置，就判定这是换源瞬间的假值，渲染继续用目标位置；一旦实测位置
 * 追上目标（或窗口过期），立刻交还实测值。
 *
 * 只影响**渲染**，不影响断点写入：写入走 `mediaPositionSec()`（真实值），且载源
 * 窗口本身有写入门控（EP-PBC-001 §4.1.2）。
 */

/** 镇定窗口长度：覆盖 `load → onCanplay → pendingSeek 生效 → onSeeked`。 */
export const SWITCH_SETTLE_MS = 2500;

/** 判定「追上目标」的容差；也是「明显落后」的门槛。 */
export const SETTLE_TOLERANCE_MS = 2000;

export type SettleDecision = 'hold' | 'release';

export interface SettleInput {
  /** 本次切轨自己算出的目标位置（ms）。≤ 0 表示本就从 00:00 开始，无需镇定。 */
  targetMs: number;
  /** 窗口截止时间（ms 时间戳）。0 / 非有限值表示没有窗口。 */
  untilMs: number;
  /** 当前时间（ms 时间戳）。 */
  nowMs: number;
  /** 媒体实测位置（ms）。 */
  liveMs: number;
  /** 容差，默认 `SETTLE_TOLERANCE_MS`。 */
  toleranceMs?: number;
}

/**
 * 是否继续用目标位置渲染。
 *
 * - `hold`：实测值明显落后（换源瞬间的假 0）→ 渲染目标位置；
 * - `release`：已追上、已超过、窗口过期、或本次目标本就是 0 → 采纳实测值。
 */
export function decideSettle(input: SettleInput): SettleDecision {
  const targetMs = Number.isFinite(input.targetMs) ? input.targetMs : 0;
  const tolerance =
    Number.isFinite(input.toleranceMs) && (input.toleranceMs as number) >= 0
      ? (input.toleranceMs as number)
      : SETTLE_TOLERANCE_MS;

  // 从 00:00 起播的音轨没有「先 0 后跳」的问题，不进入镇定。
  if (targetMs <= 0) return 'release';

  // 时间不可信时不做判断：宁可显示实测值，也不压住真实进度。
  if (!Number.isFinite(input.nowMs)) return 'release';
  const untilMs = Number.isFinite(input.untilMs) ? input.untilMs : 0;
  const nowMs = input.nowMs;
  // 窗口过期：无论实测多离谱都以平台为准，避免 seek 真失败时永久显示错位置。
  if (untilMs <= 0 || nowMs >= untilMs) return 'release';

  // 实测非法（NaN）：保留目标位置，交给过期兜底。
  if (!Number.isFinite(input.liveMs)) return 'hold';

  // 明显落后于目标 → 换源瞬间的假值。
  if (input.liveMs < targetMs - tolerance) return 'hold';

  return 'release';
}

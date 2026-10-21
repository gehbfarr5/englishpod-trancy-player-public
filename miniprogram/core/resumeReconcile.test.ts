/**
 * `core/resumeReconcile.ts` 单测 —— EP-PBC-001 v1.2 §2.2 例外句 / E15 / E14。
 *
 * 覆盖：
 *   - E15：活跃音源停在临时 00:00、历史断点 08:00 → 前跳到 08:00；
 *   - E14：实时位置领先磁盘断点 → 保持不动，**不倒退**；
 *   - 已完成 / 末尾 / 无断点（计划位置为 0）→ 不动作；
 *   - 容差边界 1999 / 2000 / 2001 ms；
 *   - 非法输入（NaN / 负数）不产生越界 seek。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { PLAYHEAD_ANCHOR_TOLERANCE_MS } from './learningRecord';
import { reconcileActivePlayhead } from './resumeReconcile';

const EIGHT_MIN = 480_000;

describe('reconcileActivePlayhead · E15 临时 00:00', () => {
  test('停在 0、历史 08:00 → 前跳到 08:00', () => {
    const d = reconcileActivePlayhead({
      plannedStartMs: EIGHT_MIN,
      livePositionMs: 0,
    });
    assert.equal(d.action, 'seek');
    assert.equal(d.seekToMs, EIGHT_MIN);
    assert.equal(d.reason, 'planned-ahead');
    assert.equal(d.behindMs, EIGHT_MIN);
  });

  test('刚载入但平台报了 300ms 的实时位置，仍应前跳（远落后于断点）', () => {
    const d = reconcileActivePlayhead({
      plannedStartMs: EIGHT_MIN,
      livePositionMs: 300,
    });
    assert.equal(d.action, 'seek');
    assert.equal(d.seekToMs, EIGHT_MIN);
  });

  test('seek 目标与计划位置严格一致（不做四舍五入漂移）', () => {
    const d = reconcileActivePlayhead({
      plannedStartMs: 123_456,
      livePositionMs: 0,
    });
    assert.equal(d.seekToMs, 123_456);
  });
});

describe('reconcileActivePlayhead · E14 实时领先不倒退', () => {
  test('实时 10:00、磁盘 09:57 → 保持实时位置', () => {
    const d = reconcileActivePlayhead({
      plannedStartMs: 597_000,
      livePositionMs: 600_000,
    });
    assert.equal(d.action, 'keep');
    assert.equal(d.reason, 'live-ahead');
    assert.equal(d.seekToMs, 600_000);
    assert.ok(d.behindMs < 0);
  });

  test('实时与磁盘完全一致 → 不动', () => {
    const d = reconcileActivePlayhead({
      plannedStartMs: EIGHT_MIN,
      livePositionMs: EIGHT_MIN,
    });
    assert.equal(d.action, 'keep');
    assert.equal(d.reason, 'live-ahead');
  });
});

describe('reconcileActivePlayhead · 计划位置为 0（已完成 / 末尾 / 无断点）', () => {
  test('已完成课程计划恢复 0，实时也在 0 → 不动作', () => {
    const d = reconcileActivePlayhead({ plannedStartMs: 0, livePositionMs: 0 });
    assert.equal(d.action, 'keep');
    assert.equal(d.reason, 'no-plan');
  });

  test('计划 0 但实时在中段（本轮已听）→ 以实时为准', () => {
    const d = reconcileActivePlayhead({ plannedStartMs: 0, livePositionMs: 45_000 });
    assert.equal(d.action, 'keep');
    assert.equal(d.reason, 'no-plan');
    assert.equal(d.seekToMs, 45_000);
  });
});

describe('reconcileActivePlayhead · 容差边界', () => {
  const tolerance = PLAYHEAD_ANCHOR_TOLERANCE_MS; // 2000ms

  test('落后恰好 2000ms → 不动（等于容差不算超前）', () => {
    const d = reconcileActivePlayhead({
      plannedStartMs: EIGHT_MIN,
      livePositionMs: EIGHT_MIN - tolerance,
    });
    assert.equal(d.action, 'keep');
    assert.equal(d.reason, 'within-tolerance');
  });

  test('落后 1999ms → 不动', () => {
    const d = reconcileActivePlayhead({
      plannedStartMs: EIGHT_MIN,
      livePositionMs: EIGHT_MIN - 1999,
    });
    assert.equal(d.action, 'keep');
    assert.equal(d.reason, 'within-tolerance');
  });

  test('落后 2001ms → 前跳', () => {
    const d = reconcileActivePlayhead({
      plannedStartMs: EIGHT_MIN,
      livePositionMs: EIGHT_MIN - 2001,
    });
    assert.equal(d.action, 'seek');
    assert.equal(d.reason, 'planned-ahead');
  });

  test('自定义容差生效', () => {
    const d = reconcileActivePlayhead({
      plannedStartMs: EIGHT_MIN,
      livePositionMs: EIGHT_MIN - 5000,
      toleranceMs: 10_000,
    });
    assert.equal(d.action, 'keep');
  });
});

describe('reconcileActivePlayhead · 非法输入降级', () => {
  test('计划位置 NaN → 不动作', () => {
    const d = reconcileActivePlayhead({ plannedStartMs: Number.NaN, livePositionMs: 0 });
    assert.equal(d.action, 'keep');
    assert.equal(d.reason, 'invalid-plan');
  });

  test('计划位置负数 → 不动作', () => {
    const d = reconcileActivePlayhead({ plannedStartMs: -1, livePositionMs: 0 });
    assert.equal(d.action, 'keep');
    assert.equal(d.reason, 'invalid-plan');
  });

  test('实时位置 NaN → 按 0 处理并前跳，绝不把 NaN 传给 seek', () => {
    const d = reconcileActivePlayhead({
      plannedStartMs: EIGHT_MIN,
      livePositionMs: Number.NaN,
    });
    assert.equal(d.action, 'seek');
    assert.equal(d.seekToMs, EIGHT_MIN);
    assert.ok(Number.isFinite(d.seekToMs));
  });

  test('实时位置负数 → 按 0 处理', () => {
    const d = reconcileActivePlayhead({ plannedStartMs: EIGHT_MIN, livePositionMs: -500 });
    assert.equal(d.action, 'seek');
    assert.equal(d.seekToMs, EIGHT_MIN);
  });
});

/**
 * `core/learningRecord.ts` 单测 —— EP-PBC-001 §4 / §4.1 写入语义。
 *
 * 覆盖：
 *   - §4.1.2 只进课程 / 只加载完成 / 手动切课定位 00:00 不覆盖历史断点；
 *   - §4.1.3 显式 Seek 立即生效（可写 0、可倒退）；
 *   - §4.1.4 写入版本递增、双轨不串写；
 *   - §4.1.5 / §3.1 完成标记与位置解耦；
 *   - §4.1.6 已完成 PB / 末尾 DG 下次从 00:00；
 *   - §4.1.9 损坏隔离与钳制。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  PB_COMPLETED_PCT,
  ZERO_POSITION_THRESHOLD_MS,
  applyTrackPoint,
  createLearningRecord,
  decidePositionCommit,
  isContinuousMediaAdvance,
  isPointAtEnd,
  markLessonCompleted,
  normalizeLearningRecord,
  normalizePreferences,
  normalizeResumeAnchor,
  resolveResumePositionMs,
  toProgressView,
  trackPointOf,
} from './learningRecord';

/** 一条已听 8:00 / 共 15:00 的 PB 记录。 */
function listenedRecord() {
  return applyTrackPoint(
    createLearningRecord('0001', 1000),
    'pb',
    { committedPositionMs: 480_000, committedSegmentIndex: 40, durationMs: 900_000 },
    1000,
  );
}

describe('learningRecord · §4.1.2 00:00 不得覆盖历史断点', () => {
  test('手动切课定位到 00:00 后周期提交：拒绝写入', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 0,
      segmentIndex: 0,
      durationMs: 900_000,
      reason: 'periodic',
      record: listenedRecord(),
    });
    assert.equal(decision.commit, false);
    assert.equal(decision.holdReason, 'zero-overwrite');
  });

  test('恢复 seek 失败后从 0.9s 起播：拒绝写入（仍是 00:00 级位置）', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 900,
      segmentIndex: 0,
      durationMs: 900_000,
      reason: 'pause',
      record: listenedRecord(),
    });
    assert.equal(decision.commit, false, '0.9s 仍属零位置级，不得覆盖 480s');
    assert.equal(decision.holdReason, 'zero-overwrite');
  });

  test('恢复 seek 失败后从 1.2s 起播：同样拒绝（按倒退处理）', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 1_200,
      segmentIndex: 0,
      durationMs: 900_000,
      reason: 'pause',
      record: listenedRecord(),
    });
    assert.equal(decision.commit, false);
    assert.equal(decision.holdReason, 'backward-without-seek');
  });

  test('加载锁定期：任何位置都不写（§4.1.2）', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 500_000,
      segmentIndex: 41,
      durationMs: 900_000,
      reason: 'periodic',
      record: listenedRecord(),
      loading: true,
    });
    assert.equal(decision.commit, false);
    assert.equal(decision.holdReason, 'load-lock');
  });

  test('非显式 Seek 的倒退：无锚点时保守拒绝', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 30_000,
      segmentIndex: 3,
      durationMs: 900_000,
      reason: 'periodic',
      record: listenedRecord(),
    });
    assert.equal(decision.commit, false);
    assert.equal(decision.holdReason, 'backward-without-seek');
  });

  test('播放头锚点在 480s、媒体却只有 4s：判定为恢复 seek 被丢弃', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 4_000,
      segmentIndex: 1,
      durationMs: 900_000,
      reason: 'periodic',
      record: listenedRecord(),
      anchorMs: 480_000,
    });
    assert.equal(decision.commit, false);
    assert.equal(decision.holdReason, 'resume-seek-missed');
  });

  test('锚点为 0（手动切课/重听）时，真实推进可以更新旧断点', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 4_000,
      segmentIndex: 1,
      durationMs: 900_000,
      reason: 'periodic',
      record: listenedRecord(),
      anchorMs: 0,
    });
    assert.equal(decision.commit, true);
    assert.equal(decision.point?.committedPositionMs, 4_000);
  });

  test('锚点为 0 但还没真正推进（0.4s）：仍拒绝', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 400,
      segmentIndex: 0,
      durationMs: 900_000,
      reason: 'periodic',
      record: listenedRecord(),
      anchorMs: 0,
    });
    assert.equal(decision.commit, false);
    assert.equal(decision.holdReason, 'zero-overwrite');
  });

  test('首次提交就落在 0 附近：不写（不把「从未听过」写成「听过 0ms」）', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 0,
      segmentIndex: 0,
      reason: 'periodic',
      record: createLearningRecord('0002'),
    });
    assert.equal(decision.commit, false);
    assert.equal(decision.holdReason, 'zero-overwrite');
  });
});

describe('learningRecord · §4.1.3 显式 Seek 立即生效', () => {
  test('重听回到 0：允许写入 0', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 0,
      segmentIndex: 0,
      durationMs: 900_000,
      reason: 'userSeek',
      record: listenedRecord(),
    });
    assert.equal(decision.commit, true);
    assert.equal(decision.point?.committedPositionMs, 0);
  });

  test('拖动到更早位置：允许（用户主动改变断点）', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 120_000,
      segmentIndex: 12,
      durationMs: 900_000,
      reason: 'userSeek',
      record: listenedRecord(),
    });
    assert.equal(decision.commit, true);
  });

  test('Seek 超出时长被钳制到时长上限', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 999_000,
      segmentIndex: 90,
      durationMs: 900_000,
      reason: 'userSeek',
      record: listenedRecord(),
    });
    assert.equal(decision.point?.committedPositionMs, 900_000);
  });
});

describe('learningRecord · §4.1.4 写入版本与双轨独立', () => {
  test('每次被接受的写入 revision +1', () => {
    const first = listenedRecord();
    assert.equal(first.revision, 1);

    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 500_000,
      segmentIndex: 41,
      durationMs: 900_000,
      reason: 'periodic',
      record: first,
    });
    const second = applyTrackPoint(first, 'pb', decision.point!, 2000);
    assert.equal(second.revision, 2);
  });

  test('提交 DG 不动 PB 断点（不串写）', () => {
    const base = listenedRecord();
    const decision = decidePositionCommit({
      track: 'dg',
      positionMs: 20_000,
      segmentIndex: 5,
      durationMs: 60_000,
      reason: 'periodic',
      record: base,
    });
    const next = applyTrackPoint(base, 'dg', decision.point!, 3000);
    assert.equal(next.podcast?.committedPositionMs, 480_000, 'PB 断点必须原样保留');
    assert.equal(next.dialogue?.committedPositionMs, 20_000);
    assert.equal(trackPointOf(next, 'dg')?.committedSegmentIndex, 5);
  });
});

describe('learningRecord · §4.1.5 / §3.1 完成与位置解耦', () => {
  test('完成标记单向：幂等且不会被位置写入清掉', () => {
    const done = markLessonCompleted(listenedRecord(), 2000);
    assert.equal(done.lessonCompleted, true);

    const again = markLessonCompleted(done, 3000);
    assert.equal(again, done, '已完成时幂等返回同一对象');

    // 重听回 0 只改位置，不改完成
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 0,
      segmentIndex: 0,
      durationMs: 900_000,
      reason: 'userSeek',
      record: done,
    });
    const replay = applyTrackPoint(done, 'pb', decision.point!, 4000);
    assert.equal(replay.lessonCompleted, true);
    assert.equal(replay.podcast?.committedPositionMs, 0);
  });

  test('95% 阈值常量与规范一致', () => {
    assert.equal(PB_COMPLETED_PCT, 95);
  });
});

describe('learningRecord · §4.1.6 恢复位置解析', () => {
  test('未完成 PB：按已提交断点恢复', () => {
    assert.equal(resolveResumePositionMs(listenedRecord(), 'pb'), 480_000);
  });

  test('已完成 PB：从 00:00（普通列表 / 继续收听进入）', () => {
    const done = markLessonCompleted(listenedRecord(), 2000);
    assert.equal(resolveResumePositionMs(done, 'pb'), 0);
  });

  test('停在末尾的 DG：下次从 00:00', () => {
    const base = applyTrackPoint(
      createLearningRecord('0001'),
      'dg',
      { committedPositionMs: 60_000, committedSegmentIndex: 20, durationMs: 60_000 },
      1000,
    );
    assert.equal(isPointAtEnd(base.dialogue!), true);
    assert.equal(resolveResumePositionMs(base, 'dg'), 0);
  });

  test('未到末尾的 DG：按断点恢复（与 PB 各自独立）', () => {
    const base = applyTrackPoint(
      createLearningRecord('0001'),
      'dg',
      { committedPositionMs: 20_000, committedSegmentIndex: 5, durationMs: 60_000 },
      1000,
    );
    assert.equal(resolveResumePositionMs(base, 'dg'), 20_000);
  });

  test('无记录：0', () => {
    assert.equal(resolveResumePositionMs(null, 'pb'), 0);
  });
});

describe('learningRecord · §4.1.9 损坏隔离与规整', () => {
  test('坏字段只回退本字段，能读的断点保留', () => {
    const record = normalizeLearningRecord('0001', {
      lessonCompleted: 'yes',
      podcast: { committedPositionMs: 123_000, committedSegmentIndex: 'x' },
      dialogue: 'garbage',
      revision: -5,
    });
    assert.equal(record.lessonCompleted, false, '非 true 一律视为未完成');
    assert.equal(record.podcast?.committedPositionMs, 123_000);
    assert.equal(record.podcast?.committedSegmentIndex, 0);
    assert.equal(record.dialogue, null);
    assert.equal(record.revision, 0, '负版本回退为 0');
  });

  test('位置超时长被钳制；无效时长不传播', () => {
    const record = normalizeLearningRecord('0002', {
      podcast: { committedPositionMs: 999_000, committedSegmentIndex: 3, durationMs: 600_000 },
      dialogue: { committedPositionMs: 10_000, committedSegmentIndex: 1, durationMs: 'x' },
    });
    assert.equal(record.podcast?.committedPositionMs, 600_000);
    assert.equal(record.dialogue?.durationMs, undefined);
  });

  test('完全非对象：返回默认空记录而不抛错', () => {
    const record = normalizeLearningRecord('0003', 'not-an-object');
    assert.deepEqual(record, createLearningRecord('0003', 0));
  });

  test('偏好与锚点坏数据回退默认值', () => {
    assert.deepEqual(normalizePreferences(null), {
      schemaVersion: 2,
      uiMode: 'standard',
      autoNextPodcastEnabled: true,
    });
    assert.equal(normalizeResumeAnchor({ lastOpenedLessonId: 42 }).lastOpenedLessonId, null);
  });
});

describe('learningRecord · §3.1 真实推进判定', () => {
  test('正常播放 250ms 推进 0.25s：连续', () => {
    assert.equal(isContinuousMediaAdvance({ deltaMs: 250, elapsedMs: 250 }), true);
  });

  test('Seek 跳变（一个 tick 内 +60%）：不算连续推进', () => {
    assert.equal(isContinuousMediaAdvance({ deltaMs: 540_000, elapsedMs: 250 }), false);
  });

  test('位置不动 / 倒退：不算推进', () => {
    assert.equal(isContinuousMediaAdvance({ deltaMs: 0, elapsedMs: 250 }), false);
    assert.equal(isContinuousMediaAdvance({ deltaMs: -800, elapsedMs: 250 }), false);
  });
});

describe('learningRecord · 课程库投影', () => {
  test('投影出 PB 百分比与完成态（DG 不影响完成）', () => {
    const withDg = applyTrackPoint(
      listenedRecord(),
      'dg',
      { committedPositionMs: 59_000, committedSegmentIndex: 20, durationMs: 60_000 },
      2000,
    );
    const view = toProgressView(withDg);
    assert.equal(view.pbPosSec, 480);
    assert.equal(view.dgPosSec, 59);
    assert.equal(view.progressPct, Math.floor((480 / 900) * 100));
    assert.equal(view.isCompleted, false, 'DG 播完不得把课程标成完成');
    assert.equal(view.hasStarted, true);
  });
});

describe('learningRecord · 零位置阈值常量', () => {
  test('阈值本身落在 1s（与恢复 seek 失败的观测窗口一致）', () => {
    assert.equal(ZERO_POSITION_THRESHOLD_MS, 1000);
  });
});

describe('learningRecord · 播放头锚点决定「前跳是否被保护」（E15 回归）', () => {
  /**
   * E15 的失效链：复用活跃音源时若把锚点错写成 0，等于向存储层声明
   * 「本次就是在 0 开始」，于是 2s 之后的周期提交全部放行，08:00 被覆盖成 0:0x。
   * 下面两条把「错的锚点」与「对的锚点」的行为差异钉死，防止回退。
   */
  test('锚点=0（错误写法）：播到 3s 会被放行 → 历史断点被覆盖', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 3_000,
      segmentIndex: 0,
      durationMs: 900_000,
      reason: 'periodic',
      record: listenedRecord(),
      anchorMs: 0,
    });
    assert.equal(decision.commit, true, '这正是 E15 之前会丢断点的原因');
    assert.equal(decision.point?.committedPositionMs, 3_000);
  });

  test('锚点=480s（修复后写法）：前跳被平台吞掉时 3s 提交被拦下', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 3_000,
      segmentIndex: 0,
      durationMs: 900_000,
      reason: 'periodic',
      record: listenedRecord(),
      anchorMs: 480_000,
    });
    assert.equal(decision.commit, false);
    assert.equal(decision.holdReason, 'resume-seek-missed');
  });

  test('锚点=480s：前跳真正生效后，正常推进仍可写入', () => {
    const decision = decidePositionCommit({
      track: 'pb',
      positionMs: 481_000,
      segmentIndex: 41,
      durationMs: 900_000,
      reason: 'periodic',
      record: listenedRecord(),
      anchorMs: 480_000,
    });
    assert.equal(decision.commit, true);
    assert.equal(decision.point?.committedPositionMs, 481_000);
  });
});

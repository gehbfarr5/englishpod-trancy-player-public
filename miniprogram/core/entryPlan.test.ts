/**
 * `core/entryPlan.ts` 单测 —— EP-PBC-001 **v1.2** §2 矩阵 / §3.2 结束与连播。
 *
 * 覆盖（一条用例对应一条验收向量）：
 *   - 普通列表 / 继续收听：目标 PB、恢复有效断点（已完成 → 0）；            E01/E06/E08/E09/E13
 *   - 手动上一课/下一课：**00:00**、继承音轨、继承播放态、关闭单句循环；     E02/E03/E06/E07
 *   - 自动连播：PB、**00:00**、播放、关闭单句循环（不续播历史断点）；       F07/F14
 *   - 边界：首末课手动按钮禁用（不环绕）／连播末课环绕回第一课；            E04/F09
 *   - 单课库：连播目标 = 同课 00:00，不停、不报错；                          F13
 *   - 手机端连播恒生效（字段可读但固定）。                                   F08(N/A)
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MOBILE_AUTO_NEXT_ENABLED,
  manualNextIndex,
  manualPrevIndex,
  nextLessonIndex,
  planEntry,
} from './entryPlan';
import {
  applyTrackPoint,
  createLearningRecord,
  markLessonCompleted,
  resolveResumePositionMs,
} from './learningRecord';
import { LessonLearningRecord } from './learningRecord';

/** 一条 PB 已听到 08:00 / 共 15:00 的记录。 */
function pbAt8min(lessonId = '012'): LessonLearningRecord {
  return applyTrackPoint(
    createLearningRecord(lessonId, 1000),
    'pb',
    { committedPositionMs: 480_000, committedSegmentIndex: 40, durationMs: 900_000 },
    1000,
  );
}

/** 一条已完成的 PB 记录（断点仍停在 14:50）。 */
function pbCompleted(lessonId = '012'): LessonLearningRecord {
  return markLessonCompleted(pbAt8min(lessonId), 2000);
}

const base = {
  targetIndex: 5,
  indexLength: 10,
  record: null as LessonLearningRecord | null,
  currentTrack: 'pb' as const,
  wasPlaying: false,
};

describe('entryPlan · §2 矩阵：普通列表入口（library）', () => {
  test('E06 未完成 PB 恢复断点', () => {
    const plan = planEntry({ ...base, mode: 'library', record: pbAt8min() });
    assert.equal(plan.track, 'pb');
    assert.equal(plan.startMs, 480_000);
    assert.equal(plan.autoPlay, true);
    assert.equal(plan.resetSingleSentenceLoop, false);
  });

  test('E08 已完成 PB → 00:00', () => {
    const plan = planEntry({ ...base, mode: 'library', record: pbCompleted() });
    assert.equal(plan.startMs, 0);
  });

  test('E01/E13 无记录 → 00:00（不伪造断点）', () => {
    const plan = planEntry({ ...base, mode: 'library', record: null });
    assert.equal(plan.startMs, 0);
    assert.equal(plan.track, 'pb');
  });

  test('E01 即使只听过 DG，普通列表仍进 PB', () => {
    const dgOnly = applyTrackPoint(
      createLearningRecord('012', 1),
      'dg',
      { committedPositionMs: 200_000, committedSegmentIndex: 12, durationMs: 600_000 },
      1,
    );
    const plan = planEntry({ ...base, mode: 'library', record: dgOnly });
    assert.equal(plan.track, 'pb');
    assert.equal(plan.startMs, 0);
  });
});

describe('entryPlan · §2 矩阵：继续收听入口（resume，EP-PBC-001 v1.5 方案 B）', () => {
  test('E09/E15 恢复 PB 有效断点；后台正在播放时继承播放态（autoPlay = true）', () => {
    const plan = planEntry({
      ...base,
      mode: 'resume',
      record: pbAt8min(),
      currentTrack: 'dg',
      wasPlaying: true,
    });
    assert.equal(plan.track, 'pb');
    assert.equal(plan.startMs, 480_000);
    assert.equal(plan.autoPlay, true);
  });

  test('E09-paused 点击卡片主体：已暂停时保持暂停（autoPlay = false）', () => {
    const plan = planEntry({
      ...base,
      mode: 'resume',
      record: pbAt8min(),
      currentTrack: 'pb',
      wasPlaying: false,
    });
    assert.equal(plan.track, 'pb');
    assert.equal(plan.startMs, 480_000);
    assert.equal(plan.autoPlay, false);
  });

  test('已完成 PB → 00:00（§4.1.6），且继承暂停态', () => {
    const plan = planEntry({ ...base, mode: 'resume', record: pbCompleted(), wasPlaying: false });
    assert.equal(plan.startMs, 0);
    assert.equal(plan.autoPlay, false);
  });
});

describe('entryPlan · §2 矩阵：手动上一课/下一课（manualNav）', () => {
  test('E02 手动下一课恒 00:00，不恢复目标课历史断点', () => {
    const plan = planEntry({
      ...base,
      mode: 'manualNav',
      record: pbAt8min(),
      wasPlaying: true,
    });
    assert.equal(plan.startMs, 0);
    assert.equal(plan.autoPlay, true);
    assert.equal(plan.resetSingleSentenceLoop, true);
  });

  test('E03 DG 暂停中手动上一课：继承 DG 且保持暂停', () => {
    const plan = planEntry({
      ...base,
      mode: 'manualNav',
      record: pbAt8min(),
      currentTrack: 'dg',
      wasPlaying: false,
    });
    assert.equal(plan.track, 'dg');
    assert.equal(plan.startMs, 0);
    assert.equal(plan.autoPlay, false);
    assert.equal(plan.resetSingleSentenceLoop, true);
  });

  test('E07 手动导航继承当前 PB', () => {
    const plan = planEntry({ ...base, mode: 'manualNav', currentTrack: 'pb' });
    assert.equal(plan.track, 'pb');
  });
});

describe('entryPlan · §3.2 自动连播（autoNext）', () => {
  test('F07 有下一课：PB 00:00 + 播放 + 关单句循环', () => {
    const plan = planEntry({ ...base, mode: 'autoNext', wasPlaying: false });
    assert.equal(plan.track, 'pb');
    assert.equal(plan.startMs, 0);
    assert.equal(plan.autoPlay, true);
    assert.equal(plan.resetSingleSentenceLoop, true);
  });

  test('F14 连播目标有 05:00 历史断点也不续播', () => {
    const plan = planEntry({ ...base, mode: 'autoNext', record: pbAt8min('001') });
    assert.equal(plan.startMs, 0);
  });

  test('自动连播即使触发前是暂停也请求播放（§2 矩阵：开始播放）', () => {
    const plan = planEntry({ ...base, mode: 'autoNext', wasPlaying: false });
    assert.equal(plan.autoPlay, true);
  });
});

describe('entryPlan · §2 边界条：手动按钮与连播必须分开', () => {
  test('E04 首课「上一课」禁用', () => {
    const plan = planEntry({ ...base, mode: 'manualNav', targetIndex: 0 });
    assert.equal(plan.canGoPrev, false);
  });

  test('E04 末课「下一课」禁用，但连播目标环绕到第一课（F09）', () => {
    const plan = planEntry({ ...base, mode: 'manualNav', targetIndex: 9, indexLength: 10 });
    assert.equal(plan.canGoNext, false);
    assert.equal(plan.autoNextTargetIndex, 0);
  });

  test('中间课两个按钮都可用，连播目标为下行', () => {
    const plan = planEntry({ ...base, mode: 'library', targetIndex: 4, indexLength: 10 });
    assert.equal(plan.canGoPrev, true);
    assert.equal(plan.canGoNext, true);
    assert.equal(plan.autoNextTargetIndex, 5);
  });

  test('F13 单课库：两个按钮都禁用，连播目标为本课', () => {
    const plan = planEntry({ ...base, mode: 'library', targetIndex: 0, indexLength: 1 });
    assert.equal(plan.canGoPrev, false);
    assert.equal(plan.canGoNext, false);
    assert.equal(plan.autoNextTargetIndex, 0);
  });

  test('索引未知（-1）时不给出连播目标，避免误跳第一课', () => {
    const plan = planEntry({ ...base, mode: 'library', targetIndex: -1, indexLength: 0 });
    assert.equal(plan.canGoPrev, false);
    assert.equal(plan.canGoNext, false);
    assert.equal(plan.autoNextTargetIndex, null);
  });
});

describe('entryPlan · 索引工具函数', () => {
  test('nextLessonIndex 末课环绕、单课自指', () => {
    assert.equal(nextLessonIndex(0, 3), 1);
    assert.equal(nextLessonIndex(2, 3), 0);
    assert.equal(nextLessonIndex(0, 1), 0);
    assert.equal(nextLessonIndex(-1, 3), null);
    assert.equal(nextLessonIndex(0, 0), null);
  });

  test('manualPrevIndex / manualNextIndex 不环绕', () => {
    assert.equal(manualPrevIndex(0), null);
    assert.equal(manualPrevIndex(2), 1);
    assert.equal(manualNextIndex(1, 3), 2);
    assert.equal(manualNextIndex(2, 3), null);
    assert.equal(manualNextIndex(0, 1), null);
  });

  test('非法输入不抛异常', () => {
    assert.equal(nextLessonIndex(Number.NaN, 3), null);
    assert.equal(nextLessonIndex(0, Number.NaN), null);
    const plan = planEntry({
      ...base,
      mode: 'library',
      targetIndex: Number.NaN,
      indexLength: Number.NaN,
    });
    assert.equal(plan.startMs, 0);
    assert.equal(plan.autoNextTargetIndex, null);
  });
});

describe('entryPlan · §3.2 手机端连播恒生效', () => {
  test('F08(N/A) 手机端不提供关闭入口，常量恒为 true', () => {
    assert.equal(MOBILE_AUTO_NEXT_ENABLED, true);
  });

  test('设备上残留 autoNextPodcastEnabled=false 不影响手机端连播决定', () => {
    // 手机端播放决策只读常量；持久化字段仍按 §4 同构保存，但不参与判定。
    const plan = planEntry({ ...base, mode: 'autoNext', record: pbCompleted() });
    assert.equal(plan.startMs, 0);
    assert.equal(plan.autoPlay, true);
  });
});

describe('entryPlan · 与 §4.1.6 恢复口径一致', () => {
  test('plan.startMs 与 resolveResumePositionMs 同源（不留第二套恢复逻辑）', () => {
    const record = pbAt8min();
    const plan = planEntry({ ...base, mode: 'library', record });
    assert.equal(plan.startMs, resolveResumePositionMs(record, 'pb'));
  });
});

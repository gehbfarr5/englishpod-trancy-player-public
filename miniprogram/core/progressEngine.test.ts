/**
 * `core/progressEngine.ts` 纯函数单测。
 *
 * 运行：`npm test`（底层为 `tsx --test`）。
 * 覆盖：各筛选计数、完成度计数、继续收听选择（含空数据边界）、卡片状态派生。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  countByFilter,
  deriveCardStatus,
  filterLessonIds,
  hasLessonStarted,
  isLessonCompleted,
  pickContinueLesson,
  progressPctOf,
  resolveContinueToggleAction,
} from './progressEngine';
import { LessonProgressRecord, ProgressMap, ProgressState } from './types';

/** 构建一条结构完整的进度记录（只覆盖关心字段）。 */
function rec(partial: Partial<LessonProgressRecord>): LessonProgressRecord {
  return {
    isCompleted: false,
    hasStarted: false,
    progressPct: 0,
    lastTrack: 'pb',
    pbPosSec: 0,
    pbSegIdx: 0,
    pbDurSec: 0,
    dgPosSec: 0,
    dgSegIdx: 0,
    dgDurSec: 0,
    updatedAtMs: 0,
    ...partial,
  };
}

const LESSON_IDS = ['0001', '0002', '0003', '0004'];

/** 一组混合记录：0001 完成、0002 进行中、0003 全新、0004 进度达标（未显式标记）。 */
function mixedRecords(): ProgressMap {
  return {
    '0001': rec({ isCompleted: true, hasStarted: true, progressPct: 100, updatedAtMs: 10 }),
    '0002': rec({ hasStarted: true, progressPct: 40, pbSegIdx: 5, updatedAtMs: 30 }),
    '0003': rec({ updatedAtMs: 0 }),
    '0004': rec({ hasStarted: true, progressPct: 96, updatedAtMs: 20 }),
  };
}

describe('isLessonCompleted / hasLessonStarted / progressPctOf', () => {
  test('缺记录一律视为未完成、未开始、进度 0', () => {
    assert.equal(isLessonCompleted(undefined), false);
    assert.equal(isLessonCompleted(null), false);
    assert.equal(hasLessonStarted(undefined), false);
    assert.equal(progressPctOf(undefined), 0);
  });

  test('显式 isCompleted 即完成', () => {
    assert.equal(isLessonCompleted(rec({ isCompleted: true })), true);
  });

  test('progressPct >= 95 视为完成（与 ProgressState 口径一致）', () => {
    assert.equal(isLessonCompleted(rec({ progressPct: 95 })), true);
    assert.equal(isLessonCompleted(rec({ progressPct: 94 })), false);
  });

  test('已开始但 0% 不算 New（hasLessonStarted 为真）', () => {
    assert.equal(hasLessonStarted(rec({ hasStarted: true, progressPct: 0 })), true);
    assert.equal(hasLessonStarted(rec({ hasStarted: false, progressPct: 0 })), false);
  });

  test('非法/越界进度被规整到 0..100', () => {
    assert.equal(progressPctOf(rec({ progressPct: Number.NaN })), 0);
    assert.equal(progressPctOf(rec({ progressPct: -5 })), 0);
    assert.equal(progressPctOf(rec({ progressPct: 150 })), 100);
  });
});

describe('countByFilter', () => {
  test('混合记录的计数正确', () => {
    const counts = countByFilter(mixedRecords(), LESSON_IDS);
    assert.deepEqual(counts, { all: 4, inProgress: 1, completed: 2 });
  });

  test('空数据：全部为 0', () => {
    assert.deepEqual(countByFilter({}, LESSON_IDS), { all: 4, inProgress: 0, completed: 0 });
  });

  test('记录里存在但不在课程列表中的课程不计入', () => {
    const records = mixedRecords();
    records['9999'] = rec({ isCompleted: true, progressPct: 100 });
    const counts = countByFilter(records, LESSON_IDS);
    assert.equal(counts.completed, 2);
    assert.equal(counts.all, 4);
  });
});

describe('filterLessonIds', () => {
  test('all 保持原顺序', () => {
    assert.deepEqual(filterLessonIds(mixedRecords(), LESSON_IDS, 'all'), LESSON_IDS);
  });

  test('completed 仅返回已完成（含进度达标）', () => {
    assert.deepEqual(filterLessonIds(mixedRecords(), LESSON_IDS, 'completed'), ['0001', '0004']);
  });

  test('in_progress 仅返回已开始且未达标', () => {
    assert.deepEqual(filterLessonIds(mixedRecords(), LESSON_IDS, 'in_progress'), ['0002']);
  });

  test('空记录：completed / in_progress 均为空数组', () => {
    assert.deepEqual(filterLessonIds({}, LESSON_IDS, 'completed'), []);
    assert.deepEqual(filterLessonIds({}, LESSON_IDS, 'in_progress'), []);
  });
});

describe('countByFilter · 完成度口径回归（分子分母同源）', () => {
  test('库内 3 课完成 + 库外 2 课完成 → completed 只按课程库范围统计，且 <= all', () => {
    // 课程库只有 30 课（lessonIds 长度 30）；本地进度里还残留 2 条库外记录
    // （例如用户此前体验过全量课程，而 MVP 只加载 1–30）。
    const lessonIds = Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(4, '0'));

    const records: ProgressMap = {
      '0001': rec({ isCompleted: true, hasStarted: true, progressPct: 100 }),
      '0002': rec({ isCompleted: true, hasStarted: true, progressPct: 100 }),
      '0003': rec({ isCompleted: true, hasStarted: true, progressPct: 100 }),
      // 库外记录（不在 lessonIds 中）
      '0121': rec({ isCompleted: true, hasStarted: true, progressPct: 100 }),
      '0200': rec({ isCompleted: true, hasStarted: true, progressPct: 100 }),
    };

    const counts = countByFilter(records, lessonIds);
    assert.equal(counts.all, 30);
    assert.equal(counts.completed, 3, 'Header 分子必须只数课程库范围内的完成数');
    assert.ok(counts.completed <= counts.all, '完成数不可能超过总课数');
  });
});

describe('pickContinueLesson', () => {
  test('无任何记录 → null', () => {
    assert.equal(pickContinueLesson({}, ''), null);
    assert.equal(pickContinueLesson({}, undefined), null);
  });

  test('优先选择 lastPlayedLessonId 对应的课程', () => {
    const info = pickContinueLesson(mixedRecords(), '0001');
    assert.ok(info);
    assert.equal(info.lessonId, '0001');
    assert.equal(info.progressPct, 100);
    assert.equal(info.progressState, ProgressState.Done);
    assert.equal(info.badge, 'LESSON COMPLETED');
  });

  test('lastPlayedLessonId 无效时回退到最近更新（updatedAtMs 最大）', () => {
    const info = pickContinueLesson(mixedRecords(), '');
    assert.ok(info);
    assert.equal(info.lessonId, '0002');
    assert.equal(info.badge, 'CONTINUE LISTENING');
    assert.equal(info.progressState, ProgressState.Resume);
    assert.equal(info.currentSegmentIndex, 5);
  });

  test('lastPlayedLessonId 不在记录中时同样回退到最近更新', () => {
    const info = pickContinueLesson(mixedRecords(), '7777');
    assert.ok(info);
    assert.equal(info.lessonId, '0002');
  });

  test('已完成但进度归零 → REPLAYING LESSON / ReplayFromStart', () => {
    const records: ProgressMap = {
      '0001': rec({ isCompleted: true, hasStarted: true, progressPct: 0 }),
    };
    const info = pickContinueLesson(records, '0001');
    assert.ok(info);
    assert.equal(info.badge, 'REPLAYING LESSON');
    assert.equal(info.progressState, ProgressState.ReplayFromStart);
  });

  test('isCompleted 但 hasStarted=false 且 0% → 按规则 1 归为 New（沿用 ProgressState 口径）', () => {
    const records: ProgressMap = { '0001': rec({ isCompleted: true, progressPct: 0 }) };
    const info = pickContinueLesson(records, '0001');
    assert.ok(info);
    assert.equal(info.progressState, ProgressState.New);
  });

  test('实时句文本经由 resolver 注入', () => {
    const info = pickContinueLesson(mixedRecords(), '0002', {
      resolveSentenceText: (lessonId, segIdx) => `${lessonId}#${segIdx}`,
    });
    assert.ok(info);
    assert.equal(info.sentenceText, '0002#5');
  });

  test('无 resolver 时句文本为空串', () => {
    const info = pickContinueLesson(mixedRecords(), '0002');
    assert.ok(info);
    assert.equal(info.sentenceText, '');
  });
});

describe('deriveCardStatus', () => {
  test('全新 → New', () => {
    const s = deriveCardStatus(undefined);
    assert.equal(s.statusLabel, 'New');
    assert.equal(s.barValue, 0);
    assert.equal(s.highlight, false);
  });

  test('进行中 → Resume N%', () => {
    const s = deriveCardStatus(rec({ hasStarted: true, progressPct: 40 }));
    assert.equal(s.statusLabel, 'Resume 40%');
    assert.equal(s.barValue, 0.4);
    assert.equal(s.highlight, true);
  });

  test('已开始但 0% → Resume 0%', () => {
    assert.equal(deriveCardStatus(rec({ hasStarted: true, progressPct: 0 })).statusLabel, 'Resume 0%');
  });

  test('完成且进度达标 → Done 100%（进度条拉满）', () => {
    const s = deriveCardStatus(rec({ isCompleted: true, progressPct: 100 }));
    assert.equal(s.statusLabel, 'Done 100%');
    assert.equal(s.barValue, 1);
    assert.equal(s.isDone, true);
  });

  test('完成但停在中间 → Replay N%', () => {
    assert.equal(
      deriveCardStatus(rec({ isCompleted: true, progressPct: 50 })).statusLabel,
      'Replay 50%',
    );
  });

  test('完成但归零 → Replay 0%', () => {
    assert.equal(
      deriveCardStatus(rec({ isCompleted: true, progressPct: 0 })).statusLabel,
      'Replay 0%',
    );
  });
});

describe('resolveContinueToggleAction', () => {
  test('冷启动：恢复旧进度但本进程未加载音频源 → 导航进播放器，而非就地 play', () => {
    assert.equal(
      resolveContinueToggleAction({
        targetLessonId: '0002',
        sessionLessonId: '0002',
        isPlaying: false,
        positionSec: 42.5,
        srcLoadedInProcess: false,
      }),
      'navigate',
    );
  });

  test('热态播放中：本进程已加载源且会话匹配 → 就地切换（暂停）', () => {
    assert.equal(
      resolveContinueToggleAction({
        targetLessonId: '0002',
        sessionLessonId: '0002',
        isPlaying: true,
        positionSec: 42.5,
        srcLoadedInProcess: true,
      }),
      'toggle',
    );
  });

  test('热态暂停中：已加载源且 positionSec > 0 → 就地切换（恢复播放）', () => {
    assert.equal(
      resolveContinueToggleAction({
        targetLessonId: '0002',
        sessionLessonId: '0002',
        isPlaying: false,
        positionSec: 42.5,
        srcLoadedInProcess: true,
      }),
      'toggle',
    );
  });

  test('会话课程与卡片目标不一致（含已完成课程换目标）→ 导航', () => {
    assert.equal(
      resolveContinueToggleAction({
        targetLessonId: '0005',
        sessionLessonId: '0002',
        isPlaying: false,
        positionSec: 42.5,
        srcLoadedInProcess: true,
      }),
      'navigate',
    );
  });

  test('无目标课程（空课程库/无记录）→ 不做任何动作', () => {
    assert.equal(
      resolveContinueToggleAction({
        targetLessonId: '',
        sessionLessonId: '0002',
        isPlaying: true,
        positionSec: 42.5,
        srcLoadedInProcess: true,
      }),
      'none',
    );
  });
});

/**
 * `services/progressJournal.ts` 单测 —— EP-PBC-001 §4.1 端到端行为。
 *
 * 本文件的核心是「重进丢进度」的回归锚点：
 *   退出微信（进程被杀）→ 重进 → 打开原课程 → 必须按已提交断点恢复，而不是 0。
 * 通过「同一份底层存储 + 全新 journal/store 实例」模拟进程重启。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { LearningStore } from '../adapters/wechat/learningStore';
import { ProgressJournal } from './progressJournal';
import { createMemoryKeyValue } from '../test-support/memoryKeyValue';

/** 造一个可控时钟。 */
function createClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** 建一套「一次进程生命周期」的 journal + store（共享底层 kv）。 */
function bootProcess(
  kv: ReturnType<typeof createMemoryKeyValue>,
  clock: ReturnType<typeof createClock>,
  holds: string[] = [],
) {
  const store = new LearningStore(kv);
  const journal = new ProgressJournal({
    store,
    now: clock.now,
    onHold: (event) => holds.push(event.reason),
  });
  return { store, journal, holds };
}

describe('progressJournal · 回归：退出微信重进打开原课程', () => {
  test('杀进程前听过的 8:00 必须被新进程恢复，而不是 0', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();

    // ---- 进程 A：正常收听到 8:00（每 3s 周期提交） ----
    const procA = bootProcess(kv, clock);
    procA.journal.setLastOpenedLesson('0001');
    for (let sec = 3; sec <= 480; sec += 3) {
      clock.advance(3000);
      const result = procA.journal.commit({
        lessonId: '0001',
        track: 'pb',
        positionMs: sec * 1000,
        segmentIndex: Math.floor(sec / 12),
        durationMs: 900_000,
        reason: 'periodic',
      });
      assert.equal(result.committed, true, `${sec}s 的周期提交必须落盘`);
    }

    // ---- 用户退出微信：模块状态全部丢失，只有存储留下 ----
    clock.advance(60_000);

    // ---- 进程 B：重进，打开原课程 ----
    const procB = bootProcess(kv, clock);
    assert.equal(procB.journal.lastOpenedLessonId(), '0001', '锚点应恢复');
    assert.equal(
      procB.journal.resolveResumeMs('0001', 'pb'),
      480_000,
      '打开原课程必须从 8:00 恢复，不能是 0（0.3.5 的回归点）',
    );

    // 载入完成时播放器位置是 0（BAM 尚未 seek 到位）→ 不得覆盖历史断点
    procB.journal.beginLoad('0001', 'pb');
    procB.journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 0,
      segmentIndex: 0,
      durationMs: 900_000,
      reason: 'pause',
    });
    procB.journal.endLoad('0001', 'pb');
    assert.equal(procB.journal.resolveResumeMs('0001', 'pb'), 480_000, '加载期的 0 不得落盘');
  });

  test('恢复 seek 失败后从 0 起播：断点仍保持，直到真实推进越过原断点', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const procA = bootProcess(kv, clock);
    procA.journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 480_000,
      segmentIndex: 40,
      durationMs: 900_000,
      reason: 'pause',
    });

    const procB = bootProcess(kv, clock, []);
    // 新进程按断点发起恢复 seek：锚点 = 480s
    procB.journal.beginLoad('0001', 'pb');
    procB.journal.endLoad('0001', 'pb');
    procB.journal.setPlayheadAnchor('0001', 'pb', 480_000);

    const held = procB.journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 4_000,
      segmentIndex: 1,
      durationMs: 900_000,
      reason: 'periodic',
    });
    assert.equal(held.committed, false);
    assert.equal(held.failureReason, 'resume-seek-missed', 'seek 被丢掉的特征就是媒体远落后于锚点');
    assert.equal(procB.journal.resolveResumeMs('0001', 'pb'), 480_000);
  });

  test('手动切课停在 00:00、未播放即离开：断点保持（锚点为 0 也不写）', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const { journal } = bootProcess(kv, clock);
    journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 480_000,
      segmentIndex: 40,
      durationMs: 900_000,
      reason: 'pause',
    });

    journal.beginLoad('0001', 'pb');
    journal.setPlayheadAnchor('0001', 'pb', 0);
    journal.endLoad('0001', 'pb');
    const result = journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 0,
      segmentIndex: 0,
      durationMs: 900_000,
      reason: 'lessonSwitch',
    });
    assert.equal(result.committed, false);
    assert.equal(journal.resolveResumeMs('0001', 'pb'), 480_000);
  });

  test('同样从 00:00 起，但真实播放推进到 5s：断点被更新（§4.1.3）', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const { journal } = bootProcess(kv, clock);
    journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 480_000,
      segmentIndex: 40,
      durationMs: 900_000,
      reason: 'pause',
    });

    journal.beginLoad('0001', 'pb');
    journal.setPlayheadAnchor('0001', 'pb', 0);
    journal.endLoad('0001', 'pb');
    const result = journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 5_000,
      segmentIndex: 1,
      durationMs: 900_000,
      reason: 'periodic',
    });
    assert.equal(result.committed, true);
    assert.equal(journal.resolveResumeMs('0001', 'pb'), 5_000);
  });
});

describe('progressJournal · §4.1.2 / §2.1 只打开不播放', () => {
  test('手动切到新课不播放：新课无断点，源课断点原样保留，锚点已更新', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const { journal } = bootProcess(kv, clock);

    journal.setLastOpenedLesson('0012');
    journal.commit({
      lessonId: '0012',
      track: 'pb',
      positionMs: 525_000,
      segmentIndex: 44,
      durationMs: 900_000,
      reason: 'pause',
    });

    // 手动导航到 0025 的 DG，未播放即退出
    journal.setLastOpenedLesson('0025');
    journal.commit({
      lessonId: '0025',
      track: 'dg',
      positionMs: 0,
      segmentIndex: 0,
      durationMs: 60_000,
      reason: 'lessonSwitch',
    });

    assert.equal(journal.lastOpenedLessonId(), '0025', '锚点指向最后打开的课');
    assert.equal(journal.resolveResumeMs('0012', 'pb'), 525_000, '源课断点不得被清');
    assert.equal(journal.resolveResumeMs('0025', 'pb'), 0, '新课无有效 PB 断点 → 00:00');
  });

  test('目标课历史 PB 8:00 → 手动进入显示 00:00 → 不播放退出 → 下次仍从 8:00（E06）', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const { journal } = bootProcess(kv, clock);

    journal.commit({
      lessonId: '0040',
      track: 'pb',
      positionMs: 480_000,
      segmentIndex: 40,
      durationMs: 900_000,
      reason: 'pause',
    });
    journal.setLastOpenedLesson('0040');

    // 手动上一课/下一课进入本课被定位到 00:00，未播放即离开
    journal.beginLoad('0040', 'pb');
    journal.commit({
      lessonId: '0040',
      track: 'pb',
      positionMs: 0,
      segmentIndex: 0,
      durationMs: 900_000,
      reason: 'lessonSwitch',
    });
    journal.endLoad('0040', 'pb');

    assert.equal(journal.resolveResumeMs('0040', 'pb'), 480_000);
  });
});

describe('progressJournal · §4.1.7 锚点与播放解耦', () => {
  test('只设锚点不产生任何断点记录', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const { journal } = bootProcess(kv, clock);

    journal.setLastOpenedLesson('0003');
    assert.equal(journal.lastOpenedLessonId(), '0003');
    assert.equal(journal.readRecord('0003').podcast, null, '锚点不得伪造断点');
    assert.deepEqual(journal.progressViews(), {}, '锚点不产生课程库进度');
  });

  test('空课程 ID 不改锚点', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const { journal } = bootProcess(kv, clock);
    journal.setLastOpenedLesson('0003');
    journal.setLastOpenedLesson('');
    assert.equal(journal.lastOpenedLessonId(), '0003');
  });
});

describe('progressJournal · §4.1.1 加载锁与周期提交', () => {
  test('加载锁期内提交被拒并上报白名单诊断事件', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const holds: string[] = [];
    const { journal } = bootProcess(kv, clock, holds);

    journal.beginLoad('0001', 'pb');
    const result = journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 120_000,
      segmentIndex: 10,
      durationMs: 900_000,
      reason: 'periodic',
    });
    assert.equal(result.committed, false);
    assert.equal(result.failureReason, 'load-lock');
    assert.deepEqual(holds, ['load-lock']);

    journal.endLoad('0001', 'pb');
    const after = journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 120_000,
      segmentIndex: 10,
      durationMs: 900_000,
      reason: 'periodic',
    });
    assert.equal(after.committed, true);
  });

  test('canplay 永不到达：10s 后加载锁自动过期，断点仍能落盘', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const { journal } = bootProcess(kv, clock);

    journal.beginLoad('0001', 'pb');
    clock.advance(9_000);
    assert.equal(journal.isLoadLocked('0001', 'pb'), true);

    clock.advance(1_500);
    assert.equal(journal.isLoadLocked('0001', 'pb'), false, '兜底超时必须放行');
    assert.equal(
      journal.commit({
        lessonId: '0001',
        track: 'pb',
        positionMs: 60_000,
        segmentIndex: 5,
        durationMs: 900_000,
        reason: 'periodic',
      }).committed,
      true,
    );
  });

  test('后台侧不知道句索引时沿用已提交值，不把 0 句写回去', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const { journal } = bootProcess(kv, clock);

    journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 60_000,
      segmentIndex: 17,
      durationMs: 900_000,
      reason: 'periodic',
    });
    journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 63_000,
      durationMs: 900_000,
      reason: 'periodic',
    });
    assert.equal(journal.readRecord('0001').podcast?.committedSegmentIndex, 17);
  });
});

describe('progressJournal · §4.1.4 旧写入不得覆盖新写入', () => {
  test('两个进程并存（旧实例迟到写）时，旧版本被拒', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const procA = bootProcess(kv, clock); // 旧进程：拿到的还是 8:00
    procA.journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 480_000,
      segmentIndex: 40,
      durationMs: 900_000,
      reason: 'pause',
    });

    const procB = bootProcess(kv, clock);
    procB.journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 500_000,
      segmentIndex: 42,
      durationMs: 900_000,
      reason: 'periodic',
    });

    // 旧实例的迟到写入（它内存里 rev 仍较旧）
    const late = procA.journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 481_000,
      segmentIndex: 40,
      durationMs: 900_000,
      reason: 'periodic',
    });
    assert.equal(late.committed, false);
    assert.equal(late.failureReason, 'stale-revision');
    assert.equal(procB.journal.resolveResumeMs('0001', 'pb'), 500_000);
  });
});

describe('progressJournal · §4.1.5 完成与位置解耦', () => {
  test('置完成后位置不受影响；后续位置写入也不清完成标记', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const { journal } = bootProcess(kv, clock);

    journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 860_000,
      segmentIndex: 70,
      durationMs: 900_000,
      reason: 'naturalEnd',
    });
    assert.equal(journal.commitCompleted('0001'), true);
    assert.equal(journal.readRecord('0001').podcast?.committedPositionMs, 860_000, '完成不改位置');

    journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 0,
      segmentIndex: 0,
      durationMs: 900_000,
      reason: 'userSeek',
    });
    assert.equal(journal.readRecord('0001').lessonCompleted, true, '重听不得撤销完成');
    assert.equal(journal.resolveResumeMs('0001', 'pb'), 0, '已完成 PB 从 00:00 进入');
  });

  test('DG 自然结束不置完成（由调用方保证只对 PB 调用）', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const { journal } = bootProcess(kv, clock);
    journal.commit({
      lessonId: '0001',
      track: 'dg',
      positionMs: 60_000,
      segmentIndex: 20,
      durationMs: 60_000,
      reason: 'naturalEnd',
    });
    assert.equal(journal.readRecord('0001').lessonCompleted, false);
    assert.equal(journal.resolveResumeMs('0001', 'dg'), 0, '停在末尾的 DG 下次从 00:00');
  });
});

describe('progressJournal · §4.1.8 写入失败', () => {
  test('写入失败如实返回，内存可用；恢复后可 flush 重试成功', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const { journal } = bootProcess(kv, clock);

    kv.failWrites = true;
    const result = journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 200_000,
      segmentIndex: 16,
      durationMs: 900_000,
      reason: 'pause',
    });
    assert.equal(result.committed, false);
    assert.equal(result.failureReason, 'write-failed');
    assert.equal(journal.readRecord('0001').podcast?.committedPositionMs, 200_000, '内存仍可用');

    kv.failWrites = false;
    assert.equal(journal.flush(), true, 'flush 必须重试未落盘的提交');
    const fresh = bootProcess(kv, clock);
    assert.equal(fresh.journal.resolveResumeMs('0001', 'pb'), 200_000);
  });
});

describe('progressJournal · 课程库投影', () => {
  test('只投影有断点或已完成的课；完成态不出现在进行中', () => {
    const kv = createMemoryKeyValue();
    const clock = createClock();
    const { journal } = bootProcess(kv, clock);

    journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 120_000,
      segmentIndex: 10,
      durationMs: 900_000,
      reason: 'pause',
    });
    journal.commitCompleted('0002');

    const views = journal.progressViews();
    assert.deepEqual(Object.keys(views).sort(), ['0001', '0002']);
    assert.equal(views['0001'].isCompleted, false);
    assert.equal(views['0002'].isCompleted, true);
  });
});

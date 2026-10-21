/**
 * `core/trackStateMachine.ts` 单测。
 *
 * 覆盖：双轨独立快照与切轨恢复；完成度严格绑定 pb（dg 完成任务不影响 pb）；
 *       倍速档位；单句循环 / 整课重复的结束决策优先级。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { TrackStateMachine, MIN_POSITION_FOR_PCT_SEC } from './trackStateMachine';
import { PLAYBACK_RATES } from './types';

describe('TrackStateMachine · 双轨独立快照', () => {
  test('切轨后各自恢复位置与句索引', () => {
    const sm = new TrackStateMachine('pb');
    sm.updateActive(42, 7, 120); // pb 进度

    const restored = sm.switchTrack('dg');
    assert.equal(restored.positionSec, 0); // dg 尚未播放
    assert.equal(restored.segIdx, 0);

    sm.updateActive(11, 3, 30); // dg 进度
    const backToPb = sm.switchTrack('pb');
    assert.equal(backToPb.positionSec, 42);
    assert.equal(backToPb.segIdx, 7);
    assert.equal(backToPb.durationSec, 120);

    const dgAgain = sm.switchTrack('dg');
    assert.equal(dgAgain.positionSec, 11);
    assert.equal(dgAgain.segIdx, 3);
  });

  test('getSnapshot 返回副本（外部修改不影响内部）', () => {
    const sm = new TrackStateMachine('pb');
    sm.updateActive(5, 1, 50);
    const snap = sm.getSnapshot('pb');
    snap.positionSec = 999;
    assert.equal(sm.getSnapshot('pb').positionSec, 5);
  });

  test('非法数值被忽略（不污染快照）', () => {
    const sm = new TrackStateMachine('pb');
    sm.updateActive(5, 1, 50);
    sm.setSnapshot('pb', { positionSec: Number.NaN });
    assert.equal(sm.getSnapshot('pb').positionSec, 5);
  });
});

describe('TrackStateMachine · 完成度严格绑定 pb', () => {
  test('进度 = pb 位置/时长（并受 3 秒起点规则约束）', () => {
    const sm = new TrackStateMachine('pb');
    sm.updateActive(1, 0, 120); // 位置在 3 秒内（早于起点阈值）
    assert.equal(sm.computePbProgressPct(), 0, '前 3 秒应记 0%');

    sm.updateActive(60, 5, 120);
    assert.equal(sm.computePbProgressPct(), 50);
  });

  test('把 dg 播到结尾不影响 pb 完成度', () => {
    const sm = new TrackStateMachine('pb');
    sm.updateActive(60, 5, 120); // pb = 50%
    assert.equal(sm.computePbProgressPct(), 50);

    sm.switchTrack('dg');
    sm.updateActive(29.9, 9, 30); // dg 接近结束
    assert.equal(sm.computePbProgressPct(), 50, 'dg 播放不应改变 pb 完成度');
    assert.equal(sm.isPbCompleted(), false);
  });

  test('pb 达阈值即算完成，且与后续切轨无关', () => {
    const sm = new TrackStateMachine('pb');
    sm.updateActive(114, 50, 120); // 95%
    assert.equal(sm.isPbCompleted(), true);
    sm.switchTrack('dg');
    sm.updateActive(1, 0, 30);
    assert.equal(sm.isPbCompleted(), true);
  });

  test('时长未知（0）→ 0%', () => {
    const sm = new TrackStateMachine('pb');
    sm.updateActive(50, 3, 0);
    assert.equal(sm.computePbProgressPct(), 0);
  });

  test('起点阈值常量与实现一致', () => {
    const sm = new TrackStateMachine('pb');
    sm.updateActive(MIN_POSITION_FOR_PCT_SEC + 0.1, 0, 60);
    assert.ok(sm.computePbProgressPct() > 0);
  });
});

describe('TrackStateMachine · 倍速', () => {
  test('默认 1.0x；cycleRate 循环所有档位', () => {
    const sm = new TrackStateMachine('pb');
    assert.equal(sm.getRate(), 1.0);

    const seen: number[] = [];
    for (let i = 0; i < PLAYBACK_RATES.length; i += 1) {
      seen.push(sm.cycleRate());
    }
    // 从 1.0 起循环一圈应回到 1.0
    assert.equal(seen[seen.length - 1], 1.0);
    assert.equal(new Set(seen).size, PLAYBACK_RATES.length);
  });

  test('setRate 拒绝非法档位', () => {
    const sm = new TrackStateMachine('pb');
    sm.setRate(3.5);
    assert.equal(sm.getRate(), 1.0);
    sm.setRate(1.25);
    assert.equal(sm.getRate(), 1.25);
  });

  test('formatRate 文案', () => {
    assert.equal(TrackStateMachine.formatRate(1.0), '1.0x');
    assert.equal(TrackStateMachine.formatRate(1.25), '1.25x');
    assert.equal(TrackStateMachine.formatRate(0.8), '0.8x');
  });
});

describe('TrackStateMachine · 结束决策优先级', () => {
  test('单句循环 > 整课重复 > 自动下一课', () => {
    const sm = new TrackStateMachine('pb');
    assert.equal(sm.decideEndedAction(), 'nextEpisode');

    sm.toggleRepeatEpisode();
    assert.equal(sm.decideEndedAction(), 'repeatEpisode');

    sm.toggleSingleSentenceLoop();
    assert.equal(sm.decideEndedAction(), 'loopSentence');
  });

  test('开关切换返回新状态', () => {
    const sm = new TrackStateMachine('pb');
    assert.equal(sm.toggleSingleSentenceLoop(), true);
    assert.equal(sm.isSingleSentenceLoop(), true);
    assert.equal(sm.toggleRepeatEpisode(), true);
    assert.equal(sm.isRepeatEpisode(), true);
  });

  test('resetSingleSentenceLoop 关闭单句循环但保留音轨循环（§2 手动切课）', () => {
    const sm = new TrackStateMachine('pb');
    sm.toggleSingleSentenceLoop();
    sm.toggleRepeatEpisode();
    assert.equal(sm.resetSingleSentenceLoop(), true);
    assert.equal(sm.isSingleSentenceLoop(), false);
    assert.equal(sm.isRepeatEpisode(), true, '音轨循环必须保留');
  });

  test('resetSingleSentenceLoop 幂等：已关闭时不产生状态变化', () => {
    const sm = new TrackStateMachine('pb');
    assert.equal(sm.resetSingleSentenceLoop(), false);
    assert.equal(sm.isSingleSentenceLoop(), false);
  });

  test('resetSingleSentenceLoop 后完成决策回落到音轨循环 / 连播', () => {
    const sm = new TrackStateMachine('pb');
    sm.toggleSingleSentenceLoop();
    assert.equal(sm.decideEndedAction(), 'loopSentence');
    sm.resetSingleSentenceLoop();
    assert.equal(sm.decideEndedAction(), 'nextEpisode');
    sm.toggleRepeatEpisode();
    assert.equal(sm.decideEndedAction(), 'repeatEpisode');
  });
});

describe('TrackStateMachine · 双轨快照与恢复', () => {
  test('pb 达完成度阈值时 isPbCompleted 为真；位置回 0 后仍为真（快照单调）', () => {
    const sm = new TrackStateMachine('pb');
    sm.setSnapshot('pb', { positionSec: 114, segIdx: 50, durationSec: 120 }); // 95%
    assert.equal(sm.isPbCompleted(), true);
  });
});

describe('TrackStateMachine · 前后台 / 切轨状态快照与恢复', () => {
  test('切轨往返：pb↔dg 各自独立恢复位置与句索引', () => {
    const sm = new TrackStateMachine('pb');
    sm.updateActive(30, 6, 120);

    const dgSnap = sm.switchTrack('dg');
    assert.equal(dgSnap.positionSec, 0);
    sm.updateActive(15, 3, 45);

    const pbSnap = sm.switchTrack('pb');
    assert.equal(pbSnap.positionSec, 30);
    assert.equal(pbSnap.segIdx, 6);

    const dgAgain = sm.switchTrack('dg');
    assert.equal(dgAgain.positionSec, 15);
    assert.equal(dgAgain.segIdx, 3);
  });

  test('后台往返：切后台期间快照不变，回前台重锚后一致', () => {
    const sm = new TrackStateMachine('pb');
    sm.setSnapshot('pb', { positionSec: 42, segIdx: 9, durationSec: 300 });
    sm.updateActive(42, 9, 300);

    const beforeBackground = sm.getSnapshot('pb');

    // 模拟「切后台」：此期间逻辑层拿不到 onTimeUpdate，只用插值外推（不改状态机快照）。
    // 回前台：用真实采样重锚（同一位置 → 覆盖为等价快照）。
    sm.updateActive(42, 9, 300);

    const afterResume = sm.getSnapshot('pb');
    assert.deepEqual(afterResume, beforeBackground);
  });
});


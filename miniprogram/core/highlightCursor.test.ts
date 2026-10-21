/**
 * `core/highlightCursor.ts` 单测（句级）。
 *
 * 关键断言：
 *   1. 「索引不变则不产出更新」——同一时间点连续调用只产出一次；
 *   2. 稳定播放 30 秒的产出次数 = 句切换次数（句级，实测远低于词级）；
 *   3. payload 仅含 `{ activeSegIdx }` 且序列化后 < 100B。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { HighlightCursorTracker } from './highlightCursor';
import { Segment } from './types';

/** 构造 `count` 个等长片段（每个 `segSeconds` 秒），首尾相接。 */
function buildSegments(count: number, segSeconds: number): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = i * segSeconds;
    out.push({
      id: i,
      speaker: 'M',
      text: `line ${i}`,
      isSection: false,
      inDialogueBlock: false,
      start,
      end: start + segSeconds,
      words: [],
    });
  }
  return out;
}

describe('HighlightCursorTracker · 句级变化才产出', () => {
  test('空片段集：首个游标为 -1，之后不再产出', () => {
    const t = new HighlightCursorTracker([]);
    assert.deepEqual(t.update(2), { segIdx: -1 });
    assert.equal(t.update(2), null);
    assert.equal(t.update(3), null);
  });

  test('首次 update 必产出', () => {
    const t = new HighlightCursorTracker(buildSegments(3, 5));
    const first = t.update(0);
    assert.ok(first);
    assert.equal(first.segIdx, 0);
  });

  test('同一时间点连续多次调用 → 只产出一次', () => {
    const t = new HighlightCursorTracker(buildSegments(3, 5));
    assert.ok(t.update(6));
    assert.equal(t.update(6), null);
    assert.equal(t.update(6), null);
  });

  test('同一句内时间推进 → 不产出（句下标未变）', () => {
    const t = new HighlightCursorTracker(buildSegments(3, 5));
    t.update(6); // seg 1
    assert.equal(t.update(6.5), null);
    assert.equal(t.update(7.0), null);
    assert.equal(t.update(9.9), null);
  });

  test('跨句 → 产出一次且 segIdx 前进', () => {
    const t = new HighlightCursorTracker(buildSegments(3, 5));
    t.update(6);
    const next = t.update(10); // seg 2
    assert.ok(next);
    assert.equal(next.segIdx, 2);
  });

  test('setSegments 后下一次 update 重新产出', () => {
    const t = new HighlightCursorTracker(buildSegments(3, 5));
    t.update(6);
    t.setSegments(buildSegments(3, 5));
    assert.ok(t.update(6));
  });
});

describe('HighlightCursorTracker · setData 预算（句级）', () => {
  test('稳定播放 30 秒：每秒变化 ≤ 4 次，且 payload < 100B', () => {
    const seconds = 30;
    // 6 个 5 秒片段：30s 内共 6 次切换 → 0.20 次/秒
    const tracker = new HighlightCursorTracker(buildSegments(6, 5));

    const TICK_MS = 250;
    const ticks = (seconds * 1000) / TICK_MS;

    let emissions = 0;
    let maxPayloadBytes = 0;
    for (let i = 0; i <= ticks; i += 1) {
      const positionSec = (i * TICK_MS) / 1000;
      const changed = tracker.update(positionSec);
      if (changed) {
        emissions += 1;
        maxPayloadBytes = Math.max(
          maxPayloadBytes,
          Buffer.byteLength(JSON.stringify(tracker.toPayload()), 'utf8'),
        );
      }
    }

    const perSecond = emissions / seconds;
    console.log(
      `[highlightCursor budget] ${seconds}s 内产出变化 ${emissions} 次 → ${perSecond.toFixed(2)} 次/秒；` +
        `payload 最大 ${maxPayloadBytes}B`,
    );

    assert.ok(perSecond <= 4, `每秒变化应 ≤ 4，实际 ${perSecond}`);
    assert.ok(maxPayloadBytes < 100, `payload 应 < 100B，实际 ${maxPayloadBytes}B`);
  });

  test('payload 字段仅为 activeSegIdx', () => {
    const tracker = new HighlightCursorTracker(buildSegments(3, 5));
    tracker.update(6);
    assert.deepEqual(Object.keys(tracker.toPayload()), ['activeSegIdx']);
  });
});

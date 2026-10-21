/**
 * `core/timelineEngine.ts` 单测。
 *
 * 覆盖：句/词二分的全部边界（句首、句尾、边界重合、越界）、空数据、
 *       插值外推与漂移校正。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  clampPosition,
  correctSample,
  extrapolatePosition,
  findSegmentIndexAt,
  hasReachedEnd,
} from './timelineEngine';
import { Segment, WordTiming } from './types';

function w(word: string, start: number, end: number): WordTiming {
  return { word, start, end };
}

function seg(id: number, start: number, end: number, words: WordTiming[] = []): Segment {
  return { id, speaker: 'A', text: '', isSection: false, inDialogueBlock: false, start, end, words };
}

/** 两句相邻、且上一句 end == 下一句 start（2.0）的典型场景。 */
const SEGMENTS: Segment[] = [
  seg(0, 0, 2, [w('Hello', 0, 0.5), w('world', 0.5, 1.2), w('again', 1.2, 2)]),
  seg(1, 2, 4, [w('Second', 2, 2.6), w('line', 2.6, 4)]),
  seg(2, 4, 6, [w('Third', 4, 6)]),
];

describe('findSegmentIndexAt', () => {
  test('空数组 → -1', () => {
    assert.equal(findSegmentIndexAt([], 1), -1);
  });

  test('t 早于首片段 → 0（钳到首片段）', () => {
    assert.equal(findSegmentIndexAt(SEGMENTS, -5), 0);
  });

  test('恰好在片段时间内 → 该片段', () => {
    assert.equal(findSegmentIndexAt(SEGMENTS, 1.0), 0);
    assert.equal(findSegmentIndexAt(SEGMENTS, 3.0), 1);
  });

  test('句首边界：t == 片段 start → 该片段', () => {
    assert.equal(findSegmentIndexAt(SEGMENTS, 2.0), 1);
    assert.equal(findSegmentIndexAt(SEGMENTS, 4.0), 2);
  });

  test('跨句瞬间（上一句 end == 下一句 start）→ 归后一句', () => {
    // 2.0 同时是 seg0.end 与 seg1.start
    assert.equal(findSegmentIndexAt(SEGMENTS, 2.0), 1);
  });

  test('句尾边界：t == 片段 end（非下一句 start 之前）→ 该片段', () => {
    assert.equal(findSegmentIndexAt(SEGMENTS, 1.999), 0);
  });

  test('越界：t 远大于最后一句 → 最后下标', () => {
    assert.equal(findSegmentIndexAt(SEGMENTS, 999), 2);
  });
});

describe('hasReachedEnd', () => {
  test('空数组 → false', () => {
    assert.equal(hasReachedEnd([], 999), false);
  });

  test('到达/越过最后一句 end → true', () => {
    assert.equal(hasReachedEnd(SEGMENTS, 6), true);
    assert.equal(hasReachedEnd(SEGMENTS, 10), true);
  });

  test('未到最后 end → false', () => {
    assert.equal(hasReachedEnd(SEGMENTS, 5.0), false);
  });
});

describe('clampPosition', () => {
  test('时长已知：钳到 [0, duration]', () => {
    assert.equal(clampPosition(-3, 60), 0);
    assert.equal(clampPosition(120, 60), 60);
    assert.equal(clampPosition(30, 60), 30);
  });

  test('时长未知：仅保证 >= 0', () => {
    assert.equal(clampPosition(-3, 0), 0);
    assert.equal(clampPosition(42, 0), 42);
  });
});

describe('extrapolatePosition（本地时钟插值外推）', () => {
  test('暂停态：原样返回采样位置', () => {
    assert.equal(
      extrapolatePosition({ positionSec: 5, atMs: 1000 }, 9999, {
        rate: 1,
        durationSec: 100,
        playing: false,
      }),
      5,
    );
  });

  test('播放态：position + Δt * rate', () => {
    // 经过 2 秒、1.5x 速率 → 前进 3 秒
    assert.equal(
      extrapolatePosition({ positionSec: 10, atMs: 1000 }, 3000, {
        rate: 1.5,
        durationSec: 100,
        playing: true,
      }),
      13,
    );
  });

  test('播放态：按 duration 钳制', () => {
    assert.equal(
      extrapolatePosition({ positionSec: 9, atMs: 0 }, 10000, {
        rate: 1,
        durationSec: 10,
        playing: true,
      }),
      10,
    );
  });

  test('长时间无 onTimeUpdate 后仍能推进（插值核心价值）', () => {
    const pos = extrapolatePosition({ positionSec: 0, atMs: 0 }, 30000, {
      rate: 1,
      durationSec: 100,
      playing: true,
    });
    assert.equal(pos, 30);
  });
});

describe('correctSample（回调校正漂移）', () => {
  test('漂移很小 → 保留原采样（避免外推抖动）', () => {
    const s = { positionSec: 10, atMs: 1000 };
    const corrected = correctSample(s, 10.05, 2000, 100);
    assert.equal(corrected, s);
  });

  test('漂移较大 → 以真实值重建采样点', () => {
    const corrected = correctSample({ positionSec: 10, atMs: 1000 }, 12.5, 2000, 100);
    assert.equal(corrected.positionSec, 12.5);
    assert.equal(corrected.atMs, 2000);
  });
});

describe('correctSample · 换源瞬间的假 0 会污染采样点（切轨闪屏的成因）', () => {
  /**
   * 0.3.9 真机反馈：PB ↔ DG 切换时进度条先归零、台本跳回首句，然后「闪」回目标位置。
   *
   * 链路：`load()` 后平台先上报 `currentTime=0` → `correctSample()` 判定漂移过大
   * （从 320s 到 0），以真实值重建采样点 → `tick()` 算出 pos≈0 → 进度条归零 +
   * `tracker.update(0)` 把高亮拉回首句。本用例把这一步钉死：不能靠「容差」兜住，
   * 必须由 `core/switchSettle.ts` 的镇定窗口在更上游拦住。
   */
  test('目标 320s 时上报 0：采样点被重建为 0（所以必须镇定）', () => {
    const corrected = correctSample({ positionSec: 320, atMs: 1_000 }, 0, 1_300, 900);
    assert.equal(corrected.positionSec, 0, '漂移远超容差 → 采样点被拉到 0');
    assert.equal(corrected.atMs, 1_300);
  });

  test('若镇定期不采纳该回调，采样点保持目标位置（渲染不闪）', () => {
    const held = { positionSec: 320, atMs: 1_000 };
    // 镇定期间 onTimeUpdate 直接 return，不调用 correctSample：
    const rendered = extrapolatePosition(held, 1_300, {
      rate: 1,
      durationSec: 900,
      playing: true,
    });
    assert.equal(rendered, 320.3, '渲染位置仍停在目标附近，不会回落到 0');
  });
});

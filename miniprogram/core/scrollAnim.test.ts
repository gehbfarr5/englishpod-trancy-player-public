/**
 * `core/scrollAnim.ts` 单测（E：精确时长 + 精确缓动的帧序列）。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildScrollFrames,
  clampScrollTop,
  computePodcastScrollTarget,
  easeSmoothOut,
  lerp,
  scrollTopSequence,
} from './scrollAnim';

describe('easeSmoothOut · cubic-bezier(0.22, 1, 0.36, 1)', () => {
  test('端点：x=0 → 0，x=1 → 1', () => {
    assert.equal(easeSmoothOut(0), 0);
    assert.equal(easeSmoothOut(1), 1);
  });

  test('单调不减；越界输入被夹到 [0,1]', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i += 1) {
      const y = easeSmoothOut(i / 100);
      assert.ok(y >= prev, `x=${i / 100} 处应单调不减`);
      assert.ok(y >= 0 && y <= 1, 'y 必须在 [0,1]');
      prev = y;
    }
    assert.equal(easeSmoothOut(-5), 0);
    assert.equal(easeSmoothOut(5), 1);
    assert.equal(easeSmoothOut(Number.NaN), 0);
  });

  test('前段快、后段慢（y(0.5) 明显 > 0.5）', () => {
    assert.ok(easeSmoothOut(0.5) > 0.5, `y(0.5)=${easeSmoothOut(0.5)} 应 > 0.5`);
    assert.ok(easeSmoothOut(0.25) > 0.5, '前 1/4 时间应已推进过半');
  });
});

describe('lerp / clampScrollTop', () => {
  test('lerp 端点与中点', () => {
    assert.equal(lerp(100, 200, 0), 100);
    assert.equal(lerp(100, 200, 1), 200);
    assert.equal(lerp(100, 200, 0.5), 150);
    assert.equal(lerp(100, 200, -1), 100);
    assert.equal(lerp(100, 200, 2), 200);
  });

  test('clampScrollTop 夹到 [0, max]', () => {
    assert.equal(clampScrollTop(-10, 500), 0);
    assert.equal(clampScrollTop(600, 500), 500);
    assert.equal(clampScrollTop(250, 500), 250);
    assert.equal(clampScrollTop(250, 0), 0);
  });
});

describe('buildScrollFrames · 帧序列', () => {
  test('380ms / 16ms → 24 帧（E：自动滚动）', () => {
    const frames = buildScrollFrames(0, 1000, 380, 16);
    assert.equal(frames.length, 24, `期望 24 帧，实际 ${frames.length}`);
  });

  test('320ms / 16ms → 20 帧（E：跳句）', () => {
    const frames = buildScrollFrames(0, 1000, 320, 16);
    assert.equal(frames.length, 20, `期望 20 帧，实际 ${frames.length}`);
  });

  test('末帧恒等于目标；整体单调不减', () => {
    const frames = buildScrollFrames(120, 880, 380, 16);
    assert.equal(frames[frames.length - 1], 880);
    let prev = 120;
    for (const f of frames) {
      assert.ok(f >= prev, `应从 ${prev} 单调不减，实际 ${f}`);
      prev = f;
    }
  });

  test('反向滚动（目标 < 起点）同样单调不回弹', () => {
    const frames = buildScrollFrames(900, 100, 380, 16);
    assert.equal(frames[frames.length - 1], 100);
    let prev = 900;
    for (const f of frames) {
      assert.ok(f <= prev, `应单调不增，实际 ${f}`);
      prev = f;
    }
  });

  test('前段推进更快（与 easeSmoothOut 一致）', () => {
    const frames = buildScrollFrames(0, 1000, 380, 16);
    // 第 6 帧（约 96ms，时间进度 25%）按缓动应已过半
    assert.ok(frames[5] > 500, `第 6 帧应 > 500，实际 ${frames[5]}`);
  });

  test('时长为 0 → 单帧直达目标', () => {
    assert.deepEqual(buildScrollFrames(0, 420, 0, 16), [420]);
  });

  test('非法输入被兜底（frameMs<1、NaN）', () => {
    const frames = buildScrollFrames(Number.NaN, Number.NaN, 32, 0);
    assert.equal(frames.length, 2, '32ms / 兜底 16ms → 2 帧');
    assert.equal(frames[frames.length - 1], 0);
  });
});

describe('computePodcastScrollTarget · Apple Podcasts 防抖与停靠引擎', () => {
  test('首句（index=0）对齐顶部（alignRatio=0.0，targetScrollTop=0）', () => {
    const res = computePodcastScrollTarget({
      targetIndex: 0,
      totalCount: 30,
      itemTop: 0,
      itemHeight: 40,
      viewportHeight: 600,
      totalContentHeight: 2000,
      currentScrollTop: 0,
    });
    assert.equal(res.alignRatio, 0.0);
    assert.equal(res.targetScrollTop, 0);
    assert.equal(res.shouldScroll, false);
  });

  test('常规播放句收敛于视口 32% 黄金阅读线', () => {
    const res = computePodcastScrollTarget({
      targetIndex: 5,
      totalCount: 30,
      itemTop: 500,
      itemHeight: 40,
      viewportHeight: 600,
      totalContentHeight: 2000,
      currentScrollTop: 0,
    });
    assert.equal(res.alignRatio, 0.32);
    // targetScrollTop = 500 - 600 * 0.32 = 500 - 192 = 308
    assert.equal(res.targetScrollTop, 308);
    assert.equal(res.shouldScroll, true);
  });

  test('末句触底且可见时：休眠滚动，0 像素位移，0 弹簧拉扯（Natural Bottom Docking）', () => {
    const totalContentHeight = 2000;
    const viewportHeight = 600;
    const maxScrollTop = 1400; // 2000 - 600
    const res = computePodcastScrollTarget({
      targetIndex: 29,
      totalCount: 30,
      itemTop: 1950,
      itemHeight: 40,
      viewportHeight,
      totalContentHeight,
      currentScrollTop: maxScrollTop, // 已在底端
    });
    assert.equal(res.isDockedAtBottom, true);
    assert.equal(res.shouldScroll, false);
    assert.equal(res.targetScrollTop, maxScrollTop);
  });

  test('倒数前三句动态滑行钳制（0.50 / 0.65 / 0.85）不越界', () => {
    const resMinus3 = computePodcastScrollTarget({
      targetIndex: 27,
      totalCount: 30,
      itemTop: 1800,
      itemHeight: 40,
      viewportHeight: 600,
      totalContentHeight: 2000,
      currentScrollTop: 1000,
    });
    assert.equal(resMinus3.alignRatio, 0.50);

    const resMinus2 = computePodcastScrollTarget({
      targetIndex: 28,
      totalCount: 30,
      itemTop: 1880,
      itemHeight: 40,
      viewportHeight: 600,
      totalContentHeight: 2000,
      currentScrollTop: 1000,
    });
    assert.equal(resMinus2.alignRatio, 0.65);

    const resMinus1 = computePodcastScrollTarget({
      targetIndex: 29,
      totalCount: 30,
      itemTop: 1940,
      itemHeight: 40,
      viewportHeight: 600,
      totalContentHeight: 2000,
      currentScrollTop: 1000,
    });
    assert.equal(resMinus1.alignRatio, 0.85);
    assert.ok(resMinus1.targetScrollTop <= 1400, '不得超过 maxScrollTop 1400');
  });
});



describe('scrollTopSequence · scroll-top 同值不下发导致找回失效的兜底', () => {
  test('目标值与上次下发值不同：一步到底', () => {
    assert.deepEqual(scrollTopSequence(320, 640), [640]);
  });

  test('目标值与上次下发值相同（手动滑走后找回当前句）：必须先错 1px 再回位', () => {
    // 场景：自动跟随把列表停在 640；用户手动滑走；点「找回」时当前句没变，
    // 计算出的目标仍是 640。scroll-view 的 scroll-top 属性没变 → 不重排 → 静默失效。
    assert.deepEqual(scrollTopSequence(640, 640), [639, 640]);
  });

  test('目标为 0 且上次也是 0：仍然要产生一次属性变化', () => {
    const seq = scrollTopSequence(0, 0);
    assert.equal(seq.length, 2);
    assert.notEqual(seq[0], seq[1]);
    assert.equal(seq[seq.length - 1], 0);
    assert.ok(seq[0] >= 0, '不得出现负偏移');
  });

  test('非整数/非法输入按整数处理，不会产生负值', () => {
    assert.deepEqual(scrollTopSequence(12.4, 12.6), [13]);
    assert.deepEqual(scrollTopSequence(Number.NaN, 0), [1, 0]);
    // 负的下发值只可能来自历史脏值：目标是 0 就已经发生了变化，直接回 0。
    assert.deepEqual(scrollTopSequence(-50, 0), [0]);
  });
});

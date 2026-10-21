/**
 * `core/transcriptAnchor.ts` 单测（BUG-004：换轨首帧重锚估算）。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  alignRatioFor,
  averageRowHeight,
  DEFAULT_ROW_HEIGHT_PX,
  estimateAnchorScrollTop,
  estimateContentHeight,
  estimateRowTop,
  fitRowHeightModel,
  REANCHOR_RETRY_DELAYS_MS,
  type RowSample,
} from './transcriptAnchor';

describe('alignRatioFor · 黄金阅读线', () => {
  test('首句对齐顶部；末尾三句依次下沉；其余 32%', () => {
    assert.equal(alignRatioFor(0, 100), 0);
    assert.equal(alignRatioFor(50, 100), 0.32);
    assert.equal(alignRatioFor(97, 100), 0.5);
    assert.equal(alignRatioFor(98, 100), 0.65);
    assert.equal(alignRatioFor(99, 100), 0.85);
  });

  test('越界下标被夹到合法区间', () => {
    assert.equal(alignRatioFor(-5, 10), 0);
    assert.equal(alignRatioFor(999, 10), 0.85);
  });
});

describe('estimateRowTop · 行顶部偏移估算', () => {
  const samples: RowSample[] = [
    { segIdx: 10, itemTop: 400, itemHeight: 34 },
    { segIdx: 20, itemTop: 800, itemHeight: 34 },
  ];

  test('精确命中：直接用样本值', () => {
    const got = estimateRowTop({ targetIndex: 20, totalCount: 60, viewportHeight: 600, samples });
    assert.deepEqual(got, { itemTop: 800, source: 'exact' });
  });

  test('两侧夹逼：按句下标线性插值', () => {
    const got = estimateRowTop({ targetIndex: 15, totalCount: 60, viewportHeight: 600, samples });
    assert.equal(got?.source, 'interpolated');
    assert.equal(got?.itemTop, 600);
  });

  test('单侧外推：用平均行高向后推', () => {
    const got = estimateRowTop({ targetIndex: 30, totalCount: 60, viewportHeight: 600, samples });
    assert.equal(got?.source, 'extrapolated');
    assert.equal(got?.itemTop, 800 + 10 * DEFAULT_ROW_HEIGHT_PX);
  });

  test('单侧外推向前：不会推出负数', () => {
    const got = estimateRowTop({
      targetIndex: 0,
      totalCount: 60,
      viewportHeight: 600,
      samples: [{ segIdx: 1, itemTop: 10, itemHeight: 34 }],
    });
    assert.equal(got?.source, 'extrapolated');
    assert.equal(got?.itemTop, 0);
  });

  test('无样本：按内容高度 × 播放进度做比例兜底', () => {
    const got = estimateRowTop({
      targetIndex: 30,
      totalCount: 60,
      viewportHeight: 600,
      contentHeight: 3000,
      progressRatio: 0.5,
    });
    assert.equal(got?.source, 'proportional');
    assert.equal(got?.itemTop, 1500);
  });

  test('无样本且无进度：返回 null（页面保留当前偏移，不下发 0）', () => {
    const got = estimateRowTop({ targetIndex: 30, totalCount: 60, viewportHeight: 600 });
    assert.equal(got, null);
  });

  test('非法样本被忽略', () => {
    const got = estimateRowTop({
      targetIndex: 5,
      totalCount: 60,
      viewportHeight: 600,
      samples: [
        { segIdx: -1, itemTop: 100, itemHeight: 34 },
        { segIdx: 5, itemTop: Number.NaN, itemHeight: 34 },
      ],
    });
    assert.equal(got, null);
  });
});

describe('estimateAnchorScrollTop · 首帧 scroll-top', () => {
  test('32% 黄金线：目标行顶部减去 32% 视口高', () => {
    const got = estimateAnchorScrollTop({
      targetIndex: 20,
      totalCount: 60,
      viewportHeight: 600,
      contentHeight: 3000,
      samples: [{ segIdx: 20, itemTop: 1200, itemHeight: 34 }],
    });
    assert.equal(got?.source, 'exact');
    assert.equal(got?.scrollTop, 1200 - 600 * 0.32);
  });

  test('末句下沉 85%：靠近底部时被 maxTop 夹住', () => {
    const got = estimateAnchorScrollTop({
      targetIndex: 59,
      totalCount: 60,
      viewportHeight: 600,
      contentHeight: 3000,
      samples: [{ segIdx: 59, itemTop: 2950, itemHeight: 34 }],
    });
    assert.equal(got?.scrollTop, 3000 - 600);
  });

  test('首句：偏移为 0（不是「未下发」，是明确对齐顶部）', () => {
    const got = estimateAnchorScrollTop({
      targetIndex: 0,
      totalCount: 60,
      viewportHeight: 600,
      contentHeight: 3000,
      samples: [{ segIdx: 0, itemTop: 20, itemHeight: 34 }],
    });
    assert.equal(got?.scrollTop, 20);
  });

  test('视口高度未知 → null（调用方应保留当前偏移，禁止下发 0）', () => {
    const got = estimateAnchorScrollTop({
      targetIndex: 20,
      totalCount: 60,
      viewportHeight: 0,
      samples: [{ segIdx: 20, itemTop: 1200, itemHeight: 34 }],
    });
    assert.equal(got, null);
  });

  test('内容高度缺失时不做上界夹取', () => {
    const got = estimateAnchorScrollTop({
      targetIndex: 20,
      totalCount: 60,
      viewportHeight: 600,
      samples: [{ segIdx: 20, itemTop: 1200, itemHeight: 34 }],
    });
    assert.equal(got?.scrollTop, 1008);
  });
});

describe('averageRowHeight · 行高统计', () => {
  test('无样本返回 null；有样本取平均', () => {
    assert.equal(averageRowHeight([]), null);
    assert.equal(
      averageRowHeight([
        { segIdx: 0, itemTop: 0, itemHeight: 30 },
        { segIdx: 1, itemTop: 30, itemHeight: 40 },
      ]),
      35,
    );
  });
});

describe('fitRowHeightModel · 字数 → 行高', () => {
  test('两点精确拟合：h = a + b·chars', () => {
    const model = fitRowHeightModel([
      { chars: 50, height: 40 },
      { chars: 100, height: 70 },
    ]);
    assert.ok(model);
    assert.equal(model!.samples, 2);
    assert.ok(Math.abs(model!.b - 0.6) < 1e-9);
    assert.ok(Math.abs(model!.a - 10) < 1e-9);
  });

  test('只有一条样本：按 a=0 单点比例', () => {
    const model = fitRowHeightModel([{ chars: 40, height: 80 }]);
    assert.ok(model);
    assert.equal(model!.samples, 1);
    assert.equal(model!.b, 2);
  });

  test('字数相同（无法定斜率）时不除零', () => {
    const model = fitRowHeightModel([
      { chars: 40, height: 60 },
      { chars: 40, height: 80 },
    ]);
    assert.ok(model);
    assert.ok(Number.isFinite(model!.b));
    assert.equal(model!.b, 70 / 40);
  });

  test('无有效样本返回 null', () => {
    assert.equal(fitRowHeightModel([]), null);
    assert.equal(fitRowHeightModel([{ chars: 0, height: 0 }]), null);
  });
});

describe('estimateContentHeight · 未显示过的音轨的内容总高', () => {
  test('用模型逐行预测求和（台词换行越多越高）', () => {
    const model = fitRowHeightModel([
      { chars: 50, height: 40 },
      { chars: 100, height: 70 },
    ]);
    const height = estimateContentHeight({ rowChars: [50, 100], model });
    assert.equal(height, 110);
  });

  test('无模型时退化为「行数 × 兜底行高」', () => {
    assert.equal(
      estimateContentHeight({ rowChars: [10, 10, 10], fallbackRowHeight: 30 }),
      90,
    );
    assert.equal(estimateContentHeight({ rowChars: [] }), 0);
  });
});

describe('REANCHOR_RETRY_DELAYS_MS · 重试阶梯', () => {
  test('首次立即尝试，之后单调递增，总窗口约 0.7s', () => {
    assert.equal(REANCHOR_RETRY_DELAYS_MS[0], 0);
    for (let i = 1; i < REANCHOR_RETRY_DELAYS_MS.length; i += 1) {
      assert.ok(REANCHOR_RETRY_DELAYS_MS[i] > REANCHOR_RETRY_DELAYS_MS[i - 1]);
    }
    const total = REANCHOR_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    assert.ok(total >= 600 && total <= 1200, `重试窗口应在一秒内，实际 ${total}ms`);
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SETTLE_TOLERANCE_MS,
  SWITCH_SETTLE_MS,
  decideSettle,
} from './switchSettle';

const NOW = 1_700_000_000_000;

function at(overrides: Partial<Parameters<typeof decideSettle>[0]> = {}) {
  return decideSettle({
    targetMs: 320_000,
    untilMs: NOW + SWITCH_SETTLE_MS,
    nowMs: NOW,
    liveMs: 320_000,
    ...overrides,
  });
}

describe('switchSettle · 切轨后的显示镇定（0.3.9 闪屏）', () => {
  test('换源瞬间上报 0：继续渲染目标位置（不闪回 00:00）', () => {
    assert.equal(at({ liveMs: 0 }), 'hold');
    assert.equal(at({ liveMs: 300 }), 'hold');
  });

  test('实测追上目标（容差内）：交还实测值', () => {
    assert.equal(at({ liveMs: 320_000 }), 'release');
    assert.equal(at({ liveMs: 319_500 }), 'release');
    // 边界：正好差一个容差仍算追上
    assert.equal(at({ liveMs: 320_000 - SETTLE_TOLERANCE_MS }), 'release');
    // 边界外 1ms：判定为假值，继续镇定
    assert.equal(at({ liveMs: 320_000 - SETTLE_TOLERANCE_MS - 1 }), 'hold');
  });

  test('正常播放推进（live 超过目标）：立刻交还实测值', () => {
    assert.equal(at({ liveMs: 325_000 }), 'release');
  });

  test('窗口过期：seek 真失败时接受平台值，不永久显示错位置', () => {
    assert.equal(
      at({ liveMs: 0, nowMs: NOW + SWITCH_SETTLE_MS }),
      'release',
    );
    assert.equal(
      at({ liveMs: 0, nowMs: NOW + SWITCH_SETTLE_MS + 1 }),
      'release',
    );
  });

  test('目标为 00:00 的音轨不进镇定（本来就从 0 开始）', () => {
    assert.equal(at({ targetMs: 0, liveMs: 0 }), 'release');
    assert.equal(at({ targetMs: 0, liveMs: 5_000 }), 'release');
    assert.equal(at({ targetMs: -1, liveMs: 0 }), 'release');
  });

  test('没有窗口（untilMs=0）或非法输入按实测走', () => {
    assert.equal(at({ untilMs: 0, liveMs: 0 }), 'release');
    assert.equal(at({ targetMs: Number.NaN, liveMs: 0 }), 'release');
    assert.equal(at({ nowMs: Number.NaN, liveMs: 0 }), 'release');
  });

  test('实测值为 NaN：保留目标位置，由窗口过期兜底', () => {
    assert.equal(at({ liveMs: Number.NaN }), 'hold');
  });

  test('自定义容差生效（词条例句这类近距离跳转不受影响）', () => {
    assert.equal(at({ liveMs: 315_000, toleranceMs: 1_000 }), 'hold');
    assert.equal(at({ liveMs: 315_000, toleranceMs: 6_000 }), 'release');
    // 非法容差回落默认值
    assert.equal(at({ liveMs: 315_000, toleranceMs: Array(0).length - 1 }), 'hold');
  });
});

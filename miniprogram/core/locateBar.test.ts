/**
 * `core/locateBar.ts` 单测（A-4 的 8% 容差判定）。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ACTIVE_SEGMENT_VIEWPORT_TOLERANCE,
  isWithinFocusViewport,
  isWithinViewport,
} from './locateBar';

describe('isWithinViewport（A-4：±8% 容差）', () => {
  test('容差常量 = 0.08（照抄 iOS）', () => {
    assert.equal(ACTIVE_SEGMENT_VIEWPORT_TOLERANCE, 0.08);
  });

  test('完全在视口内 → true', () => {
    assert.equal(isWithinViewport(0.2, 0.8), true);
    assert.equal(isWithinViewport(0, 1), true);
  });

  test('恰好落在容差边界 → true', () => {
    assert.equal(isWithinViewport(-0.08, 1.08), true);
  });

  test('超出容差（顶部滚过头 / 底部未进）→ false', () => {
    assert.equal(isWithinViewport(-0.09, 0.5), false, '顶部超出 8%');
    assert.equal(isWithinViewport(0.5, 1.09), false, '底部超出 8%');
  });

  test('非有限值 → false', () => {
    assert.equal(isWithinViewport(Number.NaN, 0.5), false);
    assert.equal(isWithinViewport(0.1, Number.POSITIVE_INFINITY), false);
  });
});

describe('isWithinFocusViewport（阅读舒适焦点区）', () => {
  test('发音句在舒适阅读区（例如 0.32 黄金线）→ true', () => {
    assert.equal(isWithinFocusViewport(0.32, 0.45), true);
    assert.equal(isWithinFocusViewport(0.04, 0.94), true);
  });

  test('滑动触及顶部边缘（<0.04）或底部坞栏（>0.94）→ false，即刻唤起找回条', () => {
    assert.equal(isWithinFocusViewport(0.03, 0.20), false);
    assert.equal(isWithinFocusViewport(0.80, 0.95), false);
    assert.equal(isWithinFocusViewport(-0.1, 0.1), false);
  });
});


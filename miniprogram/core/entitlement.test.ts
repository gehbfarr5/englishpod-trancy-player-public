/**
 * `core/entitlement.ts` 规则单测。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  filterBlocksForPreview,
  FREE_TRIAL_LESSON_COUNT,
  isLessonLocked,
  LIFETIME_PRODUCT_ID,
  LIFETIME_UNLOCK_PRICE_FEN,
  LIFETIME_UNLOCK_PRICE_YUAN,
  PREVIEW_SENTENCE_LIMIT,
} from './entitlement';
import { TranscriptBlockVM, TranscriptLineVM } from './transcriptView';

function mockLine(segIdx: number, text: string = `Line ${segIdx}`): TranscriptLineVM {
  return {
    segIdx,
    speaker: 'A',
    speakerLabel: 'ALEX',
    text,
    isSection: false,
    isHost: true,
    start: segIdx * 3,
    end: segIdx * 3 + 2.5,
    words: [{ text, isVocab: false }],
    isFirst: false,
    isLast: false,
  };
}

describe('entitlement · 常量与规格', () => {
  test('基础规格符合定价与试听规则', () => {
    assert.equal(FREE_TRIAL_LESSON_COUNT, 10);
    assert.equal(PREVIEW_SENTENCE_LIMIT, 6);
    assert.equal(LIFETIME_UNLOCK_PRICE_YUAN, '19.9');
    assert.equal(LIFETIME_UNLOCK_PRICE_FEN, 1990);
    assert.equal(LIFETIME_PRODUCT_ID, 'ep_unlock_all');
  });
});

describe('isLessonLocked · 课程解锁与锁定判定', () => {
  test('已购买 VIP：无论哪一课一律解锁', () => {
    assert.equal(isLessonLocked('0001', true), false);
    assert.equal(isLessonLocked('0010', true), false);
    assert.equal(isLessonLocked('0011', true), false);
    assert.equal(isLessonLocked('0100', true), false);
    assert.equal(isLessonLocked(335, true), false);
  });

  test('未购买 VIP：前 10 课完全免费试听，不锁定', () => {
    assert.equal(isLessonLocked('0001', false), false);
    assert.equal(isLessonLocked('1', false), false);
    assert.equal(isLessonLocked('0005', false), false);
    assert.equal(isLessonLocked('0010', false), false);
    assert.equal(isLessonLocked(10, false), false);
  });

  test('未购买 VIP：第 11 课起全部锁定', () => {
    assert.equal(isLessonLocked('0011', false), true);
    assert.equal(isLessonLocked('11', false), true);
    assert.equal(isLessonLocked('0050', false), true);
    assert.equal(isLessonLocked('0335', false), true);
    assert.equal(isLessonLocked(335, false), true);
  });

  test('非法或空编号：安全兜底不锁定', () => {
    assert.equal(isLessonLocked('', false), false);
    assert.equal(isLessonLocked(null, false), false);
    assert.equal(isLessonLocked('invalid', false), false);
    assert.equal(isLessonLocked(-1, false), false);
  });
});

describe('filterBlocksForPreview · 未解锁试听台本截断', () => {
  test('已解锁课程：不截断，原样保留全部内容', () => {
    const blocks: TranscriptBlockVM[] = [
      { kind: 'host', key: 'h0', line: mockLine(0) },
      { kind: 'host', key: 'h1', line: mockLine(1) },
      { kind: 'host', key: 'h2', line: mockLine(2) },
    ];
    const res = filterBlocksForPreview(blocks, false);
    assert.equal(res.isCapped, false);
    assert.equal(res.blocks.length, 3);
    assert.equal(res.maxAllowedSegIdx, Infinity);
  });

  test('未解锁课程：前 6 句以内的短台本全部展示且不报错', () => {
    const blocks: TranscriptBlockVM[] = [
      { kind: 'host', key: 'h0', line: mockLine(0) },
      { kind: 'host', key: 'h1', line: mockLine(1) },
      { kind: 'host', key: 'h2', line: mockLine(2) },
    ];
    const res = filterBlocksForPreview(blocks, true, 6);
    assert.equal(res.isCapped, true);
    assert.equal(res.blocks.length, 3);
    assert.equal(res.previewSentenceCount, 3);
    assert.equal(res.maxAllowedSegIdx, 2);
  });

  test('未解锁课程：超过 6 句时精确截断至第 6 句（segIdx=5）', () => {
    const blocks: TranscriptBlockVM[] = [];
    for (let i = 0; i < 20; i++) {
      blocks.push({ kind: 'host', key: `h${i}`, line: mockLine(i) });
    }
    const res = filterBlocksForPreview(blocks, true, 6);
    assert.equal(res.isCapped, true);
    assert.equal(res.blocks.length, 6);
    assert.equal(res.previewSentenceCount, 6);
    assert.equal(res.maxAllowedSegIdx, 5);
    assert.equal(res.blocks[5].kind === 'host' ? res.blocks[5].line.segIdx : -1, 5);
  });

  test('未解锁课程：跨越舞台盒子的多行台本切片', () => {
    const blocks: TranscriptBlockVM[] = [
      { kind: 'host', key: 'h0', line: mockLine(0) },
      { kind: 'host', key: 'h1', line: mockLine(1) },
      {
        kind: 'box',
        key: 'b1',
        boxGroupId: 1,
        stageKind: 'dialogue',
        badgeText: 'DIALOGUE',
        subText: 'SCENE',
        lines: [mockLine(2), mockLine(3), mockLine(4), mockLine(5), mockLine(6), mockLine(7)],
      },
      { kind: 'host', key: 'h8', line: mockLine(8) },
    ];
    // 总共 2 host + 6 box + 1 host = 9 句。截断至 6 句：
    // 应包含 2 个 host block (2句) + 1 个 box block (切片后的前4句，即 segIdx 2, 3, 4, 5)。
    const res = filterBlocksForPreview(blocks, true, 6);
    assert.equal(res.isCapped, true);
    assert.equal(res.blocks.length, 3); // 2 host + 1 box
    assert.equal(res.previewSentenceCount, 6);
    assert.equal(res.maxAllowedSegIdx, 5);

    const box = res.blocks[2];
    assert.equal(box.kind, 'box');
    if (box.kind === 'box') {
      assert.equal(box.lines.length, 4);
      assert.equal(box.lines[0].segIdx, 2);
      assert.equal(box.lines[3].segIdx, 5);
    }
  });
});

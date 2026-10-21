/**
 * `core/transcriptView.ts` 单测。
 *
 * 覆盖：舞台盒子分类（dg 整轨 / pb 的 section / dialogue block / example / 主持人）、
 *       分组边界（isFirst/isLast/boxGroupId）、词汇匹配、逐词 isVocab 标记、课内例句。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildVocabEntries,
  buildVocabMatcher,
  computeStageGroups,
  findLiveSentenceText,
  normalizeToken,
  toTranscriptBlocks,
  toTranscriptSegments,
} from './transcriptView';
import { Segment, VocabEntry } from './types';

function seg(
  id: number,
  speaker: string,
  text: string,
  opts: Partial<Segment> = {},
): Segment {
  return {
    id,
    speaker,
    text,
    isSection: false,
    inDialogueBlock: false,
    start: id,
    end: id + 1,
    words: [],
    ...opts,
  };
}

const PB: Segment[] = [
  seg(0, 'M', 'Hello learners.', { words: [{ word: 'Hello', start: 0, end: 0.5 }] }),
  seg(1, 'SECTION', 'dialogue', { isSection: true }),
  seg(2, 'A', 'I would like to order now.', {
    inDialogueBlock: true,
    words: [
      { word: 'I', start: 1, end: 1.1 },
      { word: 'order', start: 1.1, end: 1.5 },
      { word: 'now.', start: 1.5, end: 1.9 },
    ],
  }),
  seg(3, 'M', 'Interesting phrase.', { words: [{ word: 'Interesting', start: 2, end: 2.6 }] }),
  seg(4, 'Example', 'Example usage here.', { words: [{ word: 'Example', start: 3, end: 3.4 }] }),
  seg(5, 'M', 'Back to the show.'),
  seg(6, 'SECTION', 'key phrase drill', { isSection: true }),
];

describe('computeStageGroups', () => {
  test('dg 整轨一个 dialogue 盒子', () => {
    const groups = computeStageGroups([seg(0, 'A', 'hi'), seg(1, 'B', 'yo')], 'dg');
    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.kind, 'dialogue');
    assert.equal(groups[0]?.badgeText, '🎭 FULL DIALOGUE TRACK');
    assert.equal(groups[0]?.isFirstInBox, true);
    assert.equal(groups[1]?.isLastInBox, true);
    assert.equal(groups[0]?.boxGroupId, groups[1]?.boxGroupId);
  });

  test('pb：主持人旁白为 null，section/dialogue/example/phrase 分别归组', () => {
    const groups = computeStageGroups(PB, 'pb');
    assert.equal(groups[0], null);
    assert.equal(groups[1]?.kind, 'dialogue');
    assert.equal(groups[1]?.badgeText, '📌 DIALOGUE');
    assert.equal(groups[2]?.kind, 'dialogue'); // inDialogueBlock 与 section 相邻合并
    assert.equal(groups[3], null);
    assert.equal(groups[4]?.kind, 'example');
    assert.equal(groups[4]?.badgeText, '💡 EXAMPLES · IN ACTION');
    assert.equal(groups[5], null);
    // 'key phrase drill' 命中 A-13 规则 → 归为独立第三类盒子
    assert.equal(groups[6]?.kind, 'phrase');
    assert.equal(groups[6]?.badgeText, '✨ KEY PHRASE DRILL');
  });

  test('相邻同类合并为同一 boxGroupId，断开后递增', () => {
    const groups = computeStageGroups(PB, 'pb');
    assert.equal(groups[1]?.boxGroupId, groups[2]?.boxGroupId, '相邻 dialogue 合并');
    assert.notEqual(groups[4]?.boxGroupId, groups[1]?.boxGroupId, 'example 独立成盒');
    assert.notEqual(groups[6]?.boxGroupId, groups[4]?.boxGroupId, '末尾 section 独立成盒');
  });

  test('盒子首尾标记正确', () => {
    const groups = computeStageGroups(PB, 'pb');
    assert.equal(groups[1]?.isFirstInBox, true);
    assert.equal(groups[1]?.isLastInBox, false);
    assert.equal(groups[2]?.isFirstInBox, false);
    assert.equal(groups[2]?.isLastInBox, true);
  });

  test('空片段集 → 空数组', () => {
    assert.deepEqual(computeStageGroups([], 'pb'), []);
  });
});

describe('buildVocabMatcher', () => {
  const vocab: VocabEntry[] = [
    { type: 'key', word: 'order', pos: 'Noun', definition: '点菜' },
    { type: 'key', word: 'cut in line', pos: 'Phrase', definition: '插队' },
  ];

  test('hasToken 归一化匹配', () => {
    const m = buildVocabMatcher(vocab);
    assert.equal(m.hasToken(normalizeToken('Order,')), true, '命中单个词汇');
    assert.equal(m.hasToken(normalizeToken('cut in line')), true, '命中完整短语');
    assert.equal(m.hasToken(normalizeToken('banana')), false);
  });

  test('matchesText 短语边界匹配', () => {
    const m = buildVocabMatcher(vocab);
    assert.equal(m.matchesText('Please do not cut in line again.'), true);
    assert.equal(m.matchesText('This is a headline.'), false, '不应命中 headline 里的 line');
  });
});

describe('toTranscriptSegments', () => {
  test('逐词 isVocab 标记 + 舞台归属', () => {
    const matcher = buildVocabMatcher([
      { type: 'key', word: 'order', pos: 'Noun', definition: '点菜' },
    ]);
    const vm = toTranscriptSegments(PB, 'pb', matcher);
    assert.equal(vm.length, PB.length);
    // seg2 的 'order' 应标为 vocab，'I' / 'now.' 不应
    assert.equal(vm[2].words[1].isVocab, true);
    assert.equal(vm[2].words[0].isVocab, false);
    assert.equal(vm[2].words[2].isVocab, false);
    // 舞台归属透传
    assert.equal(vm[1].stage?.kind, 'dialogue');
    assert.equal(vm[0].stage, null);
  });

  test('isHost 标记主持人旁白', () => {
    const vm = toTranscriptSegments(PB, 'pb', buildVocabMatcher([]));
    assert.equal(vm[0].isHost, true); // M
    assert.equal(vm[2].isHost, false); // A（inDialogueBlock）
    assert.equal(vm[4].isHost, false); // Example
  });
});

describe('toTranscriptBlocks', () => {
  test('主持人行与舞台盒子交替成块，行下标为全局片段下标', () => {
    const blocks = toTranscriptBlocks(PB, 'pb', buildVocabMatcher([]));
    // PB: 0 host, 1-2 box(dialogue), 3 host, 4 box(example), 5 host, 6 box(dialogue)
    const kinds = blocks.map((b) => b.kind);
    assert.deepEqual(kinds, ['host', 'box', 'host', 'box', 'host', 'box']);

    const box1 = blocks[1];
    assert.equal(box1.kind, 'box');
    if (box1.kind === 'box') {
      assert.deepEqual(
        box1.lines.map((l) => l.segIdx),
        [1, 2],
      );
      assert.equal(box1.lines[0].isFirst, true);
      assert.equal(box1.lines[1].isLast, true);
      assert.equal(box1.stageKind, 'dialogue');
    }
  });

  test('盒子 key 稳定且与 boxGroupId 对应', () => {
    const blocks = toTranscriptBlocks(PB, 'pb', buildVocabMatcher([]));
    for (const b of blocks) {
      if (b.kind === 'box') {
        assert.equal(b.key, `b${b.boxGroupId}`);
        assert.ok(b.lines.length > 0);
      }
    }
  });

  test('dg 整轨为一个盒子', () => {
    const blocks = toTranscriptBlocks([seg(0, 'A', 'hi'), seg(1, 'B', 'yo')], 'dg', buildVocabMatcher([]));
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, 'box');
  });
});

describe('computeStageGroups · ✨ KEY PHRASE DRILL（A-13）', () => {
  test('section 文本匹配 Phrase 1/2/3 → 归为 phrase 盒子', () => {
    const segs: Segment[] = [
      seg(0, 'M', 'intro'),
      seg(1, 'SECTION', 'Phrase 1', { isSection: true }),
      seg(2, 'M', 'body'),
    ];
    const groups = computeStageGroups(segs, 'pb');
    assert.equal(groups[1]?.kind, 'phrase');
    assert.equal(groups[1]?.badgeText, '✨ KEY PHRASE DRILL');
    assert.equal(groups[0], null);
  });

  test('普通 DIALOGUE section 仍归为 dialogue（不受影响）', () => {
    const groups = computeStageGroups(
      [seg(1, 'SECTION', 'DIALOGUE, FIRST TIME', { isSection: true })],
      'pb',
    );
    assert.equal(groups[0]?.kind, 'dialogue');
  });

  test('section 文本含 key phrase → 归为 phrase', () => {
    const groups = computeStageGroups(
      [seg(0, 'SECTION', 'KEY PHRASE drill', { isSection: true })],
      'pb',
    );
    assert.equal(groups[0]?.kind, 'phrase');
  });
});

describe('说话人展示名（A-12，对齐 iOS `_resolveSpeakerDisplayName`）', () => {
  test('主持人开放流：M→MARCO，其余大写', () => {
    const vm = toTranscriptSegments(
      [seg(0, 'M', 'hi'), seg(1, 'E', 'yo')],
      'pb',
      buildVocabMatcher([]),
    );
    assert.equal(vm[0].speakerLabel, 'MARCO');
    assert.equal(vm[1].speakerLabel, 'ERICA');
  });

  test('舞台盒子里 M→MARCO，对白角色保持大写', () => {
    const vm = toTranscriptSegments(
      [seg(0, 'M', 'host', { inDialogueBlock: true }), seg(1, 'A', 'line', { inDialogueBlock: true })],
      'pb',
      buildVocabMatcher([]),
    );
    assert.equal(vm[0].speakerLabel, 'MARCO');
    assert.equal(vm[1].speakerLabel, 'A');
  });

  test('空说话人 → •', () => {
    const vm = toTranscriptSegments([seg(0, '', 'x')], 'pb', buildVocabMatcher([]));
    assert.equal(vm[0].speakerLabel, '•');
  });
});

describe('findLiveSentenceText（A-2 继续收听实时句）', () => {
  test('当前句非 section → 直接返回', () => {
    assert.equal(findLiveSentenceText([seg(0, 'M', 'hello there')], 0), 'hello there');
  });

  test('当前句是 section → 向后找首个非 section', () => {
    const segs = [seg(0, 'SECTION', 'DIALOGUE', { isSection: true }), seg(1, 'M', 'real line')];
    assert.equal(findLiveSentenceText(segs, 0), 'real line');
  });

  test('空文本 / 全 section → 空串（调用方回退文案）', () => {
    assert.equal(findLiveSentenceText([], 0), '');
    assert.equal(
      findLiveSentenceText([seg(0, 'SECTION', 'DIALOGUE', { isSection: true })], 0),
      '',
    );
  });
});

describe('buildVocabEntries', () => {
  test('收集课内例句并按音轨+下标定位', () => {
    const entries = buildVocabEntries(
      [{ type: 'key', word: 'order', pos: 'Noun', definition: '点菜' }],
      { dg: [], pb: PB },
    );
    assert.equal(entries.length, 1);
    assert.ok(entries[0].examples.length >= 1);
    assert.equal(entries[0].examples[0].track, 'pb');
    assert.equal(entries[0].examples[0].segIdx, 2);
  });

  test('maxExamples 上限生效', () => {
    const many: Segment[] = Array.from({ length: 10 }, (_, i) =>
      seg(i, 'M', `order number ${i}`),
    );
    const entries = buildVocabEntries(
      [{ type: 'key', word: 'order', pos: 'Noun', definition: 'x' }],
      { dg: [], pb: many },
      2,
    );
    assert.equal(entries[0].examples.length, 2);
  });

  test('无例句时为空数组', () => {
    const entries = buildVocabEntries(
      [{ type: 'key', word: 'zzz', pos: 'Noun', definition: 'x' }],
      { dg: [], pb: PB },
    );
    assert.deepEqual(entries[0].examples, []);
  });
});

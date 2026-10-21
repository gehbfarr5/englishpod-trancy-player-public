/**
 * `core/lessonModel.ts` 严格解析器单测。
 *
 * 运行：`npm test`。
 * 覆盖：双键名兼容、缺字段报错、数组/信封两种索引形态、详情解析。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LessonParseError,
  parseLessonDetail,
  parseLessonIndex,
  parseLessonIndexItem,
} from './lessonModel';

/** 一条完整的索引项（源数据形态：snake_case）。 */
const RAW_INDEX_ITEM = {
  lesson_number: 1,
  lesson_id: '0001',
  code: 'B0001',
  level: 'Elementary',
  title: 'Difficult Customer',
  dg_count: 10,
  pb_count: 103,
  vocab_count: 10,
  audio: { dg: 'audio/0001/dg.m4a', pb: 'audio/0001/pb.m4a', rv: null },
};

describe('parseLessonIndexItem', () => {
  test('解析源数据 snake_case 形态', () => {
    const item = parseLessonIndexItem(RAW_INDEX_ITEM);
    assert.equal(item.lessonNumber, 1);
    assert.equal(item.lessonId, '0001');
    assert.equal(item.code, 'B0001');
    assert.equal(item.level, 'Elementary');
    assert.equal(item.title, 'Difficult Customer');
    assert.equal(item.dgCount, 10);
    assert.equal(item.pbCount, 103);
    assert.equal(item.vocabCount, 10);
    assert.deepEqual(item.audio, { dg: 'audio/0001/dg.m4a', pb: 'audio/0001/pb.m4a', rv: null });
  });

  test('兼容别名键名（lessonNumber / LessonId）', () => {
    const item = parseLessonIndexItem({
      lessonNumber: 2,
      LessonId: '0002',
      code: 'B0002',
      audio: { dg: null, pb: null, rv: null },
    });
    assert.equal(item.lessonNumber, 2);
    assert.equal(item.lessonId, '0002');
  });

  test('缺 lesson_id / code / lesson_number 时抛 LessonParseError', () => {
    assert.throws(() => parseLessonIndexItem({ code: 'X', lesson_number: 1 }), LessonParseError);
    assert.throws(() => parseLessonIndexItem({ lesson_id: '0001', lesson_number: 1 }), LessonParseError);
    assert.throws(() => parseLessonIndexItem({ lesson_id: '0001', code: 'X' }), LessonParseError);
  });

  test('非法类型（非对象）抛错', () => {
    assert.throws(() => parseLessonIndexItem('nope'), LessonParseError);
    assert.throws(() => parseLessonIndexItem(null), LessonParseError);
  });
});

describe('parseLessonIndex', () => {
  test('解析数组形态', () => {
    const list = parseLessonIndex([RAW_INDEX_ITEM, { ...RAW_INDEX_ITEM, lesson_id: '0002' }]);
    assert.equal(list.length, 2);
    assert.equal(list[1].lessonId, '0002');
  });

  test('解析 { items: [...] } 信封形态', () => {
    const list = parseLessonIndex({ items: [RAW_INDEX_ITEM] });
    assert.equal(list.length, 1);
  });

  test('非数组/非信封抛错', () => {
    assert.throws(() => parseLessonIndex('nope'), LessonParseError);
    assert.throws(() => parseLessonIndex({}), LessonParseError);
  });

  test('错误信息携带出错下标', () => {
    assert.throws(
      () => parseLessonIndex([RAW_INDEX_ITEM, { code: 'bad' }]),
      /LessonIndex\[1\]/,
    );
  });
});

describe('parseLessonDetail', () => {
  test('解析详情（含双音轨片段与词级时间戳）', () => {
    const detail = parseLessonDetail({
      lesson_number: 1,
      LessonId: '0001',
      code: 'B0001',
      level: 'Elementary',
      title: 'Difficult Customer',
      raw_title: 'Elementary - Difficult Customer(B0001)',
      audio: { dg: 'audio/0001/dg.m4a', pb: 'audio/0001/pb.m4a' },
      vocabulary: [{ type: 'key', word: 'receipt', pos: 'Noun', definition: '收据' }],
      tracks: {
        dg: [
          {
            id: 0,
            speaker: 'A',
            text: 'Hi.',
            start: 0,
            end: 0.5,
            words: [{ word: 'Hi.', start: 0, end: 0.5 }],
          },
        ],
        pb: [],
      },
    });
    assert.equal(detail.lessonId, '0001');
    assert.equal(detail.rawTitle, 'Elementary - Difficult Customer(B0001)');
    assert.equal(detail.vocabulary[0].word, 'receipt');
    assert.equal(detail.tracks.dg.length, 1);
    assert.equal(detail.tracks.dg[0].words[0].word, 'Hi.');
    assert.deepEqual(detail.audio, { dg: 'audio/0001/dg.m4a', pb: 'audio/0001/pb.m4a', rv: null });
  });

  test('缺 tracks 抛错；tracks 内 dg/pb 缺省按空数组处理', () => {
    assert.throws(
      () => parseLessonDetail({ lesson_number: 1, LessonId: '0001', code: 'B0001' }),
      LessonParseError,
    );
    const detail = parseLessonDetail({
      lesson_number: 1,
      LessonId: '0001',
      code: 'B0001',
      tracks: {},
    });
    assert.deepEqual(detail.tracks, { dg: [], pb: [] });
  });
});

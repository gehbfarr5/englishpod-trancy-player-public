/**
 * `adapters/wechat/learningStore.ts` 单测。
 *
 * 覆盖 EP-PBC-001 §4.1.4（写入版本）/ §4.1.8（写入失败不谎报）/
 * §4.1.9（按课隔离损坏）/ §4.1.10（新命名空间、不迁移旧数据）。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  PREFERENCES_KEY,
  RECORD_KEY_PREFIX,
  RESUME_ANCHOR_KEY,
  LearningStore,
} from './learningStore';
import { applyTrackPoint, createLearningRecord } from '../../core/learningRecord';
import { createMemoryKeyValue } from '../../test-support/memoryKeyValue';

/** 旧版（0.3.5）命名空间键，必须保持原样、不被读写。 */
const LEGACY_PROGRESS_KEY = 'ep_study_progress_v1';
const LEGACY_LAST_LESSON_KEY = 'ep_last_lesson_id';

function recordAt(positionMs: number, revision = 1) {
  const base = applyTrackPoint(
    createLearningRecord('0001'),
    'pb',
    { committedPositionMs: positionMs, committedSegmentIndex: 10, durationMs: 900_000 },
    1000,
  );
  return { ...base, revision };
}

describe('LearningStore · 新命名空间与往返', () => {
  test('按课一键写入：key 为 ep_learning_v2_record_<lessonId>', () => {
    const kv = createMemoryKeyValue();
    const store = new LearningStore(kv);
    assert.equal(store.saveRecord(recordAt(480_000)), 'ok');

    const raw = kv.data.get(RECORD_KEY_PREFIX + '0001');
    assert.ok(typeof raw === 'string' && raw.length > 0, '必须落在新命名空间键上');
    assert.equal(raw.includes('"schemaVersion":2'), true, '落盘必须带 schema 版本');
  });

  test('读回记录字段一致，且每课互不影响', () => {
    const kv = createMemoryKeyValue();
    const store = new LearningStore(kv);
    store.saveRecord(recordAt(480_000));

    const other = applyTrackPoint(
      createLearningRecord('0002'),
      'pb',
      { committedPositionMs: 30_000, committedSegmentIndex: 3, durationMs: 600_000 },
      2000,
    );
    store.saveRecord(other);

    const fresh = new LearningStore(kv); // 模拟重启后重新读取
    assert.equal(fresh.loadRecord('0001').podcast?.committedPositionMs, 480_000);
    assert.equal(fresh.loadRecord('0002').podcast?.committedPositionMs, 30_000);
  });

  test('§4.1.10：旧命名空间的数据既不读取也不删除', () => {
    const kv = createMemoryKeyValue();
    kv.data.set(LEGACY_PROGRESS_KEY, JSON.stringify({ '0001': { pbPosSec: 999 } }));
    kv.data.set(LEGACY_LAST_LESSON_KEY, '0001');

    const store = new LearningStore(kv);
    assert.equal(store.loadRecord('0001').podcast, null, '不得从旧键迁移');
    assert.equal(store.loadResumeAnchor().lastOpenedLessonId, null, '锚点也不得读旧键');

    store.saveRecord(recordAt(480_000));
    assert.ok(kv.data.has(LEGACY_PROGRESS_KEY), '旧数据必须保留（删除需 owner 同意）');
    assert.ok(kv.data.has(LEGACY_LAST_LESSON_KEY));
  });
});

describe('LearningStore · §4.1.4 写入版本守卫', () => {
  test('旧版本写入被拒绝，不覆盖新版本', () => {
    const kv = createMemoryKeyValue();
    const store = new LearningStore(kv);
    store.saveRecord(recordAt(480_000, 5));

    assert.equal(store.saveRecord(recordAt(60_000, 4)), 'stale', 'rev 4 不得覆盖 rev 5');
    assert.equal(store.loadRecord('0001').podcast?.committedPositionMs, 480_000);
  });

  test('同版本重复写入被拒绝（幂等保护）', () => {
    const store = new LearningStore(createMemoryKeyValue());
    store.saveRecord(recordAt(480_000, 5));
    assert.equal(store.saveRecord(recordAt(200_000, 5)), 'stale');
  });
});

describe('LearningStore · §4.1.8 写入失败不谎报', () => {
  test('写入失败返回 false，内存仍可继续使用，且 isPersisted 为 false', () => {
    const kv = createMemoryKeyValue();
    const store = new LearningStore(kv);
    kv.failWrites = true;

    const record = recordAt(480_000);
    assert.equal(store.saveRecord(record), 'io-error', '不得谎报已保存');
    assert.equal(store.hasWriteFailure(), true);
    assert.equal(store.isPersisted('0001'), false);
    assert.equal(
      store.loadRecord('0001').podcast?.committedPositionMs,
      480_000,
      '内存状态仍应可继续使用',
    );
  });

  test('恢复写入后可以重试成功', () => {
    const kv = createMemoryKeyValue();
    const store = new LearningStore(kv);
    kv.failWrites = true;
    assert.equal(store.saveRecord(recordAt(480_000)), 'io-error');

    kv.failWrites = false;
    assert.equal(store.saveRecord(recordAt(490_000, 2)), 'ok');
    assert.equal(store.isPersisted('0001'), true);
  });
});

describe('LearningStore · §4.1.9 损坏按课隔离', () => {
  test('一课坏数据只影响该课，其他课照常读出', () => {
    const kv = createMemoryKeyValue();
    kv.data.set(RECORD_KEY_PREFIX + '0001', '{ not valid json');
    const good = recordAt(30_000, 1);
    kv.data.set(RECORD_KEY_PREFIX + '0002', JSON.stringify({ ...good, lessonId: '0002' }));

    const store = new LearningStore(kv);
    const broken = store.loadRecord('0001');
    assert.equal(broken.podcast, null, '损坏记录回退默认值');
    assert.equal(broken.lessonCompleted, false);
    assert.equal(
      store.loadRecord('0002').podcast?.committedPositionMs,
      30_000,
      '其他课的有效数据必须保留',
    );
    assert.ok(kv.data.has(RECORD_KEY_PREFIX + '0001'), '损坏内容不删除（便于排查）');
  });
});

describe('LearningStore · 偏好与锚点', () => {
  test('默认偏好：standard + 自动连播开启', () => {
    const store = new LearningStore(createMemoryKeyValue());
    assert.deepEqual(store.loadPreferences(), {
      schemaVersion: 2,
      uiMode: 'standard',
      autoNextPodcastEnabled: true,
    });
  });

  test('偏好往返（写到独立键，不污染课程记录）', () => {
    const kv = createMemoryKeyValue();
    const store = new LearningStore(kv);
    assert.equal(
      store.savePreferences({ schemaVersion: 2, uiMode: 'immersive', autoNextPodcastEnabled: false }),
      true,
    );
    assert.equal(store.loadPreferences().uiMode, 'immersive');
    assert.equal(store.loadPreferences().autoNextPodcastEnabled, false);
    assert.ok(kv.data.has(PREFERENCES_KEY));
  });

  test('锚点往返', () => {
    const kv = createMemoryKeyValue();
    const store = new LearningStore(kv);
    store.saveResumeAnchor({ schemaVersion: 2, lastOpenedLessonId: '0007' });
    assert.equal(store.loadResumeAnchor().lastOpenedLessonId, '0007');
    assert.ok(kv.data.has(RESUME_ANCHOR_KEY));
  });

  test('knownLessonIds 只列本命名空间下的课', () => {
    const kv = createMemoryKeyValue();
    kv.data.set(LEGACY_PROGRESS_KEY, '{}');
    const store = new LearningStore(kv);
    store.saveRecord(recordAt(10_000));
    assert.deepEqual(store.knownLessonIds(), ['0001']);
  });
});

describe('LearningStore · §4.1.10 旧版键一次性清理（owner 授权）', () => {
  test('只删白名单两键，并写清理标记', () => {
    const kv = createMemoryKeyValue();
    kv.data.set(LEGACY_PROGRESS_KEY, '{"0001":{"pbPosSec":480}}');
    kv.data.set(LEGACY_LAST_LESSON_KEY, '"0001"');
    const store = new LearningStore(kv);

    const result = store.purgeLegacyKeys();

    assert.deepEqual(result.removed.sort(), [LEGACY_LAST_LESSON_KEY, LEGACY_PROGRESS_KEY].sort());
    assert.equal(kv.data.has(LEGACY_PROGRESS_KEY), false);
    assert.equal(kv.data.has(LEGACY_LAST_LESSON_KEY), false);
    assert.equal(store.isLegacyPurged(), true);
  });

  test('绝不触碰新命名空间：记录 / 偏好 / 锚点清理后仍可读', () => {
    const kv = createMemoryKeyValue();
    const store = new LearningStore(kv);
    store.saveRecord(recordAt(480_000));
    store.saveResumeAnchor({ schemaVersion: 2, lastOpenedLessonId: '0001' });
    kv.data.set(LEGACY_PROGRESS_KEY, '{}');

    const before = Array.from(kv.data.keys()).filter((k) => k.startsWith(RECORD_KEY_PREFIX));
    store.purgeLegacyKeys();
    const after = Array.from(kv.data.keys()).filter((k) => k.startsWith(RECORD_KEY_PREFIX));

    assert.deepEqual(after, before);
    assert.equal(store.loadRecord('0001').podcast?.committedPositionMs, 480_000);
    assert.equal(store.loadResumeAnchor().lastOpenedLessonId, '0001');
  });

  test('幂等：第二次调用不再删除，标记已存在', () => {
    const kv = createMemoryKeyValue();
    kv.data.set(LEGACY_PROGRESS_KEY, '{}');
    const store = new LearningStore(kv);

    assert.equal(store.purgeLegacyKeys().removed.length, 1);
    const second = store.purgeLegacyKeys();
    assert.deepEqual(second.removed, []);
    assert.equal(second.alreadyPurged, true);
  });

  test('旧版本客户端写回旧键时仍会再清一次（标记不阻断清理）', () => {
    const kv = createMemoryKeyValue();
    const store = new LearningStore(kv);
    store.purgeLegacyKeys();
    kv.data.set(LEGACY_LAST_LESSON_KEY, '"0009"');

    const again = store.purgeLegacyKeys();
    assert.deepEqual(again.removed, [LEGACY_LAST_LESSON_KEY]);
    assert.equal(kv.data.has(LEGACY_LAST_LESSON_KEY), false);
  });

  test('相似但不相同的键不删（白名单不是前缀匹配）', () => {
    const kv = createMemoryKeyValue();
    kv.data.set(`${LEGACY_PROGRESS_KEY}_backup`, '{}');
    kv.data.set(`${LEGACY_LAST_LESSON_KEY}_extra`, '"x"');
    const store = new LearningStore(kv);

    assert.deepEqual(store.purgeLegacyKeys().removed, []);
    assert.equal(kv.data.has(`${LEGACY_PROGRESS_KEY}_backup`), true);
    assert.equal(kv.data.has(`${LEGACY_LAST_LESSON_KEY}_extra`), true);
  });
});

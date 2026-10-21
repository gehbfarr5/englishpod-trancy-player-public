/**
 * `services/playbackSession.ts` 单测。
 *
 * 覆盖重构后的边界（EP-PBC-001 §4.1.1 / §4.1.2 / §4.1.5）：
 *   - **重进丢进度的根因**：冷启动时 `isLessonActive()` 必须为 false，否则播放页
 *     会跳过载源与 seek，播放头停在 BAM 的 currentTime=0；
 *   - 加载锁：60ms 延迟解锁 / 过期令牌丢弃 / 10s 兜底；
 *   - 后台周期提交：只经 progressJournal、约 3s 一次、前台由页面自己提交时不自作主张；
 *   - 自然结束：PB 才置完成，且完成与位置分开写。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { LearningStore } from '../adapters/wechat/learningStore';
import { ProgressJournal } from './progressJournal';
import { PlaybackSessionService, SessionTimerHandle } from './playbackSession';
import { createMemoryKeyValue } from '../test-support/memoryKeyValue';

/** 最小 wx mock：冷态 BAM（paused、currentTime=0）+ 本地存储 + 课程索引缓存。 */
function installWxMock(store: Map<string, unknown>): { bam: Record<string, unknown> } {
  const bam: Record<string, unknown> = {
    paused: true,
    currentTime: 0,
    duration: 0,
    seek: () => undefined,
    play: () => undefined,
    pause: () => undefined,
  };
  (globalThis as unknown as { wx: unknown }).wx = {
    getStorageSync: (key: string): unknown => (store.has(key) ? store.get(key) : ''),
    setStorageSync: (key: string, value: unknown): void => {
      store.set(key, value);
    },
    getStorageInfoSync: (): { keys: string[]; currentSize: number; limitSize: number } => ({
      keys: Array.from(store.keys()),
      currentSize: 8,
      limitSize: 10240,
    }),
    getBackgroundAudioManager: (): typeof bam => bam,
  };
  return { bam };
}

/** 可手动推进的假定时器。 */
function createFakeTimers(): {
  setTimer: (fn: () => void, ms: number) => SessionTimerHandle;
  clearTimer: (handle: SessionTimerHandle) => void;
  advance: (ms: number) => void;
} {
  let nextId = 1;
  let now = 0;
  const timers = new Map<number, { fn: () => void; at: number }>();
  return {
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id as unknown as SessionTimerHandle;
    },
    clearTimer: (handle) => {
      timers.delete(handle as unknown as number);
    },
    advance: (ms) => {
      now += ms;
      for (const [id, timer] of Array.from(timers.entries())) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

/** 建一个「已有 8:00 断点」的存储环境 + 会话。 */
function bootSession(options: { srcLoaded?: boolean } = {}) {
  const kv = createMemoryKeyValue();
  const clock = { now: 1_000_000 };
  const store = new LearningStore(kv);
  const journal = new ProgressJournal({ store, now: () => clock.now });
  journal.setLastOpenedLesson('0001');
  journal.commit({
    lessonId: '0001',
    track: 'pb',
    positionMs: 480_000,
    segmentIndex: 40,
    durationMs: 900_000,
    reason: 'pause',
  });

  const wxStore = new Map<string, unknown>();
  const { bam } = installWxMock(wxStore);
  const timers = createFakeTimers();
  const session = new PlaybackSessionService({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    journal,
    now: () => clock.now,
  });
  if (options.srcLoaded) {
    session.markSrcLoaded();
  }
  return { kv, store, journal, session, timers, bam, clock };
}

describe('PlaybackSessionService · 重进丢进度根因（§4.1.2）', () => {
  test('冷启动恢复出旧进度，但 isLessonActive 必须为 false', () => {
    const { session } = bootSession();

    assert.equal(session.getState().lessonId, '0001', '应从锚点恢复最后打开的课');
    assert.equal(
      session.isSrcLoadedInProcess(),
      false,
      '本进程从未赋 src',
    );

    const active = session.isLessonActive('0001', 'pb');
    assert.equal(
      active.isActive,
      false,
      '无 src 就不是活跃媒体：判为 true 会让播放页跳过载源/seek，播放头回到 0',
    );
    assert.equal(active.currentTime, 0);
  });

  test('已载源后同一课同轨才判为活跃', () => {
    const { session, bam } = bootSession({ srcLoaded: true });
    bam.currentTime = 480;
    bam.duration = 900;
    bam.paused = false;

    const active = session.isLessonActive('0001', 'pb');
    assert.equal(active.isActive, true);
    assert.equal(active.isPlaying, true);
    assert.equal(active.currentTime, 480);
    assert.equal(session.isLessonActive('0002', 'pb').isActive, false, '别的课不活跃');
    assert.equal(session.isLessonActive('0001', 'dg').isActive, false, '别的轨不活跃');
  });

  test('冷启动不会被误判为「正在播放」（课程库继续收听卡也因此走导航）', () => {
    const { session, bam } = bootSession();
    bam.currentTime = 0;
    assert.equal(session.getState().isPlaying, false);
  });
});

describe('PlaybackSessionService · 加载锁（§4.1.2）', () => {
  test('beginAudioLoad 后 60ms 解锁；锁定期提交被拒', () => {
    const { session, journal, timers } = bootSession({ srcLoaded: true });
    const token = session.beginAudioLoad('0001', 'pb');

    assert.equal(journal.isLoadLocked('0001', 'pb'), true);
    assert.equal(
      journal.commit({
        lessonId: '0001',
        track: 'pb',
        positionMs: 500_000,
        segmentIndex: 41,
        durationMs: 900_000,
        reason: 'periodic',
      }).committed,
      false,
    );

    session.endAudioLoad(token);
    assert.equal(journal.isLoadLocked('0001', 'pb'), true, 'endAudioLoad 不应立即解锁');

    timers.advance(60);
    assert.equal(journal.isLoadLocked('0001', 'pb'), false);
  });

  test('过期令牌的 endAudioLoad 被丢弃：新一轮 load 仍保持锁定', () => {
    const { session, journal, timers } = bootSession({ srcLoaded: true });
    const first = session.beginAudioLoad('0001', 'pb');
    session.beginAudioLoad('0001', 'pb');
    session.endAudioLoad(first);
    timers.advance(60);
    assert.equal(journal.isLoadLocked('0001', 'pb'), true);
  });

  test('canplay 永不到达：10s 兜底解锁，避免该课断点被永久抑制', () => {
    const { session, journal, timers } = bootSession({ srcLoaded: true });
    session.beginAudioLoad('0001', 'pb');
    timers.advance(9_999);
    assert.equal(journal.isLoadLocked('0001', 'pb'), true);
    timers.advance(1);
    assert.equal(journal.isLoadLocked('0001', 'pb'), false);
  });
});

describe('PlaybackSessionService · 后台周期提交（§4.1.1）', () => {
  test('播放页不在前台时，按 3s 节流提交，位置取 BAM 真实时间', () => {
    const { session, journal, bam, clock } = bootSession({ srcLoaded: true });
    bam.currentTime = 481;
    bam.duration = 900;

    session.onTimeUpdate(481, 900);
    assert.equal(journal.readRecord('0001').podcast?.committedPositionMs, 481_000);

    // 1s 后再来一次：3s 周期未到 → 不写
    clock.now += 1_000;
    bam.currentTime = 482;
    session.onTimeUpdate(482, 900);
    assert.equal(journal.readRecord('0001').podcast?.committedPositionMs, 481_000);

    // 累计 3s → 再写
    clock.now += 2_500;
    bam.currentTime = 485;
    session.onTimeUpdate(485, 900);
    assert.equal(journal.readRecord('0001').podcast?.committedPositionMs, 485_000);
  });

  test('播放页在前台时不重复提交（前台由页面负责，避免双写）', () => {
    const { session, journal, bam, clock } = bootSession({ srcLoaded: true });
    session.setForegroundOwner(true);
    bam.currentTime = 500;
    bam.duration = 900;

    clock.now += 5_000;
    session.onTimeUpdate(500, 900);
    assert.equal(journal.readRecord('0001').podcast?.committedPositionMs, 480_000);
  });
});

describe('PlaybackSessionService · 自然结束（§3.1 / §4.1.5）', () => {
  test('PB 自然结束：位置写末尾 + 完成标记独立写入', () => {
    const { session, journal, bam } = bootSession({ srcLoaded: true });
    bam.currentTime = 900;
    bam.duration = 900;
    session.setLessonInfo({
      lessonId: '0001',
      track: 'pb',
      durationSec: 900,
      title: 'x',
      attributes: 'y',
    });

    session.handleNaturalEnded();

    const record = journal.readRecord('0001');
    assert.equal(record.podcast?.committedPositionMs, 900_000, '自然结束位置应落盘');
    assert.equal(record.lessonCompleted, true, 'PB 自然结束必须置完成');
  });

  test('DG 自然结束不置完成', () => {
    const { session, journal, bam } = bootSession({ srcLoaded: true });
    bam.currentTime = 60;
    bam.duration = 60;
    session.setLessonInfo({
      lessonId: '0001',
      track: 'dg',
      durationSec: 60,
      title: 'x',
      attributes: 'y',
    });

    session.handleNaturalEnded();

    assert.equal(journal.readRecord('0001').lessonCompleted, false);
  });
});

describe('PlaybackSessionService · 后台自然结束的末课环绕（§3.2 v1.2 / F09 / F13）', () => {
  /** 构造课程索引（并写进 wx 缓存，供后台切课读取）。 */
  function seedIndex(ids: string[]): void {
    const list = ids.map((lessonId, i) => ({
      lessonNumber: i + 1,
      lessonId,
      code: `B${lessonId}`,
      level: 'Elementary',
      title: `Lesson ${lessonId}`,
      dgCount: 10,
      pbCount: 10,
      vocabCount: 5,
    }));
    wx.setStorageSync('ep_cached_lesson_index_v1', list);
  }

  /** 给 BAM 装行为观测器：mock 的 play/seek 默认是空实现，断言需要看到调用。 */
  function spyingBam(bam: Record<string, unknown>): { plays: number[]; seeks: number[] } {
    const plays: number[] = [];
    const seeks: number[] = [];
    bam.play = () => {
      plays.push(Date.now());
      bam.paused = false;
    };
    bam.seek = (position: number) => {
      seeks.push(position);
      bam.currentTime = position;
    };
    return { plays, seeks };
  }

  test('末课 PB 自然结束：环绕回第一课（不停在末课）', () => {
    const { session, bam } = bootSession({ srcLoaded: true });
    seedIndex(['0001', '0002']);
    spyingBam(bam);
    bam.currentTime = 900;
    bam.duration = 900;
    session.setLessonInfo({ lessonId: '0002', track: 'pb', durationSec: 900 });

    session.handleNaturalEnded();

    assert.equal(session.getState().lessonId, '0001', '末课必须环绕回第一课');
  });

  test('非末课 PB 自然结束：下行到下一课', () => {
    const { session, bam } = bootSession({ srcLoaded: true });
    seedIndex(['0001', '0002', '0003']);
    spyingBam(bam);
    bam.currentTime = 900;
    bam.duration = 900;
    session.setLessonInfo({ lessonId: '0001', track: 'pb', durationSec: 900 });

    session.handleNaturalEnded();

    assert.equal(session.getState().lessonId, '0002');
  });

  test('单课库 PB 自然结束：同课 00:00 重播，不换课也不停止（F13）', () => {
    const { session, bam } = bootSession({ srcLoaded: true });
    seedIndex(['0001']);
    const { plays, seeks } = spyingBam(bam);
    bam.currentTime = 900;
    bam.duration = 900;
    session.setLessonInfo({ lessonId: '0001', track: 'pb', durationSec: 900 });

    session.handleNaturalEnded();

    assert.equal(session.getState().lessonId, '0001');
    assert.deepEqual(seeks, [0], '必须显式回到 00:00');
    assert.equal(plays.length, 1, '必须继续播放，不停止');
  });

  test('DG 自然结束：不换课、不回到 PB（§3.2）', () => {
    const { session, bam } = bootSession({ srcLoaded: true });
    seedIndex(['0001', '0002']);
    spyingBam(bam);
    bam.currentTime = 60;
    bam.duration = 60;
    session.setLessonInfo({ lessonId: '0001', track: 'dg', durationSec: 60 });

    session.handleNaturalEnded();

    assert.equal(session.getState().lessonId, '0001');
    assert.equal(session.getState().track, 'dg');
  });
});

describe('PlaybackSessionService · 切轨后的后台提交必须落在目标音轨（§4.1.1 / S02 无串写）', () => {
  test('页面切到 DG 并同步会话后，后台周期提交写 DG，PB 断点原样保留', () => {
    const { session, journal, bam, clock } = bootSession({ srcLoaded: true });
    // 播放页 `switchTrack()` 会调到这里——漏掉它，会话就会继续以为自己还在 PB。
    session.setLessonInfo({ lessonId: '0001', track: 'dg', durationSec: 60 });
    session.markSrcLoaded();
    session.setForegroundOwner(false);

    bam.currentTime = 15;
    bam.duration = 60;
    clock.now += 3_000;
    session.onTimeUpdate(15, 60);

    const record = journal.readRecord('0001');
    assert.equal(record.dialogue?.committedPositionMs, 15_000, 'DG 应记到 15s');
    assert.equal(
      record.podcast?.committedPositionMs,
      480_000,
      'PB 的历史断点不得被 DG 的位置覆盖（这是 0.3.8 真机反馈的串写）',
    );
  });

  test('PB → DG → PB 往返：两条音轨各自保留自己的断点（E07）', () => {
    const { session, journal, bam, clock } = bootSession({ srcLoaded: true });

    // 切到 DG 并播 20s
    session.setLessonInfo({ lessonId: '0001', track: 'dg', durationSec: 60 });
    session.markSrcLoaded();
    session.setForegroundOwner(false);
    bam.currentTime = 20;
    bam.duration = 60;
    clock.now += 3_000;
    session.onTimeUpdate(20, 60);

    // 切回 PB
    session.setLessonInfo({ lessonId: '0001', track: 'pb', durationSec: 900 });

    const record = journal.readRecord('0001');
    assert.equal(record.dialogue?.committedPositionMs, 20_000);
    assert.equal(record.podcast?.committedPositionMs, 480_000);
    assert.equal(
      journal.resolveResumeMs('0001', 'pb'),
      480_000,
      '切回 PB 必须恢复到 PB 自己的断点，而不是 0',
    );
  });
});

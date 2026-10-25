/**
 * `adapters/wechat/backgroundAudio.ts` 单测。
 *
 * 覆盖 Issue #48 的置位链路：后台音频适配器是「本进程 src 已加载」追踪的信号源——
 *   - `load(https URL)` → `assignSrc` 成功写入 `manager.src` 后即置位会话谓词；
 *   - BAM `onCanplay` 事件 → `handleCanplay` 亦置位（幂等，覆盖不经 assignSrc 的赋源路径）。
 *
 * 覆盖 Issue #52 / #53 的缓冲补偿：换 `src` 后到 `onCanplay` 前，`seek()` / `play()`
 * 会被 BAM 平台静默丢弃 →
 *   - 未就绪期 seek/play 缓冲（`pendingSeekSec` / `pendingPlay`），canplay 后补做一次且幂等；
 *   - 补做按已知时长钳制；canplay 时长未知时由首个已知时长的 timeUpdate 兜底补做
 *     （仅就绪后，防误伤 fileID 解析窗口内的旧 src）；
 *   - 新一轮 load（切轨）清除旧缓冲；pause 取消待恢复播放；就绪后与无待定 load 的
 *     路径仍直发（回归保护）。
 *
 * 说明：
 *   - 单例 `playbackSession` 为进程级状态，`onCanplay` 单独置位（未经 load）的场景
 *     需独立进程冷态才能区分，此处不重复断言；该防线由设备确认兜底（Issue #48 最小实验）。
 *   - BAM 事件为**模块级只绑一次**（生产同款约束）→ 全文件共用一套 mock 与事件表，
 *     由首个构造的适配器完成绑定；每个用例重置可写状态与调用记录。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { playbackSession } from '../../services/playbackSession';
import { BackgroundAudioAdapter } from './backgroundAudio';

/** BAM 事件回调表（按事件名捕获注册的回调）。 */
type BamHandlers = Record<string, (() => void) | undefined>;

/** BAM 方法调用记录（seek 依序记录目标秒；play / pause 计数）。 */
interface BamCalls {
  seek: number[];
  playCount: number;
  pauseCount: number;
}

/** 最小 BAM mock：可写属性 + 事件回调捕获 + play/pause/seek 调用记录。 */
function installBamWxMock(): {
  bam: Record<string, unknown>;
  handlers: BamHandlers;
  calls: BamCalls;
} {
  const handlers: BamHandlers = {};
  const calls: BamCalls = { seek: [], playCount: 0, pauseCount: 0 };
  const bam: Record<string, unknown> = {
    src: '',
    title: '',
    epname: '',
    singer: '',
    coverImgUrl: '',
    playbackRate: 1,
    paused: true,
    currentTime: 0,
    duration: 0,
    play: (): void => {
      calls.playCount += 1;
    },
    pause: (): void => {
      calls.pauseCount += 1;
    },
    stop: (): void => {},
    seek: (pos: number): void => {
      calls.seek.push(pos);
    },
  };
  const eventNames = [
    'onCanplay',
    'onPlay',
    'onPause',
    'onStop',
    'onEnded',
    'onTimeUpdate',
    'onSeeked',
    'onWaiting',
    'onError',
    'onPrev',
    'onNext',
  ];
  for (const name of eventNames) {
    bam[name] = (cb: () => void): void => {
      handlers[name] = cb;
    };
  }
  (globalThis as unknown as { wx: unknown }).wx = {
    getBackgroundAudioManager: (): Record<string, unknown> => bam,
  };
  return { bam, handlers, calls };
}

/** 全文件共享一套 mock（模块级事件只绑一次，见文件头说明）。 */
const shared = installBamWxMock();

/** 重置 BAM 可写状态与调用记录（不重置模块级事件绑定）。 */
function resetBam(): void {
  shared.bam.src = '';
  shared.bam.duration = 0;
  shared.bam.currentTime = 0;
  shared.bam.paused = true;
  shared.bam.playbackRate = 1;
  shared.calls.seek.length = 0;
  shared.calls.playCount = 0;
  shared.calls.pauseCount = 0;
}

describe('BackgroundAudioAdapter · 本进程 src 加载置位', () => {
  test('load(https URL) 赋 manager.src 成功后置位会话谓词；onCanplay 再置位幂等', () => {
    const url = 'https://media.example.com/lessons/0002_pb.m4a';
    resetBam();
    assert.equal(playbackSession.isSrcLoadedInProcess(), false, '进程冷态：谓词初始为 false');

    const adapter = new BackgroundAudioAdapter();
    adapter.load(url);

    assert.equal(shared.bam.src, url, 'assignSrc 应把 URL 写入 manager.src');
    assert.equal(playbackSession.isSrcLoadedInProcess(), true, '赋 src 成功后即置位');

    // BAM 缓冲就绪回调：handleCanplay 置位幂等，不抛错。
    shared.handlers.onCanplay?.();
    assert.equal(playbackSession.isSrcLoadedInProcess(), true, 'onCanplay 再次置位幂等');
  });
});

describe('BackgroundAudioAdapter · src 未就绪期的 seek 缓冲补偿（Issue #52）', () => {
  test('load 后 canplay 前的 seek 不直发；canplay 后补做一次且幂等', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    adapter.load('https://media.example.com/lessons/0012_pb.m4a');

    adapter.seek(42);
    assert.deepEqual(shared.calls.seek, [], 'canplay 前直发会被平台静默丢弃，必须缓冲');

    shared.bam.duration = 120; // 模拟 BAM 就绪并上报时长
    shared.handlers.onCanplay?.();
    assert.deepEqual(shared.calls.seek, [42], 'canplay 后按缓冲目标补做一次');

    shared.handlers.onCanplay?.(); // 再次 canplay（如重新缓冲）不得重复补做
    assert.deepEqual(shared.calls.seek, [42], '补做后缓冲清空，幂等');
  });

  test('补做时按已知时长钳制（不超过 duration）', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    adapter.load('https://media.example.com/lessons/0012_dg.m4a');
    adapter.seek(130);

    shared.bam.duration = 120;
    shared.handlers.onCanplay?.();
    assert.deepEqual(shared.calls.seek, [120], '补做目标按 duration 钳制');
  });

  test('就绪后的 seek 直发，不经缓冲（正常播放中拖动进度条回归保护）', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    adapter.load('https://media.example.com/lessons/0012_pb.m4a');
    shared.bam.duration = 200;
    shared.handlers.onCanplay?.();
    assert.deepEqual(shared.calls.seek, [], '无缓冲时 canplay 不产生补做');

    adapter.seek(77);
    assert.deepEqual(shared.calls.seek, [77], '就绪后 seek 立即直发');
  });

  test('canplay 时长未知（0）：seek 仍缓冲，首个已知时长的 timeUpdate 兜底补做', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    adapter.load('https://media.example.com/lessons/0012_pb.m4a');
    shared.handlers.onCanplay?.(); // duration 仍为 0

    adapter.seek(30);
    assert.deepEqual(shared.calls.seek, [], '时长未知：继续缓冲，不直发');

    shared.bam.duration = 100;
    shared.bam.currentTime = 0.5;
    shared.handlers.onTimeUpdate?.();
    assert.deepEqual(shared.calls.seek, [30], 'timeUpdate 兜底补做一次');
  });

  test('canplay 前的 timeUpdate 属旧 src，不得消费本轮缓冲（切轨窗口防误伤）', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    adapter.load('https://media.example.com/lessons/0012_pb.m4a');
    adapter.seek(30);

    // 模拟 fileID 解析期间旧轨仍在播：timeUpdate 带非 0 时长也不得补做。
    shared.bam.duration = 100;
    shared.bam.currentTime = 5;
    shared.handlers.onTimeUpdate?.();
    assert.deepEqual(shared.calls.seek, [], '未就绪的 timeUpdate 不消费缓冲');

    shared.handlers.onCanplay?.();
    assert.deepEqual(shared.calls.seek, [30], 'canplay 后才补做');
  });

  test('新一轮 load（切轨）清除旧缓冲，不得补做过时意图', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    adapter.load('https://media.example.com/lessons/0012_pb.m4a');
    adapter.seek(30); // 旧轨恢复位缓冲

    adapter.load('https://media.example.com/lessons/0012_dg.m4a'); // 切轨
    assert.equal(
      shared.bam.src,
      'https://media.example.com/lessons/0012_dg.m4a',
      '切轨应赋新 src',
    );

    shared.bam.duration = 100;
    shared.handlers.onCanplay?.();
    assert.deepEqual(shared.calls.seek, [], 'load 清除旧缓冲，canplay 后无补做');

    adapter.seek(15); // 新轨就绪后的正常 seek
    assert.deepEqual(shared.calls.seek, [15], '就绪后新意图直发');
  });

  test('未就绪期连续 seek：最新意图覆盖旧缓冲', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    adapter.load('https://media.example.com/lessons/0012_pb.m4a');
    adapter.seek(10);
    adapter.seek(20);

    shared.bam.duration = 100;
    shared.handlers.onCanplay?.();
    assert.deepEqual(shared.calls.seek, [20], '只补做最新一次意图');
  });
});

describe('BackgroundAudioAdapter · src 未就绪期的 play 缓冲补偿（Issue #53）', () => {
  test('load 后 canplay 前的 play 不直发；canplay 后自动恢复一次且幂等', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    adapter.load('https://media.example.com/lessons/0012_pb.m4a');

    adapter.play();
    assert.equal(shared.calls.playCount, 0, 'canplay 前无源 play 会被平台吞掉，必须缓冲');

    shared.bam.duration = 100;
    shared.handlers.onCanplay?.();
    assert.equal(shared.calls.playCount, 1, 'canplay 后自动恢复播放意图');

    shared.handlers.onCanplay?.();
    assert.equal(shared.calls.playCount, 1, '恢复一次后幂等');
  });

  test('缓冲 play 后的 pause 取消待恢复意图，且 pause 本身直发', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    adapter.load('https://media.example.com/lessons/0012_pb.m4a');
    adapter.play(); // 缓冲播放意图

    adapter.pause();
    assert.equal(shared.calls.pauseCount, 1, 'pause 直发（暂停当前声）');

    shared.bam.duration = 100;
    shared.handlers.onCanplay?.();
    assert.equal(shared.calls.playCount, 0, '最新意图为暂停：不恢复播放');
  });
});

describe('BackgroundAudioAdapter · 暂停意图（暂停态切轨不得自己播起来）', () => {
  /**
   * BAM 赋 `src` 后是**异步**自动开播的：切轨路径 `load()` 紧跟 `pause()` 时，
   * 这次 pause 常打在「已赋 src、尚未开播」的空窗被吞掉，随后自动播放触发 `onPlay`，
   * 页面把 UI 改成播放中（e2e `switch-roundtrip` 实测复现）。
   */
  test('load 后立即 pause：canplay 时补兑现一次暂停', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    adapter.load('https://media.example.com/lessons/0012_dg.m4a');

    adapter.pause();
    assert.equal(shared.calls.pauseCount, 1, 'pause 仍直发（先压当前声）');

    shared.bam.duration = 100;
    shared.handlers.onCanplay?.();
    assert.equal(shared.calls.pauseCount, 2, 'canplay 时必须补一次 pause，压掉自动播放');
  });

  test('迟到的 onPlay 被拦截：不广播播放事件（否则 UI 假播放）', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    let playEvents = 0;
    adapter.setEvents({ onPlay: () => { playEvents += 1; } });

    adapter.load('https://media.example.com/lessons/0012_dg.m4a');
    adapter.pause();
    shared.bam.duration = 100;
    shared.handlers.onCanplay?.();

    const before = shared.calls.pauseCount;
    shared.handlers.onPlay?.(); // 平台自动播放抢跑
    assert.equal(shared.calls.pauseCount, before + 1, '迟到的自动播放应被立刻压回暂停');
    assert.equal(playEvents, 0, '不得把「已播放」广播给页面');
  });

  test('显式 play 撤销暂停意图：canplay 后恢复播放', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    adapter.load('https://media.example.com/lessons/0012_pb.m4a');
    adapter.pause();

    adapter.play(); // 用户点播放，意图反转
    shared.bam.duration = 100;
    shared.handlers.onCanplay?.();

    assert.equal(shared.calls.playCount, 1, '缓冲的播放意图仍应恢复');
    const before = shared.calls.pauseCount;
    shared.handlers.onPlay?.();
    assert.equal(shared.calls.pauseCount, before, '播放意图有效时不得再拦 onPlay');
  });

  test('已就绪后的暂停不布防：锁屏播放不被误拦', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    adapter.load('https://media.example.com/lessons/0012_pb.m4a');
    shared.bam.duration = 100;
    shared.handlers.onCanplay?.(); // 本轮已就绪
    adapter.play();

    adapter.pause();
    const before = shared.calls.pauseCount;
    shared.handlers.onPlay?.(); // 例如稍后从锁屏按播放
    assert.equal(shared.calls.pauseCount, before, '就绪后的暂停不得留下拦截意图');
  });
});

describe('BackgroundAudioAdapter · 无待定 load 的直发回归保护', () => {
  test('未调用 load 的适配器（后台会话无缝接续路径）seek/play 直发', () => {
    resetBam();
    // 模拟进程内单例 BAM 已在播（如后台自然切课直接写 bam.src 后重进播放页）。
    shared.bam.src = 'https://media.example.com/lessons/0005_pb.m4a';
    shared.bam.duration = 100;
    shared.bam.currentTime = 12;
    shared.bam.paused = false;

    const adapter = new BackgroundAudioAdapter();
    adapter.seek(15);
    assert.deepEqual(shared.calls.seek, [15], '无待定 load：不缓冲（保留无缝接续现状）');
    adapter.play();
    assert.equal(shared.calls.playCount, 1, '无待定 load：play 直发');
  });
});

describe('BackgroundAudioAdapter · 切轨防旧源污染与进度同步', () => {
  test('切轨换源时若旧源正在播放，立即暂停旧源防外放', () => {
    resetBam();
    shared.bam.paused = false; // 模拟旧轨正在发声
    const adapter = new BackgroundAudioAdapter();
    adapter.load('https://media.example.com/lessons/0001_dg.m4a');
    assert.equal(shared.calls.pauseCount, 1, '切轨时必须先压住旧源声音');
  });

  test('未就绪期间的 timeUpdate 绝不外发，防止旧源位置污染新音轨', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    const emittedPositions: number[] = [];
    adapter.setEvents({
      onTimeUpdate: (pos) => emittedPositions.push(pos),
    });

    adapter.load('https://media.example.com/lessons/0001_dg.m4a');
    shared.bam.currentTime = 45; // 旧源遗留的位置
    shared.handlers.onTimeUpdate?.();

    assert.deepEqual(emittedPositions, [], '未就绪期的 timeUpdate 不应外发');

    shared.bam.duration = 30;
    shared.handlers.onCanplay?.();
    shared.bam.currentTime = 0.5;
    shared.handlers.onTimeUpdate?.();

    assert.deepEqual(emittedPositions, [0.5], '就绪后的新源 timeUpdate 正常外发');
  });

  test('未就绪期间的 pause / stop 绝不外发假暂停', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    let pauseCount = 0;
    adapter.setEvents({
      onPause: () => {
        pauseCount += 1;
      },
    });

    adapter.load('https://media.example.com/lessons/0001_dg.m4a');
    shared.handlers.onPause?.();
    shared.handlers.onStop?.();

    assert.equal(pauseCount, 0, '未就绪期间旧源销毁的 pause/stop 不广播给页面');
  });

  test('seek(0) 在未就绪期间正确缓冲，并在 canplay 时显式补做 seek(0)', () => {
    resetBam();
    const adapter = new BackgroundAudioAdapter();
    adapter.load('https://media.example.com/lessons/0001_dg.m4a');
    adapter.seek(0); // 目标为 00:00

    assert.deepEqual(shared.calls.seek, [], '未就绪期缓冲 seek(0)');

    shared.bam.duration = 30;
    shared.handlers.onCanplay?.();

    assert.deepEqual(shared.calls.seek, [0], 'canplay 时显式补做 seek(0)');
  });
});

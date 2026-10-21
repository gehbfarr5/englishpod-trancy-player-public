/**
 * e2e 会话封装：连接、进页、注入记录器、读回真实渲染事实。
 *
 * 这一层只做「观察与操作」，不做任何判定 —— 判定属于 scenarios。
 */
import path from 'node:path';
import automator from 'miniprogram-automator';
import type {
  AutomatorElement,
  AutomatorMiniProgram,
  AutomatorPage,
} from 'miniprogram-automator';
import { EnvError } from './env';

/** 一次 `setData` 的关键事实（只保留与本项目缺陷相关的字段）。 */
export interface RecordedCall {
  index: number;
  /** 相对注入时刻的毫秒偏移。 */
  dt: number;
  /** 本次 patch 的顶层 key。 */
  keys: string[];
  playerScrollTop?: number;
  activeSegIdx?: number;
  blocks?: number;
  scrollIntoView?: string;
  positionLabel?: string;
  activeTrack?: string;
}

/** 页面可读的渲染事实（全部来自「下发给视图的数据」或真实节点）。 */
export interface RenderFacts {
  activeTrack: string;
  activeSegIdx: number;
  playerScrollTop: number;
  positionLabel: string;
  playerProgressPct: number;
  /** scroll-view 的真实滚动偏移（不是页面级 scrollTop）。 */
  realScrollTop: number;
  /** 台本组件内已渲染的行数。 */
  transcriptRows: number;
  /** 当前高亮行数（`.is-active-line`）。 */
  activeRows: number;
  /** 产品自己判定「当前句不在视口内」时才会亮起找回条。 */
  showLocateBar: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 连接自动化端口；最多重试 5 次，避免 IDE 刚启动时的抖动。 */
export async function connect(port: number): Promise<AutomatorMiniProgram> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
    } catch (error) {
      lastError = error;
      await sleep(600 * attempt);
    }
  }
  throw new EnvError(
    'CONNECT_FAILED',
    `连接自动化端口 ${port} 失败：${String(lastError)}`,
    '确认端口上跑的是本项目：必要时执行 cli close 后重跑',
  );
}

const TAB_INDEX = { pb: 0, dg: 1 } as const;

/**
 * 打开课程播放页。
 *
 * ⚠️ 页面**只认** `lessonId` / `intent` / `diagnostics`：`track=` 与 `autoplay=`
 * 都不是契约参数（早期 e2e 曾误当参数用，导致「以为在 DG、实际在 PB」）。
 * 因此目标音轨一律用「点标签」达成，暂停一律用页面自身的 `pause()`。
 */
export async function openLesson(
  mp: AutomatorMiniProgram,
  lessonId: string,
  options: { track?: 'pb' | 'dg'; pause?: boolean; timeoutMs?: number } = {},
): Promise<AutomatorPage> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const page = await mp.reLaunch(`/pages/player/index?lessonId=${lessonId}&intent=library`);
  await waitForBlocks(page, timeoutMs);

  if (options.track && options.track !== 'pb') {
    await tapTab(page, TAB_INDEX[options.track]);
    await waitForBlocks(page, timeoutMs);
    const data = await page.data();
    if (String(data.activeTrack) !== options.track) {
      throw new EnvError(
        'TRACK_SWITCH_NOT_APPLIED',
        `切轨未生效：期望 ${options.track}，实际 ${String(data.activeTrack)}`,
      );
    }
  }

  if (options.pause) {
    await invokePageMethod(mp, 'pause');
    await page.waitFor(200);
  }
  return page;
}

/** 轮询直到台本渲染（blocks 非空）；加载报错时立即失败。 */
async function waitForBlocks(page: AutomatorPage, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await page.data();
    const blocks = Array.isArray(data.blocks) ? data.blocks.length : 0;
    if (blocks > 0) {
      return;
    }
    const error = typeof data.playerErrorMsg === 'string' ? data.playerErrorMsg : '';
    if (error) {
      throw new EnvError('LESSON_LOAD_FAILED', `课程加载失败：${error}`);
    }
    await page.waitFor(400);
  }
  throw new EnvError(
    'LESSON_LOAD_TIMEOUT',
    `等待台本渲染超时（${timeoutMs}ms）`,
    '确认云端有该课程；或用 E2E_LESSON_ID 指定可用课程',
  );
}

/**
 * 调用页面自身的方法（真实实例，`this` 正确）。
 *
 * 不用 automator 的 `page.callMethod`：实测它对本页面返回
 * `this.switchTrack is not a function`（实例代理问题），且失败信息误导。
 */
export async function invokePageMethod(
  mp: AutomatorMiniProgram,
  method: string,
  args: unknown[] = [],
): Promise<unknown> {
  return mp.evaluate(
    function (name: string, params: unknown[]) {
      var pages = getCurrentPages();
      var page = pages[pages.length - 1] as unknown as Record<string, unknown>;
      var fn = page ? page[name] : null;
      if (typeof fn !== 'function') {
        throw new Error('page method not found: ' + name);
      }
      return (fn as (...rest: unknown[]) => unknown).apply(page, params);
    },
    method,
    args,
  );
}

/**
 * 在真实 AppService 里包裹页面实例的 `setData`，记录每一次下发。
 *
 * 为什么必须这样做：轮询 `page.data()` 的粒度是「一次 RPC」，两次调用之间
 * 可能已经刷过 4 次 `setData`；「首帧下发了什么」只能靠序列记录才看得见。
 */
export async function installRecorder(mp: AutomatorMiniProgram): Promise<{ path: string; segIdx: number; scrollTop: number }> {
  return mp.evaluate(function () {
    var pages = getCurrentPages();
    var page = pages[pages.length - 1];
    if (!page) {
      throw new Error('no current page');
    }
    var host = page as unknown as {
      setData: (patch: Record<string, unknown>, cb?: () => void) => void;
      __e2eRec?: unknown;
    };
    var rec: { t0: number; calls: Array<Record<string, unknown>> } = { t0: Date.now(), calls: [] };
    var original = host.setData.bind(host);
    host.setData = function (patch: Record<string, unknown>, cb?: () => void) {
      var entry: Record<string, unknown> = {
        index: rec.calls.length,
        dt: Date.now() - rec.t0,
        keys: Object.keys(patch || {}),
      };
      if (patch) {
        if ('playerScrollTop' in patch) entry.playerScrollTop = patch.playerScrollTop;
        if ('activeSegIdx' in patch) entry.activeSegIdx = patch.activeSegIdx;
        if ('activeTrack' in patch) entry.activeTrack = patch.activeTrack;
        if ('positionLabel' in patch) entry.positionLabel = patch.positionLabel;
        if (Array.isArray(patch.blocks)) entry.blocks = patch.blocks.length;
        if ('scrollIntoView' in patch) entry.scrollIntoView = patch.scrollIntoView;
      }
      rec.calls.push(entry);
      return original(patch, cb);
    };
    host.__e2eRec = rec;
    var data = (page as unknown as { data: Record<string, unknown> }).data;
    return {
      path: String((page as unknown as { route?: string }).route || ''),
      segIdx: Number(data.activeSegIdx),
      scrollTop: Number(data.playerScrollTop),
    };
  });
}

/** 读回记录器捕获的 `setData` 序列。 */
export async function readCalls(mp: AutomatorMiniProgram): Promise<RecordedCall[]> {
  const calls = await mp.evaluate(function () {
    var pages = getCurrentPages();
    var page = pages[pages.length - 1] as unknown as { __e2eRec?: { calls: Array<Record<string, unknown>> } };
    return page && page.__e2eRec ? page.__e2eRec.calls : [];
  });
  return (calls as unknown as RecordedCall[]) ?? [];
}

/** 清空记录器（同一场景内做多段观测时用）。 */
export async function resetRecorder(mp: AutomatorMiniProgram): Promise<void> {
  await mp.evaluate(function () {
    var pages = getCurrentPages();
    var page = pages[pages.length - 1] as unknown as { __e2eRec?: { t0: number; calls: Array<Record<string, unknown>> } };
    if (page && page.__e2eRec) {
      page.__e2eRec.t0 = Date.now();
      page.__e2eRec.calls = [];
    }
  });
}

/** 点击轨道标签（Podcast / Dialogue / Vocab）。 */
export async function tapTab(page: AutomatorPage, index: number): Promise<void> {
  const tabs = await page.$$('.pl__seg-item');
  if (tabs.length <= index) {
    throw new EnvError('TAB_NOT_FOUND', `轨道标签数量不足：期望 >${index}，实际 ${tabs.length}`);
  }
  await tabs[index].tap();
}

/** 点击台本第 `segIdx` 句（真实触摸，等价于用户点字幕行）。 */
export async function tapTranscriptRow(page: AutomatorPage, segIdx: number): Promise<boolean> {
  const transcript = await page.$('#transcript');
  if (!transcript) {
    return false;
  }
  const row = await transcript.$(`#seg-${segIdx}`);
  if (!row) {
    return false;
  }
  await row.tap();
  return true;
}

/** 读 scroll-view 的真实滚动偏移；读不到时返回 -1。 */
export async function readRealScrollTop(page: AutomatorPage): Promise<number> {
  const viewport = await page.$('#transcriptViewport');
  if (!viewport) {
    return -1;
  }
  const value = await viewport.property('scrollTop');
  const num = Number(value);
  return Number.isFinite(num) ? num : -1;
}

/** 采集当前渲染事实。 */
export async function readFacts(page: AutomatorPage): Promise<RenderFacts> {
  const data = await page.data();
  const transcript: AutomatorElement | null = await page.$('#transcript');
  const rows = transcript ? await transcript.$$('.tr__row') : [];
  const activeRows = transcript ? await transcript.$$('.is-active-line') : [];
  return {
    activeTrack: String(data.activeTrack ?? ''),
    activeSegIdx: Number(data.activeSegIdx ?? -1),
    playerScrollTop: Number(data.playerScrollTop ?? -1),
    positionLabel: String(data.positionLabel ?? ''),
    playerProgressPct: Number(data.playerProgressPct ?? -1),
    realScrollTop: await readRealScrollTop(page),
    transcriptRows: rows.length,
    activeRows: activeRows.length,
    showLocateBar: Boolean(data.showLocateBar),
  };
}

/** 高亮行相对视口的位置事实。 */
export interface ActiveRowRect {
  top: number;
  bottom: number;
  viewportHeight: number;
  visible: boolean;
}

/**
 * 读「当前高亮行」的真实位置与可见性。
 *
 * 不用 `scrollTop > 0` 判落位：短台本（如 DG）全部行本来就在首屏，滚动 0 也对。
 */
export async function readActiveRowRect(page: AutomatorPage): Promise<ActiveRowRect | null> {
  const transcript = await page.$('#transcript');
  const viewport = await page.$('#transcriptViewport');
  if (!transcript || !viewport) {
    return null;
  }
  const active = await transcript.$('.is-active-line');
  if (!active) {
    return null;
  }
  const rect = await active.offset();
  const rowSize = await active.size().catch(() => ({ width: 0, height: 0 }));
  const viewSize = await viewport.size().catch(() => ({ width: 0, height: 0 }));

  const top = Number(rect.top);
  const height = Number(rowSize.height) || 0;
  const bottom = top + height;
  const viewportHeight = Number(viewSize.height) || 0;
  const visible = viewportHeight > 0 && top >= -1 && bottom <= viewportHeight + 1;
  return { top, bottom, viewportHeight, visible };
}

/**
 * 读取该课的**已提交断点**（`progressJournal` 落盘的单一写入通道）。
 *
 * 为什么不用页面显示的时间/句号判定「有没有串写」：显示位置由渲染链路决定
 * （镇定窗口、迟到事件都会影响），而断点是否被覆盖是数据事实。
 * 约束：e2e 只读不写，写入仍然只走产品自己的通道。
 */
export interface CommittedProgress {
  pb: { ms: number; seg: number };
  dg: { ms: number; seg: number };
}

export async function readCommitted(
  mp: AutomatorMiniProgram,
  lessonId: string,
): Promise<CommittedProgress | null> {
  const raw = await mp.evaluate(function (id: string) {
    var key = 'ep_learning_v2_record_' + id;
    var value = wx.getStorageSync(key);
    if (!value) return null;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch (error) {
        return null;
      }
    }
    var rec = value as unknown as {
      podcast?: { committedPositionMs?: number; committedSegmentIndex?: number };
      dialogue?: { committedPositionMs?: number; committedSegmentIndex?: number };
    };
    var podcast = rec.podcast || {};
    var dialogue = rec.dialogue || {};
    return {
      pb: {
        ms: Number(podcast.committedPositionMs) || 0,
        seg: Number(podcast.committedSegmentIndex) || 0,
      },
      dg: {
        ms: Number(dialogue.committedPositionMs) || 0,
        seg: Number(dialogue.committedSegmentIndex) || 0,
      },
    };
  }, lessonId);
  return (raw as unknown as CommittedProgress) ?? null;
}

/**
 * 真实播放状态（不只读 UI）。
 *
 * `uiPlaying` 是页面下发的状态，`bamPaused` 才是**音频实际有没有在响**——两者不一致
 * 正是「暂停态切轨自己播起来」的形态（UI 显示暂停，BAM 却在播 / 或反之）。
 */
export interface PlaybackState {
  uiPlaying: boolean;
  bamPaused: boolean;
  playRequested: boolean;
  positionLabel: string;
}

export async function readPlaybackState(mp: AutomatorMiniProgram): Promise<PlaybackState> {
  const raw = await mp.evaluate(function () {
    var pages = getCurrentPages();
    var page = pages[pages.length - 1];
    var bam = wx.getBackgroundAudioManager();
    return {
      uiPlaying: !!(page && page.data && page.data.isPlaying),
      bamPaused: !!bam.paused,
      playRequested: !!(page && page.playRequested),
      positionLabel: String((page && page.data && page.data.positionLabel) || ''),
    };
  });
  return raw as unknown as PlaybackState;
}

/** 截图到指定目录，返回文件路径；失败返回 null（不打断场景）。 */
export async function capture(
  mp: AutomatorMiniProgram,
  dir: string,
  name: string,
): Promise<string | null> {
  const file = path.join(dir, `${name}.png`);
  try {
    await mp.screenshot({ path: file });
    return file;
  } catch {
    return null;
  }
}

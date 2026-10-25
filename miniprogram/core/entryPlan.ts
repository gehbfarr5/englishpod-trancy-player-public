/**
 * ============================================================================
 *  入口 → 加载计划（core/entryPlan.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  规范来源：EP-PBC-001 **v1.2**
 *    - §2 行为矩阵（五种入口各自的音轨 / 位置 / 播放态 / 锚点）
 *    - §2 边界条（手动导航首尾禁用、不环绕；自然结束的连播不受此限）
 *    - §3.2 第 3/4 条 + 首尾循环边界规则（末课 PB 自然结束 → 第一课 00:00）
 *    - §4.1.2 / §4.1.6（00:00 不覆盖历史断点；已完成/末尾从 00:00 恢复）
 *
 *  为什么要有这个模块：
 *    0.3.6 里「用什么音轨、从哪个位置开播、开播后要不要播、要不要关单句循环、
 *    上一/下一课按钮是否可用」全部散在 `pages/player/index.ts` 的
 *    `loadLessonDetail()` 一个函数里，且**所有入口共用一套逻辑**。于是出现了
 *    五个规范偏差（手动导航恢复断点而非 00:00、手动切课不关单句循环、无条件
 *    播放、连播目标恢复断点、迟到 play 覆盖用户暂停），而且页面级代码无法单测。
 *
 *    这里把「决策」提成纯函数：输入是意图 + 索引 + 记录 + 运行态，输出是一份
 *    加载计划。页面只负责按计划调用音频 API。所有 §2/§3.2 的可观察行为因此
 *    都能在 `core/entryPlan.test.ts` 里锁死，不依赖真机或人工点。
 *
 *  刻意不做的事：不碰音频、不读存储、不读时钟、不拼 UI 文案。
 * ============================================================================
 */

import { LessonLearningRecord, resolveResumePositionMs } from './learningRecord';
import { AudioTrackKey } from './types';

/**
 * 打开一门课的意图（§2 矩阵的四种加载入口）。
 *
 * 注：`trackSwitch`（同课 PB ↔ DG）不走本模块——它不换课，位置取目标音轨自身
 * 断点，由播放页就地处理（§2 矩阵「同课切轨」行）。
 */
export type EntryMode =
  /** 点击课程列表普通课程项。 */
  | 'library'
  /** 点击「继续收听」卡片（主体或播放图标）。 */
  | 'resume'
  /** Shared lesson deep link: open the Podcast at 00:00 and wait for an explicit play tap. */
  | 'shareEntry'
  /** 页内手动上一课 / 下一课。 */
  | 'manualNav'
  /** PB 自然结束触发的自动连播（含末课环绕回第一课）。 */
  | 'autoNext';

/**
 * 手机端「自动连播」固定为生效（§3.2 端差异）。
 *
 * v1.1 起手机端（iOS / Android / 小程序）不提供开关、不提供替代控件；
 * `DevicePreferences.autoNextPodcastEnabled` 仍按 §4 同构持久化，但**不参与**
 * 手机端播放决策，避免设备上残留的 false 把连播关掉。
 */
export const MOBILE_AUTO_NEXT_ENABLED = true;

/** 计划输入。 */
export interface EntryPlanInput {
  /** 本次加载意图。 */
  readonly mode: EntryMode;
  /** 目标课在索引中的下标；未知传 -1（例如索引尚未返回）。 */
  readonly targetIndex: number;
  /** 课程总数；未知传 0。 */
  readonly indexLength: number;
  /** 目标课的学习记录（决定恢复位置）；无记录传 null。 */
  readonly record: LessonLearningRecord | null;
  /** 当前活动音轨（仅 `manualNav` 用于继承，§2 矩阵第二行）。 */
  readonly currentTrack: AudioTrackKey;
  /** 触发前的播放态（仅 `manualNav` 继承，§2 矩阵第二行）。 */
  readonly wasPlaying: boolean;
}

/** 一次加载的计划。 */
export interface EntryPlan {
  /** 目标音轨。 */
  readonly track: AudioTrackKey;
  /** 起播位置（毫秒）；**0 表示明确的 00:00**，不得写掉历史断点（§4.1.2）。 */
  readonly startMs: number;
  /** 加载完成后是否请求播放（用户最新意图优先，§5.2）。 */
  readonly autoPlay: boolean;
  /** 是否强制关闭单句循环（§2：手动切课 / 连播都关；音轨循环保留）。 */
  readonly resetSingleSentenceLoop: boolean;
  /** 手动「上一课」按钮是否可用（首课禁用，不环绕）。 */
  readonly canGoPrev: boolean;
  /** 手动「下一课」按钮是否可用（末课禁用，不环绕）。 */
  readonly canGoNext: boolean;
  /**
   * 自动连播目标下标：有下一课则下行，**末课环绕到 0**；单课库同样是 0
   * （同课 00:00 重播，F13）。无法判定时为 null。
   *
   * 与 {@link EntryPlan.canGoNext} **必须分开**：手动按钮在末课禁用，
   * 自动连播在末课环绕，这是两件事（§2 边界条、E04 / F09）。
   */
  readonly autoNextTargetIndex: number | null;
}

/** 归一化课程总数（非法 / 负数 → 0）。 */
function normalizeLength(indexLength: number): number {
  return Number.isFinite(indexLength) && indexLength > 0 ? Math.trunc(indexLength) : 0;
}

/** 归一化下标（非法 → -1）。 */
function normalizeIndex(targetIndex: number): number {
  return Number.isFinite(targetIndex) ? Math.trunc(targetIndex) : -1;
}

/**
 * 生成一次加载计划（§2 矩阵 / §3.2）。
 *
 * 决策表：
 *   | mode      | track        | startMs                    | autoPlay     | 关单句循环 |
 *   | library   | pb           | PB 有效断点（完成/末尾→0） | true         | false      |
 *   | resume    | pb           | 同上                       | true         | false      |
 *   | shareEntry| pb           | **0**                      | false        | false      |
 *   | manualNav | 继承当前音轨 | **0**                      | = wasPlaying | **true**   |
 *   | autoNext  | pb           | **0**                      | true         | **true**   |
 */
export function planEntry(input: EntryPlanInput): EntryPlan {
  const length = normalizeLength(input.indexLength);
  const index = normalizeIndex(input.targetIndex);
  const canGoPrev = index > 0;
  const canGoNext = index >= 0 && length > 0 && index < length - 1;
  const autoNextTargetIndex = nextLessonIndex(index, length);

  switch (input.mode) {
    case 'manualNav':
      return {
        // §2 矩阵第二行：手动上一/下一课**继承** PB/DG，不再回 PB。
        track: input.currentTrack === 'dg' ? 'dg' : 'pb',
        // §2 / §4.1.2：手动导航一律 00:00，且不得把历史断点写成 00:00。
        startMs: 0,
        // §2 / §5.2：继承现有播放/暂停，不用发起时的布尔值覆盖加载期间的新意图。
        autoPlay: input.wasPlaying,
        resetSingleSentenceLoop: true,
        canGoPrev,
        canGoNext,
        autoNextTargetIndex,
      };
    case 'autoNext':
      return {
        // §3.2 第 3 条：只有 PB 连播；末课环绕目标同样是 PB。
        track: 'pb',
        // §2 / §3.2：连播目标恒 00:00，即使它有历史断点也不续播（F14）。
        startMs: 0,
        autoPlay: true,
        resetSingleSentenceLoop: true,
        canGoPrev,
        canGoNext,
        autoNextTargetIndex,
      };
    case 'shareEntry':
      return {
        track: 'pb',
        startMs: 0,
        autoPlay: false,
        resetSingleSentenceLoop: false,
        canGoPrev,
        canGoNext,
        autoNextTargetIndex,
      };
    case 'resume':
    case 'library':
    default:
      return {
        // §2 矩阵：普通列表与继续收听**一律 PB**，不恢复 DG 作为默认音轨。
        track: 'pb',
        // §4.1.6：已完成 PB / 停在末尾的 DG → 0；否则按有效断点恢复。
        startMs: resolveResumePositionMs(input.record, 'pb'),
        autoPlay: true,
        resetSingleSentenceLoop: false,
        canGoPrev,
        canGoNext,
        autoNextTargetIndex,
      };
  }
}

/**
 * 自动连播的下一个下标（**含末课环绕**，§3.2 首尾循环规则）。
 *
 * - 非末课 → `currentIndex + 1`
 * - 末课 → `0`（F09）
 * - 单课库 → `0`（同课重播，F13）
 * - 索引未知 / 空索引 → null
 */
export function nextLessonIndex(currentIndex: number, indexLength: number): number | null {
  const length = normalizeLength(indexLength);
  const index = normalizeIndex(currentIndex);
  if (length === 0 || index < 0) {
    return null;
  }
  if (index >= length - 1) {
    return 0;
  }
  return index + 1;
}

/** 手动「上一课」目标（**不环绕**，§2 边界条）。 */
export function manualPrevIndex(currentIndex: number): number | null {
  const index = normalizeIndex(currentIndex);
  return index > 0 ? index - 1 : null;
}

/** 手动「下一课」目标（**不环绕**，末课返回 null，§2 边界条 / E04）。 */
export function manualNextIndex(currentIndex: number, indexLength: number): number | null {
  const length = normalizeLength(indexLength);
  const index = normalizeIndex(currentIndex);
  if (index < 0 || length === 0 || index >= length - 1) {
    return null;
  }
  return index + 1;
}

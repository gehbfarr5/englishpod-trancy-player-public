/**
 * ============================================================================
 *  进度引擎（core/progressEngine.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  职责：把「原始进度记录」加工成课程库 UI 需要的派生数据——各筛选计数、
 *        完成度计数、继续收听课程选择。
 *
 *  设计原则：
 *   1. **纯函数、零副作用**：不读写全局状态、不触碰 `wx.*`、不修改入参；
 *   2. **判定口径唯一**：所有「是否完成 / 是否已开始 / 进度百分比」的判定
 *      统一走本文件导出的 {@link isLessonCompleted} / {@link hasLessonStarted}，
 *      与 `core/types.ts` 的 `ProgressState` / `deriveProgressState` 保持同一套语义，
 *      坚决不另立一套阈值；
 *   3. **与 Flutter 端一致**：判定规则逐字对齐 `main.dart` 的 `_filteredLessonsFor`
 *      与 `_buildCourseCard`（`isCompleted || pct >= 95`；`hasStarted || isCompleted || pct > 0`）。
 *
 *  时间单位：秒（number, float）。进度百分比为 0..100 的数值。
 * ============================================================================
 */

import {
  LessonProgressRecord,
  ProgressMap,
  ProgressState,
  PROGRESS_NEAR_END_PCT,
  deriveProgressState,
} from './types';

/** 课程库筛选态（对齐 Flutter `_libraryFilter`：`all` / `in_progress` / `completed`）。 */
export type LibraryFilterKey = 'all' | 'in_progress' | 'completed';

/** 三态筛选计数。 */
export interface FilterCounts {
  /** 全部课程数。 */
  all: number;
  /** 进行中（已开始且未达标）。 */
  inProgress: number;
  /** 已完成数。 */
  completed: number;
}

/**
 * 是否「已完成」。
 *
 * 口径：用户显式标记 `isCompleted`，或实时进度已达 {@link PROGRESS_NEAR_END_PCT}%。
 * 缺记录视为未完成。
 */
export function isLessonCompleted(record: LessonProgressRecord | undefined | null): boolean {
  if (!record) {
    return false;
  }
  const pct = normalizePct(record.progressPct);
  return record.isCompleted === true || pct >= PROGRESS_NEAR_END_PCT;
}

/**
 * 是否「已开始过」。
 *
 * 口径：`hasStarted`，或已完成，或实时进度 > 0。
 * 用于区分「全新」与「从头回放」（已开始但 0% 的不算 New）。
 */
export function hasLessonStarted(record: LessonProgressRecord | undefined | null): boolean {
  if (!record) {
    return false;
  }
  if (isLessonCompleted(record)) {
    return true;
  }
  return record.hasStarted === true || normalizePct(record.progressPct) > 0;
}

/** 取某课的进度百分比（0..100，缺记录或非法值返回 0）。 */
export function progressPctOf(record: LessonProgressRecord | undefined | null): number {
  if (!record) {
    return 0;
  }
  return normalizePct(record.progressPct);
}

/**
 * 计算各筛选态的计数（用于 pill 文案 `All (30)`、Header 的 `X / 30 Done` 分子，以及徽标计数）。
 *
 * ⚠️ 这是「各态计数」的**唯一入口**：Header 的完成度分子必须用返回值的 `completed`，
 * 不要另立一个遍历全部 `records` 键的统计函数——分母 `all` 来自课程库范围
 * （`lessonIds`），两把尺子量同一件事会导致分子分母口径分叉。
 *
 * @param records  进度映射。
 * @param lessonIds 课程号列表（仅统计出现在该列表中的课程，保持课程库范围）。
 */
export function countByFilter(records: ProgressMap, lessonIds: readonly string[]): FilterCounts {
  let inProgress = 0;
  let completed = 0;

  for (const id of lessonIds) {
    const record = records[id];
    if (isLessonCompleted(record)) {
      completed += 1;
      continue;
    }
    if (hasLessonStarted(record)) {
      inProgress += 1;
    }
  }

  return {
    all: lessonIds.length,
    inProgress,
    completed,
  };
}

/**
 * 按筛选态过滤课程号列表（保持入参顺序，不做去重/排序，交由调用方决定）。
 */
export function filterLessonIds(
  records: ProgressMap,
  lessonIds: readonly string[],
  filter: LibraryFilterKey,
): string[] {
  if (filter === 'all') {
    return lessonIds.slice();
  }

  return lessonIds.filter((id) => {
    const record = records[id];
    if (filter === 'completed') {
      return isLessonCompleted(record);
    }
    // in_progress：已开始且未达标（与 Flutter 的 `hasStarted && pct < 95` 对齐）
    return hasLessonStarted(record) && !isLessonCompleted(record);
  });
}

/**
 * 课程卡片派生状态（角标文案 + 进度条取值 + 高亮）。
 */
export interface CardStatus {
  /** 角标文案：`New` / `Resume 42%` / `Done 100%` / `Replay 0%` ...。 */
  statusLabel: string;
  /** 进度条取值（0..1）。 */
  barValue: number;
  /** 是否已完成。 */
  isDone: boolean;
  /** 角标是否高亮（已开始 / 已完成）。 */
  highlight: boolean;
}

/**
 * 由进度记录派生课程卡片状态。
 *
 * 口径逐字对齐 Flutter `_buildCourseCard`：
 *   - `Done 100%`（完成且进度 ≥ 95，进度条拉满）
 *   - `Replay $pct%`（完成但停在中间）/ `Replay 0%`（完成但归零）
 *   - `Resume $pct%`（未完成且进度 > 0）/ `Resume 0%`（已开始但 0%）
 *   - `New`（从未开始）
 */
export function deriveCardStatus(record: LessonProgressRecord | undefined | null): CardStatus {
  const pct = progressPctOf(record);
  const isDone = isLessonCompleted(record);
  const hasStarted = hasLessonStarted(record);

  let statusLabel = 'New';
  let barValue = Math.min(1, Math.max(0, pct / 100));

  if (isDone) {
    if (pct >= PROGRESS_NEAR_END_PCT) {
      statusLabel = 'Done 100%';
      barValue = 1;
    } else if (pct > 0) {
      statusLabel = `Replay ${pct}%`;
    } else {
      statusLabel = 'Replay 0%';
    }
  } else if (pct > 0) {
    statusLabel = `Resume ${pct}%`;
  } else if (hasStarted) {
    statusLabel = 'Resume 0%';
  }

  return {
    statusLabel,
    barValue,
    isDone,
    highlight: isDone || hasStarted || pct > 0,
  };
}

/**
 * 「继续收听」聚光灯卡需要展示的信息。
 */
export interface ContinueLessonInfo {
  /** 课程 ID。 */
  lessonId: string;
  /** 实时进度百分比（0..100）。 */
  progressPct: number;
  /** 六态派生结果（与卡片角标语义共用一套口径）。 */
  progressState: ProgressState;
  /** 是否已开始过。 */
  hasStarted: boolean;
  /** 是否已完成。 */
  isCompleted: boolean;
  /** 当前所在片段索引（Podcast `pbSegIdx`）。 */
  currentSegmentIndex: number;
  /** 当前播放位置（秒）。 */
  currentPosSec: number;
  /** Podcast 音轨总时长（秒）。 */
  durationSec: number;
  /** 徽章文案：`CONTINUE LISTENING` / `START LISTENING` / `LESSON COMPLETED` / `REPLAYING LESSON`。 */
  badge: string;
  /** 实时当前句文本（由 {@link ContinueResolver.resolveSentenceText} 提供；缺省为空串）。 */
  sentenceText: string;
}

/**
 * 继续收听解析上下文（可选）。
 *
 * 用于把「纯进度信息」与「课程正文」解耦：core 不持有课程详情，
 * 由页面注入一个解析器，用 `lessonId + segIdx` 取出实时句文本。
 */
export interface ContinueResolver {
  /** 依据课程 ID 与片段索引返回实时当前句文本；无正文时返回空串。 */
  resolveSentenceText?: (lessonId: string, segmentIndex: number) => string;
}

/**
 * 选择「继续收听」的课程。
 *
 * 选择规则（对齐 Flutter `_renderTopLiveCard` 的 `_lastPlayedLessonId` 优先策略）：
 *   1. 若 `lastPlayedLessonId` 在记录中存在 → 选它；
 *   2. 否则选 `updatedAtMs` 最大（最近更新）的那条记录；
 *   3. `records` 为空（无任何记录）→ 返回 `null`。
 *
 * @param records           进度映射。
 * @param lastPlayedLessonId 最近播放课程 ID（可为空串/undefined）。
 * @param resolver          可选的实时句文本解析上下文。
 */
export function pickContinueLesson(
  records: ProgressMap,
  lastPlayedLessonId: string | undefined,
  resolver?: ContinueResolver,
): ContinueLessonInfo | null {
  const chosen = pickContinueLessonId(records, lastPlayedLessonId);
  if (!chosen) {
    return null;
  }

  const record = records[chosen];
  const lessonId = chosen;
  const progressPct = progressPctOf(record);
  const isCompleted = isLessonCompleted(record);
  const hasStarted = hasLessonStarted(record);

  let badge: string;
  if (isCompleted) {
    badge = progressPct >= PROGRESS_NEAR_END_PCT ? 'LESSON COMPLETED' : 'REPLAYING LESSON';
  } else if (hasStarted) {
    badge = 'CONTINUE LISTENING';
  } else {
    badge = 'START LISTENING';
  }

  const currentSegmentIndex = Math.max(0, Math.trunc(record.pbSegIdx || 0));
  const sentenceText = resolver?.resolveSentenceText
    ? resolver.resolveSentenceText(lessonId, currentSegmentIndex)
    : '';

  return {
    lessonId,
    progressPct,
    progressState: deriveProgressState(record),
    hasStarted,
    isCompleted,
    currentSegmentIndex,
    currentPosSec: Number.isFinite(record.pbPosSec) ? record.pbPosSec : 0,
    durationSec: Number.isFinite(record.pbDurSec) ? record.pbDurSec : 0,
    badge,
    sentenceText,
  };
}

/** 继续收听卡切换键决策上下文（纯快照输入，零平台依赖）。 */
export interface ContinueToggleContext {
  /** 继续收听卡指向的课程 ID（空串表示无可继续课程）。 */
  targetLessonId: string;
  /** 当前播放会话记录的课程 ID（空串表示本进程尚无会话）。 */
  sessionLessonId: string;
  /** 会话是否正在播放。 */
  isPlaying: boolean;
  /** 会话最近已知播放位置（秒；冷启动可从持久化记录恢复为正值）。 */
  positionSec: number;
  /** 本进程是否已为 BackgroundAudioManager 赋过 `src`（冷启动恒为 false）。 */
  srcLoadedInProcess: boolean;
}

/** 继续收听卡切换键动作：`toggle`（就地切换播放/暂停）/ `navigate`（进播放器页）/ `none`（无动作）。 */
export type ContinueToggleAction = 'toggle' | 'navigate' | 'none';

/**
 * 决定继续收听卡切换键的动作。
 *
 * 关键防线：冷启动（进程刚拉起、BAM 从未赋过 `src`）时，即便 `initFromStorage`
 * 已恢复 `positionSec > 0` 的旧进度，也不能直接 `bam.play()`——无源的 BAM 调用
 * 会被静默吞掉，表现为按键无响应；此时必须导航进播放器页重新加载音频源。
 */
export function resolveContinueToggleAction(ctx: ContinueToggleContext): ContinueToggleAction {
  if (!ctx.targetLessonId) {
    return 'none';
  }
  const sessionMatches = !!ctx.sessionLessonId && ctx.sessionLessonId === ctx.targetLessonId;
  const sessionResumable = ctx.isPlaying || ctx.positionSec > 0;
  if (sessionMatches && ctx.srcLoadedInProcess && sessionResumable) {
    return 'toggle';
  }
  return 'navigate';
}

/** 选出继续收听的课程 ID（内部复用；无可用记录返回空串）。 */
function pickContinueLessonId(
  records: ProgressMap,
  lastPlayedLessonId: string | undefined,
): string {
  const ids = Object.keys(records);
  if (ids.length === 0) {
    return '';
  }
  if (lastPlayedLessonId && Object.prototype.hasOwnProperty.call(records, lastPlayedLessonId)) {
    return lastPlayedLessonId;
  }

  // 回退：取 updatedAtMs 最大者；并列时按课程 ID 升序稳定取第一个。
  let bestId = '';
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const id of ids) {
    const record = records[id];
    const at = Number.isFinite(record.updatedAtMs) ? record.updatedAtMs : 0;
    if (bestId === '' || at > bestAt || (at === bestAt && id < bestId)) {
      bestId = id;
      bestAt = at;
    }
  }
  return bestId;
}

/** 把任意值规整为 0..100 的有限数值。 */
function normalizePct(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

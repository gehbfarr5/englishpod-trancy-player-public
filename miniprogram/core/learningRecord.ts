/**
 * ============================================================================
 *  学习进度持久化模型（core/learningRecord.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  规范来源：`docs/product/playback-behavior-contract.md` EP-PBC-001 v1.0 FINAL
 *    - §4   新版持久化数据模型（DevicePreferences / LessonLearningRecord /
 *           ResumeAnchor / RuntimeState）
 *    - §4.1 断点写入定义（10 条）
 *    - §3.1 完成判定（只由 PB 决定；Seek 到 95% 不算完成）
 *
 *  本文件**取代**旧实现（`core/progressGuard.ts` 的 30s 防回退阈值 +
 *  `core/types.ts` 的 `LessonProgressRecord` 作为持久化结构）。旧结构现在只剩
 *  「课程库 UI 投影」一个用途（见 {@link toProgressView}），不再落盘。
 *
 *  设计要点（逐条对应规范）：
 *    1. **双轨独立提交**：`podcast` / `dialogue` 各自持有 `committedPositionMs`
 *       （§4）。它们是「已提交的有效断点」，与运行时播放头（RuntimeState.playheadMs）
 *       是两件事：手动切课被定位到 00:00 只改播放头，不改已提交断点（§4.1.2）。
 *    2. **只接受媒体真实位置**：调用方必须传入 BAM/音频引擎回报的位置，
 *       不得传插值位置。插值只在「seek 失败后从 0 起播」时把播放头算成 0 附近，
 *       一旦落盘就是污染（§4.1.2 / §4.1.8）。
 *    3. **写入版本单调递增**：每次被接受的写入 `revision + 1`，存储层拒绝
 *       版本不大于已存版本的写入，旧异步写入永远不会盖掉新写入（§4.1.4）。
 *    4. **完成标记与位置解耦**：`lessonCompleted` 只能由 {@link markLessonCompleted}
 *       置 true，位置提交永远不会改它；位置提交也永远不会因 `lessonCompleted`
 *       而失败（§4.1.5 / §3.1）。
 *    5. **不做旧测试版迁移**：schema 版本 + 新命名空间（storage 层），
 *       旧 `ep_study_progress_v1` 数据既不读取也不删除（§4.1.10）。
 * ============================================================================
 */

import { AudioTrackKey, LessonProgressRecord, PLAYBACK_RATES, PlaybackRate, PROGRESS_NEAR_END_PCT } from './types';

/** 当前落盘 schema 版本（§4 `schemaVersion`；0.x 测试版不参与兼容）。 */
export const LEARNING_SCHEMA_VERSION = 2;

/** PB 完成阈值（%）——只由 Podcast 决定整课完成（§3.1）。 */
export const PB_COMPLETED_PCT = PROGRESS_NEAR_END_PCT;

/**
 * 视为「时间轴最前面 / 等于 00:00」的位置上限（毫秒）。
 *
 * 1s 以内既可能是真实的极早暂停，也可能是恢复 seek 失败后的起播位置；
 * 两者都无法证明用户有意把断点改到 00:00，所以非显式 Seek 一律不提交（§4.1.2）。
 */
export const ZERO_POSITION_THRESHOLD_MS = 1000;

/** 判定「停在末尾」的容差（毫秒）：DG 停在末尾下次从 00:00（§4.1.6）。 */
export const END_TOLERANCE_MS = 1500;

/** 单条音轨的已提交断点（§4 `podcast` / `dialogue`）。 */
export interface TrackPoint {
  /** 已提交的有效断点（毫秒，≥0，限于有效时长内）。 */
  committedPositionMs: number;
  /** 断点所在句索引（§4 `committedSegmentIdOrIndex`）。 */
  committedSegmentIndex: number;
  /** 可选时长缓存（毫秒），变化时校验（§4 `durationMs?`）。 */
  durationMs?: number;
}

/**
 * 单课学习记录（§4 `LessonLearningRecord[lessonId]`）。
 *
 * 注意：这里**没有** `lastTrack`。规范把「当前音轨」归入 RuntimeState，
 * 不持久化；持久化的只有每课双轨断点、完成标记与写入版本。
 */
export interface LessonLearningRecord {
  /** 落盘 schema 版本。 */
  schemaVersion: number;
  /** 课程 ID（冗余存档，便于损坏时逐条定位）。 */
  lessonId: string;
  /** 课程是否已完成；true 后不可自动撤销（§3.1）。 */
  lessonCompleted: boolean;
  /** Podcast 断点；从未提交过为 null。 */
  podcast: TrackPoint | null;
  /** Dialogue 断点；从未提交过为 null。 */
  dialogue: TrackPoint | null;
  /** 写入版本（§4.1.4）：每次被接受的写入 +1，只增不减。 */
  revision: number;
  /** 仅用于日志与「继续收听」回退排序（§4 `updatedAt?`）。 */
  updatedAtMs: number;
}

/** 设备级偏好（§4 `DevicePreferences`）。 */
export interface DevicePreferences {
  schemaVersion: number;
  /** 首次 `standard`（§6）。 */
  uiMode: 'standard' | 'immersive';
  /** 首次 `true`；只对 PB 生效（§3.2）。 */
  autoNextPodcastEnabled: boolean;
  /** 播放倍速偏好（§4 / v1.3）。支持 0.8 | 0.9 | 1.0 | 1.1 | 1.25，默认 1.0。 */
  playbackRate: PlaybackRate;
}

/** 恢复锚点（§4 `ResumeAnchor`）：最后成功打开的课，与是否播放无关（§4.1.7）。 */
export interface ResumeAnchor {
  schemaVersion: number;
  lastOpenedLessonId: string | null;
}

/** 触发一次位置提交的意图。 */
export type CommitReason =
  /** 播放中约 3s 的定期保存（§4.1.1）。 */
  | 'periodic'
  /** 暂停（§4.1.1）。 */
  | 'pause'
  /** 用户显式 Seek / 拖动 / 跳句 / 重听（§4.1.3）。 */
  | 'userSeek'
  /** 切轨前保存离开的音轨（§4.1.1 / §5.2）。 */
  | 'trackSwitch'
  /** 切课前保存离开的课（§4.1.1 / §5.2）。 */
  | 'lessonSwitch'
  /** 可信自然结束（§3.1）。 */
  | 'naturalEnd'
  /** 页面隐藏 / 后台（§4.1.1）。 */
  | 'appHide';

/** 拒绝写入的原因（供诊断 `progress_guard_hold` 归因）。 */
export type CommitHoldReason =
  /** 位置非法（NaN / 负数 / 未知）。 */
  | 'invalid-position'
  /** 音频加载锁定期：位置不可信（§4.1.2）。 */
  | 'load-lock'
  /** 非显式 Seek 的 00:00 / 极早位置，会覆盖历史断点（§4.1.2）。 */
  | 'zero-overwrite'
  /** 媒体位置明显落后于我们放置的播放头：恢复 seek 被平台静默丢弃（§4.1.2）。 */
  | 'resume-seek-missed'
  /** 无播放头锚点可参照时，非显式 Seek 的倒退写入（保守拦截）。 */
  | 'backward-without-seek';

/** 一次位置提交的判定结果。 */
export interface CommitDecision {
  readonly commit: boolean;
  readonly holdReason: CommitHoldReason | null;
  /** 通过判定时规整后的断点；被拒为 null。 */
  readonly point: TrackPoint | null;
}

/**
 * 播放头锚点容差（毫秒）。
 *
 * 锚点是「我们要求媒体停在哪里」（恢复 seek 目标 / 用户 Seek 目标）。媒体真实
 * 位置比锚点落后超过该容差，只可能是 seek 被平台丢掉了——此时不能把落后位置
 * 当成用户意图写进断点。
 */
export const PLAYHEAD_ANCHOR_TOLERANCE_MS = 2000;

/** 位置提交输入。 */
export interface CommitInput {
  /** 目标音轨。 */
  readonly track: AudioTrackKey;
  /** **媒体真实位置**（毫秒）。禁止传插值位置。 */
  readonly positionMs: number;
  /** 当前句索引。 */
  readonly segmentIndex: number;
  /** 已知时长（毫秒）。 */
  readonly durationMs?: number;
  /** 触发意图。 */
  readonly reason: CommitReason;
  /** 该课当前已提交记录。 */
  readonly record: LessonLearningRecord;
  /** 是否处于音频加载锁定期（§4.1.2）。 */
  readonly loading?: boolean;
  /**
   * 播放头锚点（毫秒）：最近一次「载入后 seek 目标」或「用户 Seek 目标」。
   * `undefined` 表示未知（后台侧没有锚点信息），此时对倒退采取保守拦截。
   */
  readonly anchorMs?: number;
}

/** 创建一条空的课程记录。 */
export function createLearningRecord(lessonId: string, nowMs = 0): LessonLearningRecord {
  return {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    lessonId,
    lessonCompleted: false,
    podcast: null,
    dialogue: null,
    revision: 0,
    updatedAtMs: nowMs,
  };
}

/** 取某轨已提交断点（无则 null）。 */
export function trackPointOf(
  record: LessonLearningRecord,
  track: AudioTrackKey,
): TrackPoint | null {
  return track === 'pb' ? record.podcast : record.dialogue;
}

/** 有限数值或回退。 */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 规整一个断点（损坏隔离，§4.1.9）。
 *
 * 缺失/非法字段一律回退默认值；位置钳制到 `[0, durationMs]`（时长已知时），
 * 绝不把无效时长或时间传播给下游。
 */
export function normalizeTrackPoint(raw: unknown): TrackPoint | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const rawDuration = finite(obj.durationMs, 0);
  const durationMs = rawDuration > 0 ? Math.trunc(rawDuration) : undefined;
  let positionMs = Math.trunc(finite(obj.committedPositionMs, -1));
  if (positionMs < 0) {
    return null;
  }
  if (durationMs !== undefined && positionMs > durationMs) {
    positionMs = durationMs;
  }
  return {
    committedPositionMs: positionMs,
    committedSegmentIndex: Math.max(0, Math.trunc(finite(obj.committedSegmentIndex, 0))),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

/**
 * 规整一条课程记录（§4.1.9 损坏隔离单元 = 一课）。
 *
 * 任何字段坏掉只影响本课：能读的断点保留，读不了的退回「从未提交」。
 */
export function normalizeLearningRecord(
  lessonId: string,
  raw: unknown,
  nowMs = 0,
): LessonLearningRecord {
  const base = createLearningRecord(lessonId, nowMs);
  if (typeof raw !== 'object' || raw === null) {
    return base;
  }
  const obj = raw as Record<string, unknown>;
  const podcast = normalizeTrackPoint(obj.podcast);
  const dialogue = normalizeTrackPoint(obj.dialogue);
  const revision = Math.max(0, Math.trunc(finite(obj.revision, 0)));
  return {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    lessonId,
    // 完成标记只认明确的 true（§3.1：单向持久事实，不能被坏数据翻转）。
    lessonCompleted: obj.lessonCompleted === true,
    podcast,
    dialogue,
    revision,
    updatedAtMs: Math.max(0, Math.trunc(finite(obj.updatedAtMs, nowMs))),
  };
}

/**
 * 判定一次位置提交是否落地（§4.1.2 / §4.1.3）。
 *
 * 规则（按优先级）：
 *   1. 加载锁定期 → 拒绝（`load-lock`）。此时位置来自尚未就绪的播放器。
 *   2. 位置非法（非有限数 / <0）→ 拒绝（`invalid-position`）。
 *   3. 显式 Seek → **一律接受**，包括 0 与倒退（§4.1.3：用户主动改变断点）。
 *   4. 已知播放头锚点且媒体落后锚点超过容差 → 拒绝（`resume-seek-missed`）。
 *      媒体不该在那里，说明恢复 seek / 用户 seek 被平台静默丢弃（BAM 已核实事实），
 *      此时的位置不是用户意图。
 *   5. 既有断点，本次仍停在 00:00 级（< {@link ZERO_POSITION_THRESHOLD_MS}）→ 拒绝
 *      （`zero-overwrite`）：只进课程 / 只完成加载 / 手动切课定位到 00:00 都不得
 *      覆盖历史断点（§4.1.2）。
 *   6. 无锚点可参照（后台侧）且本次倒退 → 拒绝（`backward-without-seek`），保守处理。
 *   7. 其余接受。注意：手动切课被定位到 00:00 后**真实播放推进**会走到这里，
 *      此时允许把断点更新为新位置（§4.1.3）。
 */
export function decidePositionCommit(input: CommitInput): CommitDecision {
  const { track, positionMs, segmentIndex, durationMs, reason, record } = input;

  if (input.loading) {
    return { commit: false, holdReason: 'load-lock', point: null };
  }
  if (!Number.isFinite(positionMs) || positionMs < 0) {
    return { commit: false, holdReason: 'invalid-position', point: null };
  }

  const knownDurationMs =
    typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0
      ? Math.trunc(durationMs)
      : undefined;
  const clamped =
    knownDurationMs !== undefined
      ? Math.min(Math.round(positionMs), knownDurationMs)
      : Math.round(positionMs);

  const point: TrackPoint = {
    committedPositionMs: clamped,
    committedSegmentIndex: Math.max(0, Math.trunc(segmentIndex)),
    ...(knownDurationMs !== undefined ? { durationMs: knownDurationMs } : {}),
  };

  if (reason === 'userSeek') {
    return { commit: true, holdReason: null, point };
  }

  const anchorMs = input.anchorMs;
  const hasAnchor = typeof anchorMs === 'number' && Number.isFinite(anchorMs);
  if (hasAnchor && clamped + PLAYHEAD_ANCHOR_TOLERANCE_MS < (anchorMs as number)) {
    return { commit: false, holdReason: 'resume-seek-missed', point: null };
  }

  const previous = trackPointOf(record, track);
  if (clamped < ZERO_POSITION_THRESHOLD_MS) {
    // 首次提交的 0 附近位置没有保存价值；已有断点的更不允许被 00:00 覆盖。
    return { commit: false, holdReason: 'zero-overwrite', point: null };
  }
  if (!hasAnchor && previous && clamped < previous.committedPositionMs) {
    return { commit: false, holdReason: 'backward-without-seek', point: null };
  }
  return { commit: true, holdReason: null, point };
}

/**
 * 应用一次已通过判定的提交（纯函数）。
 *
 * 版本号自增（§4.1.4）；只动目标音轨，另一轨原样保留（§4.1.4 不得串写）。
 */
export function applyTrackPoint(
  record: LessonLearningRecord,
  track: AudioTrackKey,
  point: TrackPoint,
  nowMs: number,
): LessonLearningRecord {
  return {
    ...record,
    podcast: track === 'pb' ? point : record.podcast,
    dialogue: track === 'dg' ? point : record.dialogue,
    revision: record.revision + 1,
    updatedAtMs: nowMs,
  };
}

/**
 * 置课程完成（§3.1 / §4.1.5）。
 *
 * 单向：已是 true 时原样返回（幂等），永不置回 false。
 */
export function markLessonCompleted(
  record: LessonLearningRecord,
  nowMs: number,
): LessonLearningRecord {
  if (record.lessonCompleted) {
    return record;
  }
  return {
    ...record,
    lessonCompleted: true,
    revision: record.revision + 1,
    updatedAtMs: nowMs,
  };
}

/** 断点是否停在末尾（时长未知时无法判定，返回 false）。 */
export function isPointAtEnd(point: TrackPoint): boolean {
  return (
    point.durationMs !== undefined
    && point.durationMs > 0
    && point.committedPositionMs >= point.durationMs - END_TOLERANCE_MS
  );
}

/**
 * 计算某轨的有效恢复位置（毫秒）——§4.1.6：
 *   - 已完成 PB：普通列表 / 继续收听进入一律 00:00（§3.1 完成是单向事实，
 *     但不把完成者的旧断点当默认入口）；
 *   - 停在末尾的 DG：下次显式进入从 00:00；
 *   - 其它：按已提交断点恢复。
 */
export function resolveResumePositionMs(
  record: LessonLearningRecord | null | undefined,
  track: AudioTrackKey,
): number {
  if (!record) {
    return 0;
  }
  const point = trackPointOf(record, track);
  if (!point) {
    return 0;
  }
  if (track === 'pb' && record.lessonCompleted) {
    return 0;
  }
  if (isPointAtEnd(point)) {
    return 0;
  }
  return point.committedPositionMs;
}

/**
 * 媒体是否在「连续推进」。
 *
 * 用于 §3.1：完成只能由真实播放跨过 95% 或可信自然结束触发。Seek 造成的
 * 位置跳变不是连续推进，因此不得据此标记完成（F02 / F04）。
 */
export function isContinuousMediaAdvance(input: {
  readonly deltaMs: number;
  readonly elapsedMs: number;
  readonly rate?: number;
  readonly toleranceMs?: number;
}): boolean {
  const tolerance = input.toleranceMs ?? 900;
  const rate = input.rate && input.rate > 0 ? input.rate : 1;
  if (!Number.isFinite(input.deltaMs) || input.deltaMs <= 0) {
    return false;
  }
  const limit = Math.max(0, input.elapsedMs) * rate + tolerance;
  return input.deltaMs <= limit;
}

/**
 * 把持久化记录投影成课程库 UI 需要的形状（**只读投影，不落盘**）。
 *
 * `progressEngine` / 课程库沿用 `LessonProgressRecord` 这套字段；它们现在只是
 * 视图模型，持久化真源是 {@link LessonLearningRecord}。
 */
export function toProgressView(record: LessonLearningRecord | null | undefined): LessonProgressRecord {
  const podcast = record ? record.podcast : null;
  const dialogue = record ? record.dialogue : null;
  const positionSec = podcast ? podcast.committedPositionMs / 1000 : 0;
  const durationSec = podcast && podcast.durationMs !== undefined ? podcast.durationMs / 1000 : 0;
  const pct =
    durationSec > 0 && positionSec >= 3
      ? Math.min(100, Math.max(0, Math.floor((positionSec / durationSec) * 100)))
      : 0;
  const isCompleted = record ? record.lessonCompleted : false;

  return {
    isCompleted,
    hasStarted: Boolean(record)
      && (isCompleted
        || Boolean(podcast && podcast.committedPositionMs > 0)
        || Boolean(dialogue && dialogue.committedPositionMs > 0)),
    progressPct: pct,
    lastTrack: 'pb',
    pbPosSec: positionSec,
    pbSegIdx: podcast ? podcast.committedSegmentIndex : 0,
    pbDurSec: durationSec,
    dgPosSec: dialogue ? dialogue.committedPositionMs / 1000 : 0,
    dgSegIdx: dialogue ? dialogue.committedSegmentIndex : 0,
    dgDurSec: dialogue && dialogue.durationMs !== undefined ? dialogue.durationMs / 1000 : 0,
    updatedAtMs: record ? record.updatedAtMs : 0,
  };
}

/** 默认设备偏好（§4 / §6）。 */
export function createDefaultPreferences(): DevicePreferences {
  return {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    uiMode: 'standard',
    autoNextPodcastEnabled: true,
    playbackRate: 1.0,
  };
}

/** 规整设备偏好（坏数据回退默认值）。 */
export function normalizePreferences(raw: unknown): DevicePreferences {
  const base = createDefaultPreferences();
  if (typeof raw !== 'object' || raw === null) {
    return base;
  }
  const obj = raw as Record<string, unknown>;
  const rate =
    typeof obj.playbackRate === 'number' &&
    (PLAYBACK_RATES as readonly number[]).includes(obj.playbackRate)
      ? (obj.playbackRate as PlaybackRate)
      : base.playbackRate;
  return {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    uiMode: obj.uiMode === 'immersive' ? 'immersive' : 'standard',
    autoNextPodcastEnabled: obj.autoNextPodcastEnabled === false ? false : true,
    playbackRate: rate,
  };
}

/** 规整恢复锚点。 */
export function normalizeResumeAnchor(raw: unknown): ResumeAnchor {
  if (typeof raw !== 'object' || raw === null) {
    return { schemaVersion: LEARNING_SCHEMA_VERSION, lastOpenedLessonId: null };
  }
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.lastOpenedLessonId === 'string' ? obj.lastOpenedLessonId : '';
  return {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    lastOpenedLessonId: id.length > 0 ? id : null,
  };
}

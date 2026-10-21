/**
 * ============================================================================
 *  进度提交日志（services/progressJournal.ts）—— 全端唯一的进度写入通道
 * ============================================================================
 *  规范来源：EP-PBC-001 §4 / §4.1（尤其 4.1.1 周期与关键事件、4.1.2 00:00 不覆盖、
 *           4.1.3 显式 Seek、4.1.4 写入版本、4.1.5 完成解耦、4.1.7 锚点解耦、
 *           4.1.8 写入失败不谎报、4.1.9 损坏隔离）
 *
 *  为什么必须只有一个通道（历史教训）：
 *    0.3.5 里 `services/playbackSession.ts` 与 `pages/player/index.ts` 各自写一份
 *    进度，两端都做「读整张表 → 改一行 → 写整张表」，再叠加 400ms 写防抖，
 *    于是陈旧读会回滚另一个写入方的 pending 值。只要存在两个写入方，这类竞争
 *    就无法靠守卫修干净。
 *
 *  本模块的职责边界：
 *    - **写**：`commit()` / `commitCompleted()` / `setLastOpenedLesson()` /
 *      `updatePreferences()`。页面与播放会话都只能调这些方法。
 *    - **读**：`readRecord()` / `resolveResumeMs()` / `lastOpenedLessonId()` /
 *      `progressViews()`。
 *    - **不做**：音频加载、UI 状态、进度条插值。位置一律由调用方传入**媒体真实
 *      位置**（BAM `currentTime` / 音频引擎位置），插值位置永远不进这里。
 * ============================================================================
 */

import { LearningStore } from '../adapters/wechat/learningStore';
import {
  CommitHoldReason,
  CommitReason,
  DevicePreferences,
  LessonLearningRecord,
  applyTrackPoint,
  decidePositionCommit,
  markLessonCompleted,
  resolveResumePositionMs,
  toProgressView,
} from '../core/learningRecord';
import { AudioTrackKey, ProgressMap } from '../core/types';

/** 加载锁兜底有效期（毫秒）：canplay 永不到达时也必须允许后续写入。 */
export const LOAD_LOCK_TIMEOUT_MS = 10000;

/** 一次提交请求。 */
export interface JournalCommitRequest {
  /** 课程 ID。 */
  readonly lessonId: string;
  /** 音轨。 */
  readonly track: AudioTrackKey;
  /** **媒体真实位置**（毫秒）。 */
  readonly positionMs: number;
  /** 当前句索引；后台侧不知道句索引时省略，保留已提交值（不得写 0 覆盖）。 */
  readonly segmentIndex?: number;
  /** 已知时长（毫秒）。 */
  readonly durationMs?: number;
  /** 触发意图。 */
  readonly reason: CommitReason;
}

/** 提交失败/被拒的原因。 */
export type JournalFailureReason = CommitHoldReason | 'stale-revision' | 'write-failed';

/** 一次提交的结果。 */
export interface JournalCommitResult {
  /** 是否真的落盘。 */
  readonly committed: boolean;
  /** 未落盘原因；成功为 null。 */
  readonly failureReason: JournalFailureReason | null;
}

/** 被拒/失败事件（诊断通道用，只上报白名单事件，不带业务字段）。 */
export interface JournalHoldEvent {
  readonly lessonId: string;
  readonly track: AudioTrackKey;
  readonly reason: JournalFailureReason;
}

export interface ProgressJournalOptions {
  /** 存储实现（默认微信存储）。 */
  readonly store?: LearningStore;
  /** 时钟（单测注入）。 */
  readonly now?: () => number;
  /** 被拒/失败回调（接线到诊断白名单）。 */
  readonly onHold?: (event: JournalHoldEvent) => void;
}

/**
 * 进度提交日志。
 *
 * 单例由模块末尾导出；单测可自行构造实例 + 内存存储，验证「杀进程重启」等场景。
 */
export class ProgressJournal {
  private readonly store: LearningStore;

  private readonly now: () => number;

  private onHold: ((event: JournalHoldEvent) => void) | null;

  /** 加载锁：key = `${lessonId}:${track}`，value = 上锁时刻。 */
  private readonly loadLocks = new Map<string, number>();

  /**
   * 播放头锚点：key = `${lessonId}:${track}`，value = 我们要求媒体停住的位置（毫秒）。
   *
   * 来源只有两处：载入后 seek 目标、用户显式 Seek 目标。它让「seek 被平台丢掉」
   * 与「用户就是想从 00:00 听」可区分——前者禁止写断点，后者允许（§4.1.2 / §4.1.3）。
   */
  private readonly anchors = new Map<string, number>();

  /** 未成功落盘的提交（供 flush() 重试，§4.1.8「后续允许重试」）。 */
  private readonly pending = new Map<string, JournalCommitRequest>();

  constructor(options: ProgressJournalOptions = {}) {
    this.store = options.store ?? new LearningStore();
    this.now = options.now ?? (() => Date.now());
    this.onHold = options.onHold ?? null;
  }

  /** 接线/断开诊断回调。 */
  setHoldListener(listener: ((event: JournalHoldEvent) => void) | null): void {
    this.onHold = listener;
  }

  // ---------------------------------------------------------------- 写入通道

  /**
   * 提交一次位置（§4.1.1–4.1.4）。
   *
   * @returns 是否落盘；未落盘时 `failureReason` 说明原因，调用方**不得**当成已保存。
   */
  commit(request: JournalCommitRequest): JournalCommitResult {
    if (!request.lessonId) {
      return { committed: false, failureReason: 'invalid-position' };
    }
    const now = this.now();
    const record = this.store.loadRecord(request.lessonId, now);
    const key = this.anchorKey(request.lessonId, request.track);
    // 后台侧拿不到句索引时沿用已提交值，避免把 0 句写回去。
    const previous = request.track === 'pb' ? record.podcast : record.dialogue;
    const segmentIndex = request.segmentIndex
      ?? (previous ? previous.committedSegmentIndex : 0);
    const decision = decidePositionCommit({
      track: request.track,
      positionMs: request.positionMs,
      segmentIndex,
      durationMs: request.durationMs,
      reason: request.reason,
      record,
      loading: this.isLoadLocked(request.lessonId, request.track, now),
      anchorMs: this.anchors.get(key),
    });

    if (!decision.commit || !decision.point) {
      const failureReason = decision.holdReason ?? 'invalid-position';
      this.reportHold(request, failureReason);
      return { committed: false, failureReason };
    }

    const next = applyTrackPoint(record, request.track, decision.point, now);
    const outcome = this.store.saveRecord(next);
    if (outcome !== 'ok') {
      const failureReason: JournalFailureReason =
        outcome === 'stale' ? 'stale-revision' : 'write-failed';
      // 只有真正的 IO 失败值得重试；版本落后说明有新写入已落地，重试没意义。
      if (outcome === 'io-error') {
        this.pending.set(request.lessonId, request);
      }
      this.reportHold(request, failureReason);
      return { committed: false, failureReason };
    }

    this.pending.delete(request.lessonId);
    // 用户主动 Seek 之后，锚点跟随新位置（后续周期提交以它为参照）。
    if (request.reason === 'userSeek') {
      this.anchors.set(key, decision.point.committedPositionMs);
    }
    return { committed: true, failureReason: null };
  }

  /**
   * 置课程完成（§3.1 / §4.1.5）。
   *
   * 与位置写入完全解耦：不读位置、不改位置；位置写入也不会清掉它。
   */
  commitCompleted(lessonId: string): boolean {
    if (!lessonId) {
      return false;
    }
    const now = this.now();
    const record = this.store.loadRecord(lessonId, now);
    const next = markLessonCompleted(record, now);
    if (next === record) {
      return true; // 已是完成态，幂等
    }
    return this.store.saveRecord(next) === 'ok';
  }

  /**
   * 更新「最后打开的课程」锚点（§4.1.7）。
   *
   * 与是否播放解耦：成功打开课程元数据即更新；不影响任何播放位置。
   */
  setLastOpenedLesson(lessonId: string): boolean {
    if (!lessonId) {
      return false;
    }
    return this.store.saveResumeAnchor({
      schemaVersion: this.store.loadResumeAnchor().schemaVersion,
      lastOpenedLessonId: lessonId,
    });
  }

  /** 更新设备偏好（§4 / §6）。 */
  updatePreferences(patch: Partial<DevicePreferences>): DevicePreferences {
    const merged: DevicePreferences = { ...this.store.loadPreferences(), ...patch };
    this.store.savePreferences(merged);
    return merged;
  }

  /** 重试未落盘的提交（§4.1.8），返回是否已全部落盘。 */
  flush(): boolean {
    let allPersisted = true;
    for (const [lessonId, request] of Array.from(this.pending.entries())) {
      const result = this.commit(request);
      if (!result.committed) {
        allPersisted = false;
        // 重试仍失败：保留 pending，等待下一次 flush。
        void lessonId;
      }
    }
    return allPersisted;
  }

  // ---------------------------------------------------------------- 加载锁

  /** 进入加载锁：这一段内的位置不可信（§4.1.2）。 */
  beginLoad(lessonId: string, track: AudioTrackKey): void {
    if (!lessonId) {
      return;
    }
    this.loadLocks.set(`${lessonId}:${track}`, this.now());
    // 新一轮载入：播放头尚未放置，锚点作废直到 setPlayheadAnchor。
    this.anchors.delete(this.anchorKey(lessonId, track));
  }

  /** canplay / 出错 / 换源后解除加载锁。 */
  endLoad(lessonId: string, track: AudioTrackKey): void {
    this.loadLocks.delete(`${lessonId}:${track}`);
  }

  /** 某课某轨当前是否处于加载锁定期（含兜底超时）。 */
  isLoadLocked(lessonId: string, track: AudioTrackKey, nowMs = this.now()): boolean {
    const startedAt = this.loadLocks.get(`${lessonId}:${track}`);
    if (startedAt === undefined) {
      return false;
    }
    if (nowMs - startedAt >= LOAD_LOCK_TIMEOUT_MS) {
      this.loadLocks.delete(`${lessonId}:${track}`);
      return false;
    }
    return true;
  }

  /**
   * 记录播放头锚点：我们要求媒体停住的位置（载入后 seek 目标 / 用户 Seek 目标）。
   *
   * 传 0 表示「本次确实是有意从 00:00 开始」（手动切课 / 重听），与「锚点未知」
   * 不同：前者允许真实播放推进后覆盖旧断点，后者只能保守拦截倒退。
   */
  setPlayheadAnchor(lessonId: string, track: AudioTrackKey, positionMs: number): void {
    if (!lessonId || !Number.isFinite(positionMs) || positionMs < 0) {
      return;
    }
    this.anchors.set(this.anchorKey(lessonId, track), Math.round(positionMs));
  }

  /** 读取播放头锚点（无则 undefined）。 */
  playheadAnchorMs(lessonId: string, track: AudioTrackKey): number | undefined {
    return this.anchors.get(this.anchorKey(lessonId, track));
  }

  private anchorKey(lessonId: string, track: AudioTrackKey): string {
    return `${lessonId}:${track}`;
  }

  // ---------------------------------------------------------------- 读取

  /** 读取单课记录（副本）。 */
  readRecord(lessonId: string): LessonLearningRecord {
    return this.store.loadRecord(lessonId, this.now());
  }

  /** 有效恢复位置（毫秒，§4.1.6）。 */
  resolveResumeMs(lessonId: string, track: AudioTrackKey): number {
    return resolveResumePositionMs(this.store.loadRecord(lessonId, this.now()), track);
  }

  /** 最后成功打开的课程 ID（无则空串）。 */
  lastOpenedLessonId(): string {
    return this.store.loadResumeAnchor().lastOpenedLessonId ?? '';
  }

  /** 设备偏好。 */
  preferences(): DevicePreferences {
    return this.store.loadPreferences();
  }

  /** 课程库投影（含内存镜像，供列表/继续收听卡使用）。 */
  progressViews(): ProgressMap {
    const map: ProgressMap = {};
    for (const lessonId of this.store.knownLessonIds()) {
      const record = this.store.loadRecord(lessonId, this.now());
      const hasPoint = Boolean(record.podcast || record.dialogue);
      if (!hasPoint && !record.lessonCompleted) {
        continue;
      }
      map[lessonId] = toProgressView(record);
    }
    return map;
  }

  // ---------------------------------------------------------------- 内部

  private reportHold(request: JournalCommitRequest, reason: JournalFailureReason): void {
    this.onHold?.({ lessonId: request.lessonId, track: request.track, reason });
  }
}

/** 全局单例：页面与会话共用同一个写入通道。 */
export const progressJournal = new ProgressJournal();

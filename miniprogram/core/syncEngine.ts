/**
 * ============================================================================
 *  多端进度同步核心状态机（core/syncEngine.ts —— 零平台依赖）
 * ============================================================================
 *  规范来源：EP-SYNC-001 v1.0
 *    - 31 字符配对码 + 5 分钟单次券 + 2s 状态轮询
 *    - 80 课分片 Push + since_seq 增量 Pull + hasMore 翻页循环
 *    - 因果 baseSeq + 服务端裁决冲突覆盖（rejectedConflicts）
 *    - 401 DEVICE_REVOKED 自动退组并 100% 保留本地学习记录
 *    - 纯 TypeScript，所有定时器与时钟均可注入，便于单测验证
 * ============================================================================
 */

import { LessonLearningRecord, TrackPoint } from './learningRecord';
import {
  MAX_SEGMENT_INDEX,
  MAX_TRACK_DURATION_MS,
  PersistedSyncState,
  SYNC_DEBOUNCE_MS,
  SYNC_HEARTBEAT_INTERVAL_MS,
  SYNC_PAIR_POLL_INTERVAL_MS,
  SYNC_PULL_MIN_INTERVAL_MS,
  SYNC_PUSH_CHUNK_SIZE,
  SYNC_SCHEMA_VERSION,
  SYNC_STATE_STORAGE_KEY,
  SyncApiError,
  SyncConnectionStatus,
  SyncDeviceSummary,
  SyncEngineSnapshot,
  SyncKeyValuePort,
  SyncLessonPullOutput,
  SyncLessonPushInput,
  SyncProgressBridge,
  SyncPullResult,
  SyncTrackPointInput,
  SyncTransport,
  createEmptyPersistedState,
  isValidCanonicalLessonId,
  mapSyncErrorMessage,
  normalizePairingCode,
  sanitizeDeviceName,
  trackBaseKey,
} from './syncModels';

export type SyncTimerHandle = ReturnType<typeof setTimeout>;

export interface SyncEngineOptions {
  readonly kv: SyncKeyValuePort;
  readonly transport: SyncTransport;
  readonly bridge: SyncProgressBridge;
  readonly defaultDeviceName?: string;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => SyncTimerHandle;
  readonly clearTimer?: (handle: SyncTimerHandle) => void;
}

type SnapshotListener = (snapshot: SyncEngineSnapshot) => void;

function clampInt(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  const n = Math.round(val);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export class SyncEngine {
  private readonly kv: SyncKeyValuePort;
  private readonly transport: SyncTransport;
  private readonly bridge: SyncProgressBridge;
  private readonly defaultDeviceName: string;
  private readonly now: () => number;
  private readonly setTimerFn: (fn: () => void, ms: number) => SyncTimerHandle;
  private readonly clearTimerFn: (handle: SyncTimerHandle) => void;

  private state: PersistedSyncState;
  private status: SyncConnectionStatus = 'unlinked';
  private activeTicket: SyncEngineSnapshot['activeTicket'] = null;
  private ticketStatus: SyncEngineSnapshot['ticketStatus'] = null;
  private lastClaimedDevice: SyncEngineSnapshot['lastClaimedDevice'] = null;
  private errorMessage = '';
  private errorCode = '';
  private revokedNotice = false;

  private initialized = false;
  private foreground = true;
  private syncChain: Promise<void> = Promise.resolve();
  private lastPullCheckMs = 0;

  private debounceTimer: SyncTimerHandle | null = null;
  private pollTimer: SyncTimerHandle | null = null;
  private heartbeatTimer: SyncTimerHandle | null = null;

  private readonly listeners = new Set<SnapshotListener>();

  constructor(options: SyncEngineOptions) {
    this.kv = options.kv;
    this.transport = options.transport;
    this.bridge = options.bridge;
    this.defaultDeviceName = sanitizeDeviceName(options.defaultDeviceName ?? '微信小程序');
    this.now = options.now ?? (() => Date.now());
    this.setTimerFn = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimerFn = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.state = createEmptyPersistedState(this.defaultDeviceName);
  }

  init(): SyncEngineSnapshot {
    if (!this.initialized) {
      this.state = this.loadPersistedState();
      this.status = this.isLinked() ? 'synced' : 'unlinked';
      this.initialized = true;
      if (this.isLinked() && this.foreground) {
        this.startHeartbeat();
      }
      this.emit();
    }
    return this.getSnapshot();
  }

  isLinked(): boolean {
    return Boolean(this.state.groupId && this.state.deviceId && this.state.deviceToken);
  }

  hasLinkedPeers(): boolean {
    return this.isLinked() && this.state.devices.length >= 2;
  }

  getSnapshot(): SyncEngineSnapshot {
    return {
      linked: this.isLinked(),
      hasLinkedPeers: this.hasLinkedPeers(),
      status: this.status,
      groupId: this.state.groupId,
      deviceId: this.state.deviceId,
      deviceName: this.state.deviceName,
      lastSyncedSeq: this.state.lastSyncedSeq,
      lastSyncedAtMs: this.state.lastSyncedAtMs,
      pendingCount: this.state.dirtyLessonIds.length + (this.state.dirtyLastOpened ? 1 : 0),
      devices: [...this.state.devices],
      activeTicket: this.activeTicket,
      ticketStatus: this.ticketStatus,
      lastClaimedDevice: this.lastClaimedDevice,
      errorMessage: this.errorMessage,
      errorCode: this.errorCode,
      revokedNotice: this.revokedNotice,
    };
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onAppShow(): void {
    this.foreground = true;
    if (!this.initialized) {
      this.init();
    }
    if (this.isLinked()) {
      this.startHeartbeat();
      void this.pullIfDue();
    }
  }

  onAppHide(): void {
    this.foreground = false;
    this.stopHeartbeat();
    this.cancelPairingPoll();
    if (this.isLinked() && (this.state.dirtyLessonIds.length > 0 || this.state.dirtyLastOpened)) {
      this.clearDebounce();
      void this.enqueueSync(() => this.syncCycleInternal());
    }
  }

  dispose(): void {
    this.clearDebounce();
    this.cancelPairingPoll();
    this.stopHeartbeat();
    this.listeners.clear();
  }

  dismissRevokedNotice(): void {
    if (this.revokedNotice) {
      this.revokedNotice = false;
      this.emit();
    }
  }

  clearError(): void {
    if (this.errorMessage || this.errorCode) {
      this.errorMessage = '';
      this.errorCode = '';
      this.emit();
    }
  }

  /** 生成一次性配对二维码和 8 位短码；若本机尚未建组则顺带上传全量基线。 */
  async createPairingCode(): Promise<SyncEngineSnapshot['activeTicket']> {
    if (!this.initialized) {
      this.init();
    }
    this.clearError();
    this.revokedNotice = false;
    const wasLinked = this.isLinked();

    try {
      const ticket = await this.transport.pairCreate({
        token: wasLinked ? this.state.deviceToken : undefined,
        deviceName: this.state.deviceName || this.defaultDeviceName,
        platform: 'wechat',
      });
      this.recordClockOffset(ticket.serverTimeMs);

      if (!wasLinked && ticket.deviceToken) {
        this.state.groupId = ticket.groupId;
        this.state.deviceId = ticket.deviceId;
        this.state.deviceToken = ticket.deviceToken;
        this.state.lastSyncedSeq = 0;
        this.state.lastSyncedAtMs = 0;
        this.state.trackBaseSeq = {};
        this.state.lastOpenedSeq = 0;
        this.queueAllLocalBaselineLocked();
        this.state.devices = [
          {
            deviceId: ticket.deviceId,
            deviceName: this.state.deviceName || this.defaultDeviceName,
            platform: 'wechat',
            createdAtMs: ticket.serverTimeMs,
            lastSeenAtMs: ticket.serverTimeMs,
            isCurrent: true,
          },
        ];
        this.savePersistedState();
        this.status = 'syncing';
        if (this.foreground) {
          this.startHeartbeat();
        }
      }

      this.activeTicket = ticket;
      this.ticketStatus = 'pending';
      this.lastClaimedDevice = null;
      this.emit();

      // 若是首次建组，立即分片上传本地已有进度作为云端基线
      if (!wasLinked && this.state.deviceToken) {
        await this.enqueueSync(() => this.syncCycleInternal());
      }

      this.schedulePairingPoll();
      return ticket;
    } catch (err) {
      this.handleTransportFailure(err);
      throw err;
    }
  }

  cancelPairingPoll(): void {
    if (this.pollTimer !== null) {
      this.clearTimerFn(this.pollTimer);
      this.pollTimer = null;
    }
  }

  clearActiveTicket(): void {
    this.cancelPairingPoll();
    this.activeTicket = null;
    this.ticketStatus = null;
    this.lastClaimedDevice = null;
    this.emit();
  }

  /** 使用 8 位设备码或二维码 URI 加入或智能合组（方案 A：已入组设备携带本机 Token 原子合组，不拆散原组）。 */
  async claimPairingCode(rawCode: string): Promise<boolean> {
    if (!this.initialized) {
      this.init();
    }
    const code = normalizePairingCode(rawCode);
    if (!code) {
      this.errorCode = 'INVALID_CODE';
      this.errorMessage = '配对码格式无效，请输入 8 位设备码或扫描有效二维码';
      this.emit();
      return false;
    }

    const wasLinked = this.isLinked();
    const prevToken = this.state.deviceToken;
    const prevStatus = this.status;

    this.clearError();
    this.revokedNotice = false;
    this.cancelPairingPoll();
    this.status = 'syncing';
    this.emit();

    try {
      const claim = await this.transport.pairClaim({
        token: wasLinked ? prevToken : undefined,
        code,
        deviceName: this.state.deviceName || this.defaultDeviceName,
        platform: 'wechat',
      });
      this.recordClockOffset(claim.serverTimeMs);

      const effectiveToken = claim.deviceToken && claim.deviceToken.trim()
        ? claim.deviceToken
        : prevToken;
      if (!effectiveToken) {
        throw new SyncApiError({
          status: 500,
          code: 'MISSING_TOKEN',
          message: '配对响应缺少设备凭证，请重试',
        });
      }

      this.state.groupId = claim.groupId;
      this.state.deviceId = claim.deviceId;
      this.state.deviceToken = effectiveToken;
      this.state.lastSyncedSeq = 0;
      this.state.lastSyncedAtMs = 0;
      this.state.trackBaseSeq = {};
      this.state.lastOpenedSeq = 0;
      this.state.devices = [...claim.devices];
      this.queueAllLocalBaselineLocked();
      this.savePersistedState();

      this.activeTicket = null;
      this.ticketStatus = null;
      if (this.foreground) {
        this.startHeartbeat();
      }
      this.emit();

      // 串联进同一 syncChain：先推本机已有基线，再 since_seq=0 拉取并合并云端全量
      await this.enqueueSync(() => this.fullBaselineMergeInternal());
      return this.getSnapshot().status === 'synced';
    } catch (err) {
      this.handleTransportFailure(err);
      if (wasLinked && this.isLinked() && this.status === 'syncing') {
        this.status = prevStatus === 'syncing' ? 'synced' : prevStatus;
        this.emit();
      }
      return false;
    }
  }

  /** 方案 A 智能合组：直接通过 claimPairingCode 携带本机 Token 原子合组，不再先踢出原组。 */
  async switchGroupWithCode(rawCode: string): Promise<boolean> {
    return this.claimPairingCode(rawCode);
  }

  /** 记录某门课的本地进度变更；即时事件立刻同步，连续 Seek 防抖 2s。 */
  recordLocalLessonChange(lessonId: string, immediate: boolean): void {
    if (!this.initialized) {
      this.init();
    }
    if (!this.isLinked() || !isValidCanonicalLessonId(lessonId)) {
      return;
    }
    if (!this.state.dirtyLessonIds.includes(lessonId)) {
      this.state.dirtyLessonIds.push(lessonId);
      this.savePersistedState();
      this.emit();
    }
    if (immediate) {
      this.clearDebounce();
      void this.enqueueSync(() => this.syncCycleInternal());
    } else {
      this.scheduleDebouncedSync();
    }
  }

  recordLocalLastOpened(lessonId: string): void {
    if (!this.initialized) {
      this.init();
    }
    if (!this.isLinked() || !isValidCanonicalLessonId(lessonId)) {
      return;
    }
    this.state.dirtyLastOpened = true;
    this.savePersistedState();
    this.emit();
    this.scheduleDebouncedSync();
  }

  async syncNow(): Promise<boolean> {
    if (!this.initialized) {
      this.init();
    }
    if (!this.isLinked()) {
      return false;
    }
    this.clearDebounce();
    this.clearError();
    await this.enqueueSync(() => this.syncCycleInternal());
    return this.status === 'synced';
  }

  async pullIfDue(minIntervalMs = SYNC_PULL_MIN_INTERVAL_MS): Promise<void> {
    if (!this.initialized) {
      this.init();
    }
    if (!this.isLinked()) {
      return;
    }
    const elapsed = this.now() - this.lastPullCheckMs;
    if (
      elapsed < minIntervalMs &&
      this.state.dirtyLessonIds.length === 0 &&
      !this.state.dirtyLastOpened
    ) {
      return;
    }
    await this.enqueueSync(() => this.syncCycleInternal());
  }

  async refreshDevices(): Promise<readonly SyncDeviceSummary[]> {
    if (!this.initialized) {
      this.init();
    }
    if (!this.isLinked()) {
      return [];
    }
    try {
      const res = await this.transport.listDevices({ token: this.state.deviceToken });
      this.recordClockOffset(res.serverTimeMs);
      this.state.devices = [...res.devices];
      const self = res.devices.find((d) => d.isCurrent || d.deviceId === this.state.deviceId);
      if (self && self.deviceName) {
        this.state.deviceName = self.deviceName;
      }
      this.savePersistedState();
      this.emit();
      return this.state.devices;
    } catch (err) {
      this.handleTransportFailure(err);
      return this.state.devices;
    }
  }

  async renameSelf(newName: string): Promise<boolean> {
    if (!this.initialized) {
      this.init();
    }
    if (!this.isLinked()) {
      return false;
    }
    const sanitized = sanitizeDeviceName(newName, '');
    if (!sanitized) {
      this.errorCode = 'INVALID_NAME';
      this.errorMessage = '设备名称不能为空';
      this.emit();
      return false;
    }
    this.clearError();
    try {
      const res = await this.transport.renameSelf({
        token: this.state.deviceToken,
        deviceName: sanitized,
      });
      this.recordClockOffset(res.serverTimeMs);
      this.state.deviceName = res.device.deviceName;
      this.state.devices = this.state.devices.map((d) =>
        d.deviceId === res.device.deviceId || d.isCurrent ? res.device : d,
      );
      this.savePersistedState();
      this.emit();
      return true;
    } catch (err) {
      this.handleTransportFailure(err);
      return false;
    }
  }

  async removeDevice(deviceId: string): Promise<boolean> {
    if (!this.initialized) {
      this.init();
    }
    if (!this.isLinked() || !deviceId) {
      return false;
    }
    if (deviceId === this.state.deviceId || deviceId === 'me') {
      await this.leaveGroup();
      return true;
    }
    this.clearError();
    try {
      const res = await this.transport.revokeDevice({
        token: this.state.deviceToken,
        deviceId,
      });
      this.recordClockOffset(res.serverTimeMs);
      this.state.devices = this.state.devices.filter((d) => d.deviceId !== deviceId);
      this.savePersistedState();
      this.emit();
      return true;
    } catch (err) {
      this.handleTransportFailure(err);
      return false;
    }
  }

  async leaveGroup(): Promise<void> {
    if (!this.initialized) {
      this.init();
    }
    const token = this.state.deviceToken;
    this.clearDebounce();
    this.cancelPairingPoll();
    this.stopHeartbeat();

    if (token) {
      try {
        await this.transport.revokeDevice({ token, deviceId: 'me' });
      } catch {
        // 即使网络异常也允许本机离线退出同步组，且绝不删除本地学习进度
      }
    }
    this.resetSyncMetadataOnly(false);
    this.emit();
  }

  // ------------------------------------------------------------------ 内部执行

  private enqueueSync(work: () => Promise<void>): Promise<void> {
    const next = this.syncChain.then(work, work);
    this.syncChain = next.catch(() => undefined);
    return next;
  }

  private async fullBaselineMergeInternal(): Promise<void> {
    if (!this.isLinked()) return;
    this.status = 'syncing';
    this.emit();
    try {
      await this.pushDirtyChunksLocked();
      await this.pullPagesLocked(0);
      this.status = 'synced';
      this.errorMessage = '';
      this.errorCode = '';
      this.lastPullCheckMs = this.now();
      this.savePersistedState();
      this.emit();
    } catch (err) {
      this.handleTransportFailure(err);
    }
  }

  private async syncCycleInternal(): Promise<void> {
    if (!this.isLinked()) return;
    this.status = 'syncing';
    this.emit();
    try {
      await this.pushDirtyChunksLocked();
      await this.pullPagesLocked(this.state.lastSyncedSeq);
      this.status = 'synced';
      this.errorMessage = '';
      this.errorCode = '';
      this.lastPullCheckMs = this.now();
      this.savePersistedState();
      this.emit();
    } catch (err) {
      this.handleTransportFailure(err);
    }
  }

  private async pushDirtyChunksLocked(): Promise<void> {
    const dirtyIds = this.state.dirtyLessonIds.filter(isValidCanonicalLessonId);
    const hasLastOpened = this.state.dirtyLastOpened;

    if (dirtyIds.length === 0 && !hasLastOpened) {
      return;
    }

    const lastOpenedId = this.bridge.lastOpenedLessonId();
    const validLastOpened = hasLastOpened && isValidCanonicalLessonId(lastOpenedId);

    const chunks: string[][] = [];
    for (let i = 0; i < dirtyIds.length; i += SYNC_PUSH_CHUNK_SIZE) {
      chunks.push(dirtyIds.slice(i, i + SYNC_PUSH_CHUNK_SIZE));
    }
    if (chunks.length === 0) {
      chunks.push([]);
    }

    const remoteWinsUpdates: SyncLessonPullOutput[] = [];
    let acceptedLastOpened: SyncPullResult['lastOpened'] = null;

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx += 1) {
      const chunkIds = chunks[chunkIdx];
      const lessons: SyncLessonPushInput[] = [];

      for (const lessonId of chunkIds) {
        const rec = this.bridge.readRecord(lessonId);
        const input = this.toLessonPushInput(rec);
        if (input) {
          lessons.push(input);
        }
      }

      const includeLastOpened = chunkIdx === chunks.length - 1 && validLastOpened;
      if (lessons.length === 0 && !includeLastOpened) {
        this.state.dirtyLessonIds = this.state.dirtyLessonIds.filter((id) => !chunkIds.includes(id));
        if (chunkIdx === chunks.length - 1) {
          this.state.dirtyLastOpened = false;
        }
        continue;
      }

      const res = await this.transport.push({
        token: this.state.deviceToken,
        payload: {
          lessons,
          lastOpened: includeLastOpened
            ? {
                lessonId: lastOpenedId,
                updatedAtMs: this.compensatedNowMs(this.now()),
                baseSeq: this.state.lastOpenedSeq,
              }
            : undefined,
        },
      });
      this.recordClockOffset(res.serverTimeMs);

      // 1. Accepted lessons: update baseSeq for submitted tracks & dequeue cleanly
      const acceptedSet = new Set(res.acceptedLessons);
      const rejectedTracksByLesson = new Map<string, Set<'pb' | 'dg'>>();
      for (const conflict of res.rejectedConflicts) {
        if (!rejectedTracksByLesson.has(conflict.lessonId)) {
          rejectedTracksByLesson.set(conflict.lessonId, new Set());
        }
        rejectedTracksByLesson.get(conflict.lessonId)!.add(conflict.track);

        // Adopt server authoritative track on conflict
        this.state.trackBaseSeq[trackBaseKey(conflict.lessonId, conflict.track)] =
          conflict.serverTrack.seq;
        const existing = this.bridge.readRecord(conflict.lessonId);
        remoteWinsUpdates.push({
          lessonId: conflict.lessonId,
          lessonCompleted: existing.lessonCompleted,
          completedAtMs: existing.updatedAtMs,
          seq: conflict.serverTrack.seq,
          pb: conflict.track === 'pb' ? conflict.serverTrack : null,
          dg: conflict.track === 'dg' ? conflict.serverTrack : null,
        });
      }

      for (const lesson of lessons) {
        const conflictTracks = rejectedTracksByLesson.get(lesson.lessonId);
        if (acceptedSet.has(lesson.lessonId)) {
          if (lesson.pb && !conflictTracks?.has('pb')) {
            this.state.trackBaseSeq[trackBaseKey(lesson.lessonId, 'pb')] = res.serverSeq;
          }
          if (lesson.dg && !conflictTracks?.has('dg')) {
            this.state.trackBaseSeq[trackBaseKey(lesson.lessonId, 'dg')] = res.serverSeq;
          }
        }
      }

      this.state.dirtyLessonIds = this.state.dirtyLessonIds.filter((id) => !chunkIds.includes(id));
      if (includeLastOpened) {
        this.state.dirtyLastOpened = false;
        if (res.lastOpened) {
          this.state.lastOpenedSeq = Math.max(this.state.lastOpenedSeq, res.lastOpened.seq);
          if (res.lastOpened.lessonId && res.lastOpened.lessonId !== lastOpenedId) {
            acceptedLastOpened = res.lastOpened;
          }
        }
      }
      this.state.lastSyncedAtMs = res.serverTimeMs || this.now();
      this.savePersistedState();
    }

    if (remoteWinsUpdates.length > 0 || acceptedLastOpened) {
      this.bridge.applyRemoteSync({
        lessons: remoteWinsUpdates,
        lastOpened: acceptedLastOpened,
      });
    }
  }

  private async pullPagesLocked(startSinceSeq: number): Promise<void> {
    let cursor = Math.max(0, startSinceSeq);
    const mergedLessons: SyncLessonPullOutput[] = [];
    let latestLastOpened: SyncPullResult['lastOpened'] = null;
    let finalServerSeq = cursor;
    let finalServerTimeMs = this.now();

    for (let guard = 0; guard < 20; guard += 1) {
      const res = await this.transport.pull({
        token: this.state.deviceToken,
        sinceSeq: cursor,
      });
      this.recordClockOffset(res.serverTimeMs);
      finalServerTimeMs = res.serverTimeMs;
      finalServerSeq = Math.max(finalServerSeq, res.serverSeq);

      for (const lesson of res.lessons) {
        if (!isValidCanonicalLessonId(lesson.lessonId)) continue;
        mergedLessons.push(lesson);
        if (lesson.pb) {
          this.state.trackBaseSeq[trackBaseKey(lesson.lessonId, 'pb')] = lesson.pb.seq;
        }
        if (lesson.dg) {
          this.state.trackBaseSeq[trackBaseKey(lesson.lessonId, 'dg')] = lesson.dg.seq;
        }
      }

      if (res.lastOpened && isValidCanonicalLessonId(res.lastOpened.lessonId)) {
        if (!latestLastOpened || res.lastOpened.seq >= latestLastOpened.seq) {
          latestLastOpened = res.lastOpened;
        }
        this.state.lastOpenedSeq = Math.max(this.state.lastOpenedSeq, res.lastOpened.seq);
      }

      if (!res.hasMore || res.serverSeq <= cursor) {
        break;
      }
      cursor = res.serverSeq;
    }

    if (mergedLessons.length > 0 || latestLastOpened) {
      this.bridge.applyRemoteSync({
        lessons: mergedLessons,
        lastOpened: latestLastOpened,
      });
    }

    this.state.lastSyncedSeq = Math.max(this.state.lastSyncedSeq, finalServerSeq);
    this.state.lastSyncedAtMs = finalServerTimeMs;
  }

  private toLessonPushInput(record: LessonLearningRecord): SyncLessonPushInput | null {
    if (!isValidCanonicalLessonId(record.lessonId)) {
      return null;
    }
    const ts = this.compensatedNowMs(record.updatedAtMs > 0 ? record.updatedAtMs : this.now());
    const pb = record.podcast ? this.toTrackInput(record.lessonId, 'pb', record.podcast, ts) : undefined;
    const dg = record.dialogue ? this.toTrackInput(record.lessonId, 'dg', record.dialogue, ts) : undefined;
    if (!record.lessonCompleted && !pb && !dg) {
      return null;
    }
    return {
      lessonId: record.lessonId,
      lessonCompleted: record.lessonCompleted,
      completedAtMs: record.lessonCompleted ? ts : undefined,
      pb,
      dg,
    };
  }

  private toTrackInput(
    lessonId: string,
    track: 'pb' | 'dg',
    point: TrackPoint,
    updatedAtMs: number,
  ): SyncTrackPointInput {
    return {
      positionMs: clampInt(point.committedPositionMs, 0, MAX_TRACK_DURATION_MS),
      segmentIndex: clampInt(point.committedSegmentIndex, 0, MAX_SEGMENT_INDEX),
      durationMs:
        typeof point.durationMs === 'number' && Number.isFinite(point.durationMs)
          ? clampInt(point.durationMs, 0, MAX_TRACK_DURATION_MS)
          : undefined,
      updatedAtMs,
      baseSeq: this.state.trackBaseSeq[trackBaseKey(lessonId, track)] ?? 0,
    };
  }

  private compensatedNowMs(rawMs: number): number {
    // 仅在设备时间偏差超过 5s 时应用服务端时钟偏移补偿
    const appliedOffset = Math.abs(this.state.clockOffsetMs) > 5000 ? this.state.clockOffsetMs : 0;
    return Math.max(1, Math.round(rawMs + appliedOffset));
  }

  private recordClockOffset(serverTimeMs: number): void {
    if (typeof serverTimeMs === 'number' && Number.isFinite(serverTimeMs) && serverTimeMs > 0) {
      this.state.clockOffsetMs = serverTimeMs - this.now();
    }
  }

  private queueAllLocalBaselineLocked(): void {
    const dirty = new Set(this.state.dirtyLessonIds.filter(isValidCanonicalLessonId));
    for (const rec of this.bridge.readAllNonEmptyRecords()) {
      if (isValidCanonicalLessonId(rec.lessonId)) {
        dirty.add(rec.lessonId);
      }
    }
    this.state.dirtyLessonIds = Array.from(dirty).sort();
    this.state.dirtyLastOpened = isValidCanonicalLessonId(this.bridge.lastOpenedLessonId());
  }

  private scheduleDebouncedSync(): void {
    this.clearDebounce();
    this.debounceTimer = this.setTimerFn(() => {
      this.debounceTimer = null;
      void this.enqueueSync(() => this.syncCycleInternal());
    }, SYNC_DEBOUNCE_MS);
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      this.clearTimerFn(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private schedulePairingPoll(): void {
    this.cancelPairingPoll();
    if (!this.activeTicket || this.ticketStatus !== 'pending' || !this.state.deviceToken) {
      return;
    }
    this.pollTimer = this.setTimerFn(() => {
      this.pollTimer = null;
      void this.pollPairingStatusOnce();
    }, SYNC_PAIR_POLL_INTERVAL_MS);
  }

  private async pollPairingStatusOnce(): Promise<void> {
    if (!this.activeTicket || this.ticketStatus !== 'pending' || !this.state.deviceToken) {
      return;
    }
    try {
      const res = await this.transport.pairStatus({
        token: this.state.deviceToken,
        code: this.activeTicket.code,
      });
      this.recordClockOffset(res.serverTimeMs);
      this.ticketStatus = res.status;
      if (res.status === 'consumed') {
        this.lastClaimedDevice = res.claimedDevice ?? null;
        this.emit();
        await this.refreshDevices();
        await this.enqueueSync(() => this.syncCycleInternal());
        return;
      }
      if (res.status === 'expired') {
        this.emit();
        return;
      }
      this.schedulePairingPoll();
    } catch (err) {
      if (err instanceof SyncApiError && (err.status === 401 || err.code === 'DEVICE_REVOKED')) {
        this.handleTransportFailure(err);
        return;
      }
      // 网络瞬时失败继续下一次轮询，避免打断扫码等待
      this.schedulePairingPoll();
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      return;
    }
    this.heartbeatTimer = this.setTimerFn(() => {
      this.heartbeatTimer = null;
      if (this.foreground && this.isLinked()) {
        void this.enqueueSync(() => this.syncCycleInternal()).finally(() => {
          if (this.foreground && this.isLinked()) {
            this.startHeartbeat();
          }
        });
      }
    }, SYNC_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      this.clearTimerFn(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleTransportFailure(err: unknown): void {
    const mapped = mapSyncErrorMessage(err);
    if (
      err instanceof SyncApiError &&
      err.status === 401 &&
      (err.code === 'DEVICE_REVOKED' || err.code === 'UNAUTHORIZED') &&
      this.isLinked()
    ) {
      this.resetSyncMetadataOnly(true);
      this.errorCode = mapped.code;
      this.errorMessage = mapped.message;
      this.emit();
      return;
    }

    this.errorCode = mapped.code;
    this.errorMessage = mapped.message;
    if (!this.isLinked()) {
      this.status = 'unlinked';
    } else if (
      mapped.code === 'UPSTREAM_TIMEOUT' ||
      mapped.code === 'UPSTREAM_UNREACHABLE' ||
      mapped.code === 'NETWORK_ERROR'
    ) {
      this.status = 'offline';
    } else {
      this.status = 'error';
    }
    this.emit();
  }

  private resetSyncMetadataOnly(showRevokedNotice: boolean): void {
    this.cancelPairingPoll();
    this.stopHeartbeat();
    this.clearDebounce();
    this.activeTicket = null;
    this.ticketStatus = null;
    this.lastClaimedDevice = null;
    this.revokedNotice = showRevokedNotice;
    this.status = 'unlinked';
    this.lastPullCheckMs = 0;

    const currentName = this.state.deviceName || this.defaultDeviceName;
    this.state = createEmptyPersistedState(currentName);
    this.kv.remove(SYNC_STATE_STORAGE_KEY);
  }

  private loadPersistedState(): PersistedSyncState {
    const raw = this.kv.get(SYNC_STATE_STORAGE_KEY);
    if (typeof raw !== 'string' || !raw) {
      return createEmptyPersistedState(this.defaultDeviceName);
    }
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedSyncState>;
      const base = createEmptyPersistedState(this.defaultDeviceName);
      return {
        schemaVersion: SYNC_SCHEMA_VERSION,
        groupId: typeof parsed.groupId === 'string' ? parsed.groupId : '',
        deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : '',
        deviceToken: typeof parsed.deviceToken === 'string' ? parsed.deviceToken : '',
        deviceName: sanitizeDeviceName(
          typeof parsed.deviceName === 'string' ? parsed.deviceName : this.defaultDeviceName,
          this.defaultDeviceName,
        ),
        lastSyncedSeq:
          typeof parsed.lastSyncedSeq === 'number' && parsed.lastSyncedSeq >= 0
            ? Math.trunc(parsed.lastSyncedSeq)
            : 0,
        lastSyncedAtMs:
          typeof parsed.lastSyncedAtMs === 'number' && parsed.lastSyncedAtMs >= 0
            ? Math.trunc(parsed.lastSyncedAtMs)
            : 0,
        clockOffsetMs:
          typeof parsed.clockOffsetMs === 'number' && Number.isFinite(parsed.clockOffsetMs)
            ? parsed.clockOffsetMs
            : 0,
        trackBaseSeq:
          parsed.trackBaseSeq && typeof parsed.trackBaseSeq === 'object'
            ? { ...parsed.trackBaseSeq }
            : {},
        lastOpenedSeq:
          typeof parsed.lastOpenedSeq === 'number' && parsed.lastOpenedSeq >= 0
            ? Math.trunc(parsed.lastOpenedSeq)
            : 0,
        dirtyLessonIds: Array.isArray(parsed.dirtyLessonIds)
          ? parsed.dirtyLessonIds.filter(
              (id): id is string => typeof id === 'string' && isValidCanonicalLessonId(id),
            )
          : [],
        dirtyLastOpened: Boolean(parsed.dirtyLastOpened),
        devices: Array.isArray(parsed.devices) ? [...parsed.devices] : base.devices,
      };
    } catch {
      return createEmptyPersistedState(this.defaultDeviceName);
    }
  }

  private savePersistedState(): void {
    this.kv.set(SYNC_STATE_STORAGE_KEY, JSON.stringify(this.state));
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snap);
    }
  }
}

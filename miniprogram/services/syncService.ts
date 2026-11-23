/**
 * ============================================================================
 *  多端学习进度同步应用服务（services/syncService.ts）
 * ============================================================================
 *  连接 `core/syncEngine.ts`、`adapters/wechat/syncTransport.ts`、
 *  `services/progressJournal.ts` 与 `services/playbackSession.ts`：
 *    1. 订阅 ProgressJournal 提交与完成事件并驱动 SyncEngine 增量同步；
 *    2. 对 `remoteMerge` 静默旁路，绝不引发回环推送；
 *    3. 向 ProgressJournal 注入活跃播放守卫，避免在某课某轨正在播放途中覆盖断点；
 *    4. 单例导出给 App / Library / Player / SyncModal 使用，同时支持单测依赖注入。
 * ============================================================================
 */

import { createWxKeyValue } from '../adapters/wechat/learningStore';
import { WechatSyncTransport, detectWechatDeviceName } from '../adapters/wechat/syncTransport';
import { CommitReason } from '../core/learningRecord';
import { SyncEngine, SyncTimerHandle } from '../core/syncEngine';
import {
  PairingTicket,
  SyncDeviceSummary,
  SyncEngineSnapshot,
  SyncKeyValuePort,
  SyncTransport,
} from '../core/syncModels';
import { AudioTrackKey } from '../core/types';
import { playbackSession } from './playbackSession';
import { JournalChangeEvent, ProgressJournal, progressJournal } from './progressJournal';

export interface ActivePlaybackProbe {
  readonly lessonId: string;
  readonly track: AudioTrackKey;
  readonly isPlaying: boolean;
}

export interface SyncServiceOptions {
  readonly kv?: SyncKeyValuePort;
  readonly transport?: SyncTransport;
  readonly journal?: ProgressJournal;
  readonly getPlaybackState?: () => ActivePlaybackProbe;
  readonly detectDeviceName?: () => string;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => SyncTimerHandle;
  readonly clearTimer?: (handle: SyncTimerHandle) => void;
}

const IMMEDIATE_COMMIT_REASONS = new Set<CommitReason>([
  'pause',
  'appHide',
  'lessonSwitch',
  'naturalEnd',
  'trackSwitch',
]);

export class SyncService {
  private readonly journal: ProgressJournal;
  private readonly getPlaybackState: () => ActivePlaybackProbe;
  private readonly engine: SyncEngine;
  private unsubscribeJournal: (() => void) | null = null;
  private started = false;

  constructor(options: SyncServiceOptions = {}) {
    this.journal = options.journal ?? progressJournal;
    this.getPlaybackState = options.getPlaybackState ?? (() => playbackSession.getState());
    const kv = options.kv ?? createWxKeyValue();
    const transport = options.transport ?? new WechatSyncTransport();
    const defaultName = options.detectDeviceName?.() ?? detectWechatDeviceName();

    this.engine = new SyncEngine({
      kv,
      transport,
      defaultDeviceName: defaultName,
      now: options.now,
      setTimer: options.setTimer,
      clearTimer: options.clearTimer,
      bridge: {
        readRecord: (lessonId) => this.journal.readRecord(lessonId),
        readAllNonEmptyRecords: () => this.journal.readAllNonEmptyRecords(),
        lastOpenedLessonId: () => this.journal.lastOpenedLessonId(),
        applyRemoteSync: ({ lessons, lastOpened }) =>
          this.journal.applyRemoteSnapshot({
            lessons,
            lastOpened,
            isTrackActivelyPlaying: (lessonId, track) => {
              const cur = this.getPlaybackState();
              return cur.isPlaying && cur.lessonId === lessonId && cur.track === track;
            },
          }),
      },
    });
  }

  init(): SyncEngineSnapshot {
    const snap = this.engine.init();
    if (!this.started) {
      this.started = true;
      this.unsubscribeJournal = this.journal.subscribeChanges((event) => {
        this.handleJournalChange(event);
      });
    }
    return snap;
  }

  dispose(): void {
    this.unsubscribeJournal?.();
    this.unsubscribeJournal = null;
    this.started = false;
    this.engine.dispose();
  }

  getSnapshot(): SyncEngineSnapshot {
    return this.engine.getSnapshot();
  }

  subscribe(listener: (snapshot: SyncEngineSnapshot) => void): () => void {
    return this.engine.subscribe(listener);
  }

  onAppShow(): void {
    if (!this.started) {
      this.init();
    }
    this.engine.onAppShow();
  }

  onAppHide(): void {
    this.engine.onAppHide();
  }

  async pullIfDue(minIntervalMs?: number): Promise<void> {
    if (!this.started) {
      this.init();
    }
    await this.engine.pullIfDue(minIntervalMs);
  }

  async flushSoon(): Promise<void> {
    const snap = this.engine.getSnapshot();
    if (snap.linked && snap.pendingCount > 0) {
      await this.engine.syncNow();
    }
  }

  createPairingCode(): Promise<PairingTicket | null> {
    if (!this.started) {
      this.init();
    }
    return this.engine.createPairingCode();
  }

  cancelPairingPoll(): void {
    this.engine.cancelPairingPoll();
  }

  clearActiveTicket(): void {
    this.engine.clearActiveTicket();
  }

  claimPairingCode(rawCode: string): Promise<boolean> {
    if (!this.started) {
      this.init();
    }
    return this.engine.claimPairingCode(rawCode);
  }

  switchGroupWithCode(rawCode: string): Promise<boolean> {
    if (!this.started) {
      this.init();
    }
    return this.engine.switchGroupWithCode(rawCode);
  }

  syncNow(): Promise<boolean> {
    if (!this.started) {
      this.init();
    }
    return this.engine.syncNow();
  }

  refreshDevices(): Promise<readonly SyncDeviceSummary[]> {
    return this.engine.refreshDevices();
  }

  renameSelf(newName: string): Promise<boolean> {
    return this.engine.renameSelf(newName);
  }

  removeDevice(deviceId: string): Promise<boolean> {
    return this.engine.removeDevice(deviceId);
  }

  leaveGroup(): Promise<void> {
    return this.engine.leaveGroup();
  }

  dismissRevokedNotice(): void {
    this.engine.dismissRevokedNotice();
  }

  clearError(): void {
    this.engine.clearError();
  }

  private handleJournalChange(event: JournalChangeEvent): void {
    if (event.kind === 'remoteMerge') {
      return;
    }
    if (event.kind === 'completed') {
      this.engine.recordLocalLessonChange(event.lessonId, true);
      return;
    }
    if (event.kind === 'lastOpened') {
      this.engine.recordLocalLastOpened(event.lessonId);
      return;
    }
    if (event.kind === 'commit') {
      const immediate = IMMEDIATE_COMMIT_REASONS.has(event.reason);
      this.engine.recordLocalLessonChange(event.lessonId, immediate);
    }
  }
}

export const syncService = new SyncService();

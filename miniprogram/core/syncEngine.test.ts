import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { LEARNING_SCHEMA_VERSION, LessonLearningRecord } from './learningRecord';
import { SyncEngine, SyncTimerHandle } from './syncEngine';
import {
  SYNC_STATE_STORAGE_KEY,
  SyncApiError,
  SyncDeviceSummary,
  SyncLastOpenedOutput,
  SyncLessonPullOutput,
  SyncProgressBridge,
  SyncPushRequest,
  SyncTransport,
  buildQrPayload,
  formatCodeInput,
  formatDisplayCode,
  isValidCanonicalLessonId,
  normalizePairingCode,
  sanitizeDeviceName,
} from './syncModels';
import { createMemoryKeyValue } from '../test-support/memoryKeyValue';

function makeRecord(
  lessonId: string,
  opts: {
    completed?: boolean;
    pbPos?: number;
    pbSeg?: number;
    dgPos?: number;
    dgSeg?: number;
    updatedAtMs?: number;
  } = {},
): LessonLearningRecord {
  return {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    lessonId,
    lessonCompleted: Boolean(opts.completed),
    podcast:
      opts.pbPos !== undefined
        ? { committedPositionMs: opts.pbPos, committedSegmentIndex: opts.pbSeg ?? 0, durationMs: 600_000 }
        : null,
    dialogue:
      opts.dgPos !== undefined
        ? { committedPositionMs: opts.dgPos, committedSegmentIndex: opts.dgSeg ?? 0, durationMs: 180_000 }
        : null,
    revision: 1,
    updatedAtMs: opts.updatedAtMs ?? 1_760_000_000_000,
  };
}

class FakeProgressBridge implements SyncProgressBridge {
  records = new Map<string, LessonLearningRecord>();
  lastOpened = '';
  appliedBatches: Array<{
    lessons: readonly SyncLessonPullOutput[];
    lastOpened: SyncLastOpenedOutput | null;
  }> = [];

  readRecord(lessonId: string): LessonLearningRecord {
    return this.records.get(lessonId) ?? makeRecord(lessonId);
  }

  readAllNonEmptyRecords(): LessonLearningRecord[] {
    return Array.from(this.records.values()).filter(
      (r) => r.lessonCompleted || r.podcast !== null || r.dialogue !== null,
    );
  }

  lastOpenedLessonId(): string {
    return this.lastOpened;
  }

  applyRemoteSync(params: {
    lessons: readonly SyncLessonPullOutput[];
    lastOpened: SyncLastOpenedOutput | null;
  }): boolean {
    this.appliedBatches.push(params);
    for (const item of params.lessons) {
      const existing = this.readRecord(item.lessonId);
      const next: LessonLearningRecord = {
        ...existing,
        lessonCompleted: existing.lessonCompleted || item.lessonCompleted,
        podcast: item.pb
          ? {
              committedPositionMs: item.pb.positionMs,
              committedSegmentIndex: item.pb.segmentIndex ?? 0,
              durationMs: item.pb.durationMs,
            }
          : existing.podcast,
        dialogue: item.dg
          ? {
              committedPositionMs: item.dg.positionMs,
              committedSegmentIndex: item.dg.segmentIndex ?? 0,
              durationMs: item.dg.durationMs,
            }
          : existing.dialogue,
        revision: existing.revision + 1,
        updatedAtMs: Date.now(),
      };
      this.records.set(item.lessonId, next);
    }
    if (params.lastOpened?.lessonId) {
      this.lastOpened = params.lastOpened.lessonId;
    }
    return true;
  }
}

class FakeTimerScheduler {
  nextId = 1;
  pending = new Map<number, { ms: number; fn: () => void }>();

  setTimer = (fn: () => void, ms: number): SyncTimerHandle => {
    const id = this.nextId++;
    this.pending.set(id, { ms, fn });
    return id as unknown as SyncTimerHandle;
  };

  clearTimer = (handle: SyncTimerHandle): void => {
    this.pending.delete(handle as unknown as number);
  };

  runByDelay(ms: number): void {
    for (const [id, item] of Array.from(this.pending.entries())) {
      if (item.ms === ms) {
        this.pending.delete(id);
        item.fn();
      }
    }
  }
}

function createFakeTransport(): SyncTransport & {
  pushCalls: SyncPushRequest[];
  pullSinceSeqs: number[];
  revokedTargets: string[];
  failWithRevoked: boolean;
  failWithNetwork: boolean;
  nextPairStatus: 'pending' | 'consumed' | 'expired';
  pullPages: Array<{
    serverSeq: number;
    hasMore: boolean;
    lessons: SyncLessonPullOutput[];
    lastOpened: SyncLastOpenedOutput | null;
  }>;
  conflictsOnNextPush: Array<{
    lessonId: string;
    track: 'pb' | 'dg';
    reason: string;
    serverTrack: { positionMs: number; segmentIndex: number; updatedAtMs: number; seq: number };
  }>;
} {
  const devices: SyncDeviceSummary[] = [
    {
      deviceId: 'dev-wechat-1',
      deviceName: 'iPhone 微信端',
      platform: 'wechat',
      createdAtMs: 1_760_000_000_000,
      lastSeenAtMs: 1_760_000_000_000,
      isCurrent: true,
    },
    {
      deviceId: 'dev-ipad-2',
      deviceName: 'iPad Pro',
      platform: 'ipad',
      createdAtMs: 1_760_000_000_100,
      lastSeenAtMs: 1_760_000_000_200,
      isCurrent: false,
    },
  ];

  const transport = {
    pushCalls: [] as SyncPushRequest[],
    pullSinceSeqs: [] as number[],
    revokedTargets: [] as string[],
    failWithRevoked: false,
    failWithNetwork: false,
    nextPairStatus: 'pending' as 'pending' | 'consumed' | 'expired',
    pullPages: [] as Array<{
      serverSeq: number;
      hasMore: boolean;
      lessons: SyncLessonPullOutput[];
      lastOpened: SyncLastOpenedOutput | null;
    }>,
    conflictsOnNextPush: [] as Array<{
      lessonId: string;
      track: 'pb' | 'dg';
      reason: string;
      serverTrack: { positionMs: number; segmentIndex: number; updatedAtMs: number; seq: number };
    }>,

    async pairCreate(params: { token?: string; deviceName: string }) {
      if (transport.failWithNetwork) {
        throw new SyncApiError({ status: 502, code: 'UPSTREAM_UNREACHABLE', message: 'offline' });
      }
      return {
        groupId: 'grp-1',
        deviceId: 'dev-wechat-1',
        deviceToken: params.token ? undefined : 'b'.repeat(64),
        code: 'K7M9P2XR',
        displayCode: 'K7M9-P2XR',
        qrPayload: buildQrPayload('K7M9P2XR'),
        expiresAtMs: 1_760_000_300_000,
        serverTimeMs: 1_760_000_000_000,
      };
    },

    async pairStatus(params: { code: string }) {
      if (transport.failWithRevoked) {
        throw new SyncApiError({ status: 401, code: 'DEVICE_REVOKED', message: 'revoked' });
      }
      return {
        code: params.code,
        displayCode: formatDisplayCode(params.code),
        status: transport.nextPairStatus,
        expiresAtMs: 1_760_000_300_000,
        serverTimeMs: 1_760_000_002_000,
        claimedDevice:
          transport.nextPairStatus === 'consumed'
            ? {
                deviceId: 'dev-ipad-2',
                deviceName: 'iPad Pro',
                platform: 'ipad',
                consumedAtMs: 1_760_000_002_000,
              }
            : undefined,
      };
    },

    async pairClaim() {
      if (transport.failWithNetwork) {
        throw new SyncApiError({ status: 502, code: 'UPSTREAM_UNREACHABLE', message: 'offline' });
      }
      return {
        groupId: 'grp-joined',
        deviceId: 'dev-wechat-1',
        deviceToken: 'c'.repeat(64),
        serverSeq: 12,
        serverTimeMs: 1_760_000_000_000,
        devices,
      };
    },

    async push(params: { payload: SyncPushRequest }) {
      if (transport.failWithRevoked) {
        throw new SyncApiError({ status: 401, code: 'DEVICE_REVOKED', message: 'revoked' });
      }
      if (transport.failWithNetwork) {
        throw new SyncApiError({ status: 502, code: 'UPSTREAM_UNREACHABLE', message: 'offline' });
      }
      transport.pushCalls.push(params.payload);
      const conflicts = [...transport.conflictsOnNextPush];
      transport.conflictsOnNextPush = [];
      return {
        serverSeq: 20 + transport.pushCalls.length,
        serverTimeMs: 1_760_000_010_000,
        acceptedLessons: params.payload.lessons.map((l) => l.lessonId),
        rejectedConflicts: conflicts,
        lastOpened: params.payload.lastOpened
          ? {
              lessonId: params.payload.lastOpened.lessonId,
              updatedAtMs: params.payload.lastOpened.updatedAtMs,
              seq: 20 + transport.pushCalls.length,
            }
          : null,
      };
    },

    async pull(params: { sinceSeq: number }) {
      if (transport.failWithRevoked) {
        throw new SyncApiError({ status: 401, code: 'DEVICE_REVOKED', message: 'revoked' });
      }
      if (transport.failWithNetwork) {
        throw new SyncApiError({ status: 502, code: 'UPSTREAM_UNREACHABLE', message: 'offline' });
      }
      transport.pullSinceSeqs.push(params.sinceSeq);
      const next = transport.pullPages.shift();
      if (next) {
        return {
          ...next,
          serverTimeMs: 1_760_000_010_000,
        };
      }
      return {
        serverSeq: params.sinceSeq,
        serverTimeMs: 1_760_000_010_000,
        hasMore: false,
        lastOpened: null,
        lessons: [],
      };
    },

    async listDevices() {
      if (transport.failWithRevoked) {
        throw new SyncApiError({ status: 401, code: 'DEVICE_REVOKED', message: 'revoked' });
      }
      return { serverTimeMs: 1_760_000_010_000, devices };
    },

    async renameSelf(params: { deviceName: string }) {
      devices[0] = { ...devices[0], deviceName: params.deviceName };
      return { serverTimeMs: 1_760_000_010_000, device: devices[0] };
    },

    async revokeDevice(params: { deviceId: string }) {
      transport.revokedTargets.push(params.deviceId);
      return { serverTimeMs: 1_760_000_010_000, revokedDeviceId: params.deviceId };
    },
  };

  return transport;
}

describe('core/syncModels · whitelist & pairing code validation', () => {
  test('validates exact 335 canonical lesson IDs excluding 0121..0150', () => {
    let validCount = 0;
    for (let n = 0; n <= 400; n += 1) {
      const id = String(n).padStart(4, '0');
      if (isValidCanonicalLessonId(id)) {
        validCount += 1;
      }
    }
    assert.equal(validCount, 335);
    assert.equal(isValidCanonicalLessonId('0001'), true);
    assert.equal(isValidCanonicalLessonId('0120'), true);
    assert.equal(isValidCanonicalLessonId('0121'), false);
    assert.equal(isValidCanonicalLessonId('0150'), false);
    assert.equal(isValidCanonicalLessonId('0151'), true);
    assert.equal(isValidCanonicalLessonId('0365'), true);
    assert.equal(isValidCanonicalLessonId('0366'), false);
    assert.equal(isValidCanonicalLessonId('lesson-1'), false);
  });

  test('normalizes raw, hyphenated, lowercase, and epsync QR codes while rejecting ambiguous chars', () => {
    assert.equal(normalizePairingCode('k7m9-p2xr'), 'K7M9P2XR');
    assert.equal(normalizePairingCode('epsync://v1/pair?c=K7M9P2XR'), 'K7M9P2XR');
    assert.equal(normalizePairingCode('  k7m9 p2xr  '), 'K7M9P2XR');
    assert.equal(normalizePairingCode('K7M0P2XR'), null); // 0 excluded
    assert.equal(normalizePairingCode('K7MOP2XR'), null); // O excluded
    assert.equal(normalizePairingCode('K7M1P2XR'), null); // 1 excluded
    assert.equal(normalizePairingCode('K7MIP2XR'), null); // I excluded
    assert.equal(normalizePairingCode('K7MLP2XR'), null); // L excluded
    assert.equal(formatCodeInput('k7m0-p2xr9'), 'K7MP-2XR9');
    assert.equal(sanitizeDeviceName('  <b>My iPhone</b>\n  '), 'bMy iPhone/b'.replace(/\s+/, ' '));
  });
});

describe('core/syncEngine · pairing, chunking, conflicts & revocation', () => {
  test('createPairingCode splits >80 local baseline lessons into 80-lesson chunks and handles 2s consumed poll', async () => {
    const kv = createMemoryKeyValue();
    const bridge = new FakeProgressBridge();
    const transport = createFakeTransport();
    const scheduler = new FakeTimerScheduler();

    // Seed 170 canonical lessons (all 0001..0120 = 120 + 0151..0200 = 50)
    for (let i = 1; i <= 120; i += 1) {
      const id = String(i).padStart(4, '0');
      bridge.records.set(id, makeRecord(id, { completed: true, pbPos: 500_000 }));
    }
    for (let i = 151; i <= 200; i += 1) {
      const id = String(i).padStart(4, '0');
      bridge.records.set(id, makeRecord(id, { dgPos: 45_000 }));
    }
    bridge.lastOpened = '0200';

    const engine = new SyncEngine({
      kv,
      transport,
      bridge,
      now: () => 1_760_000_000_000,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
    });
    engine.init();

    const ticket = await engine.createPairingCode();
    assert.equal(ticket?.code, 'K7M9P2XR');
    // 170 lessons -> chunks of 80, 80, 10
    assert.deepEqual(
      transport.pushCalls.map((c) => c.lessons.length),
      [80, 80, 10],
    );
    assert.equal(transport.pushCalls[2].lastOpened?.lessonId, '0200');
    assert.equal(engine.getSnapshot().pendingCount, 0);

    // Advance 2s pairing status poll and mark consumed
    transport.nextPairStatus = 'consumed';
    scheduler.runByDelay(2000);
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(engine.getSnapshot().ticketStatus, 'consumed');
    assert.equal(engine.getSnapshot().lastClaimedDevice?.deviceName, 'iPad Pro');
    assert.equal(engine.getSnapshot().devices.length, 2);
    engine.dispose();
  });

  test('claimPairingCode pushes local baseline and loops while pull hasMore is true', async () => {
    const kv = createMemoryKeyValue();
    const bridge = new FakeProgressBridge();
    const transport = createFakeTransport();
    const scheduler = new FakeTimerScheduler();

    bridge.records.set('0005', makeRecord('0005', { completed: true, pbPos: 320_000 }));
    transport.pullPages.push(
      {
        serverSeq: 8,
        hasMore: true,
        lastOpened: { lessonId: '0012', updatedAtMs: 1_760_000_005_000, seq: 8 },
        lessons: [
          {
            lessonId: '0010',
            lessonCompleted: true,
            seq: 8,
            pb: { positionMs: 590_000, segmentIndex: 30, updatedAtMs: 1_760_000_005_000, seq: 8 },
            dg: null,
          },
        ],
      },
      {
        serverSeq: 12,
        hasMore: false,
        lastOpened: { lessonId: '0012', updatedAtMs: 1_760_000_006_000, seq: 12 },
        lessons: [
          {
            lessonId: '0012',
            lessonCompleted: false,
            seq: 12,
            pb: { positionMs: 140_000, segmentIndex: 8, updatedAtMs: 1_760_000_006_000, seq: 12 },
            dg: { positionMs: 65_000, segmentIndex: 4, updatedAtMs: 1_760_000_006_000, seq: 12 },
          },
        ],
      },
    );

    const engine = new SyncEngine({
      kv,
      transport,
      bridge,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
    });
    engine.init();

    const ok = await engine.claimPairingCode('epsync://v1/pair?c=K7M9P2XR');
    assert.equal(ok, true);
    assert.deepEqual(transport.pullSinceSeqs, [0, 8]);
    assert.equal(bridge.readRecord('0010').lessonCompleted, true);
    assert.equal(bridge.readRecord('0012').podcast?.committedPositionMs, 140_000);
    assert.equal(bridge.readRecord('0012').dialogue?.committedPositionMs, 65_000);
    assert.equal(bridge.lastOpened, '0012');
    assert.equal(engine.getSnapshot().lastSyncedSeq, 12);
    engine.dispose();
  });

  test('switchGroupWithCode revokes old device best-effort and preserves 100% local progress', async () => {
    const kv = createMemoryKeyValue();
    const bridge = new FakeProgressBridge();
    const transport = createFakeTransport();
    const scheduler = new FakeTimerScheduler();

    bridge.records.set('0002', makeRecord('0002', { completed: true, pbPos: 450_000 }));
    kv.set(
      SYNC_STATE_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        groupId: 'old-group',
        deviceId: 'dev-old',
        deviceToken: '1'.repeat(64),
        deviceName: 'Old Phone',
        lastSyncedSeq: 99,
        lastSyncedAtMs: 1_760_000_000_000,
        clockOffsetMs: 0,
        trackBaseSeq: { '0002:pb': 99 },
        lastOpenedSeq: 99,
        dirtyLessonIds: [],
        dirtyLastOpened: false,
        devices: [],
      }),
    );

    const engine = new SyncEngine({
      kv,
      transport,
      bridge,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
    });
    engine.init();

    const switched = await engine.switchGroupWithCode('K7M9-P2XR');
    assert.equal(switched, true);
    assert.deepEqual(transport.revokedTargets, ['me']);
    assert.equal(engine.getSnapshot().groupId, 'grp-joined');
    assert.equal(bridge.readRecord('0002').lessonCompleted, true);
    assert.equal(bridge.readRecord('0002').podcast?.committedPositionMs, 450_000);
    engine.dispose();
  });

  test('adopts rejectedConflicts server track and handles 401 DEVICE_REVOKED without losing progress', async () => {
    const kv = createMemoryKeyValue();
    const bridge = new FakeProgressBridge();
    const transport = createFakeTransport();
    const scheduler = new FakeTimerScheduler();

    const engine = new SyncEngine({
      kv,
      transport,
      bridge,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
    });
    engine.init();
    await engine.claimPairingCode('K7M9P2XR');

    // Simulate local seek while remote server rejects with newer serverTrack
    bridge.records.set('0003', makeRecord('0003', { pbPos: 90_000, pbSeg: 5 }));
    transport.conflictsOnNextPush.push({
      lessonId: '0003',
      track: 'pb',
      reason: 'server_newer',
      serverTrack: { positionMs: 240_000, segmentIndex: 14, updatedAtMs: 1_760_000_099_000, seq: 55 },
    });

    engine.recordLocalLessonChange('0003', false);
    scheduler.runByDelay(2000);
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(bridge.readRecord('0003').podcast?.committedPositionMs, 240_000);
    assert.equal(bridge.readRecord('0003').podcast?.committedSegmentIndex, 14);

    // Offline failure marks offline & retains dirty lesson, then recovers on syncNow
    transport.failWithNetwork = true;
    bridge.records.set('0004', makeRecord('0004', { pbPos: 120_000 }));
    engine.recordLocalLessonChange('0004', true);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(engine.getSnapshot().status, 'offline');
    assert.equal(engine.getSnapshot().pendingCount, 1);

    transport.failWithNetwork = false;
    assert.equal(await engine.syncNow(), true);
    assert.equal(engine.getSnapshot().status, 'synced');
    assert.equal(engine.getSnapshot().pendingCount, 0);

    // 401 DEVICE_REVOKED clears credentials + shows notice while preserving all local progress
    transport.failWithRevoked = true;
    await engine.syncNow();
    const snap = engine.getSnapshot();
    assert.equal(snap.linked, false);
    assert.equal(snap.status, 'unlinked');
    assert.equal(snap.revokedNotice, true);
    assert.equal(bridge.readRecord('0003').podcast?.committedPositionMs, 240_000);
    assert.equal(bridge.readRecord('0004').podcast?.committedPositionMs, 120_000);

    engine.dispose();
  });

  test('supports renameSelf, removeDevice, and leaveGroup cleanly', async () => {
    const kv = createMemoryKeyValue();
    const bridge = new FakeProgressBridge();
    const transport = createFakeTransport();
    const scheduler = new FakeTimerScheduler();

    const engine = new SyncEngine({
      kv,
      transport,
      bridge,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
    });
    engine.init();
    await engine.claimPairingCode('K7M9P2XR');

    assert.equal(await engine.renameSelf('我的主力手机'), true);
    assert.equal(engine.getSnapshot().deviceName, '我的主力手机');

    assert.equal(await engine.removeDevice('dev-ipad-2'), true);
    assert.equal(engine.getSnapshot().devices.length, 1);

    await engine.leaveGroup();
    assert.equal(engine.getSnapshot().linked, false);
    assert.equal(kv.get(SYNC_STATE_STORAGE_KEY), '');
    engine.dispose();
  });
});

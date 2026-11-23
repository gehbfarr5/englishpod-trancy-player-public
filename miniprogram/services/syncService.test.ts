import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { LearningStore } from '../adapters/wechat/learningStore';
import { SyncEngine } from '../core/syncEngine';
import {
  SyncPushRequest,
  SyncTransport,
  buildQrPayload,
  formatDisplayCode,
} from '../core/syncModels';
import { createMemoryKeyValue } from '../test-support/memoryKeyValue';
import { ProgressJournal } from './progressJournal';
import { SyncService } from './syncService';

describe('services/syncService · 双向联动与防回环/活跃播放保护', () => {
  test('forwards local journal commits, ignores remoteMerge echo, and skips actively playing track', async () => {
    const kv = createMemoryKeyValue();
    const store = new LearningStore(kv);
    const journal = new ProgressJournal({ store, now: () => 1_760_000_000_000 });
    const pushRequests: SyncPushRequest[] = [];
    let pullReturnsChanged = false;

    const transport: SyncTransport = {
      async pairCreate() {
        return {
          groupId: 'g1',
          deviceId: 'd1',
          deviceToken: 'a'.repeat(64),
          code: '23456789',
          displayCode: '2345-6789',
          qrPayload: buildQrPayload('23456789'),
          expiresAtMs: 1_760_000_300_000,
          serverTimeMs: 1_760_000_000_000,
        };
      },
      async pairStatus(params) {
        return {
          code: params.code,
          displayCode: formatDisplayCode(params.code),
          status: 'pending',
          expiresAtMs: 1_760_000_300_000,
          serverTimeMs: 1_760_000_000_000,
        };
      },
      async pairClaim() {
        return {
          groupId: 'g1',
          deviceId: 'd1',
          deviceToken: 'a'.repeat(64),
          serverSeq: 1,
          serverTimeMs: 1_760_000_000_000,
          devices: [],
        };
      },
      async push(params) {
        pushRequests.push(params.payload);
        return {
          serverSeq: 5,
          serverTimeMs: 1_760_000_001_000,
          acceptedLessons: params.payload.lessons.map((l) => l.lessonId),
          rejectedConflicts: [],
        };
      },
      async pull(params) {
        if (pullReturnsChanged) {
          pullReturnsChanged = false;
          return {
            serverSeq: 8,
            serverTimeMs: 1_760_000_002_000,
            hasMore: false,
            lastOpened: { lessonId: '0009', updatedAtMs: 1_760_000_002_000, seq: 8 },
            lessons: [
              {
                lessonId: '0001',
                lessonCompleted: true,
                seq: 8,
                pb: { positionMs: 500_000, segmentIndex: 25, updatedAtMs: 1_760_000_002_000, seq: 8 },
                dg: null,
              },
              {
                lessonId: '0009',
                lessonCompleted: false,
                seq: 8,
                pb: { positionMs: 180_000, segmentIndex: 9, updatedAtMs: 1_760_000_002_000, seq: 8 },
                dg: null,
              },
            ],
          };
        }
        return {
          serverSeq: Math.max(params.sinceSeq, 1),
          serverTimeMs: 1_760_000_001_000,
          hasMore: false,
          lastOpened: null,
          lessons: [],
        };
      },
      async listDevices() {
        return { serverTimeMs: 1_760_000_001_000, devices: [] };
      },
      async renameSelf(params) {
        return {
          serverTimeMs: 1_760_000_001_000,
          device: {
            deviceId: 'd1',
            deviceName: params.deviceName,
            platform: 'wechat',
            createdAtMs: 0,
            lastSeenAtMs: 0,
            isCurrent: true,
          },
        };
      },
      async revokeDevice(params) {
        return { serverTimeMs: 1_760_000_001_000, revokedDeviceId: params.deviceId };
      },
    };

    const playbackState = { lessonId: '0001', track: 'pb' as const, isPlaying: true };
    const service = new SyncService({
      kv,
      transport,
      journal,
      getPlaybackState: () => playbackState,
      detectDeviceName: () => 'Test WeChat Device',
    });

    service.init();
    assert.equal(await service.claimPairingCode('2345-6789'), true);
    pushRequests.length = 0;

    // 1. 本地暂停提交（immediate=true）应触发推送
    journal.commit({
      lessonId: '0001',
      track: 'pb',
      positionMs: 120_000,
      segmentIndex: 6,
      durationMs: 600_000,
      reason: 'pause',
    });
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(pushRequests.length, 1);
    assert.equal(pushRequests[0].lessons[0].lessonId, '0001');
    pushRequests.length = 0;

    // 2. 远端拉取回来时：0001 PB 正在活跃播放中不应覆写，0009 应合并，且不能再次触发 push（防回环）
    pullReturnsChanged = true;
    await service.syncNow();
    await new Promise((r) => setTimeout(r, 15));

    assert.equal(pushRequests.length, 0, 'remoteMerge 不得回环触发 push');
    assert.equal(journal.readRecord('0001').lessonCompleted, true);
    assert.equal(journal.readRecord('0001').podcast?.committedPositionMs, 120_000);
    assert.equal(journal.readRecord('0009').podcast?.committedPositionMs, 180_000);
    assert.equal(journal.lastOpenedLessonId(), '0009');

    void SyncEngine;
    service.dispose();
  });
});

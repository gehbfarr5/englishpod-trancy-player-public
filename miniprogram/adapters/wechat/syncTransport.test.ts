import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SyncApiError } from '../../core/syncModels';
import { WechatSyncTransport } from './syncTransport';

describe('adapters/wechat/syncTransport', () => {
  test('routes calls through syncGateway cloud function and unwraps ok payload', async () => {
    const calls: Array<{ name: string; data: Record<string, unknown> }> = [];
    const transport = new WechatSyncTransport({
      callFunction: async (args) => {
        calls.push(args);
        return {
          result: {
            ok: true,
            status: 200,
            data: {
              serverTimeMs: 1_760_000_000_000,
              code: 'K7M9P2XR',
              displayCode: 'K7M9-P2XR',
              qrPayload: 'epsync://v1/pair?c=K7M9P2XR',
              expiresAtMs: 1_760_000_300_000,
              groupId: 'grp-1',
              deviceId: 'dev-1',
              deviceToken: 'a'.repeat(64),
            },
          },
        };
      },
    });

    const ticket = await transport.pairCreate({
      deviceName: 'iPhone 15',
      platform: 'wechat',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'syncGateway');
    assert.equal(calls[0].data.method, 'POST');
    assert.equal(calls[0].data.path, '/api/sync/v1/pair/create');
    assert.equal(ticket.code, 'K7M9P2XR');
  });

  test('maps non-ok gateway envelope into typed SyncApiError and handles cloud failure', async () => {
    const transport = new WechatSyncTransport({
      callFunction: async () => ({
        result: {
          ok: false,
          status: 401,
          data: {
            error: { code: 'DEVICE_REVOKED', message: 'revoked' },
          },
        },
      }),
    });

    await assert.rejects(
      () => transport.pull({ token: 'a'.repeat(64), sinceSeq: 0 }),
      (err: unknown) => err instanceof SyncApiError && err.status === 401 && err.code === 'DEVICE_REVOKED',
    );

    const brokenTransport = new WechatSyncTransport({
      callFunction: async () => {
        throw new Error('cloud timeout');
      },
    });

    await assert.rejects(
      () => brokenTransport.listDevices({ token: 'a'.repeat(64) }),
      (err: unknown) =>
        err instanceof SyncApiError && err.status === 502 && err.code === 'UPSTREAM_UNREACHABLE',
    );
  });
});

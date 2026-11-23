import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  computeGatewaySignature,
  deriveGatewaySubject,
  resolveAllowlistedRoute,
  createSyncGatewayHandler,
} = require('./index.js');

const TEST_SECRET = 'ep-sync-test-secret-0123456789abcdef';
const TEST_TOKEN = 'a'.repeat(64);

describe('syncGateway · route allowlist & SSRF guard', () => {
  test('allows all 8 EP-SYNC-001 routes and rejects arbitrary paths', () => {
    assert.deepEqual(resolveAllowlistedRoute('POST', '/api/sync/v1/pair/create', {}), {
      method: 'POST',
      pathAndQuery: '/api/sync/v1/pair/create',
      authMode: 'optional',
      hasBody: true,
    });
    assert.deepEqual(
      resolveAllowlistedRoute('GET', '/api/sync/v1/pair/status', { code: 'k7m9-p2xr' }),
      {
        method: 'GET',
        pathAndQuery: '/api/sync/v1/pair/status?code=k7m9-p2xr',
        authMode: 'required',
        hasBody: false,
      },
    );
    assert.deepEqual(resolveAllowlistedRoute('POST', '/api/sync/v1/pair/claim', {}), {
      method: 'POST',
      pathAndQuery: '/api/sync/v1/pair/claim',
      authMode: 'none',
      hasBody: true,
    });
    assert.deepEqual(resolveAllowlistedRoute('POST', '/api/sync/v1/sync/push', {}), {
      method: 'POST',
      pathAndQuery: '/api/sync/v1/sync/push',
      authMode: 'required',
      hasBody: true,
    });
    assert.deepEqual(resolveAllowlistedRoute('GET', '/api/sync/v1/sync/pull', { since_seq: 42 }), {
      method: 'GET',
      pathAndQuery: '/api/sync/v1/sync/pull?since_seq=42',
      authMode: 'required',
      hasBody: false,
    });
    assert.deepEqual(resolveAllowlistedRoute('GET', '/api/sync/v1/devices', {}), {
      method: 'GET',
      pathAndQuery: '/api/sync/v1/devices',
      authMode: 'required',
      hasBody: false,
    });
    assert.deepEqual(resolveAllowlistedRoute('PATCH', '/api/sync/v1/devices/me', {}), {
      method: 'PATCH',
      pathAndQuery: '/api/sync/v1/devices/me',
      authMode: 'required',
      hasBody: true,
    });
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    assert.deepEqual(resolveAllowlistedRoute('DELETE', `/api/sync/v1/devices/${uuid}`, {}), {
      method: 'DELETE',
      pathAndQuery: `/api/sync/v1/devices/${uuid}`,
      authMode: 'required',
      hasBody: false,
    });
    assert.deepEqual(resolveAllowlistedRoute('DELETE', '/api/sync/v1/devices/me', {}), {
      method: 'DELETE',
      pathAndQuery: '/api/sync/v1/devices/me',
      authMode: 'required',
      hasBody: false,
    });

    // Reject traversal, embedded query/protocol, wrong methods, invalid params
    assert.equal(resolveAllowlistedRoute('GET', '/healthz', {}), null);
    assert.equal(resolveAllowlistedRoute('GET', '/api/sync/v1/devices/../admin', {}), null);
    assert.equal(resolveAllowlistedRoute('GET', 'https://evil.example/api/sync/v1/devices', {}), null);
    assert.equal(resolveAllowlistedRoute('DELETE', '/api/sync/v1/devices/not-a-uuid', {}), null);
    assert.equal(resolveAllowlistedRoute('GET', '/api/sync/v1/sync/pull', { since_seq: -1 }), null);
    assert.equal(resolveAllowlistedRoute('GET', '/api/sync/v1/pair/status', { code: 'bad' }), null);
    assert.equal(resolveAllowlistedRoute('PUT', '/api/sync/v1/devices/me', {}), null);
  });
});

describe('syncGateway · configuration, HMAC signing & error passthrough', () => {
  test('returns 503 SYNC_NOT_CONFIGURED when SYNC_BASE_URL or secret is missing', async () => {
    const handler = createSyncGatewayHandler({
      env: {},
      getWXContext: () => ({ OPENID: 'wx-openid-1' }),
      fetchImpl: async () => {
        throw new Error('must not fetch');
      },
    });
    const res = await handler({ method: 'POST', path: '/api/sync/v1/pair/create' });
    assert.equal(res.ok, false);
    assert.equal(res.status, 503);
    assert.equal(res.data.error.code, 'SYNC_NOT_CONFIGURED');
  });

  test('signs canonical request matching Go VerifyGatewayRequest and hides raw OPENID', async () => {
    let capturedUrl = '';
    let capturedInit = null;
    const fixedNow = 1760000123456;
    const handler = createSyncGatewayHandler({
      env: {
        SYNC_BASE_URL: 'https://sync.example.invalid/',
        SYNC_GATEWAY_SECRET: TEST_SECRET,
      },
      getWXContext: () => ({ OPENID: 'secret-openid-999' }),
      now: () => fixedNow,
      fetchImpl: async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(
          JSON.stringify({ serverTimeMs: fixedNow, code: 'K7M9P2XR', displayCode: 'K7M9-P2XR' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    const body = { deviceName: 'iPhone 16', platform: 'wechat' };
    const res = await handler({
      method: 'POST',
      path: '/api/sync/v1/pair/create',
      body,
    });

    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(capturedUrl, 'https://sync.example.invalid/api/sync/v1/pair/create');

    const headers = capturedInit.headers;
    assert.equal(headers['X-Gateway-Timestamp'], String(fixedNow));
    // Raw openid must never appear in forwarded headers or URL
    assert.equal(JSON.stringify(headers).includes('secret-openid-999'), false);
    const expectedSubject = deriveGatewaySubject(TEST_SECRET, 'secret-openid-999');
    assert.equal(headers['X-Gateway-Subject'], expectedSubject);

    // Independently verify canonical signature matches Go's ComputeGatewaySignature
    const bodyBytes = Buffer.from(JSON.stringify(body), 'utf8');
    const bodyHash = crypto.createHash('sha256').update(bodyBytes).digest('hex');
    const canonical = `POST\n/api/sync/v1/pair/create\n${fixedNow}\n${expectedSubject}\n${bodyHash}`;
    const expectedSig = crypto.createHmac('sha256', TEST_SECRET).update(canonical).digest('hex');
    assert.equal(headers['X-Gateway-Signature'], expectedSig);
    assert.equal(
      computeGatewaySignature(
        TEST_SECRET,
        'POST',
        '/api/sync/v1/pair/create',
        String(fixedNow),
        expectedSubject,
        bodyBytes,
      ),
      expectedSig,
    );
  });

  test('requires OPENID, enforces 64KB cap, and preserves upstream 401/429 errors', async () => {
    const noOpenId = createSyncGatewayHandler({
      env: { SYNC_BASE_URL: 'https://sync.example.invalid', SYNC_GATEWAY_SECRET: TEST_SECRET },
      getWXContext: () => ({}),
      fetchImpl: async () => new Response('{}', { status: 200 }),
    });
    const unauthRes = await noOpenId({ method: 'POST', path: '/api/sync/v1/pair/create' });
    assert.equal(unauthRes.status, 401);
    assert.equal(unauthRes.data.error.code, 'MISSING_OPENID');

    const largeHandler = createSyncGatewayHandler({
      env: { SYNC_BASE_URL: 'https://sync.example.invalid', SYNC_GATEWAY_SECRET: TEST_SECRET },
      getWXContext: () => ({ OPENID: 'wx-user' }),
      fetchImpl: async () => new Response('{}', { status: 200 }),
    });
    const bigRes = await largeHandler({
      method: 'POST',
      path: '/api/sync/v1/sync/push',
      token: TEST_TOKEN,
      body: { blob: 'x'.repeat(70000) },
    });
    assert.equal(bigRes.status, 413);
    assert.equal(bigRes.data.error.code, 'PAYLOAD_TOO_LARGE');

    const upstreamErrHandler = createSyncGatewayHandler({
      env: { SYNC_BASE_URL: 'https://sync.example.invalid', SYNC_GATEWAY_SECRET: TEST_SECRET },
      getWXContext: () => ({ OPENID: 'wx-user' }),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            serverTimeMs: 123,
            error: { code: 'DEVICE_REVOKED', message: 'revoked' },
          }),
          { status: 401 },
        ),
    });
    const revokedRes = await upstreamErrHandler({
      method: 'GET',
      path: '/api/sync/v1/sync/pull',
      query: { since_seq: 0 },
      token: TEST_TOKEN,
    });
    assert.equal(revokedRes.ok, false);
    assert.equal(revokedRes.status, 401);
    assert.equal(revokedRes.data.error.code, 'DEVICE_REVOKED');
  });
});

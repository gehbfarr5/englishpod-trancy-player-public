import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyTaskResult,
  main,
  missingConfiguration,
  readConfig,
  runMiniTest,
  waitForTask,
} from './wechat-minitest.mjs';

const sha = 'a'.repeat(40);

function config(overrides = {}) {
  return {
    token: 'test-token',
    groupEnId: 'englishpod-project',
    testPlanId: '45',
    testType: 2,
    wxVersion: 3,
    platforms: ['ios', 'android'],
    appVersion: '0.3.12',
    commitSha: sha,
    runId: '12345',
    devAccountNo: '9',
    pollIntervalMs: 15000,
    timeoutMs: 60000,
    outputDir: '',
    summaryPath: '',
    ...overrides,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('reads the official project, test plan, platform and source identity settings', () => {
  const actual = readConfig({
    MINITEST_TOKEN: 'secret',
    MINITEST_PROJECT_ID: 'group-1',
    MINITEST_PLAN_ID: '52',
    MINITEST_PLATFORMS: 'ios,android,ios',
    MINITEST_COMMIT_SHA: sha,
    MINITEST_APP_VERSION: '1.2.3',
    MINITEST_RUN_ID: '12345',
  });
  assert.equal(actual.groupEnId, 'group-1');
  assert.equal(actual.testPlanId, '52');
  assert.deepEqual(actual.platforms, ['ios', 'android']);
  assert.equal(actual.wxVersion, 3);
  assert.deepEqual(missingConfiguration(actual), []);
});

test('missing cloud configuration is explicit and prevents a device-validated claim', () => {
  const actual = readConfig({});
  assert.deepEqual(missingConfiguration(actual), [
    'MINITEST_TOKEN',
    'MINITEST_PROJECT_ID',
    'MINITEST_PLAN_ID',
    'MINITEST_COMMIT_SHA',
    'MINITEST_RUN_ID',
  ]);
});

test('MiniTest requires status 12 and a perfect success rate for PASS', () => {
  assert.deepEqual(classifyTaskResult({ data: { status: 1 } }), {
    terminal: false, status: 'RUNNING', code: 1,
  });
  assert.deepEqual(classifyTaskResult({ data: { status: 12 } }), {
    terminal: true, status: 'COMPLETED', code: 12,
  });
  assert.equal(classifyTaskResult({ data: { status: 15 } }).status, 'FAIL');
  assert.equal(classifyTaskResult({ data: { status: 12 } }).status, 'COMPLETED');
  assert.throws(() => classifyTaskResult({ data: { status: 3 } }), /unknown task status/);
});

test('submits the documented form fields, polls to terminal PASS and verifies report references', async () => {
  const calls = [];
  let statusCalls = 0;
  const fetchImpl = async (input, init = {}) => {
    const url = input instanceof URL ? input : new URL(String(input));
    calls.push({ url, init });
    if (url.pathname.endsWith('/plan') && init.method === 'POST') {
      return jsonResponse({ rtn: 0, data: { plan_id: 8801 } });
    }
    if (url.pathname.endsWith('/plan')) {
      statusCalls += 1;
      assert.equal(url.searchParams.get('full_info'), '1');
      return jsonResponse({
        rtn: 0,
        data: statusCalls === 1
          ? { status: 2, status_text: '测试中' }
          : { status: 12, status_text: '测试结束' },
      });
    }
    if (url.pathname.endsWith('/plan_list')) {
      assert.equal(url.searchParams.get('keyword_in_desc'), sha);
      return jsonResponse({ rtn: 0, data: { plan_list: [{ id: 8801, success_rate: 1 }] } });
    }
    if (url.pathname.endsWith('/share_url')) {
      return jsonResponse({ rtn: 0, data: { share_url: 'https://private.example/report' } });
    }
    if (url.pathname.endsWith('/report/static_resource')) {
      return jsonResponse({ rtn: 0, data: { download_url: 'https://private.example/report.zip' } });
    }
    throw new Error('Unexpected MiniTest endpoint: ' + url.pathname);
  };
  const result = await runMiniTest({
    config: config(),
    fetchImpl,
    sleepImpl: async () => {},
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.taskId, 8801);
  assert.equal(result.reportAvailable, true);
  assert.equal(statusCalls, 2);

  const submission = calls[0];
  assert.equal(submission.url.href, 'https://minitest.weixin.qq.com/thirdapi/plan');
  assert.equal(submission.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const fields = new URLSearchParams(submission.init.body);
  assert.equal(fields.get('token'), 'test-token');
  assert.equal(fields.get('group_en_id'), 'englishpod-project');
  assert.equal(fields.get('test_type'), '2');
  assert.equal(fields.get('wx_version'), '3');
  assert.equal(fields.get('platforms'), 'ios,android');
  assert.equal(fields.get('test_plan_id'), '45');
  assert.equal(fields.get('dev_account_no'), '9');
  assert.match(fields.get('desc'), new RegExp(sha));
  assert.match(fields.get('desc'), /gha_run=12345/);
  assert.equal(submission.init.headers.Authorization, undefined);
  assert.equal(calls.some(call => String(call.url).includes('private.example')), false);
});

test('a completed run with failing cases is reported as FAIL', async () => {
  let resourcesRequested = false;
  let index = 0;
  const fetchImpl = async input => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.pathname.endsWith('/plan')) {
      index += 1;
      if (index === 1) return jsonResponse({ rtn: 0, data: { plan_id: 12 } });
      return jsonResponse({ rtn: 0, data: { status: 12 } });
    }
    if (url.pathname.endsWith('/plan_list')) {
      return jsonResponse({ rtn: 0, data: { plan_list: [{ id: 12, success_rate: 0.75 }] } });
    }
    resourcesRequested = true;
    if (url.pathname.endsWith('/share_url')) {
      return jsonResponse({ rtn: 0, data: { share_url: 'https://private.example/report' } });
    }
    if (url.pathname.endsWith('/report/static_resource')) {
      return jsonResponse({ rtn: 0, data: { download_url: 'https://private.example/report.zip' } });
    }
    throw new Error('Unexpected MiniTest endpoint: ' + url.pathname);
  };
  const result = await runMiniTest({ config: config(), fetchImpl });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.successRate, 0.75);
  assert.equal(resourcesRequested, true);
});

test('bounded poll timeout returns ERROR rather than success', async () => {
  let time = 0;
  const result = await waitForTask({
    config: config({ timeoutMs: 60000, pollIntervalMs: 60000 }),
    taskId: 7,
    now: () => time,
    sleepImpl: async ms => { time += ms; },
    fetchImpl: async () => jsonResponse({ rtn: 0, data: { status: 2 } }),
  });
  assert.equal(result.status, 'ERROR');
  assert.equal(result.reason, 'timeout');
});

test('HTTP and API errors do not expose upstream response content', async () => {
  const fetchImpl = async () => jsonResponse({ rtn: -1, msg: 'private token must not be echoed' });
  await assert.rejects(
    runMiniTest({ config: config(), fetchImpl }),
    /rtn=-1/,
  );
  await assert.rejects(
    runMiniTest({ config: config(), fetchImpl: async () => jsonResponse({}, 503) }),
    /status 503/,
  );
});

test('missing configuration causes main() to report NOT_RUN and return failure exit code 1', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'minitest-test-'));
  try {
    const exitCode = await main({
      MINITEST_OUTPUT_DIR: tempDir,
    });
    assert.equal(exitCode, 1);
    const summary = JSON.parse(readFileSync(join(tempDir, 'minitest-summary.json'), 'utf8'));
    assert.equal(summary.status, 'NOT_RUN');
    assert.ok(Array.isArray(summary.missingConfiguration));
    assert.ok(summary.missingConfiguration.includes('MINITEST_TOKEN'));
    assert.ok(summary.missingConfiguration.includes('MINITEST_PROJECT_ID'));
    assert.ok(summary.missingConfiguration.includes('MINITEST_PLAN_ID'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

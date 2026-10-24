/**
 * Tencent MiniTest integration using the official third-party API contract:
 * https://developers.weixin.qq.com/miniprogram/dev/devtools/minitest/api_plan.html
 * Never print tokens, share URLs, download URLs, or raw MiniTest responses.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ROOT = 'https://minitest.weixin.qq.com/thirdapi';
const DEFAULT_POLL_INTERVAL_MS = 15000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function readConfig(env = process.env) {
  return {
    token: env.MINITEST_TOKEN || '',
    groupEnId: env.MINITEST_PROJECT_ID || '',
    testPlanId: env.MINITEST_PLAN_ID || '',
    testType: boundedInteger(env.MINITEST_TEST_TYPE, 2, 1, 5),
    wxVersion: boundedInteger(env.MINITEST_WX_VERSION, 3, 1, 3),
    platforms: (env.MINITEST_PLATFORMS || 'ios,android')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index),
    appVersion: env.MINITEST_APP_VERSION || PACKAGE_VERSION || '',
    commitSha: env.MINITEST_COMMIT_SHA || '',
    runId: env.MINITEST_RUN_ID || '',
    devAccountNo: env.MINITEST_DEV_ACCOUNT_NO || env.WECHAT_CI_ROBOT || '9',
    pollIntervalMs: boundedInteger(
      env.MINITEST_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      5000,
      60000,
    ),
    timeoutMs: boundedInteger(env.MINITEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 60000, DEFAULT_TIMEOUT_MS),
    outputDir: env.MINITEST_OUTPUT_DIR || '',
    summaryPath: env.GITHUB_STEP_SUMMARY || '',
  };
}

export function missingConfiguration(config) {
  const missing = [];
  if (!config.token) missing.push('MINITEST_TOKEN');
  if (!config.groupEnId) missing.push('MINITEST_PROJECT_ID');
  if (!config.testPlanId) missing.push('MINITEST_PLAN_ID');
  if (!config.platforms.length) missing.push('MINITEST_PLATFORMS');
  if (!/^[0-9a-f]{40}$/i.test(config.commitSha)) missing.push('MINITEST_COMMIT_SHA');
  if (!config.appVersion) missing.push('MINITEST_APP_VERSION');
  if (!config.runId) missing.push('MINITEST_RUN_ID');
  return missing;
}

function validateConfig(config) {
  if (config.testType !== 2 && config.testType !== 3) {
    throw new Error('Configured test type must be Minium (2) or recorded replay (3).');
  }
  if (!config.platforms.length ||
      config.platforms.some(platform => platform !== 'ios' && platform !== 'android')) {
    throw new Error('Platforms must contain ios and/or android only.');
  }
}

async function readApiResponse(response) {
  if (!response || typeof response.json !== 'function') {
    throw new Error('MiniTest returned an invalid HTTP response.');
  }
  if (!response.ok) {
    throw new Error('MiniTest HTTP request failed with status ' + response.status + '.');
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('MiniTest returned invalid JSON.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('MiniTest returned an invalid response object.');
  }
  if (payload.rtn !== 0) {
    const errorMsg = typeof payload.msg === 'string' ? payload.msg.slice(0, 100) : '';
    throw new Error('MiniTest rejected the request with rtn=' + String(payload.rtn) + (errorMsg ? ' (' + errorMsg + ')' : '') + '.');
  }
  return payload;
}

async function postForm(fetchImpl, endpoint, fields) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== '') body.set(key, String(value));
  }
  const response = await fetchImpl(API_ROOT + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(30000),
  });
  return readApiResponse(response);
}

async function getJson(fetchImpl, endpoint, fields) {
  const url = new URL(API_ROOT + endpoint);
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(30000) });
  return readApiResponse(response);
}

function taskStatus(payload) {
  const data = payload && payload.data;
  if (!data || typeof data !== 'object' || !Number.isInteger(Number(data.status))) {
    throw new Error('MiniTest task response did not contain a valid status.');
  }
  return { code: Number(data.status), data };
}

export function classifyTaskResult(payload) {
  const { code } = taskStatus(payload);
  if (code < 10) return { terminal: false, status: 'RUNNING', code };
  if (code !== 12) {
    return {
      terminal: true,
      status: 'FAIL',
      code,
      reason: 'abnormal-terminal-status',
    };
  }
  return { terminal: true, status: 'COMPLETED', code };
}

async function defaultSleep(ms) {
  await new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

export async function waitForTask({
  fetchImpl = fetch,
  config,
  taskId,
  now = () => Date.now(),
  sleepImpl = defaultSleep,
}) {
  const startedAt = now();
  while (now() - startedAt < config.timeoutMs) {
    const payload = await getJson(fetchImpl, '/plan', {
      token: config.token,
      group_en_id: config.groupEnId,
      plan_id: taskId,
      full_info: 1,
    });
    const result = classifyTaskResult(payload);
    const statusText = typeof payload.data?.status_text === 'string' ? ' (' + payload.data.status_text + ')' : '';
    console.log('[wechat-minitest] task ' + taskId + ' status=' + result.status + ' code=' + result.code + statusText);
    if (result.terminal) return result;
    await sleepImpl(Math.min(config.pollIntervalMs, Math.max(0, config.timeoutMs - (now() - startedAt))));
  }
  return { terminal: true, status: 'ERROR', reason: 'timeout' };
}

export function findSuccessRate(payload, taskId) {
  const list = payload && payload.data && payload.data.plan_list;
  if (!Array.isArray(list)) throw new Error('MiniTest task list did not contain plan_list.');
  const task = list.find(item => Number(item.id) === Number(taskId));
  if (!task) return null;
  const successRate = Number(task.success_rate);
  if (!Number.isFinite(successRate)) {
    throw new Error('MiniTest task list did not contain a valid success_rate.');
  }
  return successRate;
}

async function waitForSuccessRate(fetchImpl, config, taskId, now, sleepImpl) {
  const startedAt = now();
  while (now() - startedAt < 120000) {
    const payload = await getJson(fetchImpl, '/plan_list', {
      token: config.token,
      group_en_id: config.groupEnId,
      page_index: 1,
      page_size: 100,
      keyword_in_desc: config.commitSha,
      create_by_me: 1,
    });
    const successRate = findSuccessRate(payload, taskId);
    if (successRate !== null) return successRate;
    await sleepImpl(Math.min(config.pollIntervalMs, Math.max(0, 120000 - (now() - startedAt))));
  }
  throw new Error('MiniTest completed but its success rate was not available.');
}

async function confirmReportResources(fetchImpl, config, taskId) {
  const fields = {
    token: config.token,
    group_en_id: config.groupEnId,
    plan_id: taskId,
  };
  const [sharePayload, resourcePayload] = await Promise.all([
    getJson(fetchImpl, '/share_url', fields),
    getJson(fetchImpl, '/report/static_resource', { ...fields, need_image: 0, need_log: 1 }),
  ]);
  if (typeof sharePayload.data?.share_url !== 'string' ||
      typeof resourcePayload.data?.download_url !== 'string') {
    throw new Error('MiniTest completed without returning report references.');
  }
  return { reportAvailable: true };
}

function baseSummary(config, status, extra = {}) {
  return {
    status,
    appVersion: config.appVersion,
    commitSha: config.commitSha,
    wxVersion: config.wxVersion,
    testType: config.testType,
    platforms: config.platforms,
    ...extra,
  };
}

export async function runMiniTest({
  config,
  fetchImpl = fetch,
  now = () => Date.now(),
  sleepImpl = defaultSleep,
}) {
  validateConfig(config);
  const postFields = {
    token: config.token,
    group_en_id: config.groupEnId,
    test_type: config.testType,
    wx_version: config.wxVersion,
    platforms: config.platforms.join(','),
    test_plan_id: config.testPlanId,
    desc: 'EnglishPod Mini Program ' + config.appVersion + ' sha=' + config.commitSha +
      ' gha_run=' + config.runId,
  };
  if (config.wxVersion === 3 && config.devAccountNo) {
    postFields.dev_account_no = config.devAccountNo;
  }
  const submitted = await postForm(fetchImpl, '/plan', postFields);
  const taskId = submitted.data?.plan_id;
  if (!Number.isInteger(Number(taskId)) || Number(taskId) <= 0) {
    throw new Error('MiniTest submission did not return a task ID.');
  }
  console.log('[wechat-minitest] Submitted task ID: ' + taskId);
  const finalResult = await waitForTask({
    fetchImpl,
    config,
    taskId: Number(taskId),
    now,
    sleepImpl,
  });
  if (finalResult.status === 'ERROR') {
    return baseSummary(config, finalResult.status, {
      taskId: Number(taskId),
      taskStatus: finalResult.code,
      reason: finalResult.reason || 'test-task-not-passed',
      reportAvailable: false,
    });
  }
  let successRate = null;
  let reportAvailable = false;
  try {
    successRate = await waitForSuccessRate(fetchImpl, config, Number(taskId), now, sleepImpl);
    reportAvailable = (await confirmReportResources(fetchImpl, config, Number(taskId))).reportAvailable;
  } catch (error) {
    return baseSummary(config, 'ERROR', {
      taskId: Number(taskId),
      taskStatus: finalResult.code,
      successRate,
      reason: error instanceof Error ? error.message.slice(0, 180) : 'report-read-error',
      reportAvailable,
    });
  }
  if (finalResult.status !== 'COMPLETED' || successRate !== 1) {
    return baseSummary(config, 'FAIL', {
      taskId: Number(taskId),
      taskStatus: finalResult.code,
      successRate,
      reason: successRate === 1 ? 'abnormal-terminal-status' : 'one-or-more-tests-failed',
      reportAvailable,
    });
  }
  return baseSummary(config, 'PASS', {
    taskId: Number(taskId),
    taskStatus: finalResult.code,
    successRate,
    reportAvailable,
  });
}

function persistSummary(path, report) {
  if (!path) return;
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'minitest-summary.json'), JSON.stringify(report, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function writeStepSummary(path, report) {
  if (!path) return;
  const lines = [
    '### Tencent MiniTest result',
    '',
    '- Status: **' + report.status + '**',
    '- App version / commit: ' + report.appVersion + ' / ' + report.commitSha,
    '- Task ID: ' + (report.taskId || 'not created'),
    '- Platforms: ' + report.platforms.join(', '),
    '- Success rate: ' + (Number.isFinite(report.successRate) ? report.successRate : 'not available'),
    '- Report references available in MiniTest: ' + String(Boolean(report.reportAvailable)),
    '- Share URLs and downloadable report URLs are intentionally excluded from public logs.',
    '',
  ];
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, lines.join('\n'), 'utf8');
}

export async function main(env = process.env) {
  const config = readConfig(env);
  const missing = missingConfiguration(config);
  if (missing.length) {
    const report = baseSummary(config, 'NOT_RUN', { missingConfiguration: missing });
    persistSummary(config.outputDir, report);
    writeStepSummary(config.summaryPath, report);
    console.error('[wechat-minitest] NOT_RUN; missing required configuration: ' + missing.join(', '));
    return 1;
  }
  let report;
  try {
    report = await runMiniTest({ config });
  } catch (error) {
    report = baseSummary(config, 'ERROR', {
      reason: error instanceof Error ? error.message.slice(0, 180) : 'unknown-error',
      reportAvailable: false,
    });
  }
  persistSummary(config.outputDir, report);
  writeStepSummary(config.summaryPath, report);
  console.log('[wechat-minitest] ' + report.status +
    (report.taskId ? ' taskId=' + report.taskId : '') +
    (Number.isFinite(report.successRate) ? ' successRate=' + report.successRate : ''));
  return report.status === 'PASS' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error('[wechat-minitest] ERROR ' +
      (error instanceof Error ? error.message.slice(0, 180) : 'unknown-error'));
    process.exitCode = 1;
  });
}

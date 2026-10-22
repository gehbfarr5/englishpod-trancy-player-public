/**
 * Explicitly gated WeChat Mini Program CI entrypoint.
 * verify: no secret, no network, no platform mutation.
 * preview: creates developer preview QR; upload: uploads development code ONLY.
 *
 * Diagnostic contract (see docs/wechat-ci-deployment.md):
 * - Every phase marker is written synchronously to stderr and carries elapsed seconds.
 * - Progress from the WeChat SDK is surfaced, so a stall can be attributed to local
 *   compilation, COS transfer or the CI API instead of one opaque "api" phase.
 * - Host-level evidence (load, memory, swap, processes, sockets) is captured in place
 *   when a stall is detected, before the process is torn down.
 * - A single stuck SDK call must never keep the job alive: the in-process watchdog and
 *   a forced exit are backed by a workflow-level `timeout` wrapper.
 * - No key material, tokens or raw upstream bodies are ever printed.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { auditMiniProgram } from './wechat-package-audit.mjs';

const validModes = ['verify', 'preview', 'upload'];
const mode = process.argv[2] || 'verify';

const DEFAULT_API_TIMEOUT_MS = 360000;
const HEARTBEAT_MS = 15000;
const STALL_MS = 120000;
const PROCESS_STARTED_AT = Date.now();

function resolveApiTimeoutMs() {
  const parsed = Number(process.env.WECHAT_CI_TIMEOUT_MS || '');
  return Number.isInteger(parsed) && parsed >= 30000 && parsed <= 1800000
    ? parsed
    : DEFAULT_API_TIMEOUT_MS;
}

const API_TIMEOUT_MS = resolveApiTimeoutMs();
// Backstop inside the process in case the raced timeout itself cannot run
// (blocked event loop). The workflow-level `timeout` command is the last resort.
const HARD_TIMEOUT_MS = API_TIMEOUT_MS + 120000;

function elapsedSec() {
  return ((Date.now() - PROCESS_STARTED_AT) / 1000).toFixed(1);
}

/**
 * Diagnostics go to stderr only. They record phase markers and structured error
 * fields (name/code/errCode/errno/syscall/status) and never include raw upstream
 * messages, requests, response bodies, tokens or key material.
 */
function note(message) {
  try {
    writeSync(2, '[wechat-ci] ' + message + '\n');
  } catch {
    console.error('[wechat-ci] ' + message);
  }
}

function sanitizeError(error) {
  const parts = [];
  if (error && typeof error === 'object') {
    if (typeof error.name === 'string') parts.push('name=' + error.name.slice(0, 48));
    if (typeof error.code === 'string' || typeof error.code === 'number') {
      parts.push('code=' + String(error.code).slice(0, 48));
    }
    if (typeof error.errCode === 'number') parts.push('errCode=' + error.errCode);
    if (typeof error.errno === 'number') parts.push('errno=' + error.errno);
    if (typeof error.syscall === 'string') parts.push('syscall=' + error.syscall.slice(0, 24));
    if (typeof error.status === 'number') parts.push('status=' + error.status);
  } else {
    parts.push('name=' + typeof error);
  }
  return parts.join(' ') || 'no-structured-details';
}

/** Free-text progress messages come from the SDK; keep them short and inert. */
function sanitizeText(value, limit = 120) {
  const printable = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return printable.length > limit ? printable.slice(0, limit) + '~' : printable;
}

/**
 * Read-only host snapshot. This is the evidence needed to explain a stall that
 * happens on a shared runner: coarse CPU/memory pressure plus the processes and
 * sockets that are alive at that moment. Never writes to the host.
 */
function dumpHostSnapshot(tag) {
  if (process.platform !== 'linux') return;
  let meminfo = '';
  try {
    meminfo = readFileSync('/proc/meminfo', 'utf8');
  } catch {
    meminfo = '';
  }
  const pick = key => {
    const match = meminfo.match(new RegExp('^' + key + ':\\s+(\\d+)', 'm'));
    return match ? Math.round(Number(match[1]) / 1024) : 'unknown';
  };
  let loadavg = 'unknown';
  try {
    loadavg = readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/).slice(0, 3).join(' ');
  } catch {
    loadavg = 'unknown';
  }
  note('snapshot[' + tag + '] loadavg=' + loadavg +
    ' memAvailableMb=' + pick('MemAvailable') +
    ' swapFreeMb=' + pick('SwapFree') + '/' + pick('SwapTotal') +
    ' committedMb=' + pick('Committed_AS'));

  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000 });
    return result && typeof result.stdout === 'string' ? result.stdout : '';
  };

  const ps = run('ps', ['-eo', 'pid,ppid,etime,pcpu,pmem,rss,stat,comm', '--sort=-pcpu']);
  for (const line of ps.trim().split('\n').slice(0, 8)) {
    note('snapshot[' + tag + '] ps: ' + sanitizeText(line, 140));
  }
  const nodes = run('sh', ['-c', 'pgrep -c node 2>/dev/null || true']).trim();
  note('snapshot[' + tag + '] nodeProcesses=' + (nodes || 'unknown'));
  const sockets = run('sh', ['-c', 'ss -Htn state established 2>/dev/null | wc -l']);
  note('snapshot[' + tag + '] establishedSockets=' + (sockets.trim() || 'unknown'));
}

// A WeChat call that never settles would otherwise leave no output at all.
// Race it against a bounded timer so the step fails loudly instead of exiting quietly.
function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      note('phase=timeout label="' + label + '" elapsedSec=' + elapsedSec() +
        ' limitSec=' + Math.round(ms / 1000));
      dumpHostSnapshot('api-timeout');
      reject(new Error(label + ' did not settle within ' + Math.round(ms / 1000) + 's'));
    }, ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/**
 * The SDK keeps child-process handles and sockets open, so setting exitCode is not
 * enough: the step would stay "running" after a failure. Flush, then force the exit.
 */
function finish(code) {
  process.exitCode = code;
  const forced = setTimeout(() => process.exit(code), 5000);
  if (typeof forced.unref === 'function') forced.unref();
}

async function main() {
  if (!validModes.includes(mode)) throw new Error('Unknown mode; use verify, preview or upload');
  const audit = auditMiniProgram();
  if (mode === 'verify') {
    console.log('[wechat-ci] VERIFIED (offline only; no WeChat compilation or upload) ' + audit.version);
    return;
  }
  if (process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      process.env.GITHUB_REF !== 'refs/heads/main' ||
      process.env.WECHAT_CI_APPROVED !== 'UPLOAD_WECHAT_DEV_CODE') {
    throw new Error('WeChat network operations require an explicitly confirmed manual main workflow');
  }
  const encodedKey = process.env.WECHAT_CI_PRIVATE_KEY_B64 || '';
  if (!encodedKey) throw new Error('Missing WECHAT_CI_PRIVATE_KEY_B64 GitHub Secret');
  const privateKey = Buffer.from(encodedKey, 'base64').toString('utf8');
  if (!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(privateKey)) {
    throw new Error('WeChat key does not contain a valid PEM private-key header');
  }
  const runId = process.env.GITHUB_RUN_ID || 'unknown';
  const sha = process.env.GITHUB_SHA || '';
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('Missing trusted Git SHA');
  const robot = Number(process.env.WECHAT_CI_ROBOT || '9');
  if (!Number.isInteger(robot) || robot < 1 || robot > 30) throw new Error('Invalid CI robot number');
  const output = process.env.WECHAT_CI_OUTPUT_DIR;
  if (mode === 'preview' && (!output || !resolve(output).startsWith(resolve(tmpdir()) + '/'))) {
    throw new Error('Preview QR output must reside under the runner temporary directory');
  }

  const ephemeralDir = mkdtempSync(join(tmpdir(), 'englishpod-wechat-key-'));
  const keyPath = join(ephemeralDir, 'wechat-upload.key');
  let lastProgressAt = Date.now();
  let lastProgress = 'none';
  let maxLoopLagMs = 0;
  let stallReported = false;
  let heartbeat;
  let lagMonitor;
  let hardWatchdog;

  try {
    writeFileSync(keyPath, privateKey, { mode: 0o600 });
    note('phase=gate-ok mode=' + mode + ' appid=' + audit.appid + ' robot=' + robot +
      ' keyChars=' + privateKey.length + ' apiTimeoutSec=' + Math.round(API_TIMEOUT_MS / 1000) +
      ' hardTimeoutSec=' + Math.round(HARD_TIMEOUT_MS / 1000));
    dumpHostSnapshot('start');

    // Event-loop lag: a multi-second lag means the runner (or this process) is starved,
    // which is itself an explanation for a "silent" phase.
    let lagExpected = Date.now() + 1000;
    lagMonitor = setInterval(() => {
      const now = Date.now();
      const lag = now - lagExpected;
      if (lag > maxLoopLagMs) maxLoopLagMs = lag;
      lagExpected = now + 1000;
    }, 1000);

    heartbeat = setInterval(() => {
      const sinceProgressSec = Math.round((Date.now() - lastProgressAt) / 1000);
      note('phase=heartbeat elapsedSec=' + elapsedSec() + ' sinceProgressSec=' + sinceProgressSec +
        ' lastProgress=' + lastProgress + ' maxLoopLagMs=' + maxLoopLagMs +
        ' rssMb=' + Math.round(process.memoryUsage().rss / 1048576));
      if (!stallReported && Date.now() - lastProgressAt > STALL_MS) {
        stallReported = true;
        note('phase=stall-warning noProgressSec=' + sinceProgressSec + ' lastProgress=' + lastProgress);
        dumpHostSnapshot('stall');
      }
    }, HEARTBEAT_MS);

    hardWatchdog = setTimeout(() => {
      note('phase=hard-timeout elapsedSec=' + elapsedSec() +
        ' limitSec=' + Math.round(HARD_TIMEOUT_MS / 1000));
      dumpHostSnapshot('hard-timeout');
      process.exit(3);
    }, HARD_TIMEOUT_MS);
    if (typeof hardWatchdog.unref === 'function') hardWatchdog.unref();

    const { default: ci } = await import('miniprogram-ci');
    note('phase=miniprogram-ci-loaded elapsedSec=' + elapsedSec());

    if (process.env.WECHAT_CI_PROXY) {
      if (typeof ci.proxy === 'function') {
        ci.proxy(process.env.WECHAT_CI_PROXY);
      }
      note('phase=proxy-configured elapsedSec=' + elapsedSec());
    }

    // The SDK prints its own boundary lines; use them to label the phases precisely
    // without depending on undocumented callbacks. Purely observational.
    const originalLog = console.log.bind(console);
    let compileDone = false;
    let transferStarted = false;
    console.log = (...args) => {
      const text = args.map(value => (typeof value === 'string' ? value : '')).join(' ');
      if (!compileDone && /upload zip buffer size/i.test(text)) {
        compileDone = true;
        note('phase=compile-done elapsedSec=' + elapsedSec());
      }
      if (!transferStarted && /upload by cos|request url:/i.test(text)) {
        transferStarted = true;
        note('phase=transfer-start elapsedSec=' + elapsedSec());
      }
      originalLog(...args);
    };

    const project = new ci.Project({
      appid: audit.appid,
      type: 'miniProgram',
      projectPath: resolve('miniprogram'),
      privateKeyPath: keyPath,
      ignores: [
        'node_modules/**/*', 'scripts/**/*', 'cloudfunctions/**/*',
        '.ci/**/*', '**/*.test.ts', '**/*.test.mjs',
        '*.md', 'package.json', 'package-lock.json', 'tsconfig.json',
      ],
    });

    const onProgressUpdate = event => {
      lastProgressAt = Date.now();
      const percent = typeof event?.percent === 'number' ? Math.floor(event.percent) : null;
      const status = typeof event?.status === 'string' ? sanitizeText(event.status, 24) : 'info';
      const message = typeof event?.message === 'string' ? sanitizeText(event.message) : '';
      const loaded = typeof event?.loaded === 'number' ? event.loaded : null;
      const total = typeof event?.total === 'number' ? event.total : null;
      lastProgress = status + (percent === null ? '' : '(percent=' + percent + ')');
      note('phase=progress elapsedSec=' + elapsedSec() + ' status=' + lastProgress +
        (loaded === null ? '' : ' loaded=' + loaded + ' total=' + total) +
        (message ? ' message=' + message : ''));
    };

    const desc = 'EnglishPod ' + sha.slice(0, 12) + ' (Actions ' + runId + ')';
    const startedAt = Date.now();
    if (mode === 'preview') {
      mkdirSync(output, { recursive: true });
      note('phase=api-start mode=preview elapsedSec=' + elapsedSec());
      await withTimeout(ci.preview({
        project, desc, robot,
        setting: { useProjectConfig: true },
        qrcodeFormat: 'image',
        qrcodeOutputDest: join(output, 'preview.jpg'),
        onProgressUpdate,
      }), API_TIMEOUT_MS, 'WeChat preview call (local compilation + CI API)');
      note('phase=api-done mode=preview elapsedSec=' + ((Date.now() - startedAt) / 1000).toFixed(1));
      console.log('[wechat-ci] Developer preview QR generated for ' + sha.slice(0, 12) +
        '; developer permissions required for scanning');
    } else {
      note('phase=api-start mode=upload elapsedSec=' + elapsedSec());
      const result = await withTimeout(ci.upload({
        project, version: audit.version, desc, robot,
        setting: { useProjectConfig: true },
        onProgressUpdate,
      }), API_TIMEOUT_MS, 'WeChat upload call (local compilation + CI API)');
      note('phase=api-done mode=upload elapsedSec=' + ((Date.now() - startedAt) / 1000).toFixed(1));
      console.log('[wechat-ci] Development code upload completed; version=' + audit.version +
        '; source SHA=' + sha + '; package groups=' +
        (Array.isArray(result?.subPackageInfo) ? result.subPackageInfo.length : 'unknown'));
      console.log('[wechat-ci] No review submission, trial assignment, production release or CloudBase deployment performed.');
    }
    dumpHostSnapshot('done');
  } finally {
    clearInterval(heartbeat);
    clearInterval(lagMonitor);
    clearTimeout(hardWatchdog);
    rmSync(ephemeralDir, { recursive: true, force: true });
  }
}

process.on('unhandledRejection', error => {
  note('FAILED: unhandled rejection | diag ' + sanitizeError(error));
  finish(1);
});

process.on('uncaughtException', error => {
  note('FAILED: uncaught exception | diag ' + sanitizeError(error));
  finish(1);
});

main().then(() => {
  note('phase=exit code=0 elapsedSec=' + elapsedSec());
  finish(0);
}).catch(error => {
  // Do not print raw upstream errors: they can contain request/credential data.
  console.error('[wechat-ci] FAILED: ' +
    (/^(Unknown mode|WeChat network operations|Missing WECHAT|WeChat key|Missing trusted|Invalid CI robot|Preview QR output)/.test(error?.message || '')
      ? error.message
      : 'operation failed; check credentials, fixed-egress IP allowlist and WeChat project settings'));
  const timedOut = /did not settle within/.test(error?.message || '');
  note('diag ' + sanitizeError(error) + (timedOut ? ' | reason=api-call-never-settled' : ''));
  note('phase=exit code=' + (timedOut ? 2 : 1) + ' elapsedSec=' + elapsedSec());
  finish(timedOut ? 2 : 1);
});

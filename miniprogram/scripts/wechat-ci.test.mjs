import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { auditMiniProgram, isSensitivePath } from './wechat-package-audit.mjs';

const projectPath = resolve('miniprogram');

test('current repository matches version, AppID and packaging constraints', () => {
  const result = auditMiniProgram(projectPath);
  assert.ok(result.sourceFiles > 0);
  assert.ok(result.sourceBytes > 0);
  assert.match(result.version, /^\d+\.\d+\.\d+$/);
});

test('sensitive filenames are blocked', () => {
  for (const path of ['private.wx123.key', '.env.production', 'credentials.pem', 'id_rsa', '.npmrc']) {
    assert.equal(isSensitivePath(path), true, path);
  }
  assert.equal(isSensitivePath('app.ts'), false);
});

test('audit rejects credential-like files, including nested directories', () => {
  const temp = mkdtempSync(join(tmpdir(), 'ep-wechat-audit-test-'));
  try {
    // A deliberate file in the actual project would be unsafe. Make a full tiny fixture instead.
    const mini = join(temp, 'miniprogram');
    mkdirSync(join(mini, 'config'), { recursive: true });
    mkdirSync(join(temp, 'release'));
    writeFileSync(join(mini, 'project.config.json'), JSON.stringify({
      appid: 'wxf9bd7099653c6159', compileType: 'miniprogram',
      packOptions: { ignore: ['node_modules', 'scripts', '.ci'].map(value => ({ type: 'folder', value })) },
    }));
    writeFileSync(join(mini, 'package.json'), '{"version":"0.2.0"}');
    writeFileSync(join(mini, 'package-lock.json'), '{"version":"0.2.0","packages":{"":{"version":"0.2.0"}}}');
    writeFileSync(join(temp, 'release', 'versions.json'), '{"miniprogram":{"version":"0.2.0"}}');
    writeFileSync(join(mini, 'app.json'), '{}');
    writeFileSync(join(mini, 'config', 'private.test.key'), 'secret');
    assert.throws(() => auditMiniProgram(mini, temp), /Credential-like file/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('verify mode never requires upload credentials', () => {
  const env = { ...process.env };
  delete env.WECHAT_CI_PRIVATE_KEY_B64;
  const result = spawnSync(process.execPath, ['scripts/wechat-ci.mjs', 'verify'], {
    cwd: projectPath, encoding: 'utf8', env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /VERIFIED \(offline only/);
});

test('upload mode fails closed outside approved main workflow', () => {
  const env = { ...process.env, GITHUB_ACTIONS: 'false' };
  delete env.WECHAT_CI_PRIVATE_KEY_B64;
  const result = spawnSync(process.execPath, ['scripts/wechat-ci.mjs', 'upload'], {
    cwd: projectPath, encoding: 'utf8', env,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /explicitly confirmed manual main workflow/);
});

test('preview mode fails closed and emits sanitized diagnostics only', () => {
  const env = { ...process.env, GITHUB_ACTIONS: 'false' };
  delete env.WECHAT_CI_PRIVATE_KEY_B64;
  const result = spawnSync(process.execPath, ['scripts/wechat-ci.mjs', 'preview'], {
    cwd: projectPath, encoding: 'utf8', env,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /explicitly confirmed manual main workflow/);
  // Structured diagnostics are present and never echo key material or PEM headers.
  assert.match(result.stderr, /\[wechat-ci\] diag name=/);
  assert.doesNotMatch(result.stderr, /-----BEGIN/);
  assert.doesNotMatch(result.stderr, /[A-Za-z0-9+/]{120,}={0,2}/);
});

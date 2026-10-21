/**
 * Local, credential-free guard before WeChat compilation or upload.
 * Source bytes are NOT the compiled WeChat package size.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultMiniRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const excludedDirs = new Set(['node_modules', '.git', '.ci', 'dist', 'miniprogram_npm']);
const nonPayloadDirs = new Set(['scripts', 'cloudfunctions']);
const textExt = new Set(['.ts', '.js', '.mjs', '.json', '.wxml', '.wxss', '.wxs']);
const requiredIgnores = ['node_modules', 'scripts', '.ci'];

export function isSensitivePath(relPath) {
  const base = relPath.split(/[\\/]/).pop();
  return /^(?:\.env(?:\..*)?|\.npmrc|id_rsa(?:\.pub)?|private\..*\.key)$/i.test(base) ||
    /\.(?:key|pem|p12|p8|mobileprovision)$/i.test(base);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function auditMiniProgram(miniRoot = defaultMiniRoot, repositoryRoot = resolve(miniRoot, '..')) {
  const config = readJson(join(miniRoot, 'project.config.json'));
  const pkg = readJson(join(miniRoot, 'package.json'));
  const lock = readJson(join(miniRoot, 'package-lock.json'));
  const versions = readJson(join(repositoryRoot, 'release', 'versions.json'));
  if (!/^wx[a-zA-Z0-9]{16}$/.test(config.appid)) throw new Error('Mini Program AppID is invalid');
  if (config.compileType !== 'miniprogram') throw new Error('Expected miniprogram compileType');
  if (pkg.version !== versions.miniprogram.version ||
      pkg.version !== lock.version ||
      pkg.version !== lock.packages?.['']?.version) {
    throw new Error('Mini Program version mismatch');
  }
  const ignored = new Set((config.packOptions?.ignore || []).filter(x => x.type === 'folder').map(x => x.value));
  for (const required of requiredIgnores) {
    if (!ignored.has(required)) throw new Error('Missing project pack ignore: ' + required);
  }

  let count = 0;
  let bytes = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relative(miniRoot, abs).split(sep).join('/');
      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isSensitivePath(rel)) throw new Error('Credential-like file under miniprogram/: ' + rel);
      const parts = rel.split('/');
      if (nonPayloadDirs.has(parts[0])) continue;
      if (/\.test\.(?:ts|js|mjs)$/.test(rel) || /\.md$/i.test(rel) ||
          ['package-lock.json', 'package.json', 'tsconfig.json'].includes(rel)) continue;
      const size = statSync(abs).size;
      if (size > 2 * 1024 * 1024) throw new Error('Unexpected large source file: ' + rel);
      count += 1;
      bytes += size;
      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      if (textExt.has(ext)) {
        const body = readFileSync(abs, 'utf8');
        const pemHeader = '-----BEGIN' + ' ' + '(?:RSA |EC |OPENSSH )?PRIVATE KEY-----';
        if (new RegExp(pemHeader).test(body)) throw new Error('Private key material detected: ' + rel);
      }
    }
  };
  walk(miniRoot);
  if (count === 0) throw new Error('No Mini Program source files');
  return { version: pkg.version, appid: config.appid, sourceFiles: count, sourceBytes: bytes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = auditMiniProgram();
    console.log('[wechat-audit] OK; version=' + result.version +
      '; sourceFiles=' + result.sourceFiles + '; sourceBytes=' + result.sourceBytes +
      ' (NOT compiled package bytes)');
  } catch (error) {
    console.error('[wechat-audit] ' + error.message);
    process.exitCode = 1;
  }
}

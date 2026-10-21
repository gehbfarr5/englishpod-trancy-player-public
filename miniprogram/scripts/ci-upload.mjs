/**
 * CI 开发版代码上传脚本
 * ============================================================================
 * 用 miniprogram-ci 上传为微信官方「开发版」，永久有效，不随 25 分钟临时预览过期。
 * ============================================================================
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);

function loadCi() {
  const candidates = ['miniprogram-ci', process.env.MP_CI_MODULE_PATH].filter(Boolean);
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* ignore */
    }
  }
  throw new Error('未找到 miniprogram-ci。');
}

const ci = loadCi();

const APPID = 'wxf9bd7099653c6159';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_PATH = path.resolve(HERE, '..');

const keyPath = process.env.MP_PRIVATE_KEY || '';
if (!keyPath || !existsSync(keyPath)) {
  console.error(`❌ 密钥文件不存在：${keyPath}`);
  process.exit(2);
}

const proxyUrl = process.env.MP_CI_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
if (proxyUrl) {
  ci.proxy(proxyUrl);
}

const project = new ci.Project({
  appid: APPID,
  type: 'miniProgram',
  projectPath: PROJECT_PATH,
  privateKeyPath: keyPath,
  ignores: ['node_modules/**/*', 'scripts/**/*', '.ci/**/*'],
});

console.log(`[ci] appid = ${APPID}`);
console.log('[ci] 开始编译并上传开发版…');

const uploadResult = await ci.upload({
  project,
  version: '0.3.0',
  desc: `Dev ${new Date().toLocaleString('zh-CN')} - remove manual theme switcher & upgrade player skeleton to staggered high-fidelity text lines`,
  setting: {
    es6: true,
    es7: true,
    minify: false,
    autoPrefixWXSS: true,
  },
  onProgressUpdate: (info) => console.log('[ci upload]', info),
});

console.log('\n✅ 官方开发版上传成功！', uploadResult);

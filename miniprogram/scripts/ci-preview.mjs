/**
 * CI 预览脚本（不需要微信开发者工具）
 * ============================================================================
 * 用 `miniprogram-ci` 直接编译并生成**真机预览二维码**，手机微信扫码即可打开。
 *
 * 前置条件（一次性）：
 *   1. 微信公众平台 → 开发管理 → 开发设置 → 「小程序代码上传」→ 生成代码上传密钥
 *      会下载一个 `private.<appid>.key` 文件
 *   2. 把密钥文件路径通过环境变量 `MP_PRIVATE_KEY` 传进来（**不要提交到仓库**）
 *   3. IP 白名单：生成密钥时若能选择「不限制 IP」就选它，最省事；
 *      若必须填，就填你当前的公网出口 IP（报 40164 时错误信息里会直接给出该填哪个 IP）
 *
 * 运行：
 *   cd miniprogram
 *   MP_PRIVATE_KEY=/path/to/private.wxf9bd7099653c6159.key node scripts/ci-preview.mjs
 *
 * 依赖：`miniprogram-ci` 已作为 devDependency 装在 miniprogram/ 下
 *   （node_modules 已加入 .gitignore 与 packOptions.ignore，不会入库也不会打包上传）。
 *
 * 产物：`miniprogram/.ci/preview.jpg`（二维码图片）
 * ============================================================================
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// miniprogram-ci 是 CJS 包；这里的脚本位于仓库内，依赖装在外部工作区，
// 因此用 createRequire 显式解析，避免依赖 cwd 的 node_modules 布局。
const require = createRequire(import.meta.url);

function loadCi() {
  // 依赖优先从项目内解析；若装在其他位置，用环境变量 MP_CI_MODULE_PATH 指定。
  // ⚠️ 不要在源码里写死本机绝对路径（会随机器不同而失效，也属于信息泄漏）。
  const candidates = ['miniprogram-ci', process.env.MP_CI_MODULE_PATH].filter(Boolean);
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error(
    '未找到 miniprogram-ci。请在项目内安装：cd miniprogram && npm i -D miniprogram-ci' +
      '（或设置环境变量 MP_CI_MODULE_PATH 指向其安装目录）',
  );
}

const ci = loadCi();

const APPID = 'wxf9bd7099653c6159';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_PATH = path.resolve(HERE, '..');
const OUT_DIR = path.resolve(PROJECT_PATH, '.ci');
const OUT_FILE = path.join(OUT_DIR, 'preview.jpg');

const keyPath = process.env.MP_PRIVATE_KEY || '';
if (!keyPath) {
  console.error('❌ 缺少环境变量 MP_PRIVATE_KEY（代码上传密钥文件路径）。');
  process.exit(2);
}
if (!existsSync(keyPath)) {
  console.error(`❌ 密钥文件不存在：${keyPath}`);
  process.exit(2);
}
if (!existsSync(path.join(PROJECT_PATH, 'project.config.json'))) {
  console.error(`❌ 在 ${PROJECT_PATH} 下找不到 project.config.json。`);
  process.exit(2);
}

mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// 代理：本机若开启「fake-IP」模式的代理，servicewechat.com 会被解析到 198.18.x.x
// 这类保留段地址。Node 默认不使用环境代理，会去直连这个假 IP，TLS 握手直接失败
// （表现为 "Client network socket disconnected before secure TLS connection
// was established"，errCode 20001/20003）。因此这里显式把代理交给 miniprogram-ci。
// 优先 MP_CI_PROXY，其次沿用环境里的 HTTP(S)_PROXY。
// ---------------------------------------------------------------------------
const proxyUrl = process.env.MP_CI_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
if (proxyUrl) {
  ci.proxy(proxyUrl);
  console.log(`[ci] proxy      = ${proxyUrl}`);
}

console.log(`[ci] appid      = ${APPID}`);
console.log(`[ci] projectPath= ${PROJECT_PATH}`);
console.log(`[ci] 输出二维码 = ${OUT_FILE}`);
console.log('[ci] 开始编译并请求预览…');

const project = new ci.Project({
  appid: APPID,
  type: 'miniProgram',
  projectPath: PROJECT_PATH,
  privateKeyPath: keyPath,
  ignores: ['node_modules/**/*', 'scripts/**/*', '.ci/**/*'],
});

console.log(`[ci] appid      = ${APPID}`);
console.log(`[ci] projectPath= ${PROJECT_PATH}`);
console.log(`[ci] 输出二维码 = ${OUT_FILE}`);
console.log('[ci] 开始编译并请求预览…');

await ci.preview({
  project,
  desc: `preview ${new Date().toLocaleString('zh-CN')}`,
  // 预览不压缩，便于定位问题
  setting: {
    es6: true,
    es7: true,
    minify: false,
    minifyJS: false,
    minifyWXML: false,
    minifyWXSS: false,
    autoPrefixWXSS: true,
  },
  qrcodeFormat: 'image',
  qrcodeOutputDest: OUT_FILE,
  onProgressUpdate: (info) => console.log('[ci]', info),
});

console.log(`\n✅ 预览二维码已生成：${OUT_FILE}`);
console.log('   用微信扫码即可在真机上打开（预览版，不上传到开发版列表）。');

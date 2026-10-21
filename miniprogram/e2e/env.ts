/**
 * e2e 运行环境自检：开发者工具 CLI、登录态、自动化端口。
 *
 * 设计原则（与项目「失败要说清缺哪一项」一致）：
 *   - 任何一步不满足，直接抛出带 `code` 的可读错误，而不是让上层收到
 *     `Connection closed` 之类的噪声；
 *   - 不静默重试超过必要次数：端口拉起最多等 90s，连接最多 5 次。
 */
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

/** 开发者工具 CLI 默认路径；可用环境变量覆盖（Windows / 非默认安装）。 */
export const DEVTOOLS_CLI =
  process.env.WECHAT_DEVTOOLS_CLI ?? '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';

/** 小程序工程根（本文件在 `<mp>/e2e/` 下）。 */
export const MP_ROOT = path.resolve(__dirname, '..');

/** 自动化 WebSocket 端口，与 `cli auto --auto-port` 保持一致。 */
export const AUTO_PORT = Number(process.env.WECHAT_AUTO_PORT ?? 9420);

/** e2e 默认课程：固定一节，避免真实数据漂移。可用环境变量覆盖。 */
export const DEFAULT_LESSON_ID = process.env.E2E_LESSON_ID ?? '0001';

export class EnvError extends Error {
  readonly code: string;

  constructor(code: string, message: string, hint?: string) {
    super(hint ? `${message}\n  处理：${hint}` : message);
    this.code = code;
    this.name = 'EnvError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 单次探测端口是否处于 LISTEN。 */
export function isPortOpen(port: number, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** 确认开发者工具已登录；未登录时提示用户扫码，不硬跑。 */
export function assertDevtoolsLoggedIn(): void {
  let raw = '';
  try {
    raw = execFileSync(DEVTOOLS_CLI, ['islogin'], { encoding: 'utf8', timeout: 120_000 });
  } catch (error) {
    throw new EnvError(
      'CLI_UNAVAILABLE',
      `无法执行开发者工具 CLI：${DEVTOOLS_CLI}`,
      '确认「微信开发者工具」已安装；非默认路径请设置 WECHAT_DEVTOOLS_CLI',
    );
  }
  if (!raw.includes('"login":true')) {
    throw new EnvError(
      'LOGIN_EXPIRED',
      '开发者工具未登录（cli islogin 未返回 login:true）',
      '打开「微信开发者工具」扫码登录后重试',
    );
  }
}

/**
 * 确保自动化端口可用；不可用时用 `cli auto` 拉起并等待监听。
 *
 * 注意：`cli auto` 会把项目窗口打开，属于正常副作用（与手动点「自动化」等价）。
 */
export async function ensureAutomation(port = AUTO_PORT): Promise<void> {
  if (await isPortOpen(port)) {
    return;
  }
  assertDevtoolsLoggedIn();

  const child = spawn(
    DEVTOOLS_CLI,
    ['auto', '--project', MP_ROOT, '--auto-port', String(port)],
    { cwd: MP_ROOT, stdio: 'ignore', detached: true },
  );
  child.unref();

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await sleep(800);
    if (await isPortOpen(port)) {
      return;
    }
  }
  throw new EnvError(
    'AUTOMATION_PORT_TIMEOUT',
    `等待自动化端口 ${port} 超时（90s）`,
    '手动执行：cli auto --project <miniprogram> --auto-port ' + port,
  );
}

/** 读取开发者工具版本，仅用于报告与问题定位。 */
export function readDevtoolsVersion(): string {
  try {
    const plist = execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleShortVersionString', '/Applications/wechatwebdevtools.app/Contents/Info.plist'],
      { encoding: 'utf8' },
    ).trim();
    return plist || 'unknown';
  } catch {
    return 'unknown';
  }
}

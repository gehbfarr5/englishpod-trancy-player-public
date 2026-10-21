/**
 * e2e 报告：控制台表格 + JSON 落盘。
 *
 * 约定：
 *   - `FAIL`   = 代码行为不符合契约，可复现；
 *   - `SKIP`   = 本层（模拟器）无法判定，需要真机 / 云测；
 *   - `ERROR`  = 环境或脚本自身出错（例如课程加载失败），不代表产品有问题。
 *
 * 三者的区分是这份报告存在的理由：混在一起就会退化成「一红就怀疑人生」。
 */
import fs from 'node:fs';
import path from 'node:path';

export type ScenarioStatus = 'PASS' | 'FAIL' | 'SKIP' | 'ERROR';

export interface ScenarioResult {
  id: string;
  title: string;
  status: ScenarioStatus;
  /** 人类可读的证据行，直接打印。 */
  detail: string[];
  /** 结构化证据，写入 JSON 便于比对。 */
  evidence?: Record<string, unknown>;
  screenshot?: string | null;
}

const COLORS: Record<ScenarioStatus, string> = {
  PASS: '\u001b[32m',
  FAIL: '\u001b[31m',
  SKIP: '\u001b[33m',
  ERROR: '\u001b[35m',
};
const RESET = '\u001b[0m';

function paint(status: ScenarioStatus): string {
  return `${COLORS[status]}${status.padEnd(5)}${RESET}`;
}

export function printHeader(meta: Record<string, string>): void {
  console.log('');
  console.log('小程序 e2e（devtools + miniprogram-automator）');
  for (const [key, value] of Object.entries(meta)) {
    console.log(`  ${key.padEnd(12)} ${value}`);
  }
  console.log('');
}

export function printResult(result: ScenarioResult): void {
  console.log(`${paint(result.status)} ${result.id}  ${result.title}`);
  for (const line of result.detail) {
    console.log(`        ${line}`);
  }
  if (result.screenshot) {
    console.log(`        截图 ${result.screenshot}`);
  }
  console.log('');
}

export function printSummary(results: ScenarioResult[]): { pass: number; fail: number; skip: number; error: number } {
  const tally = { pass: 0, fail: 0, skip: 0, error: 0 };
  for (const result of results) {
    if (result.status === 'PASS') tally.pass += 1;
    else if (result.status === 'FAIL') tally.fail += 1;
    else if (result.status === 'SKIP') tally.skip += 1;
    else tally.error += 1;
  }
  console.log(
    `合计 ${results.length} 条：PASS ${tally.pass} / FAIL ${tally.fail} / SKIP ${tally.skip} / ERROR ${tally.error}`,
  );
  return tally;
}

export function writeReport(
  dir: string,
  meta: Record<string, unknown>,
  results: ScenarioResult[],
): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'report.json');
  fs.writeFileSync(
    file,
    `${JSON.stringify({ meta, generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
    'utf8',
  );
  return file;
}

export function createArtifactDir(root: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-');
  const dir = path.join(root, stamp);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * e2e 入口。
 *
 *   npm run e2e                     # 跑全部场景（FAIL 也退出 0，用于「先看现状」）
 *   npm run e2e -- --strict         # FAIL 时退出 1（用于门禁）
 *   npm run e2e -- --only=render-anchor
 *   npm run e2e -- --lesson=0007 --port=9420
 *
 * 退出码：0 正常；1 有 FAIL 且 --strict / 有 ERROR；2 环境未就绪。
 */
import path from 'node:path';
import {
  AUTO_PORT,
  DEFAULT_LESSON_ID,
  EnvError,
  MP_ROOT,
  ensureAutomation,
  readDevtoolsVersion,
} from './env';
import { connect, openLesson } from './session';
import { scenarios } from './scenarios';
import type { ScenarioContext } from './scenario';
import {
  createArtifactDir,
  printHeader,
  printResult,
  printSummary,
  writeReport,
} from './report';
import type { ScenarioResult } from './report';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 场景之间的清场：回到列表页，释放播放页的定时器与音频实例。 */
async function settle(mp: { reLaunch(url: string): Promise<unknown> }): Promise<void> {
  try {
    await mp.reLaunch('/pages/library/index');
    await pause(300);
  } catch {
    // 清场失败不应掩盖场景自身的结论
  }
}

interface Options {
  strict: boolean;
  only: string[];
  lessonId: string;
  port: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    strict: false,
    only: [],
    lessonId: DEFAULT_LESSON_ID,
    port: AUTO_PORT,
  };
  for (const arg of argv) {
    if (arg === '--strict') {
      options.strict = true;
    } else if (arg.startsWith('--only=')) {
      options.only = arg
        .slice('--only='.length)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--lesson=')) {
      options.lessonId = arg.slice('--lesson='.length).trim();
    } else if (arg.startsWith('--port=')) {
      options.port = Number(arg.slice('--port='.length));
    }
  }
  return options;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const selected = options.only.length
    ? scenarios.filter((scenario) => options.only.includes(scenario.id))
    : scenarios;

  if (selected.length === 0) {
    console.error(`没有匹配的场景：${options.only.join(', ')}`);
    return 2;
  }

  printHeader({
    开发者工具: readDevtoolsVersion(),
    自动化端口: String(options.port),
    测试课程: options.lessonId,
    场景数: String(selected.length),
  });

  try {
    await ensureAutomation(options.port);
  } catch (error) {
    const message = error instanceof EnvError ? `[${error.code}] ${error.message}` : String(error);
    console.error(`环境未就绪：${message}`);
    return 2;
  }

  const mp = await connect(options.port);
  const artifactsDir = createArtifactDir(path.join(MP_ROOT, 'e2e', 'artifacts'));
  const ctx: ScenarioContext = {
    mp,
    artifactsDir,
    lessonId: options.lessonId,
    open: (inner) => openLesson(mp, options.lessonId, inner),
  };

  const results: ScenarioResult[] = [];
  try {
    for (const scenario of selected) {
      try {
        const result = await scenario.run(ctx);
        results.push(result);
        printResult(result);
      } catch (error) {
        const message = error instanceof EnvError ? `[${error.code}] ${error.message}` : String(error);
        const failed: ScenarioResult = {
          id: scenario.id,
          title: scenario.title,
          status: 'ERROR',
          detail: [message],
        };
        results.push(failed);
        printResult(failed);
      }
      // 清场：回到列表页并释放播放页（tick 定时器 / 音频实例），
      // 避免上一个场景的残留让下一个场景的 RPC 超时。
      await settle(mp);
    }
  } finally {
    await mp.disconnect().catch(() => undefined);
  }

  const tally = printSummary(results);
  const reportFile = writeReport(artifactsDir, {
    devtools: readDevtoolsVersion(),
    port: options.port,
    lessonId: options.lessonId,
  }, results);
  console.log(`报告 ${reportFile}`);
  console.log(`截图目录 ${artifactsDir}`);
  console.log('');

  if (tally.error > 0) {
    return 1;
  }
  if (tally.fail > 0 && options.strict) {
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(2);
  });

/**
 * 场景协议：一个场景 = 一次可独立复现的「操作 → 观察 → 判定」。
 *
 * 约束：
 *   - 每个场景自己 `ctx.open()`，不共享页面实例（避免上一个场景的残留状态）；
 *   - 场景只通过 `session` 提供的观察手段取证，不读页面内部字段；
 *   - 断点写入必须走产品自身的通道，禁止在 e2e 里伪造（单一写通道）。
 */
import type { AutomatorMiniProgram, AutomatorPage } from 'miniprogram-automator';
import type { ScenarioResult } from './report';

export interface ScenarioContext {
  mp: AutomatorMiniProgram;
  artifactsDir: string;
  lessonId: string;
  /** 打开课程播放页（reLaunch，页面栈干净）。 */
  open(options?: { track?: 'pb' | 'dg'; pause?: boolean }): Promise<AutomatorPage>;
}

export interface Scenario {
  id: string;
  title: string;
  /** 该场景对应契约/缺陷编号，便于回链。 */
  refs: string[];
  run(ctx: ScenarioContext): Promise<ScenarioResult>;
}

/**
 * 渲染事实 · 切走再切回后，高亮句仍在视口内。
 *
 * 这一条只有 L1 能做：读 `#transcriptViewport` 的真实尺寸与高亮行的真实位置，
 * 确认「视图层」也落位了，而不只是 `data.activeSegIdx` 对。
 *
 * 步骤全部走真实用户动作：PB 连点 4 次「下一句」→ 切 DG → 切回 PB。
 * 用 PB 而不是 DG：PB 有 100+ 行，必须真实滚动才能让高亮句可见。
 */
import {
  capture,
  invokePageMethod,
  readActiveRowRect,
  readFacts,
  tapTab,
} from '../session';
import type { Scenario } from '../scenario';
import type { ScenarioResult } from '../report';

const FORWARD_STEPS = 4;

export const renderAnchor: Scenario = {
  id: 'render-anchor',
  title: '切走再切回后，高亮句仍在视口内',
  refs: ['BUG-004', 'E07', 'real-scroll'],
  async run(ctx): Promise<ScenarioResult> {
    const page = await ctx.open({ track: 'pb', pause: true });

    for (let step = 0; step < FORWARD_STEPS; step += 1) {
      await invokePageMethod(ctx.mp, 'nextSentence');
      await page.waitFor(450);
    }
    await page.waitFor(600);
    const atPb = await readFacts(page);
    const beforeRect = await readActiveRowRect(page);

    await tapTab(page, 1); // -> Dialogue
    await page.waitFor(1000);
    await tapTab(page, 0); // -> Podcast
    await page.waitFor(1800);

    const backPb = await readFacts(page);
    const afterRect = await readActiveRowRect(page);
    const shot = await capture(ctx.mp, ctx.artifactsDir, 'render-anchor');

    const segOk = backPb.activeSegIdx === atPb.activeSegIdx;
    const rowsOk = backPb.transcriptRows > 0;
    const highlightOk = backPb.activeRows === 1;
    // 「落位」判据刻意不自造像素阈值：
    //   1) 高亮行句首必须在视口内（top ∈ [0, 视口高)）；
    //   2) 产品自己的「找回当前句」条不应亮起 —— 它才是「当前句是否可见」的权威判断。
    const headVisible = afterRect !== null && afterRect.top >= 0 && afterRect.top < afterRect.viewportHeight;
    const locateHidden = backPb.showLocateBar === false;
    const pass = segOk && rowsOk && highlightOk && headVisible && locateHidden;

    const describe = (rect: typeof afterRect, locateBar: boolean): string =>
      rect === null
        ? '未取到高亮行'
        : `句首 top=${rect.top.toFixed(1)}（视口高 ${rect.viewportHeight.toFixed(1)}）${headVisible ? '' : ' 句首不在视口内'}；找回条=${locateBar ? '亮起' : '未亮'}`;

    return {
      id: 'render-anchor',
      title: '切走再切回后，高亮句仍在视口内',
      status: pass ? 'PASS' : 'FAIL',
      detail: [
        `PB 连点 ${FORWARD_STEPS} 次下一句后：seg=${atPb.activeSegIdx}，${describe(beforeRect, atPb.showLocateBar)}`,
        `切走再切回：seg=${backPb.activeSegIdx}，${describe(afterRect, backPb.showLocateBar)}`,
        `判定：句位${segOk ? '一致' : '不一致'} / 高亮${highlightOk ? '唯一' : `异常(${backPb.activeRows})`} / 可见性${headVisible && locateHidden ? '通过' : '失败'}`,
      ],
      evidence: { atPb, backPb, beforeRect, afterRect },
      screenshot: shot,
    };
  },
};

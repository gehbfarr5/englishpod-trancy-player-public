/**
 * 双轨断点各自保留 · PB → DG → PB 回到原句（BUG-002 回归）。
 *
 * 做法完全走产品通道：点字幕行 = 用户 seek，切轨 = 用户点标签。
 * 不使用 `callMethod`，也不伪造任何写入路径。
 */
import { capture, readFacts, tapTab, tapTranscriptRow } from '../session';
import type { Scenario } from '../scenario';
import type { ScenarioResult } from '../report';

const TARGET_SEG = 4;

export const switchKeepPosition: Scenario = {
  id: 'switch-keep-position',
  title: 'PB→DG→PB 回到原句（双轨断点不串写）',
  refs: ['BUG-002', 'E07'],
  async run(ctx): Promise<ScenarioResult> {
    const page = await ctx.open({ track: 'pb', pause: true });

    const tapped = await tapTranscriptRow(page, TARGET_SEG);
    if (!tapped) {
      return {
        id: 'switch-keep-position',
        title: 'PB→DG→PB 回到原句（双轨断点不串写）',
        status: 'SKIP',
        detail: [`第 ${TARGET_SEG} 句未渲染（虚拟列表未覆盖），本场景跳过。`],
      };
    }
    await page.waitFor(700);
    const atPb = await readFacts(page);

    await tapTab(page, 1); // -> Dialogue
    await page.waitFor(1000);
    const atDg = await readFacts(page);

    await tapTab(page, 0); // -> Podcast
    await page.waitFor(1200);
    const backPb = await readFacts(page);
    const shot = await capture(ctx.mp, ctx.artifactsDir, 'switch-keep-position');

    const pass = backPb.activeSegIdx === atPb.activeSegIdx && backPb.transcriptRows > 0;

    return {
      id: 'switch-keep-position',
      title: 'PB→DG→PB 回到原句（双轨断点不串写）',
      status: pass ? 'PASS' : 'FAIL',
      detail: [
        `PB 点第 ${TARGET_SEG} 句后：seg=${atPb.activeSegIdx} pos=${atPb.positionLabel}`,
        `切到 DG：seg=${atDg.activeSegIdx} pos=${atDg.positionLabel}（DG 自己的断点）`,
        `切回 PB：seg=${backPb.activeSegIdx} pos=${backPb.positionLabel}`,
        pass
          ? `判定：PB 断点保持（回到 seg=${atPb.activeSegIdx}）。`
          : `判定：PB 断点被改写（期望 seg=${atPb.activeSegIdx}，实际 seg=${backPb.activeSegIdx}）。`,
      ],
      evidence: { atPb, atDg, backPb, targetSeg: TARGET_SEG },
      screenshot: shot,
    };
  },
};

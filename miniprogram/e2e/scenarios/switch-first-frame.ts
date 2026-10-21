/**
 * BUG-004 · 切轨后台本首帧必须已落位。
 *
 * 判据（与修复方案无关的表述）：
 *   替换 `blocks` 的那一次 `setData`，必须同时带上「当前句」的滚动锚点 ——
 *   即 `playerScrollTop` 非 0，或 `scrollIntoView` 指向目标句。
 *
 * 为什么盯这一次：`blocks` 一变，视图会先按新数据渲染；若这次 patch 没有锚点，
 * 视图必然从第 1 条开始画，之后再补滚动就一定会「先闪一下第 1 条」。
 *
 * 当前代码（0.3.10）预期 FAIL：该 patch 不含任何滚动字段。
 */
import { capture, installRecorder, readCalls, readFacts, tapTab } from '../session';
import type { Scenario } from '../scenario';
import type { ScenarioResult } from '../report';

export const switchFirstFrame: Scenario = {
  id: 'switch-first-frame',
  title: '切轨后首帧台本已落位（BUG-004）',
  refs: ['BUG-004', 'PB->DG'],
  async run(ctx): Promise<ScenarioResult> {
    const page = await ctx.open({ track: 'pb', pause: true });
    const before = await readFacts(page);
    await installRecorder(ctx.mp);

    await tapTab(page, 1); // Podcast -> Dialogue
    await page.waitFor(1200);

    const calls = await readCalls(ctx.mp);
    const after = await readFacts(page);
    // 首帧之后再多等一会儿，区分「滚动动画未结束」与「下发值始终没落地」。
    await page.waitFor(1500);
    const settled = await readFacts(page);
    const shot = await capture(ctx.mp, ctx.artifactsDir, 'switch-first-frame');

    // 找出「替换 blocks」的那一次下发。
    const mountIndex = calls.findIndex((call) => (call.blocks ?? 0) > 0);
    const mount = mountIndex >= 0 ? calls[mountIndex] : null;

    const anchorScrollTop = mount && typeof mount.playerScrollTop === 'number' ? mount.playerScrollTop : null;
    const anchorIntoView = mount && typeof mount.scrollIntoView === 'string' ? mount.scrollIntoView.trim() : '';
    const hasAnchor = (anchorScrollTop !== null && anchorScrollTop !== 0) || anchorIntoView.length > 0;

    const detail: string[] = [
      `切轨前：track=${before.activeTrack} seg=${before.activeSegIdx} scroll=${before.playerScrollTop} rows=${before.transcriptRows}`,
      mount
        ? `blocks patch：第 ${mount.index} 次 setData（+${mount.dt}ms），keys=[${mount.keys.join(', ')}]`
        : 'blocks patch：未捕获到（录像可能未覆盖到载入阶段）',
      mount
        ? `锚点：playerScrollTop=${anchorScrollTop === null ? '未下发' : anchorScrollTop}，scrollIntoView=${anchorIntoView || '未下发'}`
        : '锚点：无',
      `切轨后 1.2s：track=${after.activeTrack} seg=${after.activeSegIdx} 下发 scroll=${after.playerScrollTop} 真实=${after.realScrollTop}`,
      `切轨后 2.7s：seg=${settled.activeSegIdx} 下发 scroll=${settled.playerScrollTop} 真实=${settled.realScrollTop}`,
    ];

    if (after.activeTrack !== 'dg') {
      return {
        id: 'switch-first-frame',
        title: '切轨后首帧台本已落位（BUG-004）',
        status: 'ERROR',
        detail: [`切轨未生效：期望 dg，实际 ${after.activeTrack}（场景结论不可信）`],
      };
    }

    if (hasAnchor) {
      detail.push('判定：首帧已带锚点，符合 EP-PBC-001 的「切换即显示当前条目」。');
    } else {
      detail.push('判定：首帧未带锚点 —— 视图会先渲染第 1 条，再靠后续测量补滚。');
    }

    return {
      id: 'switch-first-frame',
      title: '切轨后首帧台本已落位（BUG-004）',
      status: hasAnchor ? 'PASS' : 'FAIL',
      detail,
      evidence: {
        before,
        after,
        settled,
        mountIndex,
        mount,
        sequence: calls.slice(0, 8),
      },
      screenshot: shot,
    };
  },
};

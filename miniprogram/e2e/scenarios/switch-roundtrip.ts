/**
 * 切轨 5 次往返 · 双轨断点与渲染稳定性（E07 / BUG-002 / BUG-003 / BUG-004 合并回归）。
 *
 * 每一趟都检查四件事：
 *   1. 轨道真的换了（防止 e2e 自己「以为在 DG」的假结论）；
 *   2. 两条音轨的**已提交断点**各自保留（判定读 `progressJournal` 落盘值，
 *      不看页面显示的瞬时位置 —— 后者受镇定窗口与迟到事件影响）；
 *   3. 时间显示不为 0:00（BUG-003：换源假 0 不得进入渲染）；
 *   4. 高亮行唯一且在视口内（BUG-004：落位成功，且不是「停在第一条」）。
 */
import {
  capture,
  invokePageMethod,
  installRecorder,
  readActiveRowRect,
  readCalls,
  readCommitted,
  readFacts,
  resetRecorder,
  tapTab,
  tapTranscriptRow,
} from '../session';
import type { Scenario } from '../scenario';
import type { ScenarioResult } from '../report';

const ROUND_TRIPS = 5;
const BASE_SEG = 4;

interface RoundTrip {
  round: number;
  dgSeg: number;
  dgLabel: string;
  dgVisible: boolean;
  dgAnchored: boolean;
  pbSeg: number;
  pbLabel: string;
  pbVisible: boolean;
  pbAnchored: boolean;
}

export const switchRoundTrip: Scenario = {
  id: 'switch-roundtrip',
  title: 'PB↔DG 往返 5 次：断点不串写、时间不归零、落位稳定',
  refs: ['E07', 'BUG-002', 'BUG-003', 'BUG-004'],
  async run(ctx): Promise<ScenarioResult> {
    const page = await ctx.open({ pause: true });
    await tapTranscriptRow(page, BASE_SEG);
    await page.waitFor(900);
    await invokePageMethod(ctx.mp, 'pause');
    await page.waitFor(400);
    const base = await readFacts(page);
    const baseCommitted = await readCommitted(ctx.mp, ctx.lessonId);

    const rounds: RoundTrip[] = [];
    for (let round = 1; round <= ROUND_TRIPS; round += 1) {
      await resetRecorder(ctx.mp);
      await installRecorder(ctx.mp);

      await tapTab(page, 1);
      await page.waitFor(800);
      const dgCalls = await readCalls(ctx.mp);
      const dg = await readFacts(page);
      const dgRect = await readActiveRowRect(page);
      const dgPatch = dgCalls.find((call) => (call.blocks ?? 0) > 0) ?? null;

      await tapTab(page, 0);
      await page.waitFor(800);
      const pbCalls = await readCalls(ctx.mp);
      const pb = await readFacts(page);
      const pbRect = await readActiveRowRect(page);
      const pbPatch = pbCalls.find((call) => (call.blocks ?? 0) > 0) ?? null;

      rounds.push({
        round,
        dgSeg: dg.activeSegIdx,
        dgLabel: dg.positionLabel,
        dgVisible: dg.activeTrack === 'dg' && dgRect !== null && dgRect.visible,
        dgAnchored: !!dgPatch && typeof dgPatch.playerScrollTop === 'number',
        pbSeg: pb.activeSegIdx,
        pbLabel: pb.positionLabel,
        pbVisible: pb.activeTrack === 'pb' && pbRect !== null && pbRect.visible,
        pbAnchored: !!pbPatch && typeof pbPatch.playerScrollTop === 'number',
      });
    }

    const finalFacts = await readFacts(page);
    const finalCommitted = await readCommitted(ctx.mp, ctx.lessonId);
    const shot = await capture(ctx.mp, ctx.artifactsDir, 'switch-roundtrip');

    const segStable = rounds.every((r) => r.pbSeg === base.activeSegIdx);
    const allVisible = rounds.every((r) => r.dgVisible && r.pbVisible);
    // 只对 PB 判「时间不归零」：DG 播完后按契约（F05）从 00:00 起，0:00 是正确显示。
    const noZeroTime = rounds.every((r) => r.pbLabel !== '0:00');
    const anchored = rounds.every((r) => r.dgAnchored && r.pbAnchored);
    const journalPb = !!baseCommitted && !!finalCommitted
      && finalCommitted.pb.seg === baseCommitted.pb.seg
      && finalCommitted.pb.ms >= baseCommitted.pb.ms - 2000;
    const journalDg = !!baseCommitted && !!finalCommitted
      && finalCommitted.dg.seg === baseCommitted.dg.seg;
    const pass = segStable && allVisible && noZeroTime && anchored && journalPb && journalDg;

    return {
      id: 'switch-roundtrip',
      title: 'PB↔DG 往返 5 次：断点不串写、时间不归零、落位稳定',
      status: pass ? 'PASS' : 'FAIL',
      detail: [
        `基准：PB seg=${base.activeSegIdx} pos=${base.positionLabel} scroll=${base.playerScrollTop}`,
        ...rounds.map(
          (r) =>
            `#${r.round} DG seg=${r.dgSeg} ${r.dgLabel} ${r.dgVisible ? '可见' : '不可见'} ${r.dgAnchored ? '有锚点' : '无锚点'} `
            + `→ PB seg=${r.pbSeg} ${r.pbLabel} ${r.pbVisible ? '可见' : '不可见'} ${r.pbAnchored ? '有锚点' : '无锚点'}`,
        ),
        `断点：PB ${baseCommitted?.pb.ms ?? '?'}ms/seg${baseCommitted?.pb.seg ?? '?'} → ${finalCommitted?.pb.ms ?? '?'}ms/seg${finalCommitted?.pb.seg ?? '?'}；DG seg${baseCommitted?.dg.seg ?? '?'} → ${finalCommitted?.dg.seg ?? '?'}`,
        `判定：句位${segStable ? '稳定' : '漂移'} / 落位${allVisible ? '稳定' : '有失败'} / PB 时间${noZeroTime ? '未归零' : '出现 0:00'} / 首帧锚点${anchored ? '齐全' : '缺失'} / 断点${journalPb && journalDg ? '各自保留' : '串写'}`,
      ],
      evidence: { base, rounds, finalFacts, baseCommitted, finalCommitted },
      screenshot: shot,
    };
  },
};

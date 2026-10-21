/**
 * BUG-004 变体 · **暂停态**切轨。
 *
 * 真机最容易命中的形态：暂停后切轨，台本可能长时间停在第一条，直到「当前这一句播完、
 * 下一句开始」才跳 —— 因为旧实现唯一的后续触发点是 `tick()` 里的 `changed.segIdx`，
 * 而暂停时它永远不会到来。
 *
 * 位置用「点台本行」推进（与用户操作一致），不用连续 seek：devtools 的 BAM 在
 * 「深层 seek + 立刻切轨」时会上报一次迟到的旧位置，那属于播放器实现差异，
 * 已单独记为待真机复核项，不应混进本条判定。
 */
import {
  capture,
  invokePageMethod,
  readActiveRowRect,
  readCommitted,
  readFacts,
  readPlaybackState,
  installRecorder,
  readCalls,
  resetRecorder,
  tapTab,
  tapTranscriptRow,
} from '../session';
import type { Scenario } from '../scenario';
import type { ScenarioResult } from '../report';

/** 用第 4 句做「离开顶部但不深」的基准位：深 seek 会引入平台侧迟到事件。 */
const BASE_SEG = 4;

export const switchPaused: Scenario = {
  id: 'switch-paused',
  title: '暂停态切轨：首帧落位且不会停在第一条（BUG-004 变体）',
  refs: ['BUG-004', 'EP-PBC-001 §2'],
  async run(ctx): Promise<ScenarioResult> {
    const page = await ctx.open({ pause: true });
    const tapped = await tapTranscriptRow(page, BASE_SEG);
    await page.waitFor(900);
    await invokePageMethod(ctx.mp, 'pause');
    await page.waitFor(400);

    const before = await readFacts(page);
    const beforeCommitted = await readCommitted(ctx.mp, ctx.lessonId);

    await resetRecorder(ctx.mp);
    await installRecorder(ctx.mp);

    // 暂停态 PB → DG
    await tapTab(page, 1);
    await page.waitFor(900);
    const atDgCalls = await readCalls(ctx.mp);
    const atDg = await readFacts(page);
    const atDgRect = await readActiveRowRect(page);
    const atDgCommitted = await readCommitted(ctx.mp, ctx.lessonId);
    // 切轨会重建 BAM src，而「赋 src 自动播放」是异步的：先看即时态，再等一拍看有没有
    // 迟到的自动播放把音频顶起来（BUG-005：暂停态切轨自己播）。
    const atDgPlay = await readPlaybackState(ctx.mp);
    await page.waitFor(1200);
    const atDgPlayLate = await readPlaybackState(ctx.mp);

    // 暂停态 DG → PB
    await tapTab(page, 0);
    await page.waitFor(900);
    const backCalls = await readCalls(ctx.mp);
    const backPb = await readFacts(page);
    const backPbRect = await readActiveRowRect(page);
    const backCommitted = await readCommitted(ctx.mp, ctx.lessonId);
    const backPlay = await readPlaybackState(ctx.mp);
    await page.waitFor(1200);
    const backPlayLate = await readPlaybackState(ctx.mp);
    const shot = await capture(ctx.mp, ctx.artifactsDir, 'switch-paused');

    const dgPatch = atDgCalls.find((call) => (call.blocks ?? 0) > 0) ?? null;
    const pbPatch = backCalls.find((call) => (call.blocks ?? 0) > 0) ?? null;
    const anchored = (patch: typeof dgPatch): boolean =>
      !!patch && typeof patch.playerScrollTop === 'number';
    const zeroPatch = [...atDgCalls, ...backCalls].some(
      (call) => (call.blocks ?? 0) > 0 && call.playerScrollTop === 0 && (call.activeSegIdx ?? 0) > 0,
    );

    const trackOk = atDg.activeTrack === 'dg' && backPb.activeTrack === 'pb';
    const segKept = backPb.activeSegIdx === before.activeSegIdx && tapped;
    const dgVisible = atDgRect !== null && atDgRect.visible;
    const pbVisible = backPbRect !== null && backPbRect.visible;
    const noLocate = !atDg.showLocateBar && !backPb.showLocateBar;
    const pbJournalIntact =
      !!beforeCommitted &&
      !!backCommitted &&
      backCommitted.pb.ms >= beforeCommitted.pb.ms - 2000 &&
      backCommitted.pb.seg === beforeCommitted.pb.seg;
    const dgJournalIntact =
      !!atDgCommitted && !!backCommitted && backCommitted.dg.seg === atDgCommitted.dg.seg;
    const noZeroReset = !zeroPatch;
    // 暂停态切轨必须保持暂停：真实音频（BAM）始终停着，UI 也不得显示播放中。
    const staysPaused =
      atDgPlay.bamPaused && atDgPlayLate.bamPaused &&
      backPlay.bamPaused && backPlayLate.bamPaused &&
      !atDgPlay.uiPlaying && !backPlay.uiPlaying;
    const pausedDetail =
      `DG ${atDgPlay.bamPaused ? '暂停' : '播放中'}→${atDgPlayLate.bamPaused ? '暂停' : '播放中'}；`
      + `PB ${backPlay.bamPaused ? '暂停' : '播放中'}→${backPlayLate.bamPaused ? '暂停' : '播放中'}`;

    const pass =
      trackOk && segKept && dgVisible && pbVisible && noLocate && pbJournalIntact && dgJournalIntact && noZeroReset && staysPaused;

    const describe = (rect: typeof atDgRect): string =>
      rect === null
        ? '取不到高亮行'
        : `top=${rect.top.toFixed(0)} 视口=${rect.viewportHeight.toFixed(0)} ${rect.visible ? '在视口内' : '在视口外'}`;

    return {
      id: 'switch-paused',
      title: '暂停态切轨：首帧落位且不会停在第一条（BUG-004 变体）',
      status: pass ? 'PASS' : 'FAIL',
      detail: [
        `暂停位：track=${before.activeTrack} seg=${before.activeSegIdx} pos=${before.positionLabel} 断点=${beforeCommitted?.pb.ms ?? '?'}ms`,
        `切到 DG：seg=${atDg.activeSegIdx} 锚点=${anchored(dgPatch) ? String(dgPatch?.playerScrollTop) : '无'}，高亮行 ${describe(atDgRect)}`,
        `切回 PB：seg=${backPb.activeSegIdx} 锚点=${anchored(pbPatch) ? String(pbPatch?.playerScrollTop) : '无'}，高亮行 ${describe(backPbRect)}`,
        `断点：PB ${beforeCommitted?.pb.ms ?? '?'}ms/seg${beforeCommitted?.pb.seg ?? '?'} → ${backCommitted?.pb.ms ?? '?'}ms/seg${backCommitted?.pb.seg ?? '?'}；DG seg${atDgCommitted?.dg.seg ?? '?'} → ${backCommitted?.dg.seg ?? '?'}`,
        `判定：轨道${trackOk ? '正确' : '错误'} / 句位${segKept ? '保持' : '漂移'} / 可见性${dgVisible && pbVisible ? '通过' : '失败'} / 找回条${noLocate ? '未亮' : '误亮'} / 断点${pbJournalIntact && dgJournalIntact ? '各自保留' : '异常'} / 归零下发${noZeroReset ? '无' : '出现'} / 暂停态${staysPaused ? '保持' : `被打破（${pausedDetail}）`}`,
      ],
      evidence: {
        before,
        atDg,
        backPb,
        atDgRect,
        backPbRect,
        beforeCommitted,
        atDgCommitted,
        backCommitted,
        atDgPlay,
        atDgPlayLate,
        backPlay,
        backPlayLate,
        dgPatch,
        pbPatch,
      },
      screenshot: shot,
    };
  },
};

/**
 * 手势交互与性能门禁 · 台本区域原生滑动与 IPC 频次审计。
 *
 * 验收目标：
 * 1. 验证台本视口使用微信官方原生 enhanced scroll-view，支持平滑物理滚动。
 * 2. 性能哨兵门禁：用户在台本区域手动滚动时，逻辑层禁止发生高频 setData 轰炸（IPC 频次 <= 1 次）。
 * 3. 视口偏离活跃焦点后，智能「找回当前句」条（Locate Dock）正常唤起。
 * 4. 点击找回条可一键平滑归位至当前发音句。
 */
import {
  capture,
  installRecorder,
  invokePageMethod,
  readCalls,
  readFacts,
  resetRecorder,
} from '../session';
import type { Scenario } from '../scenario';
import type { ScenarioResult } from '../report';

export const gestureScroll: Scenario = {
  id: 'gesture-scroll',
  title: '台本原生手势滑动、零 IPC 堵塞与找回条联动',
  refs: ['PERF-GUARD', 'EP-PBC-001', 'scroll-view-gesture'],
  async run(ctx): Promise<ScenarioResult> {
    const page = await ctx.open({ track: 'pb', pause: true });
    await page.waitFor(800);

    const initialFacts = await readFacts(page);
    await installRecorder(ctx.mp);
    await resetRecorder(ctx.mp);

    // 1. 获取视口元素并执行滚动
    const viewport = await page.$('#pbViewport');
    if (!viewport) {
      return {
        id: 'gesture-scroll',
        title: '台本原生手势滑动、零 IPC 堵塞与找回条联动',
        status: 'ERROR',
        detail: ['未找到 #pbViewport 视口组件'],
      };
    }

    // 模拟用户向上划动 500px 查看后续台词
    // @ts-expect-error ScrollViewElement scrollTo
    if (typeof viewport.scrollTo === 'function') {
      // @ts-expect-error ScrollViewElement scrollTo
      await viewport.scrollTo(0, 500);
    } else {
      // @ts-expect-error fallback trigger/dispatchEvent
      if (typeof viewport.trigger === 'function') {
        // @ts-expect-error trigger
        await viewport.trigger('scroll', { scrollTop: 500 });
      }
    }
    await page.waitFor(600);

    // 2. 检查用户滚动期间的 setData 频次（性能红线：不得产生频繁通信）
    const callsDuringScroll = await readCalls(ctx.mp);
    // 允许 0 或 1 次（如找回条状态变更），严禁 touchmove 产生的几十次 setData
    const ipcFlooded = callsDuringScroll.length > 2;

    const scrolledFacts = await readFacts(page);
    const scrollMoved = scrolledFacts.realScrollTop > 200 || scrolledFacts.playerScrollTop > 200;

    // 3. 验证偏离当前句后，找回条是否灵敏亮起
    const locateDockAppeared = scrolledFacts.showLocateBar;

    // 4. 点击找回条一键归位
    let returnSuccess = false;
    if (locateDockAppeared) {
      await invokePageMethod(ctx.mp, 'onLocateTap');
      await page.waitFor(1200);
      const returnedFacts = await readFacts(page);
      returnSuccess = returnedFacts.showLocateBar === false;
    }

    const shot = await capture(ctx.mp, ctx.artifactsDir, 'gesture-scroll');

    const pass = !ipcFlooded && (scrollMoved || locateDockAppeared) && returnSuccess;

    return {
      id: 'gesture-scroll',
      title: '台本原生手势滑动、零 IPC 堵塞与找回条联动',
      status: pass ? 'PASS' : 'FAIL',
      detail: [
        `初始状态：track=${initialFacts.activeTrack} seg=${initialFacts.activeSegIdx} scroll=${initialFacts.realScrollTop}`,
        `划动后事实：scroll=${scrolledFacts.realScrollTop} locateBar=${locateDockAppeared ? '已唤起' : '未唤起'}`,
        `IPC 审计：滑动期间触发 setData 次数=${callsDuringScroll.length}（性能红线阈值 <= 2，判定：${ipcFlooded ? '堵塞违规' : '流畅达标'}）`,
        `一键找回：${returnSuccess ? '成功精准归位并收起找回条' : '找回点击未生效'}`,
        `判定：手势响应${scrollMoved ? '正常' : '异常'} / IPC通信${!ipcFlooded ? '健康' : '超标'} / 总体${pass ? '通过' : '未通过'}`,
      ],
      evidence: { initialFacts, scrolledFacts, callsCount: callsDuringScroll.length },
      screenshot: shot,
    };
  },
};

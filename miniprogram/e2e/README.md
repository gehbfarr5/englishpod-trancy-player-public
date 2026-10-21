# e2e（本地运行时自测）

让 Agent 在**不开真机、不上传体验版**的前提下，自己跑完
「打开页面 → 操作 → 观察真实渲染 → 判定 → 出报告」。

跑在微信开发者工具的自动化通道上（`miniprogram-automator`），
观察对象是**真实模拟器**，不是假运行时。

## 前置条件

1. 已安装「微信开发者工具」（默认 `/Applications/wechatwebdevtools.app`，可用 `WECHAT_DEVTOOLS_CLI` 覆盖）；
2. 开发者工具**已登录**（`cli islogin` 返回 `login:true`）；
3. 无需手动开端口：`npm run e2e` 会自动 `cli auto --auto-port 9420` 并等端口就绪。

> 端口不通/未登录时脚本会直接报出缺哪一项，不会抛 `Connection closed`。

## 命令

```bash
npm run e2e                        # 全部场景；有 FAIL 也退出 0（先看现状）
npm run e2e -- --strict            # FAIL 时退出 1（门禁用）
npm run e2e -- --only=render-anchor
npm run e2e -- --lesson=0007 --port=9420
```

产物：`e2e/artifacts/<时间戳>/`（`report.json` + 每个场景一张截图），已加入 `.gitignore`。

## 结果语义

| 状态 | 含义 | 谁来处理 |
| --- | --- | --- |
| `PASS` | 符合契约 | — |
| `FAIL` | 代码行为不符合契约，可复现 | 开发 |
| `SKIP` | 本层（模拟器）判不了，需要真机/云测 | 真机验收 |
| `ERROR` | 环境或脚本自身问题（课程加载失败、切轨未生效…） | 先修环境，别当产品缺陷 |

把 `FAIL` 和需要真机的条目混在一起，是这类自测环境最常见的死法。

## 现有场景

| id | 判据 | 关联 |
| --- | --- | --- |
| `switch-first-frame` | 替换 `blocks` 的那次 `setData` 必须已带滚动锚点（`playerScrollTop` 已下发） | BUG-004 |
| `switch-paused` | 暂停态 PB↔DG：句位保持、两侧都落位、断点各自保留、无「归零下发」、**真实 BAM 始终暂停**（切轨不得自己播起来） | BUG-004 变体 / BUG-005 |
| `switch-roundtrip` | 往返 5 次：断点不串写、PB 时间不归零、落位稳定、首帧锚点齐全 | E07 / BUG-002 / 003 / 004 |
| `switch-keep-position` | PB→DG→PB 回到原句，双轨断点不串写 | BUG-002 / E07 |
| `render-anchor` | 切走再切回，高亮句句首仍在视口内且「找回当前句」条未亮 | BUG-004 / 真实滚动 |

> 「断点是否串写」一律用 `readCommitted()` 读 `progressJournal` 的落盘值判定，
> **不看页面显示的瞬时位置** —— 后者受镇定窗口与迟到事件影响，会把实现差异误判成缺陷。

## 加一个场景

在 `scenarios/` 新建文件，导出 `Scenario`，再到 `scenarios/index.ts` 追加即可：

```ts
export const myScenario: Scenario = {
  id: 'my-scenario',
  title: '一句话说清判据',
  refs: ['PBC-§x'],
  async run(ctx) {
    const page = await ctx.open({ track: 'pb', pause: true });
    // 只用 session 暴露的观察手段取证
    return { id: 'my-scenario', title: '…', status: 'PASS', detail: ['证据行'] };
  },
};
```

## 三条踩过的坑（改代码前请先看）

1. **`track=` / `autoplay=` 不是页面参数**。页面只认 `lessonId` / `intent` / `diagnostics`，
   且 `playRequested` 恒为 `true`。切轨用点标签，暂停用 `invokePageMethod('pause')`。
2. **不要用 `page.callMethod`**。实测它对播放页返回 `this.switchTrack is not a function`（实例代理问题），
   失败信息还会误导。用 `invokePageMethod`（在 AppService 里 `apply` 到真实实例）。
3. **轮询 `page.data()` 看不到首帧**。两次 RPC 之间可能已经刷过 4 次 `setData`。
   要判「首帧下发了什么」，只能用 `installRecorder` 包裹 `setData` 记录序列。

## 这一层判定不了什么

- 锁屏 / 后台调度 / 音源被系统回收 / 蓝牙耳机 / 来电打断 → 只能真机或云测；
- 原生滚动在真机上的像素级表现（含 `enhanced` 滚动、惯性）→ 模拟器只作参考；
- 机型矩阵 → 模拟器固定机型，与 iPhone 17 验收基线不对应。

## 模拟器与真机的已知差异（别当产品缺陷）

1. **深层 seek + 立刻切轨**：模拟器 BAM 会在 seek 后补发一次迟到的旧位置，
   页面显示可能短暂回到旧位置，但 `progressJournal` 落盘值始终正确。
   A/B 对照（BUG-004 修复前后）表现一致，与本轮修复无关 → 待真机复核。
   因此场景里的基准位置用「点台本行」推进，避免连续 seek 把差异混进判定。
2. **`scroll-into-view` 不能穿透自定义组件**：台本行 id 在 `transcript` 组件内部，
   页面的 `scroll-view` 定位不到（实测设置后真实 `scrollTop` 不变）。
   落位只能走 `scroll-top` + 预测量，别指望换机制绕开时序。
3. **同帧改 `scroll-with-animation` 与 `scroll-top`**：动画开关可能沿用旧设置，
   表现为落位时多滑 1 帧。产品代码已改为「先单独关动画，再下发偏移」。

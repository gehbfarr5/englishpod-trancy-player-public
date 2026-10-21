# 小程序端开发说明与进度

> **2026-10-18 附注（审计 main 2c7fa1a4）：** 2026-10-16 的批次细节继续保留为历史档案。小程序源码为 `0.2.0`；当前实际页面见 `app.json`（WebView）；AppID / CloudBase 环境已有配置，Mock/Fake 模式关闭；是否已按某个版本正式上架及 335 课真机性能仍待微信后台/设备证据。持续跟踪 [项目审计](../docs/project-audit-2026-10-18.md) 与 [版本管理](../docs/versioning.md)。
>
> **历史事实快照：2026-10-16，main 061bbbc。** 此文件中后面的某些段落是历史故障档案，不能直接按“待修”字样启动自动开发。以当前代码、最近 PR、CI 和新的真机反馈为准。
>
> - 小程序当前 app.json 指定全局 WebView，播放器位于 pages/player/index，没有 Skyline 分包。
> - 首屏已有索引缓存/非阻塞读取及 detail 预取，是否仍然慢必须先真机测量。
> - 倍速和系统胶囊避让已有代码处理，旧错误描述不能证明当前还存在。
> - PR #9 已合并封面 HTTPS 缓存有效期和回归测试，Issue #5 已关闭；永久静态 URL 和客户端首播云上传架构仍未改变，不应声称已经完全改造。
> - Flutter 和源数据索引实际为 335 条课程记录；历史 336 的文档口径需单独核对。
> - 每轮需求应附设备型号、系统/微信版本、代码 SHA 和脱敏的复现证据；无数据时将问题标记为待复测。


> **范围声明**：本文件**只描述 `miniprogram/` 这一端**。其他端的内容与说明不在本文件范围内，也不应被本端的改动波及 —— 包括 `flutter_app/`（iOS/Flutter 参考实现）、`web_preview/`、`pipeline/`（数据管线）、根 `README.md`、根 `DESIGN.md`。
>
> 本端所有与"参照实现有出入"的记录都收在本文件里，**不再写进共享的根 `DESIGN.md`**。

---

## 一、这是什么，以及跟 iOS 端的关系

EnglishPod 精听小程序：**30 课**（数据管线已备好 335 课，见 §八）、双主题、以**句子导航**为核心的精听播放器。原生 TypeScript + 微信云开发（CloudBase）。

**复刻基准（重要）**：本端以 **iOS 端已实现并验证的部分为对齐目标**，规格真源是 **根 `DESIGN.md` v10**（2026-10 更新，已对齐 iOS 27 发布版）。

> 凡根 `DESIGN.md` 的书面描述与 iOS 实现**冲突**之处，**一律以 iOS 实现为准**。
> 本端与 v10 的**已知差异**（含待对齐项）一律收在 **§七**，**不改动共享文档**。

---

## 二、技术栈与目录结构

- 原生小程序 + TypeScript（无框架），`miniprogram-ci` 做 CI 预览构建
- 后端：微信云开发（CloudBase），环境见 `config/env.ts`
- 音频：`BackgroundAudioManager`（支持后台播放与锁屏控制）
- 渲染器：**全局 WebView，播放器在 pages/player/index**（app.json 当前配置）；Skyline 为历史设计讨论。

```
miniprogram/
├── app.ts / app.json / app.wxss     全局配置与设计令牌（CSS 变量）
├── core/                             纯 TS，**零 wx.***（可单测，与平台解耦）
│   ├── timelineEngine.ts             时间轴：句级二分定位 + **插值外推**
│   ├── highlightCursor.ts            时间 → 活跃句下标（变化才产出，节流 setData）
│   ├── transcriptView.ts             台本视图模型（含词汇匹配与舞台盒子分组）
│   ├── scrollAnim.ts                 歌词滚动的贝塞尔反解 + 逐帧序列生成
│   ├── themeTokens.ts                设计令牌单一真源（颜色/字号/圆角/间距/动效）
│   ├── locateBar.ts                  返回定位条的 8% 视口容差判定
│   ├── lessonModel.ts / types.ts     领域模型
│   └── *.test.ts                     单测
├── adapters/wechat/                  平台适配层（云、音频、存储、进度）
├── components/                       课程卡 / 台本 / 词高亮 / 舞台盒子 / 词汇面板 /
│                                     控制坞 / 筛选 / 继续收听卡 / 钉住顶区
├── pages/library/                    课程库页
├── pages/player/                     播放器（WebView 页面）
├── wxs/highlight.wxs                 视图层 class 差分（避免高频 setData）
└── scripts/                          ci-preview.mjs（CI 预览）、validate-config.mjs（校验）、
                                      trace-highlight.ts（调试脚本）
```

---

## 三、开发进度

### 已完成

| 阶段 | 内容 | 提交 |
|---|---|---|
| M1 | 小程序骨架：原生 TS、CloudBase 后端、平台无关 `core/` | `5deb447` |
| M2 | 课程库页 UI + 进度/主题基础设施 | `deae140` 等 |
| — | 展示名 / AppID / **CloudBase 接入** / 音频 `fileID` 解析修复 | `7e9106b` `394ceb6` `28c47de` `bd2af90` |
| M3 | 播放器（当时的**逐词高亮**，后收敛，见下） | `a136ec9` |
| M4 | 进度持久化、后台播放、锁屏控制、常亮 | `637bc18` |
| — | **CI 预览流水线**（`miniprogram-ci`，无需开发者工具） | `2c85cb5` |
| — | 颜色令牌从 `theme.json` 迁到 `app.wxss`（修真机 UI 全丢） | `63f942e` |

**阶段一「复刻对齐 iOS」9 个批次**：

| 批 | 内容 | 提交 |
|---|---|---|
| 1 | **逐词收敛为句级** + A 组界面 13 条（音轨下划线、倍速键、时间戳、卡片高度…） | `02c1b18` |
| 2 | 返回定位条对齐 iOS（图标+实时句、触发与隐藏条件、进出动画） | `8de4cd0` |
| 3 | 手风琴 / 舞台盒子展开动画 + chevron 改 `scaleY` | `81e7b68` |
| 4 | 折叠区**真实高度量测**（修「快扩后停顿」） | `7863fc6` |
| 5 | **全局触感按压/回弹**（两层方案） | `1c2cc94` |
| 6 | Hero 圆角形变 + 图标交换 + 补 `continue-card` | `c3628ab` |
| 7 | 标签 / 筛选**方向性滑动** | `e0c8864` |
| 8 | 歌词滚动**精确 380ms**（逐帧驱动） | `58333a2` |

**真机验收后的修复批次**：

| 批 | 内容 | 提交 |
|---|---|---|
| A | 删筛选双列表（修**闪烁回归**）+ 去滚动 `scrollTop` 回写回声 + 返回文案改 `Library` | `4c7e780` |
| B | **动效精简**（按真机反馈削减，见 §三·动效现状） | `b9b3672` |

### 动效现状（批次 B 之后）

**保留（承载信息，非装饰）**：
- 活跃音轨下划线 + 分段指示块（指示**当前在放哪条音轨**）
- 台本**行高亮**颜色过渡（标记**当前句**）
- **词色过渡**（标记**课内词汇**）
- **歌词逐帧滚动**（跟随播放位置）——`SCROLL.frameMs = 24`，即 380ms 内 16 帧

**已移除**：筛选滑动、chip 变色、卡片进度条宽度、Hero 阴影/圆角形变与图标动画、continue-card 点缀、chevron 250ms 翻面（**保留方向瞬时切换**）、**全部触感按压/回弹**、三处 `max-height` 高度过渡（改为**瞬时尺寸 + 120ms 纯 `opacity` 淡入**）。

> 现状：全仓 WXSS **零 `@keyframes`、零 `animation:`**。动效只靠 `transition` 表达。

### 待办

- **批 C 加载优化**：已加入非阻塞索引读取和详情缓存/预取，后续需要真机性能基线再决定优化范围（Issue #4）
- **批 D 封面**：PR #9 已合并 HTTPS 缓存过期修复（Issue #5 已关闭）；长期 URL 方案与设备级可用性仍需单独验证
- **批 E 页面转场（P2 单页自绘）**：方案见 `../deliverables/ui-audit/p2-overlay-migration-plan.md`
- **批 F 虚拟列表**：与「335 课扩容」绑成一件

---

## 四、构建与真机预览

**无需微信开发者工具**，用 `miniprogram-ci` 直接出预览码：

```bash
cd miniprogram
MP_PRIVATE_KEY="$HOME/Downloads/private.<appid>.key" node scripts/ci-preview.mjs
# 产物：miniprogram/.ci/preview.jpg → 微信扫码即可在真机打开
```

**⚠️ 两个必须知道的环境前提**：

1. **`coverImgUrl` 等网络图片需要配 `downloadFile` 合法域名白名单**。
   `project.config.json` 的 `urlCheck:false` **只跳过开发者工具校验，真机仍会校验**。
2. **本机代理是 fake-IP 模式**，`servicewechat.com` 会被解析到 `198.18.x.x` 保留段；而 Node **默认不走环境代理**，直连假 IP 会导致 TLS 握手失败（`errCode 20001/20003`）。
   → `scripts/ci-preview.mjs` 已内建：读 `MP_CI_PROXY`，否则回退环境里的 `HTTP(S)_PROXY`。
   → 代理端口会漂移（见过 `53000` → `63992` → `64528`），**脚本自动跟随，不要写死**。

**本地校验**：
```bash
npx tsc --noEmit        # 类型
npm test                # 单测（148 条）
npm run validate        # 配置/令牌校验（含「孤儿 CSS 变量」检查）
npm run trace:highlight # 调试：打印句级高亮变化序列
```

---

## 五、架构约定（改动前必读）

1. **`core/` 保持零 `wx.*`** —— 它是平台无关层，才能单测。平台能力一律走 `adapters/wechat/`。
2. **时间统一用秒（float）**。
3. **颜色/尺寸/动效一律走令牌**（`core/themeTokens.ts` 与 `app.wxss` 的 `--ep-*`），不散落魔法值。新增数值要同步进令牌；`validate` 会检查「引用了但未定义的变量」与「定义了但无人引用的孤儿变量」。
4. **`timelineEngine` 的插值外推不可删**：后台 `onTimeUpdate` 不回调时全靠它推进高亮与滚动。`extrapolatePosition` / `correctSample` / `ClockSample` / `DRIFT_TOLERANCE_SEC` 都与「逐词/逐句」无关。
5. **`wx.createSelectorQuery()` 在自定义组件里必须 `.in(this)`** —— 组件内的查询**选不到自己模板里的节点**，且**不报错**，只会导致功能静默失效。正确范例见 `components/transcript/index.ts` 的 `measureRow()`。
6. **`scroll-view` 的程序化滚动**：`scroll-with-animation` 不接受自定义时长/曲线。若要精确时长+曲线，只能自建帧循环（见 `core/scrollAnim.ts`），并**必须把整个循环计入程序化滚动窗口**，否则 `bindscroll` 会把程序化滚动误判为用户滚动。
7. **展示文案规避**：电台 / FM / 播客 / 有声书 / 音频节目 / 课程平台。
8. **`styleIsolation`**：组件默认 `isolated`。`app.wxss` 的**类选择器进不去**组件，但 **CSS 变量靠继承生效、与隔离设置无关** —— 所以令牌在任何组件里都能用。

---

## 六、平台能力边界（iOS → 小程序：哪些做不到）

### 完全不可实现

| 项 | 原因 |
|---|---|
| 隐藏 / 移除 / 自定义**右上角胶囊按钮** | 无解 |
| 在**原生路由**下自定义页面转场（时长、曲线、退出页动画） | `wx.navigateTo` / `wx.navigateBack` **没有** `animationType` / `animationDuration`（typings 与官方文档双双确认），`NavigateBackOption` **仅 `delta`** |

> ⚠️ **注意**：上表第二项此前被我们**过度概括**成「页面转场整体不可实现」，这是**错的**。
> 官方其实提供 **Skyline 自定义路由**（`routeType` / `routeConfig` / `routeOptions` / `withOpenContainer`，含 `secondaryAnimation` 驱动退出页）与 **`open-container` 组件**；另外**「单页自绘 / 自建页面栈」**（把播放器做成库页内的全屏覆盖层，用纯 CSS `transform` 表达）**完全绕开这个限制**。
> 本端已选定走 **P2 单页自绘**。

### 可实现但需绕行 / 有代价

| 项 | 绕行方式与代价 |
|---|---|
| 精确时长的程序化滚动 | 自建帧循环（24→16 次 setData）；`ScrollViewContext.scrollTo({duration})` 需 `enhanced`，且**曲线在任何官方 API 都不可指定** |
| 自动高度过渡（`AnimatedSize`） | 无原生对应。**本端已改为「瞬时尺寸 + 120ms 纯 `opacity` 淡入」**（`opacity` 可合成、近零成本） |
| 组件内节点量测 | 必须 `.in(this)`（见 §五·5） |
| 锁屏 / 通知栏封面 | 用 `coverImgUrl`，**须是可抓取的 URL**（官方未明说"必须网络地址"，但 `src` 的云文件 ID 支持说明**未外推到 `coverImgUrl`**，社区证据一致指向须 HTTPS） |
| 倍速播放 | `BackgroundAudioManager.playbackRate` **平台支持**（0.5–2.0，基础库 2.11.0+、Android 6+）；注意 `InnerAudioContext.playbackRate` 在 **iOS 长音频**下不支持 |

### 渲染器差异（重要）

**当前全部是 WebView，以下 Skyline 限制只属于历史备选架构，不可作为现版本的故障依据。** 历史评估如下：
- `<text space="...">` 是 **WebView 专有**属性，**Skyline 下不生效**；Skyline 也不支持 `white-space: pre*`，Inline 布局仍在演进
- Skyline 下 `@keyframes` / `-webkit-mask` / `z-index` 层叠 / `radial-gradient` 的真机行为需单独验证
- 若某个能力在 Skyline 下不可用，**先查是不是播放器页面的问题**，而不是全端

### 一条被纠正的规格误解（留档，避免重犯）

**CSS `cubic-bezier()` 只约束 `x1` / `x2` 在 `[0,1]`；`y` 可以任意**（可负、可 >1，正是过冲曲线的来源）。MDN 的**合法**示例直接列了 `cubic-bezier(0, 1.1, 0.8, 4)`。
此前我们误以为「`y` 必须在 `[0,1]`」，据此绕道 `@keyframes` 实现过冲 —— 实现本身有效，但**理由错了**，相关注释已在批次 B 更正。

---

## 七、对齐基准：`DESIGN.md` v10

> **对齐目标：以 iOS 端已实现并验证的部分为准。**
> 根 `DESIGN.md` 已于 2026-10 更新到 **v10**（`docs: comprehensive update of README and DESIGN specs to match verified iOS 27 release`）。
> **v9 时代那一批「文档落后于实现」的条目（返回条文案、`13→17dp` 推进、`scale 0.985`、`m3EmphasizedDecelerate`、`P9` 数字 pop-in、`38dp` 工具键等）已在 v10 里修正**，本文件不再复述。
> **本端不改动 `DESIGN.md` 与其他端的任何内容**，差异只在本文件记录。

### 7.1 v10 已与本端一致的部分

| v10 位置 | 内容 | 本端状态 |
|---|---|---|
| §3.1 黄金阅读线 | 收敛于视口上方 **32%** | ✅ 本端 `SCROLL.alignRatio = 0.32` |
| §4.2 缓动曲线 | `easeSmoothOut` `Cubic(0.22,1,0.36,1)`；`easeBounce` `Cubic(0.34,1.38,0.64,1)` | ✅ 令牌值一致（`core/themeTokens.ts`）；⚠️ 但**动效用量**已按用户「减少动效」要求削减，见 7.2-6 |
| §1 主题体系 | 双主题 + `ThemeMode.system` / `prefers-color-scheme` | ✅ 同源（`app.wxss` 的 `--ep-*` + `@media (prefers-color-scheme: dark)`） |

### 7.2 本端与 v10 的**已知差异**（待对齐清单 · 本轮只记录、不改动）

| # | v10 位置 | v10 规定 | 本端现状 | 备注 |
|---|---|---|---|---|
| 1 | §3.3 | 找回条文案 **`Return ↑ (5s)`** + 倒计时 | 实现为 **`my_location` 图标 + 实时句文本**，**不显示倒计时数字**（倒计时逻辑保留、只不渲染） | 依据**旧版 iOS + 早期决策 D1**；v10 把该文案重新写回规格 → **需确认是否回改** |
| 2 | §4.1 | **Sinja 长按复听**：3 个入口（库置顶卡 / 列表项左侧索引方块 / Hero 播放键）、150ms 观察窗口 + 8px 滚动防误触、900ms 线性扫掠、完成态 360° 旋转 + 触觉 | **未实现** | 早前决策为「先不补」；**v10 明确了 3 个入口，规模大于早前认知** → 需重新评估 |
| 3 | §3.2 | **自然触底停靠 + 动态钳制**：末项 `itemTrailingEdge <= 1.01` 时休眠 `scrollTo`、就地高亮；`> 1.0` 时按 `maxScrollUp` 钳制滑行 | **未实现**（只有 32% 黄金线跟随） | 影响长课末尾观感 |
| 4 | §3.2.3 | **移除右侧 `RawScrollbar`**；底部留白收敛为 **6px**，使「自然播到底」与「手动滑到底」停在**同一像素点** | 待核查 | 需确认本端 `scroll-view` 是否显示滚动条、底部留白当前值 |
| 5 | §4.2 | `durScroll` = **520ms** | 歌词滚动为 **380ms**（跳句 320ms） | 取值不同 → 需确认 v10 的 520ms 是否即滚动时长 |
| 6 | §4.2 | 动效令牌含 `easeBounce`（按压回弹、图标形变） | 批次 B 已按**用户「减少动效」要求移除** | ⚠️ **v10 与用户指令冲突** → 以用户指令为准，但需知悉 |
| 7 | §2.2 | **全屏交互式右滑返回**（自研手势 + 边缘落影 + 弹簧复位） | P2 计划里 Phase 1 **不自绘** | v10 明确要求 → P2 实施时需重新评估 |
| 8 | §5.2 | 小程序端「基于**全量 336 课** JSON 轻量化数据集」 | 线上 **30 课** | 已确认**上线前扩容**（前置条件：虚拟列表） |

### 7.3 本端**主动超越** v10（⚠️ 非遗漏）

| 内容 | 说明 |
|---|---|
| 第三类舞台盒子 **`✨ KEY PHRASE DRILL`** | iOS/v10 均无此类型（一律 `📌 <SECTION 大写>`）；本端按**用户决策 D2** 主动新增：`core/transcriptView.ts` 的 `isPhraseDrillSegment()` + `computeStageGroups()` |

### 7.4 页面转场与本端的处置

v10 **§2 已采用「同级持久双层堆叠」**（库页常驻 + 播放器覆盖层），**与本端选定的 P2 单页自绘同构** —— 这条路得到规范背书。

- 原生路由下**无法定制**转场（`navigateTo` / `navigateBack` 无 `animationType` / `animationDuration`，且无法对**退出页**做动画）
- **但这不等于"平台做不到"** —— 见 §六
- 本端按 **P2「单页自绘 / 自建页面栈」**落地（播放器做成库页内的全屏覆盖层 + 同页双容器 `transform`），
  方案与 8 步实施序见 `../deliverables/ui-audit/p2-overlay-migration-plan.md`
- **v10 §2 的转场不含 scale**（scale 只存在于旧版的 `pressedScale`）→ 实现时不做 scale

### 7.5 下一步（仅记录）

1. 把本端色彩令牌与 v10 §1 的 8 个 token **逐值比对**（v10 给了确切色值：`textMuted #757989 / #827B70`、`stageBoxBg #161922 / #E8E2D5`、`stageBoxBorder #252A38 / #D5CDBC`、`accentSoft` 14% alpha 等）
2. 逐条评估 7.2 的 8 项差异，**由用户决定哪些回改**
3. 页面转场按 P2 落地（与 v10 §2 对齐）

---

## 八、已知问题与待办

### 历史故障与当时方案（当前状态须结合代码和真机重新判断）

1. **进播放器首屏慢**（真机反馈）：`loadLesson` 里 **串行 await 两次云函数** —— `getLessonDetail`（查库 + 云存储下载 `.json.gz` + gunzip）→ `getLessonIndex`（仅为算上/下一课，却重复拉整份索引）。
   已定方案：① `getLessonIndex` 改**非阻塞** ② **会话级索引缓存** ③ **跨页复用 detail**（全局缓存或 `EventChannel` 直传）④ **detail 持久化到 `wx.setStorage`**（课程内容是静态的）⑤ `loading` 遮罩覆盖到 `audio.onCanplay` ⑥ 云函数侧精简字段。
2. **系统播放控件无封面**（真机反馈）：`coverImgUrl` 现在被赋成**本地包路径** `player/index.ts` 的 `COVER_IMG_URL`，而它用于**原生音频播放器背景图**。
   已定方案：品牌图放**云存储**取 **HTTPS 永久链接**（`getTempFileURL` 有 2h 时效，不可用）+ **在小程序后台配 `downloadFile` 合法域名白名单**。
3. **课程台本无空格、不换行**（真机反馈，**M3 起就存在的老缺陷**）：词数据是裸 token，相邻 `<text>` 之间的空白被 WXML 编译期丢弃，`space="nbsp"` 只管同一文本节点内的连续空格。
   且**播放器是 Skyline**，`space` 是 WebView 专有属性 → 加剧失效。
   修法方向：Skyline 下用单个 `<text>` 内嵌节点并**显式插空格**。
4. **倍速疑似失效**（真机反馈，**M4 遗留**）：`adapters/wechat/backgroundAudio.ts` 的 `load()` 里 `applyRate()` 在**赋 `src` 之前**调用，且 `handleCanplay` / `handlePlay` **未补应用一次** → 换源后被打回 1.0x。
5. **顶部三段胶囊被系统胶囊按钮遮挡**（真机反馈，M3 老问题）：播放器顶栏把真实控件放进了原生胶囊的占位带；`initNavMetrics()` **只算纵向**（`menu.left/right/width` 从未使用）。
   对照物证：课程库页有 `components/pinned-top-deck/` 的**透明占位条**，播放器**缺这一块**。

### 待决策

6. **课程库是否扩到全部 335 课**：数据管线**已处理 335 课（0001–0365）**，线上只上传 **30** 课（`LESSON_INDEX_PAGE_SIZE = 335` 是预留上限）。
   用户决定：**测试期先不动，最后上线再加入**。⚠️ **前置条件：扩容必须同时上虚拟列表**，否则几百个组件全量渲染会拖垮列表。

### 主动不做（已确认，非遗漏）

- **Hero 长按重播**（iOS 的 `_HeroHoldStage` 五态机 + 非对称进度填充）：用户选择**先不补**（属新增功能）
- **应用内专辑封面**：iOS 也没有（其封面只在系统层），本端只做系统层

---

## 九、踩坑记录

### 工具类（**这个仓库里请一律用最朴素的模式**）

| 陷阱 | 表现 |
|---|---|
| `grep "a\|b"` | 在 zsh 下**静默返回空**（不是"没命中"，是表达式被拆坏）→ **一律用 `grep -E "a\|b"`** |
| `git diff <不存在的路径>` | **静默输出空** → 会被误读成"没改动"。**先确认路径存在** |
| `grep -E "\bname\b"` | **macOS BSD grep 不支持 `\b`** → **假阴性**（连必然存在的名字都报"不存在"） |

> **通用怀疑原则**：当核对结果是「全 0 命中」或「全部缺失」这类**过于整齐**的结论时，**先怀疑工具，再怀疑代码**。

### 平台类

- **合成点击（DOM `click`）对微信后台不生效**：开关、下载链接、确认按钮都必须用**真实鼠标事件**（`mouse move` → `down` → `up`）。验证码、密钥下载出问题多半是这里。
- **自定义组件内 `createSelectorQuery` 选不到自己的节点**，必须 `.in(this)`，且**不报错**（静默失效）。
- **`scroll-view` 的 `scroll-with-animation` 必须关掉**才能自建帧循环，否则系统会对我们写的每一帧再动一次画，时长彻底失控。
- **程序化滚动也会触发 `bindscroll`**：必须用「程序化窗口」把整段循环盖住，否则会被误判为用户滚动。

---

## 十、真机验收清单

**每批改动后至少过一遍**（很多问题只在真机暴露，开发者工具看不出来）：

- [ ] **课程库**：30 条能拉到；筛选三态切换**不闪烁**；列表滚动**不卡**；课程卡等高 88px
- [ ] **进入播放器**：等待时长可接受；**自动播放**行为符合预期；返回按钮文案 `← Library`
- [ ] **播放器顶栏**：三段胶囊**不被系统胶囊遮挡**
- [ ] **台本**：词间**有空格**、句子能**正常换行**；活跃句高亮；**词汇有颜色标记**
- [ ] **音频**：出声；**倍速生效**；**后台播放**可用；**锁屏封面**显示
- [ ] **歌词滚动**：跟随播放位置、平滑（`frameMs=24`）
- [ ] **动效**：整体观感"够简"；保留的 4 项（音轨下划线 / 行高亮 / 词色 / 歌词滚动）正常

**2026-10-16 状态重核：** 上一行原是历史故障断言，现不可继续引用为“当前必然失败”。倍速、顶栏、加载已有源码处理；封面缓存 PR #9 已合并；台本与设备表现需按新版本实测。自动播放属于产品决策。验收报告必须列出设备、版本、Build SHA 和具体证据。

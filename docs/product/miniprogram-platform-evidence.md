# 小程序平台能力证据表

编号：EP-MP-REBUILD-001-M0 · v0.2 · 2026-10-24（北京时间）  
状态：官方文档核验已覆盖核心音频、生命周期、渲染更新和 MiniTest API；真实设备/声音实验仍待执行。本表不代表兼容性或产品验收全部通过。

## 核验原则

- 以腾讯/微信官方开发文档正文为平台依据，并用目标微信客户端/云测验证运行行为。
- 官方 API 文档可以确认接口和文档所述限制；不能替代实际音频输出、设备差异、媒体时序或性能测量。
- 每项实验记录源码 SHA、上传版本、微信/基础库、设备/系统、网络、步骤和证据。
- 第三方文章只用于排查线索，不用于填补官方结论。

## 已核验的官方能力

| 能力 | 官方资料与核验事实 | 对实施的影响 | 后续验证 |
| --- | --- | --- | --- |
| BackgroundAudioManager | [API](https://developers.weixin.qq.com/miniprogram/dev/api/media/background-audio/wx.getBackgroundAudioManager.html) 与 [属性/事件](https://developers.weixin.qq.com/miniprogram/dev/api/media/background-audio/BackgroundAudioManager.html)。全局唯一；音频播放中进入后台可继续播放，但后台不能通过小程序 API 操纵播放状态。新 src 会自动播放；支持 m4a/aac/mp3/wav。文档称 playbackRate 0.5–2.0（基础库 2.11.0+；Android 还要求客户端 6+）。onTimeUpdate 仅前台回调，onCanplay 不保证后续流畅播放。 | 单一 Podcast 会话固定一个 BAM；展示视图切换不改 src；后台控件应接受微信系统播放器控制能力边界。 | 换源/暂停/恢复/seek/自然结束/倍速及真实声音分端实测。 |
| 后台及运行生命周期 | [运行机制](https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/operating-mechanism.html)，最后编辑 2026-08-10。普通后台约 5 秒后 JS 挂起；使用后台音乐播放等能力时可持续运行。资源紧张可能销毁小程序；挂起后当前文档描述 30 分钟后可销毁。 | 不能依赖后台定时器或后台 UI 更新；热返回与冷启动分开处理，并允许进程回收。正式版后台音乐还要按 BAM 文档声明 requiredBackgroundModes，开发/体验版与正式版审核要求不同。 | 锁屏、离开小程序、长时后台、音频结束和系统回收后恢复。 |
| setData 与渲染性能 | [合理使用 setData](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/runtime_setData.html)，最后编辑 2026-08-21。更新成本受组件 Shadow 树节点量和更新数据量影响，节点/复杂度影响更大；避免高频更新、滚动回调 setData 和后台页面更新。 | 控制组件树大小；页面 data 仅放渲染字段；合并更新并测实际长台本负载。 | 首屏、长台本、滚动和更新性能量化后设验收阈值。 |
| scroll-view | [组件文档](https://developers.weixin.qq.com/miniprogram/dev/component/scroll-view.html)列出 WebView 与 Skyline 支持；竖向滚动需固定高度；文档说明滚动目标应为子元素 ID，部分能力有基础库版本差异；旧 E2E 中跨组件定位不生效属于项目实测观察，并非该官方页面直接声明。 | M1 决定渲染器前不定最终滚动实现；避免依赖跨组件节点定位。 | 目标渲染器/客户端实际滚动与定位验证。 |
| 网络 | [网络指南](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)，最后编辑 2026-08-21。request/download 等域名需在后台配置，支持 HTTPS；后台 5 秒仍未完成的网络请求会被中断，回前台前网络接口调用受限。 | 课程详情与音频 URL 获取需在播放前完成；后台不做依赖网络的断点写入。音频播放域名和临时 URL 规则仍需按对应 API/云资源文档核验。 | 域名、签名 URL 过期、超时、弱网与回前台重试。 |
| 分享 | [转发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/share.html)，最后编辑 2026-07-23。强调自愿、清晰、按需分享，不得诱导或强制转发。 | 可把分享作为便捷入口，但不能设置分享解锁；课程参数与本机进度分离。 | 分享卡片与冷启动课程直达验证。 |
| 本地存储 | [存储指南](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/storage.html)，最后编辑 2026-06-16。同一用户同一小程序 storage 上限 10MB，按用户隔离；文档称缓存随代码包清理。 | 进度 schema 应小而明确；不要把课程内容或日志长期写入 storage。迁移前保留旧记录。 | 进度乱序写入、用户隔离、代码包更新及缓存清理。 |
| MiniTest 提交与报告 | [官方任务 API](https://developers.weixin.qq.com/miniprogram/dev/devtools/minitest/api_plan.html) 和 [接口说明](https://developers.weixin.qq.com/miniprogram/dev/devtools/minitest/api_exe.html)，最后编辑 2026-08-21。POST /thirdapi/plan 需 token、group_en_id、test_type、wx_version、platforms；自定义用例传 test_plan_id，响应 data.plan_id 为本次任务 ID。GET /thirdapi/plan 查终态；GET /thirdapi/plan_list 返回 success_rate；可取 share_url 与 report/static_resource。大于 10 为终态，只有 12 是正常结束。 | 已据此开 PR #38 修正旧脚本的路径、认证/字段和“触发成功即通过”假闭环。仅 status=12 且匹配任务 success_rate=1 才 PASS；Token、分享/下载 URL 不进入公开日志。 | 在配置凭据的开发上传中跑一次真实任务，验证本项目测试计划字段及返回结构；保留任务 ID 与脱敏摘要。 |

## 云测与自动化现状

- .github/workflows/wechat-preview.yml 对 PR 跑免凭据检查；上传开发版需要 main 上手动触发并确认。上传/开发版不是生产发布。
- [Run 39883149608](https://github.com/gehbfarr5/englishpod-trancy-player-public/actions/runs/39883149608) 的上传和 OpenAPI 巡检通过，MiniTest hook 步骤显示成功；旧脚本使用的 /thirdapi/plan/run、Bearer 认证与字段不符合上面核验的官方 API，因此此 Run 不能证明云测任务或设备用例通过。
- 本地 e2e README 仍有旧双轨场景并依赖本机微信开发者工具。它不作为本次重建的唯一验证路径；新自动化通过 GitHub Actions 和腾讯云测报告闭环。

## M0/M1 退出门槛

M0 的官方文档核心能力核对已完成；以下仍未完成，不能开始声称重建通过平台兼容验收：

1. 核对现有音频 URL、CloudBase 临时链接、域名白名单及后台资源加载规则。
2. 用目标微信版本验证 BAM、锁屏、真实播放连续性、系统中断、进程回收和自然结束。
3. 通过 PR #38 的 GitHub 检查，再用开发版配置跑通 MiniTest 终态/成功率/报告资源回收。
4. 执行 [M1 单 Podcast 音轨实验](miniprogram-audio-experiment.md)，按 iOS/Android 分开记录；截图或无崩溃不能替代真实声音证据。

任何未覆盖设备/场景都标记 NOT TESTED/BLOCKED，不继承其他平台 PASS。

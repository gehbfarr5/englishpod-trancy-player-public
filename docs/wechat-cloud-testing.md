# 微信小程序云测（MiniTest）接入与结果判定

> 适用范围：EnglishPod 微信小程序
> 官方 API 契约核验日期：2026-10-24；腾讯文档标注最后更新：2026-08-21。

## 官方资料

- [MiniTest 第三方 API：测试任务](https://developers.weixin.qq.com/miniprogram/dev/devtools/minitest/api_plan.html)
- [MiniTest API 接口说明](https://developers.weixin.qq.com/miniprogram/dev/devtools/minitest/api_exe.html)
- [BackgroundAudioManager](https://developers.weixin.qq.com/miniprogram/dev/api/media/background-audio/BackgroundAudioManager.html)
- [后台音频管理器 API](https://developers.weixin.qq.com/miniprogram/dev/api/media/background-audio/wx.getBackgroundAudioManager.html)
- [小程序运行机制](https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/operating-mechanism.html)
- [合理使用 setData](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/runtime_setData.html)

## GitHub Actions 配置

在仓库 Settings → Secrets and variables → Actions 配置：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| **MINITEST_TOKEN** | Secret | 腾讯 MiniTest 用户 Token。只从 Actions Secret 读取，不写入日志。 |
| **MINITEST_PROJECT_ID** | Variable | MiniTest 项目英文 ID（group_en_id），不是小程序 AppID。 |
| **MINITEST_PLAN_ID** | Variable | 云测控制台中的测试计划 ID，提交时映射到官方参数 test_plan_id。 |
| **MINITEST_TEST_TYPE** | Variable，可选 | 默认 2（Minium）；也可用 3（录制回放）。云测控制台须已有对应计划。 |
| **MINITEST_PLATFORMS** | Variable，可选 | 默认 ios,android。官方接口支持 ios、android。 |

用户 Token、项目英文 ID 和测试计划 ID 是三类不同值，缺一时不能执行真实云测。upload 模式要求 MiniTest 时，未配置将产生 NOT_RUN 摘要并使任务以失败状态（exit code 1）退出；未运行或失败均不能作为设备验收。

## 官方 API 执行契约

上传开发版成功后，miniprogram/scripts/wechat-minitest.mjs 按官方接口完成以下步骤：

1. POST /thirdapi/plan，提交 token、group_en_id、test_type、wx_version=3（开发版）、平台列表和 test_plan_id；描述附带包版本、Git SHA 和 GitHub Run ID。腾讯要求项目已绑定小程序 AppID。
2. 从响应中的 data.plan_id 取得本次测试任务 ID。这里的任务 ID 与测试计划 ID 不同。
3. 以 GET /thirdapi/plan 查询任务，带 full_info=1。官方状态 1 为排队、2 为测试中；大于 10 表示终态，只有 12 表示正常结束，其他终态按未通过处理。
4. 以 GET /thirdapi/plan_list 按提交描述中的 SHA 查询本次任务及 success_rate。只有任务 ID 匹配且成功率为 1.0 才记 PASS。任务完成但成功率缺失、查询超时、报告读取失败均不得记为通过。
5. 以 GET /thirdapi/share_url 和 /thirdapi/report/static_resource 确认报告引用可用。分享 URL、下载 URL、Token 和原始报告内容不会写到公开日志或仓库。

官方第三方接口限制为每个项目每小时 1000 次；当前工作流按 15 秒间隔轮询，最多等待 30 分钟。开发版上传/云测任务所在工作流超时设置为 60 分钟。云测摘要 JSON 仅包含状态、版本、SHA、Run ID、任务 ID、平台、成功率和报告是否可读取，作为 7 天 GitHub Actions Artifact 保存。

若需要查看截图、日志等详细资源，请使用 MiniTest 控制台中的任务 ID 和账号权限。不要把包含课程/账号内容的原始截图或报告压进公开仓库。腾讯云测能否观察真实音频输出、后台连续播放、锁屏控制、耳机操作和系统中断，必须分别核实；页面渲染通过、无崩溃或 MiniTest 任务结束不能替代这些证据。

## 对旧执行记录的重新判读

历史 [Run 39883149608](https://github.com/gehbfarr5/englishpod-trancy-player-public/actions/runs/39883149608) 的开发版上传和 OpenAPI 巡检成功，MiniTest 步骤也显示成功，但旧脚本使用的 URL、认证方式和字段与上述官方 API 不符；该 Run 不能证明腾讯云测任务已成功提交或设备用例已通过。历史预览 Run 39883317942 不执行 MiniTest。

## 与播放器重建相关的平台事实

- BackgroundAudioManager 是全局唯一实例；设置新的 src 会自动开始播放，因此切换 Podcast / Dialogue 台本或词汇视图不能更新 src。
- 官方说明：小程序切到后台时，如果音频正在播放，可以继续播放；后台状态不能通过小程序 API 操纵播放状态。正式版使用后台音频还涉及 requiredBackgroundModes 审核。
- 小程序进入后台约 5 秒后 JS 线程会挂起；使用后台音乐播放能力时可持续运行。设备资源紧张或长时间未使用时仍可能被回收，因此回前台需从真实媒体状态恢复界面。
- onTimeUpdate 仅在小程序前台回调；onCanplay 只表示进入可播放状态，不保证之后连续流畅。
- 官方 setData 指南要求控制组件树规模和更新频率，避免滚动回调高频 setData，也要求后台页面避免不必要的更新。

这些规则约束新实现，但仍须通过 M1 云端/目标设备实验确认实际声音、后台、恢复及长音频行为；接口文档不是设备测试结果。

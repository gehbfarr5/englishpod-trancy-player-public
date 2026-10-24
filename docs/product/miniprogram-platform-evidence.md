# 小程序平台能力证据表

编号：EP-MP-REBUILD-001-M0 · v0.1 · 2026-10-24（北京时间）  
状态：执行中；官方开发文档正文尚未完成逐项核验。本表不构成兼容性通过声明。

## 核验原则

- 以腾讯/微信官方开发文档正文及目标微信客户端实测为依据。
- 腾讯发布的 TypeScript API 定义可佐证接口签名，不单独证明后台生命周期、异步时序、不同系统行为或实际音频输出。
- 官方页面在当前检索环境不可读取时，保留“待核验”，不以第三方文章补成官方结论。
- 核验后记录文档版本/适用基础库、引用章节、日期及对应实验结果。

## 证据状态

| 能力 | 官方依据入口 | 当前证据 | 状态 | 对实施的影响 |
| --- | --- | --- | --- | --- |
| BackgroundAudioManager 加载、自动播放、seek、时长、事件、倍速 | [后台音频](https://developers.weixin.qq.com/miniprogram/dev/api/media/background-audio/wx.getBackgroundAudioManager.html)；[微信 API 类型定义](https://github.com/wechat-miniprogram/api-typings) | 本次自动检索无法读取官方文档正文。项目锁定 miniprogram-api-typings 5.2.3，只能用于接口签名核对；旧适配器注释中的运行时描述尚未逐项复核。 | 待官方正文及目标微信实测 | M1 分别测首次加载、换源、seek、暂停/恢复、自然结束；不把旧注释当平台保证。 |
| 小程序前后台运行和页面生命周期 | [运行机制](https://developers.weixin.qq.com/miniprogram/dev/framework/operating-mechanism.html)；[页面](https://developers.weixin.qq.com/miniprogram/dev/framework/app-service/page.html) | 文档正文无法读取；尚无当前目标版本的完整实测记录。 | 待核验 | 区分页面隐藏、切后台、进程回收、冷启动和热返回；不能预设后台 JS 持续运行。 |
| setData 与首屏/更新性能 | [setData 运行时建议](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/runtime_setData.html) | 正文无法读取；旧播放器负载尚未量化。 | 待官方正文及基线测量 | 页面数据只放渲染所需状态；用长台本测首屏、更新量及滚动后再定阈值。 |
| scroll-view、组件边界与节点测量 | [scroll-view](https://developers.weixin.qq.com/miniprogram/dev/component/scroll-view.html)；[兼容性](https://developers.weixin.qq.com/miniprogram/dev/framework/compatibility.html) | 正文无法读取；旧 E2E 记录属于项目观察，不是平台文档事实。 | 待官方正文及渲染器实测 | M1 后决定渲染器；M3 测真实滚动，不把模拟器预测当真机通过。 |
| 网络音频、域名、URL 有效期和错误 | [网络](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)；项目 CloudBase 音频解析代码 | 官方正文未核验；现有 fileID 到可播 URL 解析和单测可供审查，过期、超时和域名仍待确认。 | 平台规范待核验 | 保留错误呈现和过期处理；不得在日志泄露签名 URL。 |
| 后台声明、锁屏控制和音频中断 | [后台音频](https://developers.weixin.qq.com/miniprogram/dev/api/media/background-audio/wx.getBackgroundAudioManager.html) | 文档正文无法读取；历史代码中的 requiredBackgroundModes 描述未对照现行规范及审核状态。无新 SHA 对应的锁屏、来电、系统抢占证据。 | 待官方正文及设备矩阵 | M1 覆盖锁屏、离开小程序、音频抢占和回前台；不能用 UI 截图代替真实声音证据。 |
| 分享参数及课程直达 | [分享](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/share.html) | 官方正文未核验；参数、登录态和播放意图待细化。 | 待官方正文及产品/设备测试 | 跨微信冷启动验证课程打开；分享不得隐式清除本机断点。 |
| 本地缓存及存储限制 | [数据缓存](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/storage.html) | 官方正文未核验；progressJournal 测试只能证明项目行为，不能证明平台容量/清理规则。 | 平台限制待核验 | M2 明确 schema、并发与清理策略；未经授权不迁移/清除旧记录。 |

## 云测和自动化现状

- .github/workflows/wechat-preview.yml 对 PR 执行免凭据检查；预览/开发版上传受 main 和工作流确认保护。
- [Run 39883149608](https://github.com/gehbfarr5/englishpod-trancy-player-public/actions/runs/39883149608) 显示开发版上传、OpenAPI 巡检与 MiniTest hook 步骤成功。这不能单独证明计划完成或自定义用例通过。
- miniprogram/scripts/wechat-minitest.mjs 当前提交 POST /thirdapi/plan/run 后退出，没有轮询终态或读取报告；工作流也没有传入 MINITEST_VERSION。
- [Issue #37](https://github.com/gehbfarr5/englishpod-trancy-player-public/issues/37) 跟踪补环。任务状态/报告接口须从腾讯官方资料或账号控制台确认，不能猜接口。
- 现有 e2e README 描述旧双轨用例和本地开发者工具路径；复用其证据判定思路前必须适配新范围。常规验收走 GitHub 云端流程，不依赖用户本地设备。

## M0 退出门槛

M0 尚未完成。全面重写前需要：

1. 读取并记录腾讯官方文档正文、适用基础库及限制。
2. 从腾讯 MiniTest 官方资料确认任务提交、版本绑定、状态查询、报告/附件读取契约。
3. 建立 M1 最小单音轨实验并确认云端设备能否观测后台与真实音频场景。
4. 将旧适配器中未经证实的平台描述标为官方事实、项目观察或待复现。

官方页面读取恢复后更新此表；在此之前不声称已完成“官方兼容审查”。

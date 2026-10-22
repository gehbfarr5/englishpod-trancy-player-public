# 微信小程序云测（MiniTest）接入与使用指南

> **适用范围**：EnglishPod 微信小程序（`gehbfarr5/englishpod-trancy-player-public`）  
> **服务官方入口**：[微信公众平台](https://mp.weixin.qq.com/) → **开发** → **云测服务** (或直接访问 [minitest.weixin.qq.com](https://minitest.weixin.qq.com))

---

## 1. 为什么接入小程序云测？

传统自动化测试或真机验证依赖开发者在本地连接物理机（或开着开发者工具）。
微信官方提供的**小程序云测（MiniTest）**联合腾讯 WeTest，在腾讯云机房配备了上百款真实的 iPhone 和 Android 设备，每周提供 **150 分钟免费真机额度**。

接入后：
* 代码通过 GitHub Actions 自动上传至开发版后，CI 可直接通过 HTTP API 触发云测任务。
* 云端真机矩阵自动跑兼容性、防崩溃（Monkey 测试）以及核心用例。
* 测试报告（含真实截图、耗时、JS 异常、网络请求）直接生成在线链接或结构化数据，供 Agent 和开发者复核，**彻底免去在身边物理机上手工反复测试**。

---

## 2. 首次开通与凭据获取（账号持有人操作）

1. **登录控制台**：
   * 登录微信公众平台后台，进入「开发管理」→「云测服务」（首次进入按提示开通）。
2. **创建测试计划**：
   * 在云测后台选择「测试计划」→「新建计划」，选择测试类型（例如「Monkey 测试」或「录制回放/自定义用例」）。
   * 记下生成的 `Plan ID`（测试计划编号）。
3. **获取 API 授权 Token**：
   * 在云测后台「用户设置」或「第三方接口 / OpenAPI」中生成授权 Token。
4. **配置 GitHub 变量**：
   * 在 GitHub 仓库设置 `Settings` → `Secrets and variables` → `Actions` 中添加：
     * `MINITEST_TOKEN`（Secret）：云测 API Token。
     * `MINITEST_PLAN_ID`（Variable）：刚才创建的测试计划 ID。

---

## 3. 流水线执行机制

* 在 `.github/workflows/wechat-preview.yml` 中：
  * 当执行 `mode=upload` 且成功将代码传到微信开发版后，会自动触发 `miniprogram/scripts/wechat-minitest.mjs`。
  * 若未配置凭据，脚本会自动跳过（Graceful skip），不阻断流水线。
  * 若已配置凭据，云测将异步在腾讯云真机上执行测试，测试完成后可直接在云测控制台查阅报告。

---

## 4. 全链路自动化实测回执（2026-10-23）

全套标准化无头 CI/CD 流水线已在 GitHub Actions 官方托管 Runner (`ubuntu-24.04`) 与腾讯云首尔出口代理配合下完成端到端闭环实测：

| 验证项 | 工作流运行记录 | 测试模式 | 被测版本 & SHA | 执行耗时 | 结果与证据 |
|---|---|---|---|---|---|
| **开发者预览二维码** | [Run 39819027282](https://github.com/gehbfarr5/englishpod-trancy-player-public/actions/runs/39819027282) | `mode: preview` | `0.3.12` (`b0a625a`) | 19.9s | **PASS**: 成功通过首尔代理握手微信 CI，产出 `preview.jpg` 并作为 Artifact 保存，Step Summary 回显成功 |
| **官方开发版上传** | [Run 39819830575](https://github.com/gehbfarr5/englishpod-trancy-player-public/actions/runs/39819830575) | `mode: upload` | `0.3.12` (`b0a625a`) | 15.0s | **PASS**: 成功编译并上传官方开发版代码（package groups=1，Robot 9），MiniTest 接入钩子触发并平稳挂起 |


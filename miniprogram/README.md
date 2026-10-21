# EnglishPod 微信小程序

原生微信小程序（TypeScript）实现；`core/` 纯业务逻辑，`adapters/wechat/` 包含云端、音频与存储适配。**与 Flutter iOS/Android 是不同的客户端实现，不应假定某端修复自动覆盖另一端。**

## 当前已知状态

- 微信 AppID：在 `project.config.json` 和 `config/env.ts` 中保持一致，AppID 及环境 ID 已配置，**不是占位符**。
- `app.json` 当前使用 **WebView** 渲染器；`pages/library/index` 与 `pages/player/index` 为实际页面。曾经讨论的 Skyline 分包在本次代码基线上并非当前入口。
- `USE_MOCK_DATA=false`、`USE_FAKE_AUDIO_CLOCK=false`：当前代码默认使用真实 CloudBase 数据与音频机制，而不是虚拟时钟。
- 已有 CloudBase 账号迁移及部分真机预览验证记录；历史单独 M4A 兼容回退不能视为新移动端的主资源格式。完整课程库覆盖及性能须以小程序实际数据库与设备为准，不能仅凭 Flutter 335 课推断。
- **源码版本**：`0.2.0`（`package.json`，由根目录 `release/versions.json` 校验）。微信后台上传/发布版本需要人工核实，没有凭据不能认定与源码相同。
- 小程序公众平台**正式主体、认证和历史费用**仍属于待核实事项；`APP_DISPLAY_NAME` 只是 UI 显示名，不是后台登记名。

## 本地检查

```bash
cd miniprogram
npm ci
npm run typecheck
npm test
npm run validate
```

基础操作、云函数与历史架构取舍见 [DEVELOPMENT.md](DEVELOPMENT.md)；其中早期的 Skyline/M4A/30 课批次描述是**历史档案**，不能当成今日运行架构。

版本更新：从仓库根目录运行 `python3 pipeline/versioning.py bump --platform miniprogram --part patch`，提交更新的 `package.json`、lockfile 和版本清单。**此操作只修改源码版本，不会自动上传/发布微信小程序**。详见 [版本管理规则](../docs/versioning.md)。

部署/版本验收遵循 [跨端验收矩阵](../docs/platform-validation.md)，任何云函数、数据库或公众平台发布操作均需单独授权。

## 音频映射回归修复及真机验收（2026-10-18）

第 0114 课 PB 曾因错误回退 `audio/0114/pb.m4a` 报 `STORAGE_FILE_NONEXIST`。修复已在 [PR #29](https://github.com/gehbfarr5/englishpod-trancy-player/pull/29) 合并：播放器始终预热在线 `file_ids`，等待音频地址就绪，仅允许合法课程详情相对路径回退。WorkBuddy 整理的单台 iPhone 开发预览中，用户整体确认 0001/0031/0114/0335 两音轨及核心控制正常；未量化首播耗时或验证其他设备。详见 [真机验收记录](../docs/wechat-audio-acceptance-2026-10-18.md)。


## 微信 GitHub Actions 分阶段部署（PR #28）

参见 [微信 CI 部署说明](../docs/wechat-ci-deployment.md)。PR 仅执行离线无密钥检查；只有管理员人工授权、正确 Runner/微信密钥与 IP 白名单就绪后，才可能生成开发预览或上传开发版本。GitHub 私有仓库部署审批能力受计划限制，不能把现有 Environment 视为已获独立审批保障。
# iOS 自动化测试、规范对齐与 Agent 审查架构

**版本**：v1.0  
**日期**：2026-10-25  
**关联规范**：[`EP-PBC-001 v1.4`](../product/playback-behavior-contract.md)  
**适用平台**：Flutter iOS（模拟器与实体 iPhone 17）  

---

## 1. 核心目标与职责边界

本项目在 Web 端与微信小程序端均已建立自动化审查与云端测试回路。针对 iOS 端，确立了**代码确定性测试门禁**与**Agent 认知审查归因**相辅相成的双层体系：

```
                ┌──────────────────────────────────────────────┐
                │             GitHub Actions 门禁              │
                │ (Flutter test / iOS Simulator / iPhone 17)   │
                └──────────────────────┬───────────────────────┘
                                       │ 产出结构化测试报告与运行产物
                                       ▼ (report.json, log, screenshots)
       ┌───────────────────────────────────────────────────────────────┐
       │             确定性判定层 (Deterministic CI)                   │
       │  • 断言比较 (Expectations: 进度是否为 00:00、写入是否成功)     │
       │  • 二元判定 (PASS / FAIL / TIMEOUT)                           │
       │  • 退出码控制 (硬门禁拦截 PR 合并)                            │
       └───────────────────────────────┬───────────────────────────────┘
                                       │
                      ┌────────────────┴────────────────┐
                      │ 触发判定：若出现 FAIL/WARN/新 PR │
                      ▼                                 ▼
       ┌───────────────────────────────┐ ┌─────────────────────────────┐
       │      Agent Scout (审查归因)    │ │   Agent Builder (自动修复)  │
       │ • 日志脱敏与根因归因 (RCA)      │ │ • 基于已批准的 Issue/用例     │
       │ • 判定: 代码Bug / 断言误判 /     │ │ • 拉取独立分支编写最小补丁      │
       │   环境超时 / 跨端规范违背       │ │ • 必须提供前后对比回归证据    │
       │ • 语义审计: 是否破坏 EP-PBC 规则│ │ • 提交 Draft PR 待人工审阅     │
       └───────────────────────────────┘ └─────────────────────────────┘
```

### 1.1 确定性 CI（严禁 Agent 代劳）
- **真伪通过判定（PASS/FAIL）**：时间戳断言、断点恢复判定、文件写入与状态转移必须由测试代码给出二元判定，严禁由 LLM 通过截图进行主观猜度。
- **合并保护**：只有所有确定性测试通过（exit_code == 0），并且人工审核通过后才能合并至 `main`。

### 1.2 Agent Scout 与 Builder 的审查职责
- **失败自动诊断与根因归因（RCA）**：当 CI 产生 FAIL/ERROR 时，Agent Scout 读取脱敏后的 `native-evidence/report.json` 与测试日志，识别出是「代码逻辑缺陷」、「测试断言编写错误」还是「CI 模拟器冷启动超时」。
- **跨端规范语义审计**：在审查 PR 时，核对代码变更是否破坏了 `EP-PBC-001` 的核心规范（如加载中是否违规写盘、DG 是否错误修改了完成标志）。
- **自动化复现与修复（Builder）**：对确认的问题先新增失败的回归测试，再编写修复代码，提交 Draft PR。

---

## 2. 跨平台播放规范对齐（EP-PBC-001 v1.4）

在 `flutter_app/lib/services/playback_contract_policy.dart` 与 `flutter_app/lib/main.dart` 中严格实现以下逻辑：

1. **课程入口与断点恢复**：
   - 课程列表普通进入强制打开 **Podcast (`pb`)**。
   - 未完成课程恢复其 PB 断点；**已完成课程（`isCompleted == true`）强制从 00:00 开始**。
   - 「继续收听」卡片同样强制定位至最后打开课程的 PB 断点（不恢复 DG 作为默认音轨）。
2. **独立双断点存储**：
   - 同一课程内 PB 与 DG 进度独立存储于 `pbPosSec` 与 `dgPosSec`，互不覆盖。
   - 切换选项卡时，恢复目标音轨自己的断点。
3. **加载锁定守卫（Anti-Rollback Guard）**：
   - 加载音频或执行异步 seek 期间，置位 `_isAudioLoading = true` 并自增 `_audioLoadToken`。
   - 加载期间原生 AVPlayer 上报的 `0.x` 秒初始事件绝不写入磁盘，防止断点被重置覆盖。
4. **单向完成判定（Monotonic Completion）**：
   - 只有 **PB** 正常播放跨越 95% 或自然到达末尾才能将 `isCompleted` 标记为 `true`；DG 播放绝不改变整课完成状态。
   - 拖拽 Seek 跨越 95% 绝不触发完成。
   - `isCompleted` 一旦为 `true` 永不回退为 `false`。
5. **自然播放结束决策链**：
   - 优先级：单句循环 > 当前音轨循环 > 自动连播（仅 PB 自然结束有效） > 停止播放。
   - 最后一课 PB 自然结束时，自动连播循环回第一课 PB 00:00；手动 Next 按钮在最后一课处于禁用/No-Op 状态。
   - DG 自然结束一律停止播放（除非开启单轨循环）。

---

## 3. 双轨测试方案：方案 A 与方案 B

| 特性 | 方案 A：云端模拟器门禁 | 方案 B：实体 iPhone 17 真机自动化 |
| --- | --- | --- |
| **执行载体** | GitHub Actions 托管 `macos-14` Runner | 自托管 Mac Runner (`[self-hosted, macOS, ios-device]`) |
| **设备目标** | Xcode iOS Simulator (iPhone 17 runtime) | 物理 iPhone 17 (iOS 27.x, Developer Mode) |
| **触发方式** | 每次 PR / Push 自动触发门禁 (`mobile-regression.yml`) | 手动调度 (`ios-device-regression.yml`) 或发布候选分支 |
| **测试资产** | 隔离合成音频 WAV fixture（60s，无大文件下载） | 隔离合成音频 WAV fixture |
| **证书与配置** | 无需开发者证书，零维护成本 | 需要 Mac 本地签名或开发证书配对 |
| **核心职责** | 快速拦截日常代码回归、UI 流程、进度断点保存与恢复 | 验证真实硬件音频解码、后台播放 (Now Playing)、耳机打断 |

---

## 4. 实体 iPhone 17 真机接入与沙盒保护机制

为了保障方案 B 在运行自动化测试时**绝对不破坏用户的正常使用与真实学习记录**：

1. **测试 Bundle ID 隔离**：
   测试构建在打包时使用专用包名 `com.englishpod.trancy.regression`，与用户手机上安装的日常学习版本隔离共存。
2. **SharedPreferences 数据沙盒隔离**：
   测试入口显式设置 `SharedPreferences.setPrefix('ep_native_regression.')`，所有读写、断点记录均隔离在此前缀下，不读取亦不删除用户日常的 `ep_study_progress_v1`。
3. **物理机连接与预检脚本**：
   通过 `python3 pipeline/select_ios_device.py` 自动检索已连接、已信任配对并开启 Developer Mode 的物理 iPhone，并捕获运行环境字符串（如 `iPhone 17 (iOS 27.0.1)`）。
4. **统一证据产出**：
   物理真机测试执行完毕后，调用 `pipeline/native_test_evidence.py finalize --platform ios-device` 生成标准 `report.json`，与模拟器方案 A 完全一致，无缝供 Agent Scout 进行自动化审查。

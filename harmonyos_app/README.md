# EnglishPod · HarmonyOS 7.0 (API 26) 原生客户端

面向 **HUAWEI Pura X View（`VOL-AL00`｜6.39" 16:9.5 阔直板屏｜2232 × 1320｜120Hz）** 的纯原生 ArkTS（Stage 模型）实现，功能与契约严格对齐 iOS `1.0.2+3`（`EP-PBC-001 v1.4`）。

## 模块结构

- `entry`：主 HAP（`EntryAbility`、`MainShellPage`、`LibraryPage`、`PlayerPage`、`StudyFormAbility`、`FlashSubWindowPage`）
- `packages/ep_design`：Dark Cocoon & Claude Paper 双主题 Token、`UIMaterial` 玻璃光感、Pura X View 16:9.5 布局断点与 1.05mm 极窄边避让、`HapticEngine` 线性马达封装
- `packages/ep_domain`：`EP-PBC-001 v1.4` 播放与进度契约引擎、逐句导航、词汇高亮分词、RDB/Preferences 持久化与 `rawfile` 课程加载器
- `packages/ep_audio`：`AVPlayer` 双轨音频引擎、`AVSession` 播控中心（含实时英文原句歌词与动态深浅色封面）、HarmonyOS 7.0 `SpatialAudioManager`、后台音频长时任务
- `packages/ep_harmony_ext`：实况窗（Live View）、闪控窗/闪控球（Flash Window）、后台代理定时提醒（Reminder）、小艺 Agent A2A 技能桥接、跨端接续（Continue）与碰一碰分享

## 快速开始（DevEco Studio）

1. 同步课程与音频资产（首次运行，通过软链接复用 `flutter_app/assets` 避免重复占用 2.2 GB）：
   ```bash
   ./harmonyos_app/scripts/sync_assets.sh
   ```
   > 若需打独立 Release HAP 包，请使用 `SYNC_MODE=copy ./harmonyos_app/scripts/sync_assets.sh`。
2. 使用 **DevEco Studio（HarmonyOS SDK API 26）** 打开 `harmonyos_app/` 目录。
3. 连接 **HUAWEI Pura X View（VOL-AL00）** 真机，配置自动签名后点击 **Run `entry`** 即可安装调试。

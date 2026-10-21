# EnglishPod Flutter · iOS / Android

Flutter 双端共享播放器，支持 Podcast / Dialogue 双音轨、同步字幕和离线课程资源。实际课程索引 **335 课**，完整构建包含 **670 个原始 MP3 文件**。

## 身份、版本和验收

- iOS Bundle ID：`com.jin.englishpod.trancyplayer`（Xcode Runner 工程；本地签名工具须核对最终值）。
- Android applicationId：`com.englishpod.trancy.englishpod_trancy`，当前是测试 APK 的 debug key 签名配置。
- Flutter 两端共用 `pubspec.yaml` 的 `version: 语义版本+构建号`。以根目录 `release/versions.json` 的一致性检查为准。
- 2026-10-17 已成功构建并安装的 iOS IPA 属于旧源码版本 `1.0.0+1`；仓库里的 `1.0.1+2` 是 **下一版待构建候选**。
- Android 已成功构建完整资源 APK，**没有 Android 真机测试设备，不能声称通过真机验收**。

## 本地静态检查

```bash
# 在仓库根目录
python3 pipeline/versioning.py check
python3 pipeline/prepare_flutter_lessons.py
python3 pipeline/check_distribution.py --audit-source processed_lessons --expected-count 335 --scan flutter_app/assets/lessons_safe

cd flutter_app
flutter pub get
flutter analyze
flutter test
```

## 完整离线安装包

本仓库不包含原始 MP3 二进制素材，不能靠 `flutter build ios` 就证明音频完备。建议从 GitHub Actions 手动运行 `Mobile Cloud Build`，按账号 B COS 清单下载并校验所有音轨，再自动打包未签名 IPA（`ios_signing=unsigned-ipa`），在设备本地签名；Android 则生成测试 APK。

手动构建或排查请阅读 [构建说明](../docs/mobile-cloud-build.md)、[版本规则](../docs/versioning.md) 与 [验收矩阵](../docs/platform-validation.md)。不要将 legacy `assets/lessons/` 打包，运行时代码只读取生成的 `assets/lessons_safe/`。

## 组件结构

- `lib/main.dart`：课程库、播放器 UI、字幕/滚动交互（较大文件，后续渐进拆分）。
- `lib/models/lesson_models.dart`：课程、字幕、词汇等数据模型。
- `lib/services/sentence_audio_handler.dart`：锁屏与媒体控制集成。
- `ios/`、`android/`：各平台独有集成与应用身份。

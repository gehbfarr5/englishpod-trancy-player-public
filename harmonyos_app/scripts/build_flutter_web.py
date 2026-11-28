#!/usr/bin/env python3
"""
Build the genuine Flutter mobile CanvasKit bundle (`flutter_app/lib/main.dart`)
for HarmonyOS ArkWeb hosting, without modifying tracked files in `flutter_app/`.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess

SCRIPT_DIR = Path(__file__).resolve().parent
HARMONY_DIR = SCRIPT_DIR.parent
REPO_ROOT = HARMONY_DIR.parent
FLUTTER_SOURCE_ROOT = Path(os.environ.get('FLUTTER_SOURCE_ROOT', str(REPO_ROOT))).resolve()
EP_SYNC_API_BASE = os.environ.get(
    'EP_SYNC_API_BASE',
    'https://43.155.232.185:8888/api/sync/v1',
).strip()
STAGE_DIR = Path('/tmp/englishpod-harmony-web')
OUTPUT_DIR = HARMONY_DIR / 'entry' / 'src' / 'main' / 'resources' / 'rawfile' / 'flutter_web'
FLUTTER_BIN = Path(os.environ.get('FLUTTER_BIN', '/Users/jin/development/flutter/bin/flutter'))


def stage_clean_flutter(source_root: Path, output: Path) -> None:
    app = source_root / 'flutter_app'
    fallback_app = REPO_ROOT / 'flutter_app'
    output.mkdir(parents=True)
    for folder in ('lib', 'test', 'web', 'assets/branding', 'assets/fonts', 'assets/lessons_safe'):
        src = app / folder
        if not src.exists() and folder == 'assets/lessons_safe':
            src = fallback_app / folder
        if src.exists():
            shutil.copytree(src, output / folder)
    for name in ('pubspec.lock', 'analysis_options.yaml'):
        src_file = app / name
        if src_file.is_file():
            shutil.copyfile(src_file, output / name)
    pubspec = (app / 'pubspec.yaml').read_text(encoding='utf-8')
    pubspec = re.sub(r'(?m)^\s+- assets/audio/[^\n]*\n?', '', pubspec)
    (output / 'pubspec.yaml').write_text(pubspec, encoding='utf-8')


CLEAN_INDEX_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <base href="$FLUTTER_BASE_HREF">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="description" content="EnglishPod listening player">
  <meta name="theme-color" id="ep-theme-color" content="#070709">
  <script>
    (function () {
      function resolveInitialIsDark() {
        try {
          const params = new URLSearchParams(window.location.search || '');
          const t = params.get('theme');
          if (t === 'light') return false;
          if (t === 'dark') return true;
        } catch (_) {}
        try {
          const stored = localStorage.getItem('flutter.user_theme_preference') || '';
          if (stored.indexOf('light') !== -1) return false;
          if (stored.indexOf('dark') !== -1) return true;
        } catch (_) {}
        try {
          return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        } catch (_) {}
        return true;
      }
      window.__epApplyHtmlTheme = function (isDark) {
        const bg = isDark ? '#070709' : '#F2EDE2';
        try {
          document.documentElement.style.backgroundColor = bg;
          if (document.body) {
            document.body.style.backgroundColor = bg;
          }
          const meta = document.getElementById('ep-theme-color');
          if (meta) {
            meta.setAttribute('content', bg);
          }
        } catch (_) {}
      };
      window.__epApplyHtmlTheme(resolveInitialIsDark());
    })();
  </script>
  <title>EnglishPod</title>
  <style>
    :root {
      --ep-sat: env(safe-area-inset-top, 0px);
      --ep-sab: env(safe-area-inset-bottom, 0px);
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      overscroll-behavior: none;
      -webkit-overscroll-behavior: none;
      touch-action: manipulation;
      background: #070709;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      -webkit-user-select: none;
    }
    @media (prefers-color-scheme: light) {
      html, body {
        background: #F2EDE2;
      }
    }
  </style>
  <script>
    (function () {
      window.epMediaElements = [];
      window.epBridgeState = null;

      window.epSendCommand = function (cmd) {
        try {
          if (typeof window.epDispatchCommand === 'function') {
            window.epDispatchCommand(String(cmd));
            return 'ok:' + cmd;
          }
          return 'not_ready:' + cmd;
        } catch (e) {
          return 'err:' + String(e);
        }
      };

      window.epNavigateBack = function () {
        return window.epSendCommand('back');
      };

      function syncWebMediaSession(state) {
        if (!('mediaSession' in navigator) || !state) return;
        try {
          const artFile = state.isDark ? 'brand_icon_dark.png' : 'brand_icon_light.png';
          const artUrl = window.location.origin + '/assets/assets/branding/' + artFile;
          navigator.mediaSession.metadata = new MediaMetadata({
            title: state.title || 'EnglishPod',
            artist: state.subtitle || 'Elementary (Podcast)',
            album: 'EnglishPod · Trancy Player',
            artwork: [
              { src: artUrl, sizes: '1024x1024', type: 'image/png' }
            ]
          });
          navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
          navigator.mediaSession.setActionHandler('play', function () { window.epSendCommand('play'); });
          navigator.mediaSession.setActionHandler('pause', function () { window.epSendCommand('pause'); });
          navigator.mediaSession.setActionHandler('previoustrack', function () { window.epSendCommand('prev'); });
          navigator.mediaSession.setActionHandler('nexttrack', function () { window.epSendCommand('next'); });
          navigator.mediaSession.setActionHandler('seekto', function (details) {
            if (details && typeof details.seekTime === 'number') {
              window.epSendCommand('seek:' + details.seekTime);
            }
          });
        } catch (_) {}
      }

      const origConsoleLog = console.log.bind(console);
      console.log = function () {
        for (let i = 0; i < arguments.length; i++) {
          const msg = String(arguments[i] || '');
          if (msg.indexOf('[EP_BRIDGE]') === 0) {
            try {
              window.epBridgeState = JSON.parse(msg.slice('[EP_BRIDGE]'.length));
              if (typeof window.epBridgeState.isDark === 'boolean' && typeof window.__epApplyHtmlTheme === 'function') {
                window.__epApplyHtmlTheme(window.epBridgeState.isDark);
              }
              syncWebMediaSession(window.epBridgeState);
            } catch (_) {}
          }
        }
        return origConsoleLog.apply(console, arguments);
      };
      const trackEl = function (el) {
        if (!el || window.epMediaElements.indexOf(el) !== -1) return;
        window.epMediaElements.push(el);
      };
      const origLoad = HTMLMediaElement.prototype.load;
      HTMLMediaElement.prototype.load = function () {
        trackEl(this);
        return origLoad.apply(this, arguments);
      };
      const origPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        trackEl(this);
        return origPlay.apply(this, arguments);
      };
      setInterval(function () {
        for (let i = 0; i < window.epMediaElements.length; i++) {
          const el = window.epMediaElements[i];
          if (el && !el.paused) {
            console.log('[EP_AUDIO_TICK]' + JSON.stringify({
              src: el.currentSrc || el.src || '',
              time: Number((el.currentTime || 0).toFixed(2)),
              dur: Number((el.duration || 0).toFixed(2)),
              rate: el.playbackRate || 1.0,
              paused: !!el.paused
            }));
          }
        }
      }, 800);

      window.epDumpTestState = function () {
        const dpr = window.devicePixelRatio || 1;
        const maxArea = window.innerWidth * dpr * window.innerHeight * dpr * 0.75;
        const nodes = [];
        const seen = {};
        const list = document.querySelectorAll('flt-semantics');
        for (let i = 0; i < list.length; i++) {
          const el = list[i];
          const rawLabel = (el.getAttribute('aria-label') || el.innerText || '').trim();
          const r = el.getBoundingClientRect();
          const w = Math.round(r.width * dpr);
          const h = Math.round(r.height * dpr);
          const onScreen = r.left >= -2 && r.right <= window.innerWidth + 2 && r.top >= -2 && r.bottom <= window.innerHeight + 2;
          if (rawLabel && w > 0 && h > 0 && onScreen && (w * h) < maxArea) {
            const label = rawLabel.length > 120 ? rawLabel.slice(0, 120) : rawLabel;
            const cx = Math.round((r.left + r.width / 2) * dpr);
            const cy = Math.round((r.top + r.height / 2) * dpr);
            const k = label + '@' + cx + ',' + cy;
            if (!seen[k]) {
              seen[k] = true;
              nodes.push({ label: label, cx: cx, cy: cy, w: w, h: h });
            }
          }
        }
        const media = window.epMediaElements.map(function (el) {
          return {
            src: el.currentSrc || el.src || '',
            time: Number((el.currentTime || 0).toFixed(2)),
            dur: Number((el.duration || 0).toFixed(2)),
            rate: el.playbackRate || 1.0,
            paused: !!el.paused
          };
        });
        const out = JSON.stringify({
          bootComplete: !!window.englishpodBootComplete,
          bootError: window.englishpodBootError || null,
          bridge: window.epBridgeState || null,
          dpr: dpr,
          vw: window.innerWidth,
          vh: window.innerHeight,
          media: media,
          nodes: nodes
        });
        const tagId = String(Date.now() % 1000000);
        const chunkLen = 1200;
        const total = Math.max(1, Math.ceil(out.length / chunkLen));
        for (let p = 0; p < total; p++) {
          console.log('[EP_STATE_CHUNK:' + tagId + ':' + p + '/' + total + ']' + out.slice(p * chunkLen, (p + 1) * chunkLen));
        }
        return 'ok:' + tagId + ':' + total;
      };
    })();
  </script>
</head>
<body>
  <script src="flutter_bootstrap.js" async></script>
</body>
</html>
"""


def replace_once(text: str, target: str, replacement: str, label: str) -> str:
    count = text.count(target)
    if count != 1:
        raise RuntimeError(f'Patch {label!r} expected 1 match, found {count}')
    return text.replace(target, replacement, 1)


def replace_exact_n(text: str, target: str, replacement: str, expected: int, label: str) -> str:
    count = text.count(target)
    if count != expected:
        raise RuntimeError(f'Patch {label!r} expected {expected} matches, found {count}')
    return text.replace(target, replacement)


def patch_staged_app(stage_dir: Path) -> None:
    main_dart = stage_dir / 'lib' / 'main.dart'
    src = main_dart.read_text(encoding='utf-8')

    # 2.0 Add JS interop imports & disable permanent DOM semantics tree for 120fps scrolling
    src = replace_once(
        src,
        "import 'dart:async';\n"
        "import 'dart:convert';\n"
        "import 'dart:math' as math;\n"
        "import 'dart:ui' as ui;",
        "import 'dart:async';\n"
        "import 'dart:convert';\n"
        "import 'dart:js_interop';\n"
        "import 'dart:js_interop_unsafe';\n"
        "import 'dart:math' as math;\n"
        "import 'dart:ui' as ui;",
        'js_interop_imports',
    )
    src = replace_once(
        src,
        "  if (kIsWeb) SemanticsBinding.instance.ensureSemantics();",
        "  // Semantics disabled by default on ArkWeb for 120fps CanvasKit scrolling; enabled on-demand via epSendCommand('semantics').",
        'disable_permanent_semantics',
    )

    # 2a. Force 100% genuine mobile UI & mobile playback pipeline (_useWeb => false)
    src = replace_once(
        src,
        'bool get _useWeb => (kIsWeb && !isHarmonyHost) || widget.webPlayer != null;',
        'bool get _useWeb => widget.webPlayer != null;',
        'force_mobile_ui',
    )

    # 2b. Replace '.SF Pro Display' with bundled offline 'Roboto' font
    src = replace_exact_n(
        src,
        "fontFamily: '.SF Pro Display',",
        "fontFamily: 'Roboto',",
        2,
        'font_family_roboto',
    )

    # 2d. Guard _wakelockChannel calls for theme override against MissingPluginException
    src = replace_once(
        src,
        "      unawaited(_wakelockChannel.invokeMethod('syncThemeOverride', {\n"
        "        'preference': nextPref.name,\n"
        "      }));",
        "      unawaited(_wakelockChannel.invokeMethod<void>('syncThemeOverride', {\n"
        "        'preference': nextPref.name,\n"
        "      }).catchError((_) {}));",
        'guard_theme_override_1',
    )
    src = replace_once(
        src,
        "      unawaited(_wakelockChannel.invokeMethod('syncThemeOverride', {\n"
        "        'preference': 'system',\n"
        "      }));",
        "      unawaited(_wakelockChannel.invokeMethod<void>('syncThemeOverride', {\n"
        "        'preference': 'system',\n"
        "      }).catchError((_) {}));",
        'guard_theme_override_2',
    )

    # 2e. Disable Flutter internal splash (rendered natively in ArkUI), remove swipe-back haptic, add [EP_BRIDGE] + JS command bridge
    src = replace_once(
        src,
        "  bool _isSplashActive = true;",
        "  bool _isSplashActive = false;",
        'disable_flutter_splash_flag',
    )
    src = replace_once(
        src,
        "    if (shouldCompletePop) {\n"
        "      HapticFeedback.lightImpact();\n"
        "      setState(() {\n"
        "        _isInteractivePopActive = false;\n"
        "        _activeScreen = 'library';\n"
        "      });",
        "    if (shouldCompletePop) {\n"
        "      setState(() {\n"
        "        _isInteractivePopActive = false;\n"
        "        _activeScreen = 'library';\n"
        "      });",
        'remove_swipe_back_haptic',
    )
    src = replace_once(
        src,
        "    _splashAnimationController.forward();",
        "    globalContext.setProperty(\n"
        "      'epDispatchCommand'.toJS,\n"
        "      ((JSString jsCmd) {\n"
        "        _handleHarmonyCommand(jsCmd.toDart);\n"
        "      }).toJS,\n"
        "    );",
        'register_js_command_bridge',
    )
    # Remove scroll setState storm in _start5sReturnBanner
    src = replace_once(
        src,
        "  void _start5sReturnBanner() {\n"
        "    _returnCountdownTimer?.cancel();\n"
        "    setState(() {\n"
        "      _showReturnBanner = true;\n"
        "      _returnCountdown = 5;\n"
        "    });",
        "  void _start5sReturnBanner() {\n"
        "    _returnCountdownTimer?.cancel();\n"
        "    if (!_showReturnBanner || _returnCountdown != 5) {\n"
        "      setState(() {\n"
        "        _showReturnBanner = true;\n"
        "        _returnCountdown = 5;\n"
        "      });\n"
        "    }",
        'avoid_scroll_setstate_storm',
    )
    src = replace_once(
        src,
        "  AppLifecycleState _appLifecycleState = AppLifecycleState.resumed;\n"
        "  bool _lastKeepScreenOnApplied = false;",
        "  AppLifecycleState _appLifecycleState = AppLifecycleState.resumed;\n"
        "  bool _lastKeepScreenOnApplied = false;\n"
        "  String _lastHarmonyBridgeJson = '';",
        'bridge_field',
    )
    src = replace_once(
        src,
        "  @override\n"
        "  Widget build(BuildContext context) {\n"
        "    final p = _paletteFor(context);",
        "  void _handleHarmonyCommand(String cmd) {\n"
        "    if (!mounted) return;\n"
        "    if (cmd == 'back') {\n"
        "      final nav = Navigator.maybeOf(context);\n"
        "      if (nav != null && nav.canPop()) {\n"
        "        nav.pop();\n"
        "        return;\n"
        "      }\n"
        "      if (_activeScreen == 'player') {\n"
        "        _returnToLibraryScreen();\n"
        "      }\n"
        "      return;\n"
        "    }\n"
        "    if (cmd == 'play') {\n"
        "      unawaited(_safePlay());\n"
        "      return;\n"
        "    }\n"
        "    if (cmd == 'pause') {\n"
        "      unawaited(_globalPlayer.pause());\n"
        "      return;\n"
        "    }\n"
        "    if (cmd == 'next') {\n"
        "      _nextSentence();\n"
        "      return;\n"
        "    }\n"
        "    if (cmd == 'prev') {\n"
        "      _prevSentence();\n"
        "      return;\n"
        "    }\n"
        "    if (cmd.startsWith('seek:')) {\n"
        "      final sec = double.tryParse(cmd.substring(5));\n"
        "      if (sec != null && sec.isFinite) {\n"
        "        unawaited(_globalPlayer.seek(Duration(milliseconds: (sec * 1000).round())));\n"
        "      }\n"
        "      return;\n"
        "    }\n"
        "    if (cmd == 'semantics') {\n"
        "      SemanticsBinding.instance.ensureSemantics();\n"
        "      setState(() {});\n"
        "      return;\n"
        "    }\n"
        "  }\n\n"
        "  @override\n"
        "  Future<bool> didPopRoute() async {\n"
        "    if (_activeScreen == 'player') {\n"
        "      _returnToLibraryScreen();\n"
        "      return true;\n"
        "    }\n"
        "    return super.didPopRoute();\n"
        "  }\n\n"
        "  @override\n"
        "  Widget build(BuildContext context) {\n"
        "    final p = _paletteFor(context);\n"
        "    final curLesson = _currentLesson;\n"
        "    final lessonNumStr = curLesson != null ? curLesson.lessonNumber.toString().padLeft(2, '0') : '01';\n"
        "    final lessonTitle = curLesson != null ? '$lessonNumStr · ${curLesson.title}' : 'EnglishPod';\n"
        "    final lessonSub = curLesson != null ? '${curLesson.level} (${_currentTrack == 'dg' ? 'Dialogue' : 'Podcast'})' : 'Elementary (Podcast)';\n"
        "    final bridgeJson = jsonEncode({\n"
        "      'screen': _activeScreen,\n"
        "      'ready': _lessons.isNotEmpty,\n"
        "      'isDark': p.isDark,\n"
        "      'themePref': _themePreference.name,\n"
        "      'isPlaying': _isPlaying,\n"
        "      'tab': _playerTab,\n"
        "      'track': _currentTrack,\n"
        "      'lesson': curLesson?.lessonId ?? _lastPlayedLessonId,\n"
        "      'filter': _libraryFilter,\n"
        "      'title': lessonTitle,\n"
        "      'subtitle': lessonSub,\n"
        "      'sentence': _currentLiveSentenceText,\n"
        "      'pos': double.parse(_currentPositionSec.toStringAsFixed(2)),\n"
        "      'dur': double.parse(_durationSec.toStringAsFixed(2)),\n"
        "      'speed': _currentSpeed,\n"
        "    });\n"
        "    if (bridgeJson != _lastHarmonyBridgeJson) {\n"
        "      _lastHarmonyBridgeJson = bridgeJson;\n"
        "      // ignore: avoid_print\n"
        "      print('[EP_BRIDGE]$bridgeJson');\n"
        "    }",
        'bridge_emitter_and_did_pop',
    )

    # 2f. Replace Stage Box emoji prefixes with crisp Inter vector symbols (zero offline font fetches)
    src = replace_once(src, "badgeText: '🎭 FULL DIALOGUE TRACK',", "badgeText: '● FULL DIALOGUE TRACK',", 'stage_emoji_1')
    src = replace_once(src, "customBadge[i] = '📌 ${txt.toUpperCase()}';", "customBadge[i] = '◆ ${txt.toUpperCase()}';", 'stage_emoji_2')
    src = replace_once(src, "badge = '📌 DIALOGUE · SCENE';", "badge = '◆ DIALOGUE · SCENE';", 'stage_emoji_3')
    src = replace_exact_n(src, "'💡 EXAMPLES · IN ACTION'", "'★ EXAMPLES · IN ACTION'", 3, 'stage_emoji_4')

    main_dart.write_text(src, encoding='utf-8')
    (stage_dir / 'web' / 'index.html').write_text(CLEAN_INDEX_HTML, encoding='utf-8')


def ensure_fonts_and_strip(web_build_dir: Path) -> None:
    # Ensure full Latin + symbol coverage (including ↓, ✓, ●, ◆, ★ and bold weights) offline
    font_candidates = (
        Path('/Applications/DevEco-Studio.app/Contents/jbr/Contents/Home/lib/fonts'),
        Path('/Volumes/DevEco-Studio/DevEco-Studio.app/Contents/jbr/Contents/Home/lib/fonts'),
    )
    src_font_dir = next((p for p in font_candidates if p.is_dir()), font_candidates[-1])
    fallback_dir = web_build_dir / 'assets' / 'fonts' / 'fallback'
    fallback_dir.mkdir(parents=True, exist_ok=True)
    for fname in ('Inter-Regular.otf', 'Inter-SemiBold.otf', 'Inter-Italic.otf', 'Inter-SemiBoldItalic.otf'):
        src = src_font_dir / fname
        if not src.exists():
            raise FileNotFoundError(f'Missing offline Inter font at {src}')
        shutil.copyfile(src, fallback_dir / fname)

    manifest_path = web_build_dir / 'assets' / 'FontManifest.json'
    manifest = [
        {
            'family': 'MaterialIcons',
            'fonts': [{'asset': 'fonts/MaterialIcons-Regular.otf'}],
        },
        {
            'family': 'Roboto',
            'fonts': [
                {'asset': 'fonts/fallback/Inter-Regular.otf', 'weight': 400},
                {'asset': 'fonts/fallback/Inter-SemiBold.otf', 'weight': 500},
                {'asset': 'fonts/fallback/Inter-SemiBold.otf', 'weight': 600},
                {'asset': 'fonts/fallback/Inter-SemiBold.otf', 'weight': 700},
                {'asset': 'fonts/fallback/Inter-Italic.otf', 'weight': 400, 'style': 'italic'},
                {'asset': 'fonts/fallback/Inter-SemiBoldItalic.otf', 'weight': 700, 'style': 'italic'},
            ],
        },
    ]
    cjk_font = web_build_dir / 'assets' / 'assets' / 'fonts' / 'EpCjkFallback.ttf'
    if cjk_font.is_file():
        manifest.append({
            'family': 'EpCjkFallback',
            'fonts': [{'asset': 'assets/fonts/EpCjkFallback.ttf'}],
        })
    manifest_path.write_text(json.dumps(manifest), encoding='utf-8')

    # Strip unneeded debug symbols, maps, and unused skwasm runtimes (keep canvaskit + chromium + webparagraph)
    for pattern in ('*.symbols', '*.map', '._*', '.DS_Store'):
        for p in web_build_dir.rglob(pattern):
            p.unlink()
    for fname in ('.last_build_id', 'flutter_service_worker.js'):
        f = web_build_dir / fname
        if f.exists():
            f.unlink()
    canvaskit_dir = web_build_dir / 'canvaskit'
    for unused in ('skwasm.js', 'skwasm.wasm', 'skwasm_heavy.js', 'skwasm_heavy.wasm', 'wimp.js', 'wimp.wasm'):
        target = canvaskit_dir / unused
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()


def main() -> None:
    if not FLUTTER_BIN.exists():
        raise FileNotFoundError(f'Flutter binary not found at {FLUTTER_BIN}')
    if STAGE_DIR.exists():
        shutil.rmtree(STAGE_DIR)

    print(f'==> Staging clean Flutter project from {FLUTTER_SOURCE_ROOT} into {STAGE_DIR}')
    stage_clean_flutter(FLUTTER_SOURCE_ROOT, STAGE_DIR)
    patch_staged_app(STAGE_DIR)

    print('==> Running flutter pub get --offline')
    pub_res = subprocess.run([str(FLUTTER_BIN), 'pub', 'get', '--offline'], cwd=STAGE_DIR)
    if pub_res.returncode != 0:
        print('==> Offline pub get failed; retrying online flutter pub get')
        subprocess.run([str(FLUTTER_BIN), 'pub', 'get'], cwd=STAGE_DIR, check=True)

    build_cmd = [str(FLUTTER_BIN), 'build', 'web', '--release', '--no-web-resources-cdn']
    if EP_SYNC_API_BASE:
        build_cmd.append(f'--dart-define=EP_SYNC_API_BASE={EP_SYNC_API_BASE}')
    print('==> Building Flutter CanvasKit Web bundle (--release --no-web-resources-cdn)')
    subprocess.run(
        build_cmd,
        cwd=STAGE_DIR,
        check=True,
    )

    built_web = STAGE_DIR / 'build' / 'web'
    ensure_fonts_and_strip(built_web)

    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(built_web, OUTPUT_DIR)

    if STAGE_DIR.exists():
        shutil.rmtree(STAGE_DIR)

    total_bytes = sum(p.stat().st_size for p in OUTPUT_DIR.rglob('*') if p.is_file())
    lesson_count = len(list((OUTPUT_DIR / 'assets' / 'assets' / 'lessons_safe').glob('lesson_*.json')))
    print(f'SUCCESS: Synced Flutter Web bundle to {OUTPUT_DIR} ({total_bytes / (1024*1024):.1f} MB, {lesson_count} lessons)')


if __name__ == '__main__':
    main()

import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:audio_service/audio_service.dart';
import 'package:audio_session/audio_session.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:just_audio/just_audio.dart';
import 'package:scrollable_positioned_list/scrollable_positioned_list.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'models/lesson_models.dart';
import 'services/audio_error_policy.dart';
import 'services/sentence_audio_handler.dart';
import 'services/transcript_navigation.dart';
import 'services/web_contract_player.dart';
import 'services/web_contract_audio.dart';
import 'services/playback_platform_web.dart'
    if (dart.library.io) 'services/playback_platform_native.dart' as playback_platform;

enum AppThemePreference {
  system,
  light,
  dark,
}

late SentenceAudioHandler _audioHandler;
final AudioPlayer _globalPlayer = AudioPlayer();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (kIsWeb) SemanticsBinding.instance.ensureSemantics();
  _audioHandler = SentenceAudioHandler(_globalPlayer);

  // Pre-read stored theme preference synchronously so frame 1 is 100% theme-accurate
  String? savedThemeStr;
  try {
    final prefs = await SharedPreferences.getInstance();
    savedThemeStr = prefs.getString('user_theme_preference');
  } catch (_) {
    if (!kIsWeb) rethrow;
    // Web can continue with in-memory learning state when storage is blocked.
  }
  final AppThemePreference initialPref;
  if (savedThemeStr == 'dark') {
    initialPref = AppThemePreference.dark;
  } else if (savedThemeStr == 'light') {
    initialPref = AppThemePreference.light;
  } else {
    initialPref = AppThemePreference.system;
  }

  runApp(EnglishPodTrancyApp(initialPreference: initialPref));
  if (!kIsWeb) unawaited(_initAudioServicesInBackground());
}

Future<void> _initAudioServicesInBackground() async {
  try {
    final session = await AudioSession.instance;
    await session.configure(const AudioSessionConfiguration.music());
  } catch (_) {}
  try {
    final handler = await AudioService.init(
      builder: () => _audioHandler,
      config: const AudioServiceConfig(
        androidNotificationChannelId: 'com.englishpod.trancy.channel.audio',
        androidNotificationChannelName: 'EnglishPod Sentence Playback',
        androidNotificationOngoing: true,
        androidNotificationIcon: 'drawable/ic_stat_smiley',
      ),
    );
    _audioHandler = handler;
  } catch (_) {}
}

/// System-Adaptive Dual Theme Palette (Dark Cocoon & Claude Paper Mode)
/// with Edge-to-Edge Top Deck Elevation, Stage Container Boxes, Pure Accent
/// Vocab Highlights, and Metrolist Player Controls.
class AppPalette {
  final bool isDark;
  final Color bgWell;
  final Color deckBg;
  final List<Color> deckGradientColors;
  final Color deckBorder;
  final Color bottomBg;
  final Color surface1;
  final Color surface2;
  final Color surface3;
  final Color surfaceInset;
  final Color stageBoxBg;
  final Color stageBoxBorder;
  final Color border;
  final Color metroOutline;
  final Color metroBtnBg;
  final Color textPrimary;
  final Color textPassed;
  final Color textUpcoming;
  final Color accent;
  final Color accentFg;
  final Color accentSoft;
  final Color vocabHlUnplayed;
  final Color vocabHlPassed;
  final Color vocabHlActive;
  final Color locateBarBg;
  final Color locateBarBorder;
  final Color scrollbarThumb;

  const AppPalette({
    required this.isDark,
    required this.bgWell,
    required this.deckBg,
    required this.deckGradientColors,
    required this.deckBorder,
    required this.bottomBg,
    required this.surface1,
    required this.surface2,
    required this.surface3,
    required this.surfaceInset,
    required this.stageBoxBg,
    required this.stageBoxBorder,
    required this.border,
    required this.metroOutline,
    required this.metroBtnBg,
    required this.textPrimary,
    required this.textPassed,
    required this.textUpcoming,
    required this.accent,
    required this.accentFg,
    required this.accentSoft,
    required this.vocabHlUnplayed,
    required this.vocabHlPassed,
    required this.vocabHlActive,
    required this.locateBarBg,
    required this.locateBarBorder,
    required this.scrollbarThumb,
  });

  static const dark = AppPalette(
    isDark: true,
    bgWell: Color(0xFF070709),
    deckBg: Color(0xFF13151C),
    deckGradientColors: [
      Color(0xFF1A2E24),
      Color(0xFF141720),
      Color(0xFF121318),
    ],
    deckBorder: Color(0x1FFFFFFF),
    bottomBg: Color(0xFA0A0B0F),
    surface1: Color(0xFF14151B),
    surface2: Color(0xFF1F2029),
    surface3: Color(0xFF282A36),
    surfaceInset: Color(0x0EFFFFFF),
    stageBoxBg: Color(0x0CFFFFFF),
    stageBoxBorder: Color(0x1CFFFFFF),
    border: Color(0x14FFFFFF),
    metroOutline: Color(0x26FFFFFF),
    metroBtnBg: Color(0x08FFFFFF),
    textPrimary: Color(0xFFFFFFFF),
    textPassed: Color(0x73FFFFFF),
    textUpcoming: Color(0x38FFFFFF),
    accent: Color(0xFF1ED760),
    accentFg: Color(0xFF060608),
    accentSoft: Color(0x291ED760),
    vocabHlUnplayed: Color(0x801ED760),
    vocabHlPassed: Color(0xBF1ED760),
    vocabHlActive: Color(0xFF1ED760),
    locateBarBg: Color(0xF714261C),
    locateBarBorder: Color(0x731ED760),
    scrollbarThumb: Color(0x2EFFFFFF),
  );

  static const paper = AppPalette(
    isDark: false,
    bgWell: Color(0xFFF2EDE2),
    deckBg: Color(0xFFFAF8F5),
    deckGradientColors: [
      Color(0xFFF5E3DC),
      Color(0xFFFCF9F4),
      Color(0xFFFAF8F5),
    ],
    deckBorder: Color(0x1A141413),
    bottomBg: Color(0xFAFAF8F5),
    surface1: Color(0xFFFAF8F5),
    surface2: Color(0xFFE6E0D4),
    surface3: Color(0xFFDAD2C3),
    surfaceInset: Color(0x0A141413),
    stageBoxBg: Color(0xFFE9E2D4),
    stageBoxBorder: Color(0x40CC785C),
    border: Color(0x14141413),
    metroOutline: Color(0x29141413),
    metroBtnBg: Color(0x08141413),
    textPrimary: Color(0xFF141413),
    textPassed: Color(0x7A141413),
    textUpcoming: Color(0x3D141413),
    accent: Color(0xFFCC785C),
    accentFg: Color(0xFFFFFFFF),
    accentSoft: Color(0x26CC785C),
    vocabHlUnplayed: Color(0x8CCC785C),
    vocabHlPassed: Color(0xCCCC785C),
    vocabHlActive: Color(0xFFCC785C),
    locateBarBg: Color(0xF7F7EBE6),
    locateBarBorder: Color(0x73CC785C),
    scrollbarThumb: Color(0x2E141413),
  );
}

/// Custom Metrolist Vertical Pill Slider Thumb Shape (`|`)
class _MetrolistVerticalThumbShape extends SliderComponentShape {
  final double width;
  final double height;
  final Color borderColor;

  const _MetrolistVerticalThumbShape({
    this.width = 4.0,
    this.height = 18.0,
    required this.borderColor,
  });

  @override
  Size getPreferredSize(bool isEnabled, bool isDiscrete) => Size(width, height);

  @override
  void paint(
    PaintingContext context,
    Offset center, {
    required Animation<double> activationAnimation,
    required Animation<double> enableAnimation,
    required bool isDiscrete,
    required TextPainter labelPainter,
    required RenderBox parentBox,
    required SliderThemeData sliderTheme,
    required TextDirection textDirection,
    required double value,
    required double textScaleFactor,
    required Size sizeWithOverflow,
  }) {
    final Canvas canvas = context.canvas;
    final RRect outerRRect = RRect.fromRectAndRadius(
      Rect.fromCenter(center: center, width: width + 4, height: height + 4),
      const Radius.circular(9999),
    );
    canvas.drawRRect(outerRRect, Paint()..color = borderColor);

    final RRect thumbRRect = RRect.fromRectAndRadius(
      Rect.fromCenter(center: center, width: width, height: height),
      const Radius.circular(9999),
    );
    canvas.drawRRect(
      thumbRRect,
      Paint()..color = sliderTheme.thumbColor ?? Colors.white,
    );
  }
}

/// Metadata describing whether a transcript segment belongs to a non-host
/// Stage Container Box (`Dialogue`, `Examples`, or `Phrase / Section`).
class _StageGroupInfo {
  final int boxGroupId;
  final String kind; // 'dialogue', 'example', 'phrase'
  final String badgeText;
  final String subText;
  final bool isFirstInBox;
  final bool isLastInBox;

  const _StageGroupInfo({
    required this.boxGroupId,
    required this.kind,
    required this.badgeText,
    required this.subText,
    required this.isFirstInBox,
    required this.isLastInBox,
  });
}

/// Material 3 Official Motion + `transitions.dev` Motion Tokens
class _M3Motion {
  /// `transitions.dev` `--ease-smooth-out: cubic-bezier(0.22, 1, 0.36, 1)`
  /// Used for P4 card resize, P8 page slide, P16 sliding tabs, P21 accordion, P22 toast
  static const Cubic easeSmoothOut = Cubic(0.22, 1.0, 0.36, 1.0);

  /// `transitions.dev` `--ease-bounce: cubic-bezier(0.34, 1.36, 0.64, 1)`
  /// Used for tactile spring release, active sentence accent bar, and badge pop
  static const Cubic easeBounce = Cubic(0.34, 1.38, 0.64, 1.0);

  /// Material 3 Emphasized Accelerate (`cubic-bezier(0.3, 0.0, 0.8, 0.15)`)
  static const Cubic m3EmphasizedAccelerate = Cubic(0.3, 0.0, 0.8, 0.15);

  static const Duration durMicro = Duration(milliseconds: 100);
  static const Duration durQuick = Duration(milliseconds: 160);
  static const Duration durFast = Duration(milliseconds: 250);
  static const Duration durMedium = Duration(milliseconds: 320);
  static const Duration durScroll = Duration(milliseconds: 380);
}

/// Tactile press wrapper:
/// - For pure tap buttons (`onLongPress == null`), provides subtle tap feedback.
/// - For elements supporting long-press (`onLongPress != null`), triggers `onTap` and `onLongPress`
///   with haptic feedback only and ZERO visual animation or element scaling.
class _M3TactileScale extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final double pressedScale;

  const _M3TactileScale({
    required this.child,
    this.onTap,
    this.onLongPress,
    this.pressedScale = 0.94,
  });

  @override
  State<_M3TactileScale> createState() => _M3TactileScaleState();
}

class _M3TactileScaleState extends State<_M3TactileScale> {
  bool _pressed = false;

  void _setPressed(bool val) {
    if (_pressed == val || !mounted) return;
    setState(() => _pressed = val);
  }

  @override
  Widget build(BuildContext context) {
    final bool allowTapScale = widget.onTap != null;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: allowTapScale ? (_) => _setPressed(true) : null,
      onTapUp: allowTapScale ? (_) => _setPressed(false) : null,
      onTapCancel: allowTapScale ? () => _setPressed(false) : null,
      onTap: widget.onTap == null
          ? null
          : () {
              HapticFeedback.selectionClick();
              widget.onTap!();
            },
      onLongPressDown: allowTapScale ? (_) => _setPressed(true) : null,
      onLongPressStart: allowTapScale ? (_) => _setPressed(true) : null,
      onLongPressEnd: allowTapScale ? (_) => _setPressed(false) : null,
      onLongPressCancel: allowTapScale ? () => _setPressed(false) : null,
      onLongPressUp: allowTapScale ? () => _setPressed(false) : null,
      onLongPress: widget.onLongPress == null
          ? null
          : () {
              widget.onLongPress!();
            },
      child: allowTapScale
          ? AnimatedScale(
              scale: _pressed ? widget.pressedScale : 1.0,
              duration: _pressed
                  ? _M3Motion.durMicro
                  : const Duration(milliseconds: 260),
              curve: _pressed ? Curves.easeOut : _M3Motion.easeBounce,
              child: widget.child,
            )
          : widget.child,
    );
  }
}

enum _HeroHoldStage {
  idle,
  pendingTap,
  inProgress,
  complete,
  confirming,
}

/// Custom chunky rounded Replay icon (`↺`, 21x21, 2.85px stroke + rounded arrow head)
/// matching the visual weight of `Play`/`Pause` icons and `FontWeight.w800` text.
class _ChunkyReplayIconPainter extends CustomPainter {
  final Color color;

  const _ChunkyReplayIconPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final sx = size.width / 24.0;
    final sy = size.height / 24.0;
    canvas.save();
    canvas.scale(sx, sy);

    // Arc: M12 5.25 A6.75 6.75 0 1 1 5.65 14.3
    final arcPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.85
      ..strokeCap = StrokeCap.round
      ..isAntiAlias = true;

    final rect = Rect.fromCircle(center: const Offset(12.0, 12.0), radius: 6.75);
    const startAngle = -math.pi / 2; // 12 o'clock (12, 5.25)
    const sweepAngle = 1.62 * math.pi; // ~292 degrees clockwise to ~8:30 o'clock
    canvas.drawArc(rect, startAngle, sweepAngle, false, arcPaint);

    // Arrowhead at top pointing left: M12.4 1.8 L7.6 5.25 L12.4 8.7 Z
    final arrowPath = Path()
      ..moveTo(12.4, 1.8)
      ..lineTo(7.6, 5.25)
      ..lineTo(12.4, 8.7)
      ..close();

    final fillPaint = Paint()
      ..color = color
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;
    final strokePaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6
      ..strokeJoin = StrokeJoin.round
      ..strokeCap = StrokeCap.round
      ..isAntiAlias = true;

    canvas.drawPath(arrowPath, fillPaint);
    canvas.drawPath(arrowPath, strokePaint);
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _ChunkyReplayIconPainter oldDelegate) =>
      oldDelegate.color != color;
}

/// Custom chunky rounded Play Triangle icon (`▶`) for `New` unplayed episodes
/// inside the `36x36` Course List index badge.
class _ChunkyPlayTrianglePainter extends CustomPainter {
  final Color color;

  const _ChunkyPlayTrianglePainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final sx = size.width / 24.0;
    final sy = size.height / 24.0;
    canvas.save();
    canvas.scale(sx, sy);

    final path = Path()
      ..moveTo(7.4, 5.5)
      ..lineTo(7.4, 18.5)
      ..lineTo(18.2, 12.0)
      ..close();

    final fillPaint = Paint()
      ..color = color
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;
    final strokePaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.6
      ..strokeJoin = StrokeJoin.round
      ..strokeCap = StrokeCap.round
      ..isAntiAlias = true;

    canvas.drawPath(path, fillPaint);
    canvas.drawPath(path, strokePaint);
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _ChunkyPlayTrianglePainter oldDelegate) =>
      oldDelegate.color != color;
}

/// Kobra Input-OTP inspired staggered 3D perspective character flip
/// for `"Hold"` ↔ `"Release"`.
/// - When `entryEpoch` increments (entering Hold from Idle), `"Hold"` staggers in as the first
///   4 characters (`charIndices 0..3`) of the full sentence (`Hold to replay` / `Hold to start`).
/// - When `word` changes from `"Hold"` to `"Release"` at 100% (`entryEpoch` unchanged),
///   ONLY `"Hold"` → `"Release"` flips in place while the suffix (`_KobraStaggeredSuffixText`) stays locked!
class _KobraPrefixWordSwitcher extends StatefulWidget {
  final String word;
  final TextStyle style;
  final int entryEpoch;
  final int startCharIndex;

  const _KobraPrefixWordSwitcher({
    required this.word,
    required this.style,
    this.entryEpoch = 0,
    this.startCharIndex = 0,
  });

  @override
  State<_KobraPrefixWordSwitcher> createState() =>
      _KobraPrefixWordSwitcherState();
}

class _KobraPrefixWordSwitcherState extends State<_KobraPrefixWordSwitcher>
    with TickerProviderStateMixin {
  late String _currentWord;
  String? _exitingWord;
  int _activeStartCharIndex = 0;
  late AnimationController _enterCtrl;
  late AnimationController _exitCtrl;

  @override
  void initState() {
    super.initState();
    _currentWord = widget.word;
    _activeStartCharIndex = widget.startCharIndex;
    _enterCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 380),
    )..forward();
    _exitCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 240),
    );
  }

  @override
  void didUpdateWidget(covariant _KobraPrefixWordSwitcher oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.entryEpoch != widget.entryEpoch) {
      // Fresh entry into Hold: whole sentence staggers in from left to right without an exiting ghost
      _exitingWord = null;
      _currentWord = widget.word;
      _activeStartCharIndex = widget.startCharIndex;
      _exitCtrl.value = 1.0;
      _enterCtrl.forward(from: 0.0);
    } else if (oldWidget.word != widget.word) {
      // Reached 100% ("Hold" -> "Release"): flip prefix word in place!
      _exitingWord = _currentWord;
      _currentWord = widget.word;
      _activeStartCharIndex = 0;
      _exitCtrl.forward(from: 0.0);
      _enterCtrl.forward(from: 0.0);
    }
  }

  @override
  void dispose() {
    _enterCtrl.dispose();
    _exitCtrl.dispose();
    super.dispose();
  }

  Widget _buildStaggeredWord(
    String text,
    AnimationController ctrl, {
    required bool isEntering,
    required int startIdx,
  }) {
    final chars = text.split('');
    final int n = chars.length;
    return AnimatedBuilder(
      animation: ctrl,
      builder: (context, _) {
        final double rawT = ctrl.value;
        if (!isEntering && rawT >= 0.999) {
          return const SizedBox.shrink();
        }
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(n, (i) {
            final int globalIdx = startIdx + i;
            final double delayFrac =
                (globalIdx * (isEntering ? 0.036 : 0.045)).clamp(0.0, 0.56);
            final double spanFrac = 1.0 - delayFrac;
            final double localLinear =
                ((rawT - delayFrac) / spanFrac).clamp(0.0, 1.0);

            if (isEntering) {
              final double curved =
                  _M3Motion.easeBounce.transform(localLinear);
              final double opacity = localLinear.clamp(0.0, 1.0);
              final double dy = (1.0 - curved) * 6.5;
              final double rotX = (1.0 - curved) * (-40.0 * math.pi / 180.0);
              final double scale = 0.90 + 0.10 * curved;

              final matrix = Matrix4.identity()
                ..setEntry(3, 2, 0.004)
                ..translateByDouble(0.0, dy, 0.0, 1.0)
                ..rotateX(rotX)
                ..scaleByDouble(scale, scale, 1.0, 1.0);

              return Opacity(
                opacity: opacity,
                child: Transform(
                  alignment: Alignment.bottomCenter,
                  transform: matrix,
                  child: Text(
                    chars[i],
                    style: widget.style,
                    textHeightBehavior: const TextHeightBehavior(
                      applyHeightToFirstAscent: false,
                      applyHeightToLastDescent: false,
                    ),
                  ),
                ),
              );
            } else {
              final double curved =
                  _M3Motion.easeSmoothOut.transform(localLinear);
              final double opacity = (1.0 - curved).clamp(0.0, 1.0);
              final double dy = -4.5 * curved;
              final double rotX = curved * (26.0 * math.pi / 180.0);
              final double scale = 1.0 - 0.06 * curved;

              final matrix = Matrix4.identity()
                ..setEntry(3, 2, 0.004)
                ..translateByDouble(0.0, dy, 0.0, 1.0)
                ..rotateX(rotX)
                ..scaleByDouble(scale, scale, 1.0, 1.0);

              return Opacity(
                opacity: opacity,
                child: Transform(
                  alignment: Alignment.bottomCenter,
                  transform: matrix,
                  child: Text(
                    chars[i],
                    style: widget.style,
                    textHeightBehavior: const TextHeightBehavior(
                      applyHeightToFirstAscent: false,
                      applyHeightToLastDescent: false,
                    ),
                  ),
                ),
              );
            }
          }),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return OverflowBox(
      alignment: Alignment.centerRight,
      minWidth: 0.0,
      maxWidth: double.infinity,
      child: Stack(
        alignment: Alignment.centerRight,
        clipBehavior: Clip.none,
        children: [
          if (_exitingWord != null)
            _buildStaggeredWord(
              _exitingWord!,
              _exitCtrl,
              isEntering: false,
              startIdx: 0,
            ),
          _buildStaggeredWord(
            _currentWord,
            _enterCtrl,
            isEntering: true,
            startIdx: _activeStartCharIndex,
          ),
        ],
      ),
    );
  }
}

/// CustomPainter for the Sinja Asymmetric Hold-to-Replay / Hold-to-Start sweep filler:
/// - Driven directly by `Listenable.merge([fillListenable, confirmListenable])` inside a permanent `Positioned.fill`.
/// - Bleeds `2px` past the clip bounds when `conf <= 0.001` (left) or `prog >= 0.999` (right)
///   so `ClipRRect` / `Clip.antiAlias` curved corners on the far right (`最右侧`) and far left
///   are 100% covered with zero subpixel gap.
/// - Draws the `1.5px` leading-edge line while actively sweeping and smoothly dissolves it
///   as the fill reaches `100%`, leaving zero stuck border strip on the far right edge.
class _SinjaHoldFillerPainter extends CustomPainter {
  final Animation<double> fillListenable;
  final Animation<double> confirmListenable;
  final Color fillerBg;
  final Color fillerEdge;

  _SinjaHoldFillerPainter({
    required this.fillListenable,
    required this.confirmListenable,
    required this.fillerBg,
    required this.fillerEdge,
  }) : super(repaint: Listenable.merge([fillListenable, confirmListenable]));

  @override
  void paint(Canvas canvas, Size size) {
    final double prog = fillListenable.value.clamp(0.0, 1.0);
    if (prog <= 0.001 || size.width <= 0.0 || size.height <= 0.0) {
      return;
    }
    final double conf = confirmListenable.value.clamp(0.0, 1.0);
    final double leftX = conf * size.width;
    final double rightX = prog * size.width;
    if (rightX - leftX <= 0.1) {
      return;
    }

    final double drawLeft = conf <= 0.001 ? -2.0 : leftX;
    final double drawRight = prog >= 0.999 ? size.width + 2.0 : rightX;
    final Rect fillRect = Rect.fromLTRB(
      drawLeft,
      -2.0,
      drawRight,
      size.height + 2.0,
    );

    canvas.drawRect(
      fillRect,
      Paint()
        ..color = fillerBg
        ..style = PaintingStyle.fill
        ..isAntiAlias = true,
    );

    if (prog < 0.995) {
      final double edgeFade =
          prog <= 0.955 ? 1.0 : ((0.995 - prog) / 0.04).clamp(0.0, 1.0);
      final double edgeLeft = (rightX - 1.5).clamp(drawLeft, rightX);
      if (rightX > edgeLeft && edgeFade > 0.01) {
        canvas.drawRect(
          Rect.fromLTRB(edgeLeft, -2.0, rightX, size.height + 2.0),
          Paint()
            ..color = fillerEdge.withValues(alpha: fillerEdge.a * edgeFade)
            ..style = PaintingStyle.fill
            ..isAntiAlias = true,
        );
      }
    }
  }

  @override
  bool shouldRepaint(covariant _SinjaHoldFillerPainter oldDelegate) {
    return oldDelegate.fillerBg != fillerBg ||
        oldDelegate.fillerEdge != fillerEdge ||
        oldDelegate.fillListenable != fillListenable ||
        oldDelegate.confirmListenable != confirmListenable;
  }
}

/// Companion Kobra staggered character widget for the locked two-word suffix (`"to"` + `"replay"/"start"`):
/// - Uses explicit, identical `SizedBox(width: wordGap)` before `"to"` and before `"replay"/"start"`
///   so the spacing between `Hold/Release` ↔ `to` and `to` ↔ `replay/start` is 100% equal in physical pixels.
/// - Keeps a constant widget tree depth (`Opacity -> Transform -> Text`) across all `rawT` values
///   so Flutter never remounts characters when the entrance animation finishes.
class _KobraStaggeredSuffixText extends StatefulWidget {
  final String word1;
  final String word2;
  final double wordGap;
  final TextStyle style;
  final int entryEpoch;
  final int startCharIndex;

  const _KobraStaggeredSuffixText({
    required this.word1,
    required this.word2,
    required this.wordGap,
    required this.style,
    required this.entryEpoch,
    this.startCharIndex = 4,
  });

  @override
  State<_KobraStaggeredSuffixText> createState() =>
      _KobraStaggeredSuffixTextState();
}

class _KobraStaggeredSuffixTextState extends State<_KobraStaggeredSuffixText>
    with SingleTickerProviderStateMixin {
  late AnimationController _enterCtrl;

  @override
  void initState() {
    super.initState();
    _enterCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 380),
    )..forward();
  }

  @override
  void didUpdateWidget(covariant _KobraStaggeredSuffixText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.entryEpoch != widget.entryEpoch) {
      _enterCtrl.forward(from: 0.0);
    }
  }

  @override
  void dispose() {
    _enterCtrl.dispose();
    super.dispose();
  }

  Widget _buildAnimatedChar(String ch, int globalIdx, double rawT) {
    final double delayFrac = (globalIdx * 0.036).clamp(0.0, 0.56);
    final double spanFrac = 1.0 - delayFrac;
    final double localLinear = ((rawT - delayFrac) / spanFrac).clamp(0.0, 1.0);
    final double curved = _M3Motion.easeBounce.transform(localLinear);
    final double opacity = localLinear.clamp(0.0, 1.0);
    final double dy = (1.0 - curved) * 6.5;
    final double rotX = (1.0 - curved) * (-40.0 * math.pi / 180.0);
    final double scale = 0.90 + 0.10 * curved;

    final matrix = Matrix4.identity()
      ..setEntry(3, 2, 0.004)
      ..translateByDouble(0.0, dy, 0.0, 1.0)
      ..rotateX(rotX)
      ..scaleByDouble(scale, scale, 1.0, 1.0);

    return Opacity(
      opacity: opacity,
      child: Transform(
        alignment: Alignment.bottomCenter,
        transform: matrix,
        child: Text(
          ch,
          style: widget.style,
          textHeightBehavior: const TextHeightBehavior(
            applyHeightToFirstAscent: false,
            applyHeightToLastDescent: false,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final chars1 = widget.word1.split('');
    final chars2 = widget.word2.split('');
    return AnimatedBuilder(
      animation: _enterCtrl,
      builder: (context, _) {
        final double rawT = _enterCtrl.value;
        final List<Widget> children = [
          SizedBox(width: widget.wordGap),
        ];
        for (int i = 0; i < chars1.length; i++) {
          children.add(
            _buildAnimatedChar(chars1[i], widget.startCharIndex + i, rawT),
          );
        }
        children.add(SizedBox(width: widget.wordGap));
        final int word2BaseIdx = widget.startCharIndex + chars1.length;
        for (int i = 0; i < chars2.length; i++) {
          children.add(
            _buildAnimatedChar(chars2[i], word2BaseIdx + i, rawT),
          );
        }
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: children,
        );
      },
    );
  }
}

/// Continuous Curvature Squircle Border (iOS Continuous Corners / Figma 60% Corner Smoothing):
/// Eliminates harsh C0 curvature discontinuities at the tangent junctions of standard
/// circular-arc rounded rectangles, delivering G2/C2 smooth continuous corner curves
/// without altering the visual corner curvature or peak radius.
class SmoothSquircleBorder extends OutlinedBorder {
  final double radius;
  final double cornerSmoothing;

  const SmoothSquircleBorder({
    super.side,
    required this.radius,
    this.cornerSmoothing = 0.6,
  });

  @override
  EdgeInsetsGeometry get dimensions => EdgeInsets.all(side.width);

  @override
  ShapeBorder scale(double t) {
    return SmoothSquircleBorder(
      side: side.scale(t),
      radius: radius * t,
      cornerSmoothing: cornerSmoothing,
    );
  }

  @override
  ShapeBorder? lerpFrom(ShapeBorder? a, double t) {
    if (a is SmoothSquircleBorder) {
      return SmoothSquircleBorder(
        side: BorderSide.lerp(a.side, side, t),
        radius: ui.lerpDouble(a.radius, radius, t) ?? radius,
        cornerSmoothing:
            ui.lerpDouble(a.cornerSmoothing, cornerSmoothing, t) ?? cornerSmoothing,
      );
    }
    return super.lerpFrom(a, t);
  }

  @override
  ShapeBorder? lerpTo(ShapeBorder? b, double t) {
    if (b is SmoothSquircleBorder) {
      return SmoothSquircleBorder(
        side: BorderSide.lerp(side, b.side, t),
        radius: ui.lerpDouble(radius, b.radius, t) ?? radius,
        cornerSmoothing:
            ui.lerpDouble(cornerSmoothing, b.cornerSmoothing, t) ?? cornerSmoothing,
      );
    }
    return super.lerpTo(b, t);
  }

  @override
  Path getInnerPath(Rect rect, {TextDirection? textDirection}) {
    return computePath(rect.deflate(side.width));
  }

  @override
  Path getOuterPath(Rect rect, {TextDirection? textDirection}) {
    return computePath(rect);
  }

  @override
  void paint(Canvas canvas, Rect rect, {TextDirection? textDirection}) {
    if (side.style == BorderStyle.none || side.width == 0.0) return;
    final paint = side.toPaint();
    final path = getOuterPath(rect, textDirection: textDirection);
    canvas.drawPath(path, paint);
  }

  @override
  SmoothSquircleBorder copyWith({
    BorderSide? side,
    double? radius,
    double? cornerSmoothing,
  }) {
    return SmoothSquircleBorder(
      side: side ?? this.side,
      radius: radius ?? this.radius,
      cornerSmoothing: cornerSmoothing ?? this.cornerSmoothing,
    );
  }

  Path computePath(Rect rect) {
    final double width = rect.width;
    final double height = rect.height;
    if (width <= 0 || height <= 0) return Path();

    final double maxR = math.min(width, height) / 2.0;
    final double r = radius.clamp(0.0, maxR);
    if (r <= 0.001) {
      return Path()..addRect(rect);
    }

    // Determine effective smoothing. If (1 + s) * r > maxR, gracefully scale smoothing down.
    double s = cornerSmoothing.clamp(0.0, 1.0);
    final double maxPossibleSmoothing = (maxR / r - 1.0).clamp(0.0, 1.0);
    s = math.min(s, maxPossibleSmoothing);

    if (s <= 0.001) {
      return Path()..addRRect(RRect.fromRectAndRadius(rect, Radius.circular(r)));
    }

    final double p = (1.0 + s) * r;

    final double angleAlpha = 45.0 * s;
    final double angleBeta = 90.0 * (1.0 - s);
    final double angleTheta = (90.0 - angleBeta) / 2.0;

    final double alphaRad = angleAlpha * math.pi / 180.0;
    final double betaRad = angleBeta * math.pi / 180.0;
    final double thetaRad = angleTheta * math.pi / 180.0;

    final double dDivC = math.tan(alphaRad);
    final double hLongest = r * math.tan(thetaRad / 2.0);

    final double l = math.sin(betaRad / 2.0) * r * math.sqrt(2.0);
    final double c = hLongest * math.cos(alphaRad);
    final double d = c * dDivC;
    final double b = ((p - l) - (1.0 + dDivC) * c) / 3.0;
    final double a = 2.0 * b;

    final double left = rect.left;
    final double top = rect.top;
    final double right = rect.right;
    final double bottom = rect.bottom;

    final path = Path();
    path.moveTo(left + width / 2.0, top);

    // Top-Right corner
    path.lineTo(right - p, top);
    path.cubicTo(
      right - (p - a),
      top,
      right - (p - a - b),
      top,
      right - (p - a - b - c),
      top + d,
    );
    path.arcTo(
      Rect.fromCircle(center: Offset(right - r, top + r), radius: r),
      (270.0 + angleTheta) * math.pi / 180.0,
      angleBeta * math.pi / 180.0,
      false,
    );
    path.cubicTo(
      right,
      top + (p - a - b),
      right,
      top + (p - a),
      right,
      top + p,
    );

    // Bottom-Right corner
    path.lineTo(right, bottom - p);
    path.cubicTo(
      right,
      bottom - (p - a),
      right,
      bottom - (p - a - b),
      right - d,
      bottom - (p - a - b - c),
    );
    path.arcTo(
      Rect.fromCircle(center: Offset(right - r, bottom - r), radius: r),
      (0.0 + angleTheta) * math.pi / 180.0,
      angleBeta * math.pi / 180.0,
      false,
    );
    path.cubicTo(
      right - (p - a - b),
      bottom,
      right - (p - a),
      bottom,
      right - p,
      bottom,
    );

    // Bottom-Left corner
    path.lineTo(left + p, bottom);
    path.cubicTo(
      left + (p - a),
      bottom,
      left + (p - a - b),
      bottom,
      left + (p - a - b - c),
      bottom - d,
    );
    path.arcTo(
      Rect.fromCircle(center: Offset(left + r, bottom - r), radius: r),
      (90.0 + angleTheta) * math.pi / 180.0,
      angleBeta * math.pi / 180.0,
      false,
    );
    path.cubicTo(
      left,
      bottom - (p - a - b),
      left,
      bottom - (p - a),
      left,
      bottom - p,
    );

    // Top-Left corner
    path.lineTo(left, top + p);
    path.cubicTo(
      left,
      top + (p - a),
      left,
      top + (p - a - b),
      left + d,
      top + (p - a - b - c),
    );
    path.arcTo(
      Rect.fromCircle(center: Offset(left + r, top + r), radius: r),
      (180.0 + angleTheta) * math.pi / 180.0,
      angleBeta * math.pi / 180.0,
      false,
    );
    path.cubicTo(
      left + (p - a - b),
      top,
      left + (p - a),
      top,
      left + p,
      top,
    );

    path.close();
    return path;
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    if (other.runtimeType != runtimeType) return false;
    return other is SmoothSquircleBorder &&
        other.side == side &&
        other.radius == radius &&
        other.cornerSmoothing == cornerSmoothing;
  }

  @override
  int get hashCode => Object.hash(side, radius, cornerSmoothing);
}

/// Hero Play/Pause Button with Hold-to-Replay (`sinja.io` Asymmetric Filler + Kobra 3D Flip
/// with whole-sentence `"Hold to replay"` entry, Mode 2 locked `" to replay"` on `"Release"`,
/// Option B chunky `↺` icon, explicit equal `4.5px` word spacing, and zero vibration on finger release).
class _HoldToReplayHeroButton extends StatefulWidget {
  final bool isPlaying;
  final AppPalette palette;
  final VoidCallback onTap;
  final VoidCallback onConfirmReplay;
  final bool isEnded;
  final bool isLoading;
  final bool fitHoldContent;

  const _HoldToReplayHeroButton({
    this.isEnded = false,
    this.isLoading = false,
    this.fitHoldContent = false,
    required this.isPlaying,
    required this.palette,
    required this.onTap,
    required this.onConfirmReplay,
  });

  @override
  State<_HoldToReplayHeroButton> createState() =>
      _HoldToReplayHeroButtonState();
}

class _HoldToReplayHeroButtonState extends State<_HoldToReplayHeroButton>
    with TickerProviderStateMixin {
  static const double _kHeroWordGap = 4.5;

  _HeroHoldStage _stage = _HeroHoldStage.idle;
  bool _isPressing = false;
  int? _activePointerId;
  Timer? _tapThresholdTimer;
  int _holdEntryEpoch = 0;

  // 1) Filler progress (0.0 -> 1.0 over 900ms, or retract to 0.0 over 200ms)
  late AnimationController _fillCtrl;
  // 2) Confirm forward exit sweep (left: 0% -> 100% over 200ms)
  late AnimationController _confirmCtrl;
  // 3) Stage transition between Idle ("Play"/"Pause") and Hold ("↺ Hold/Release to replay")
  late AnimationController _stageSwitchCtrl;
  bool _showingHoldContent = false;
  int _stageDirection = 1; // +1 forward (enter hold / confirm), -1 back (cancel)
  // 4) Counter-clockwise 360° spin on the chunky `↺` icon when reaching Complete
  late AnimationController _iconSpinCtrl;

  @override
  void initState() {
    super.initState();
    _fillCtrl = AnimationController(vsync: this, value: 0.0)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed &&
            _stage == _HeroHoldStage.inProgress) {
          _onHoldReachedComplete();
        }
      });
    _confirmCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 200),
      value: 0.0,
    );
    _stageSwitchCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 280),
      value: 1.0,
    );
    _iconSpinCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 420),
      value: 0.0,
    );
  }

  @override
  void dispose() {
    _tapThresholdTimer?.cancel();
    _fillCtrl.dispose();
    _confirmCtrl.dispose();
    _stageSwitchCtrl.dispose();
    _iconSpinCtrl.dispose();
    super.dispose();
  }

  double _measureStaggeredWordWidth(
    BuildContext context,
    String word,
    TextStyle style,
  ) {
    TextStyle effectiveStyle = style;
    if (style.inherit) {
      effectiveStyle = DefaultTextStyle.of(context).style.merge(style);
    }
    if (MediaQuery.boldTextOf(context)) {
      effectiveStyle =
          effectiveStyle.merge(const TextStyle(fontWeight: FontWeight.bold));
    }
    final scaler = MediaQuery.textScalerOf(context);
    final dir = Directionality.of(context);
    final locale = Localizations.maybeLocaleOf(context);
    double total = 0.0;
    for (final ch in word.split('')) {
      final tp = TextPainter(
        text: TextSpan(text: ch, style: effectiveStyle),
        maxLines: 1,
        textDirection: dir,
        textScaler: scaler,
        locale: locale,
        textHeightBehavior: const TextHeightBehavior(
          applyHeightToFirstAscent: false,
          applyHeightToLastDescent: false,
        ),
      )..layout();
      total += tp.width;
    }
    return total;
  }

  void _startHoldCountdown() {
    if (!mounted || _stage != _HeroHoldStage.pendingTap) return;
    _iconSpinCtrl.value = 0.0;
    setState(() {
      _stage = _HeroHoldStage.inProgress;
      _showingHoldContent = true;
      _stageDirection = 1;
      _holdEntryEpoch++;
    });
    _confirmCtrl.value = 0.0;
    _stageSwitchCtrl.forward(from: 0.0);
    _fillCtrl.animateTo(
      1.0,
      duration: const Duration(milliseconds: 900),
      curve: Curves.linear,
    );
  }

  void _onHoldReachedComplete() {
    if (!mounted || _stage != _HeroHoldStage.inProgress) return;
    // Only haptic anchor during hold (while finger is still pressed down)
    HapticFeedback.mediumImpact();
    setState(() {
      _stage = _HeroHoldStage.complete;
    });
    _iconSpinCtrl.forward(from: 0.0);
  }

  void _cancelHold() {
    _tapThresholdTimer?.cancel();
    _tapThresholdTimer = null;
    if (_stage == _HeroHoldStage.idle) return;

    final bool wasHoldVisible = _stage == _HeroHoldStage.inProgress ||
        _stage == _HeroHoldStage.complete;

    setState(() {
      _stage = _HeroHoldStage.idle;
      _isPressing = false;
      _activePointerId = null;
      if (wasHoldVisible) {
        _showingHoldContent = false;
        _stageDirection = -1;
      }
    });

    if (wasHoldVisible) {
      _stageSwitchCtrl.forward(from: 0.0);
    }

    _fillCtrl.animateTo(
      0.0,
      duration: const Duration(milliseconds: 220),
      curve: _M3Motion.easeSmoothOut,
    );
  }

  void _confirmHold() {
    _tapThresholdTimer?.cancel();
    _tapThresholdTimer = null;
    // Zero vibration on finger release!
    setState(() {
      _stage = _HeroHoldStage.confirming;
      _isPressing = false;
      _activePointerId = null;
      _showingHoldContent = false;
      _stageDirection = 1;
    });

    _stageSwitchCtrl.forward(from: 0.0);
    widget.onConfirmReplay();

    _confirmCtrl
        .animateTo(
          1.0,
          duration: const Duration(milliseconds: 280),
          curve: _M3Motion.easeSmoothOut,
        )
        .then((_) {
      if (!mounted) return;
      _fillCtrl.value = 0.0;
      _confirmCtrl.value = 0.0;
      if (_stage == _HeroHoldStage.confirming) {
        setState(() {
          _stage = _HeroHoldStage.idle;
        });
      }
    });
  }

  void _handlePointerDown(PointerDownEvent event) {
    if (_activePointerId != null) return;
    _activePointerId = event.pointer;
    _tapThresholdTimer?.cancel();

    if (_stage == _HeroHoldStage.confirming) {
      _fillCtrl.value = 0.0;
      _confirmCtrl.value = 0.0;
    }

    setState(() {
      _isPressing = true;
      _stage = _HeroHoldStage.pendingTap;
    });

    // 150ms Tap-Hold threshold so normal Play/Pause taps never flash Hold UI
    _tapThresholdTimer = Timer(const Duration(milliseconds: 150), () {
      _tapThresholdTimer = null;
      _startHoldCountdown();
    });
  }

  void _handlePointerMove(PointerMoveEvent event) {
    if (event.pointer != _activePointerId) return;
    if (_stage != _HeroHoldStage.pendingTap &&
        _stage != _HeroHoldStage.inProgress &&
        _stage != _HeroHoldStage.complete) {
      return;
    }
    final box = context.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return;
    final pos = event.localPosition;
    final inside = pos.dx >= 0 &&
        pos.dx <= box.size.width &&
        pos.dy >= 0 &&
        pos.dy <= box.size.height;
    if (!inside) {
      _cancelHold();
    }
  }

  void _handlePointerUp(PointerUpEvent event) {
    if (event.pointer != _activePointerId) return;
    if (_stage == _HeroHoldStage.pendingTap) {
      // Short tap (<150ms) -> normal Play/Pause toggle (zero vibration on release)
      _tapThresholdTimer?.cancel();
      _tapThresholdTimer = null;
      setState(() {
        _isPressing = false;
        _activePointerId = null;
        _stage = _HeroHoldStage.idle;
      });
      widget.onTap();
    } else if (_stage == _HeroHoldStage.inProgress) {
      // Released before 100% -> cancel hold, do NOT toggle Play/Pause
      _cancelHold();
    } else if (_stage == _HeroHoldStage.complete) {
      // Released at 100% inside button -> confirm replay!
      _confirmHold();
    } else {
      setState(() {
        _isPressing = false;
        _activePointerId = null;
      });
    }
  }

  void _handlePointerCancel(PointerCancelEvent event) {
    if (event.pointer != _activePointerId) return;
    _cancelHold();
  }

  Widget _buildIdleContent(AppPalette p) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 220),
          switchInCurve: _M3Motion.easeBounce,
          switchOutCurve: Curves.easeIn,
          transitionBuilder: (child, anim) => ScaleTransition(
            scale: Tween<double>(begin: 0.35, end: 1.0).animate(anim),
            child: FadeTransition(opacity: anim, child: child),
          ),
          child: widget.isLoading
              ? SizedBox(
                  key: const ValueKey('hero_audio_loading'),
                  width: 30, height: 30,
                  child: Padding(padding: const EdgeInsets.all(3),
                    child: CircularProgressIndicator(strokeWidth: 2.5, color: p.accentFg)),
                )
              : Icon(
                  widget.isEnded ? Icons.replay_rounded : widget.isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                  key: ValueKey('hero_icon_${widget.isPlaying}_${widget.isEnded}'),
                  size: 30,
                  color: p.accentFg,
                ),
        ),
        const SizedBox(width: 8),
        SizedBox(
          width: 50,
          child: Text(
            widget.isEnded ? 'Replay' : widget.isPlaying ? 'Pause' : 'Play',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.2,
              color: p.accentFg,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildHoldContent(BuildContext context, AppPalette p) {
    final holdTextStyle = TextStyle(
      fontSize: 14.5,
      fontWeight: FontWeight.w800,
      letterSpacing: -0.2,
      color: p.accentFg,
    );
    final double holdW =
        _measureStaggeredWordWidth(context, 'Hold', holdTextStyle);
    final double releaseW =
        _measureStaggeredWordWidth(context, 'Release', holdTextStyle);
    const double iconSize = 21.0;
    const double iconGap = 8.0;
    // Fixed outer reserve width on the left of " to replay" so " to replay" NEVER moves!
    final double reserveW = iconSize + iconGap + releaseW;
    final double balanceOffsetPx = (releaseW - holdW) * 0.35;
    final bool isComplete = _stage == _HeroHoldStage.complete;
    final String activePrefix = isComplete ? 'Release' : 'Hold';

    return Transform.translate(
      offset: Offset(-balanceOffsetPx, 0.0),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: reserveW,
            height: 24,
            child: Align(
              alignment: Alignment.centerRight,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AnimatedBuilder(
                    animation: Listenable.merge([_stageSwitchCtrl, _iconSpinCtrl]),
                    builder: (context, child) {
                      // 1) Smooth 3D entrance flip when entering Hold
                      final double enterT = _showingHoldContent
                          ? _M3Motion.easeSmoothOut
                              .transform(_stageSwitchCtrl.value.clamp(0.0, 1.0))
                          : 1.0;
                      final double enterDy = (1.0 - enterT) * 6.0;
                      final double enterRotX =
                          (1.0 - enterT) * (-35.0 * math.pi / 180.0);
                      final double enterScale = 0.86 + 0.14 * enterT;

                      // 2) Single continuous 360° CCW spin + sine scale swell at 100%
                      final double spinRaw = _iconSpinCtrl.value.clamp(0.0, 1.0);
                      final double spinEased =
                          _M3Motion.easeSmoothOut.transform(spinRaw);
                      final double spinAngle = -2.0 * math.pi * spinEased;
                      final double spinScale =
                          1.0 + 0.12 * math.sin(math.pi * spinEased);
                      final double totalScale = enterScale * spinScale;

                      final matrix = Matrix4.identity()
                        ..setEntry(3, 2, 0.004)
                        ..translateByDouble(0.0, enterDy, 0.0, 1.0)
                        ..rotateX(enterRotX)
                        ..rotateZ(spinAngle)
                        ..scaleByDouble(totalScale, totalScale, 1.0, 1.0);

                      return Opacity(
                        opacity: enterT.clamp(0.0, 1.0),
                        child: Transform(
                          alignment: Alignment.center,
                          transform: matrix,
                          child: child,
                        ),
                      );
                    },
                    child: SizedBox(
                      width: iconSize,
                      height: iconSize,
                      child: CustomPaint(
                        painter: _ChunkyReplayIconPainter(color: p.accentFg),
                      ),
                    ),
                  ),
                  const SizedBox(width: iconGap),
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 280),
                    curve: _M3Motion.easeSmoothOut,
                    width: isComplete ? releaseW : holdW,
                    height: 24,
                    alignment: Alignment.centerRight,
                    child: _KobraPrefixWordSwitcher(
                      word: activePrefix,
                      style: holdTextStyle,
                      entryEpoch: _holdEntryEpoch,
                      startCharIndex: 0,
                    ),
                  ),
                ],
              ),
            ),
          ),
          _KobraStaggeredSuffixText(
            word1: 'to',
            word2: 'replay',
            wordGap: _kHeroWordGap,
            style: holdTextStyle,
            entryEpoch: _holdEntryEpoch,
            startCharIndex: 4,
          ),
        ],
      ),
    );
  }

  /// Constant-depth `Stack` transition between `idleChild` and `holdChild`:
  /// Never removes the `Stack` or changes the widget tree depth at `rawT >= 0.999`,
  /// completely preventing subtree remounts (no double-flash and reliable retries!).
  Widget _buildKobraStageTransition({
    required Widget idleChild,
    required Widget holdChild,
  }) {
    return AnimatedBuilder(
      animation: _stageSwitchCtrl,
      builder: (context, _) {
        final double rawT = _stageSwitchCtrl.value.clamp(0.0, 1.0);
        final double exitLinear = (rawT / 0.72).clamp(0.0, 1.0);
        final double exitCurved = _M3Motion.easeSmoothOut.transform(exitLinear);
        final double exitDy = exitCurved * (-5.0 * _stageDirection);
        final double exitRotX =
            exitCurved * (22.0 * _stageDirection * math.pi / 180.0);
        final double exitScale = 1.0 - 0.04 * exitCurved;
        final exitMatrix = Matrix4.identity()
          ..setEntry(3, 2, 0.004)
          ..translateByDouble(0.0, exitDy, 0.0, 1.0)
          ..rotateX(exitRotX)
          ..scaleByDouble(exitScale, exitScale, 1.0, 1.0);

        final double enterCurved = _M3Motion.easeBounce.transform(rawT);
        final double enterDy = (1.0 - enterCurved) * (8.0 * _stageDirection);
        final double enterRotX =
            (1.0 - enterCurved) * (-36.0 * _stageDirection * math.pi / 180.0);
        final double enterScale = 0.94 + 0.06 * enterCurved;
        final enterMatrix = Matrix4.identity()
          ..setEntry(3, 2, 0.004)
          ..translateByDouble(0.0, enterDy, 0.0, 1.0)
          ..rotateX(enterRotX)
          ..scaleByDouble(enterScale, enterScale, 1.0, 1.0);

        final double idleOpacity = _showingHoldContent
            ? (1.0 - exitCurved).clamp(0.0, 1.0)
            : rawT.clamp(0.0, 1.0);
        final Matrix4 idleMatrix =
            _showingHoldContent ? exitMatrix : enterMatrix;

        final double holdOpacity = _showingHoldContent
            ? 1.0
            : (1.0 - exitCurved).clamp(0.0, 1.0);
        final Matrix4 holdMatrix =
            _showingHoldContent ? Matrix4.identity() : exitMatrix;

        return Stack(
          alignment: Alignment.center,
          clipBehavior: Clip.none,
          children: [
            KeyedSubtree(
              key: const ValueKey('hero_slot_idle'),
              child: Offstage(
                offstage: _showingHoldContent && exitLinear >= 0.999,
                child: IgnorePointer(
                  ignoring: _showingHoldContent,
                  child: Opacity(
                    opacity: idleOpacity,
                    child: Transform(
                      alignment: Alignment.center,
                      transform: idleMatrix,
                      child: idleChild,
                    ),
                  ),
                ),
              ),
            ),
            KeyedSubtree(
              key: const ValueKey('hero_slot_hold'),
              child: Offstage(
                offstage: !_showingHoldContent && exitLinear >= 0.999,
                child: IgnorePointer(
                  ignoring: !_showingHoldContent,
                  child: Opacity(
                    opacity: holdOpacity,
                    child: Transform(
                      alignment: Alignment.center,
                      transform: holdMatrix,
                      child: holdChild,
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.palette;
    final double radius = widget.isPlaying ? 18.0 : 30.0;
    final Color fillerBg =
        p.isDark ? const Color(0x38060608) : const Color(0x33141413);
    final Color fillerEdge =
        p.isDark ? const Color(0x61060608) : const Color(0x52141413);

    return Listener(
      behavior: HitTestBehavior.opaque,
      onPointerDown: _handlePointerDown,
      onPointerMove: _handlePointerMove,
      onPointerUp: _handlePointerUp,
      onPointerCancel: _handlePointerCancel,
      child: AnimatedScale(
        scale: _isPressing ? 0.975 : 1.0,
        duration: _isPressing
            ? const Duration(milliseconds: 110)
            : const Duration(milliseconds: 240),
        curve: _isPressing ? Curves.easeOut : _M3Motion.easeSmoothOut,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 320),
          curve: _M3Motion.easeSmoothOut,
          width: double.infinity,
          height: 60,
          clipBehavior: Clip.antiAlias,
          decoration: ShapeDecoration(
            color: p.accent,
            shape: SmoothSquircleBorder(
              radius: radius,
              cornerSmoothing: 0.6,
            ),
            shadows: [
              BoxShadow(
                color: p.accentSoft,
                blurRadius: widget.isPlaying ? 24 : 16,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Stack(
            fit: StackFit.expand,
            alignment: Alignment.center,
            children: [
              // Asymmetric Hold-to-Replay Filler Layer (sinja.io)
              Positioned.fill(
                child: IgnorePointer(
                  child: CustomPaint(
                    painter: _SinjaHoldFillerPainter(
                      fillListenable: _fillCtrl,
                      confirmListenable: _confirmCtrl,
                      fillerBg: fillerBg,
                      fillerEdge: fillerEdge,
                    ),
                  ),
                ),
              ),

              // Foreground Stage (Idle Play/Pause ↔ Mode 2 + Option B Hold/Release to replay)
              Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  child: _buildKobraStageTransition(
                    idleChild: _buildIdleContent(p),
                    holdChild: widget.fitHoldContent
                        ? FittedBox(fit: BoxFit.scaleDown, child: _buildHoldContent(context, p))
                        : _buildHoldContent(context, p),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Course List Card with Hold-to-Replay (Scheme A1 Refined):
/// - Option 1: No press-down shrink (`scale = 1.0`) so normal taps open the Player screen crisply
///   and scrolling the list never causes card jitter.
/// - `150ms` silent tap/scroll observation window + `8px` scroll slop guard + `900ms` linear Sinja sweep fill.
/// - Left `36x36` Index Squircle flips in 3D from `'01'`/`'✓'` to the custom chunky `↺` icon
///   (and spins `360°` CCW + lights up solid `p.accent` upon reaching `100%`).
/// - Right Status Pill smoothly morphs from `statusLabel` (`New` / `Resume 42%` / `Done 100%`)
///   to `Hold to replay` → `Release to replay`, maintaining 100% symmetric `7.0px` left & right
///   inner margins while locking `" to replay"` at `0.0px` horizontal shift.
class _HoldToReplayCourseCard extends StatefulWidget {
  final LessonSummary item;
  final AppPalette palette;
  final bool isDone;
  final bool isCurrent;
  final bool highlightStatusPill;
  final String statusLabel;
  final double displayBarValue;
  final VoidCallback onTap;
  final VoidCallback onConfirmReplay;

  const _HoldToReplayCourseCard({
    super.key,
    required this.item,
    required this.palette,
    required this.isDone,
    required this.isCurrent,
    required this.highlightStatusPill,
    required this.statusLabel,
    required this.displayBarValue,
    required this.onTap,
    required this.onConfirmReplay,
  });

  @override
  State<_HoldToReplayCourseCard> createState() =>
      _HoldToReplayCourseCardState();
}

class _HoldToReplayCourseCardState extends State<_HoldToReplayCourseCard>
    with TickerProviderStateMixin {
  static const double _kPillWordGap = 3.5;

  _HeroHoldStage _stage = _HeroHoldStage.idle;
  int? _activePointerId;
  Offset _downGlobalPos = Offset.zero;
  Timer? _tapThresholdTimer;
  int _holdEntryEpoch = 0;
  bool _holdPlayedSnapshot = false;

  // 1) Card Sweep Filler progress (0.0 -> 1.0 over 900ms, or retract to 0.0 over 200ms)
  late AnimationController _fillCtrl;
  // 2) Confirm forward exit sweep (left: 0% -> 100% over 200ms)
  late AnimationController _confirmCtrl;
  // 3) Stage transition for Left Badge ('01'/'✓' ↔ '↺'/'▶') & Right Pill (statusLabel ↔ 'Hold/Release to replay/start')
  late AnimationController _stageSwitchCtrl;
  bool _showingHoldContent = false;
  int _stageDirection = 1;
  // 4) Action animation on the left 36x36 badge icon at 100% (360° CCW spin for `↺`, spring pop for `▶`)
  late AnimationController _iconSpinCtrl;

  bool get _isCurrentlyPlayed =>
      widget.isDone || widget.displayBarValue > 0.001;

  @override
  void initState() {
    super.initState();
    _holdPlayedSnapshot = _isCurrentlyPlayed;
    _fillCtrl = AnimationController(vsync: this, value: 0.0)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed &&
            _stage == _HeroHoldStage.inProgress) {
          _onHoldReachedComplete();
        }
      });
    _confirmCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 200),
      value: 0.0,
    );
    _stageSwitchCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 260),
      value: 1.0,
    );
    _iconSpinCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 420),
      value: 0.0,
    );
  }

  @override
  void didUpdateWidget(covariant _HoldToReplayCourseCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_stage == _HeroHoldStage.idle && !_showingHoldContent) {
      _holdPlayedSnapshot = _isCurrentlyPlayed;
    }
  }

  @override
  void dispose() {
    _tapThresholdTimer?.cancel();
    _fillCtrl.dispose();
    _confirmCtrl.dispose();
    _stageSwitchCtrl.dispose();
    _iconSpinCtrl.dispose();
    super.dispose();
  }

  TextStyle _resolveEffectiveTextStyle(BuildContext context, TextStyle style) {
    TextStyle effective = style;
    if (style.inherit) {
      effective = DefaultTextStyle.of(context).style.merge(style);
    }
    if (MediaQuery.boldTextOf(context)) {
      effective =
          effective.merge(const TextStyle(fontWeight: FontWeight.bold));
    }
    return effective;
  }

  /// Measures the exact width of a single `Text` widget with the current `TextScaler` and `DefaultTextStyle`.
  double _measureSingleTextWidth(
    BuildContext context,
    String text,
    TextStyle style,
  ) {
    final effectiveStyle = _resolveEffectiveTextStyle(context, style);
    final tp = TextPainter(
      text: TextSpan(text: text, style: effectiveStyle),
      maxLines: 1,
      textDirection: Directionality.of(context),
      textScaler: MediaQuery.textScalerOf(context),
      locale: Localizations.maybeLocaleOf(context),
      textHeightBehavior: const TextHeightBehavior(
        applyHeightToFirstAscent: false,
        applyHeightToLastDescent: false,
      ),
    )..layout();
    return tp.width;
  }

  /// Measures the exact width of `_KobraPrefixWordSwitcher` / `_KobraStaggeredSuffixText`
  /// (which lay out individual character `Text` widgets in a `Row(mainAxisSize: MainAxisSize.min)`).
  double _measureStaggeredWordWidth(
    BuildContext context,
    String word,
    TextStyle style,
  ) {
    final effectiveStyle = _resolveEffectiveTextStyle(context, style);
    final scaler = MediaQuery.textScalerOf(context);
    final dir = Directionality.of(context);
    final locale = Localizations.maybeLocaleOf(context);
    double total = 0.0;
    for (final ch in word.split('')) {
      final tp = TextPainter(
        text: TextSpan(text: ch, style: effectiveStyle),
        maxLines: 1,
        textDirection: dir,
        textScaler: scaler,
        locale: locale,
        textHeightBehavior: const TextHeightBehavior(
          applyHeightToFirstAscent: false,
          applyHeightToLastDescent: false,
        ),
      )..layout();
      total += tp.width;
    }
    return total;
  }

  void _startHoldCountdown() {
    if (!mounted || _stage != _HeroHoldStage.pendingTap) return;
    _iconSpinCtrl.value = 0.0;
    setState(() {
      _holdPlayedSnapshot = _isCurrentlyPlayed;
      _stage = _HeroHoldStage.inProgress;
      _showingHoldContent = true;
      _stageDirection = 1;
      _holdEntryEpoch++;
    });
    _confirmCtrl.value = 0.0;
    _stageSwitchCtrl.forward(from: 0.0);
    _fillCtrl.animateTo(
      1.0,
      duration: const Duration(milliseconds: 900),
      curve: Curves.linear,
    );
  }

  void _onHoldReachedComplete() {
    if (!mounted || _stage != _HeroHoldStage.inProgress) return;
    // Only haptic anchor during hold (while finger is still pressed down)
    HapticFeedback.mediumImpact();
    setState(() {
      _stage = _HeroHoldStage.complete;
    });
    _iconSpinCtrl.forward(from: 0.0);
  }

  void _cancelHold() {
    _tapThresholdTimer?.cancel();
    _tapThresholdTimer = null;
    if (_stage == _HeroHoldStage.idle) return;

    final bool wasHoldVisible = _stage == _HeroHoldStage.inProgress ||
        _stage == _HeroHoldStage.complete;

    setState(() {
      _stage = _HeroHoldStage.idle;
      _activePointerId = null;
      if (wasHoldVisible) {
        _showingHoldContent = false;
        _stageDirection = -1;
      }
    });

    if (wasHoldVisible) {
      _stageSwitchCtrl.forward(from: 0.0);
    }

    _fillCtrl.animateTo(
      0.0,
      duration: const Duration(milliseconds: 220),
      curve: _M3Motion.easeSmoothOut,
    );
  }

  void _confirmHold() {
    _tapThresholdTimer?.cancel();
    _tapThresholdTimer = null;
    // Zero vibration on finger release!
    // Directly reset card filler and state (no post-release sweep animation since we navigate immediately to Player screen).
    _fillCtrl.value = 0.0;
    _confirmCtrl.value = 0.0;
    _stageSwitchCtrl.value = 1.0;
    setState(() {
      _stage = _HeroHoldStage.idle;
      _activePointerId = null;
      _showingHoldContent = false;
      _stageDirection = 1;
      _holdPlayedSnapshot = _isCurrentlyPlayed;
    });

    widget.onConfirmReplay();
  }

  void _handlePointerDown(PointerDownEvent event) {
    if (_activePointerId != null) return;
    _activePointerId = event.pointer;
    _downGlobalPos = event.position;
    _tapThresholdTimer?.cancel();

    if (_stage == _HeroHoldStage.confirming) {
      _fillCtrl.value = 0.0;
      _confirmCtrl.value = 0.0;
    }

    setState(() {
      _stage = _HeroHoldStage.pendingTap;
    });

    // 150ms Tap/Scroll observation threshold (same as Hero Play Button)
    _tapThresholdTimer = Timer(const Duration(milliseconds: 150), () {
      _tapThresholdTimer = null;
      _startHoldCountdown();
    });
  }

  void _handlePointerMove(PointerMoveEvent event) {
    if (event.pointer != _activePointerId) return;
    if (_stage == _HeroHoldStage.idle || _stage == _HeroHoldStage.confirming) {
      return;
    }

    // 8px Scroll Slop Guard during the initial 150ms observation window
    final double moveDist = (event.position - _downGlobalPos).distance;
    if (_stage == _HeroHoldStage.pendingTap && moveDist > 8.0) {
      _cancelHold();
      return;
    }

    // If already holding, cancel if user scrolls vertically or slides finger outside card bounds
    if ((event.position.dy - _downGlobalPos.dy).abs() > 14.0) {
      _cancelHold();
      return;
    }

    final box = context.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return;
    final pos = event.localPosition;
    final inside = pos.dx >= -8.0 &&
        pos.dx <= box.size.width + 8.0 &&
        pos.dy >= -8.0 &&
        pos.dy <= box.size.height + 8.0;
    if (!inside) {
      _cancelHold();
    }
  }

  void _handlePointerUp(PointerUpEvent event) {
    if (event.pointer != _activePointerId) return;
    if (_stage == _HeroHoldStage.pendingTap) {
      // Short tap (<150ms) -> zero vibration on release
      _tapThresholdTimer?.cancel();
      _tapThresholdTimer = null;
      setState(() {
        _activePointerId = null;
        _stage = _HeroHoldStage.idle;
      });
      widget.onTap();
    } else if (_stage == _HeroHoldStage.inProgress) {
      _cancelHold();
    } else if (_stage == _HeroHoldStage.complete) {
      _confirmHold();
    } else {
      setState(() {
        _activePointerId = null;
      });
    }
  }

  void _handlePointerCancel(PointerCancelEvent event) {
    if (event.pointer != _activePointerId) return;
    _cancelHold();
  }

  /// Constant-depth `Stack` 3D transition:
  /// Keeps both `idleChild` and `holdChild` mounted at fixed `KeyedSubtree` slots
  /// across all `rawT` values (`0.0 .. 1.0`), eliminating subtree remounts (no double-flash!)
  /// and avoiding offscreen blur surface teardown stutter on vector icons.
  Widget _buildKobra3DTransition({
    required Widget idleChild,
    required Widget holdChild,
    required Alignment alignment,
    bool holdUsesOwnCharacterStagger = false,
  }) {
    return AnimatedBuilder(
      animation: _stageSwitchCtrl,
      builder: (context, _) {
        final double rawT = _stageSwitchCtrl.value.clamp(0.0, 1.0);
        final double exitLinear = (rawT / 0.72).clamp(0.0, 1.0);
        final double exitCurved = _M3Motion.easeSmoothOut.transform(exitLinear);
        final double exitDy = exitCurved * (-5.0 * _stageDirection);
        final double exitRotX =
            exitCurved * (30.0 * _stageDirection * math.pi / 180.0);
        final double exitScale = 1.0 - 0.08 * exitCurved;
        final exitMatrix = Matrix4.identity()
          ..setEntry(3, 2, 0.004)
          ..translateByDouble(0.0, exitDy, 0.0, 1.0)
          ..rotateX(exitRotX)
          ..scaleByDouble(exitScale, exitScale, 1.0, 1.0);

        final double enterCurved = _M3Motion.easeSmoothOut.transform(rawT);
        final double enterDy = (1.0 - enterCurved) * (6.0 * _stageDirection);
        final double enterRotX =
            (1.0 - enterCurved) * (-35.0 * _stageDirection * math.pi / 180.0);
        final double enterScale = 0.86 + 0.14 * enterCurved;
        final enterMatrix = Matrix4.identity()
          ..setEntry(3, 2, 0.004)
          ..translateByDouble(0.0, enterDy, 0.0, 1.0)
          ..rotateX(enterRotX)
          ..scaleByDouble(enterScale, enterScale, 1.0, 1.0);

        final double idleOpacity = _showingHoldContent
            ? (1.0 - exitCurved).clamp(0.0, 1.0)
            : rawT.clamp(0.0, 1.0);
        final Matrix4 idleMatrix =
            _showingHoldContent ? exitMatrix : enterMatrix;

        final double holdOpacity = _showingHoldContent
            ? (holdUsesOwnCharacterStagger ? 1.0 : rawT.clamp(0.0, 1.0))
            : (1.0 - exitCurved).clamp(0.0, 1.0);
        final Matrix4 holdMatrix = _showingHoldContent
            ? (holdUsesOwnCharacterStagger ? Matrix4.identity() : enterMatrix)
            : exitMatrix;

        return Stack(
          alignment: alignment,
          clipBehavior: Clip.none,
          children: [
            KeyedSubtree(
              key: const ValueKey('card_slot_idle'),
              child: Offstage(
                offstage: _showingHoldContent && exitLinear >= 0.999,
                child: IgnorePointer(
                  ignoring: _showingHoldContent,
                  child: Opacity(
                    opacity: idleOpacity,
                    child: Transform(
                      alignment: alignment,
                      transform: idleMatrix,
                      child: idleChild,
                    ),
                  ),
                ),
              ),
            ),
            KeyedSubtree(
              key: const ValueKey('card_slot_hold'),
              child: Offstage(
                offstage: !_showingHoldContent && exitLinear >= 0.999,
                child: IgnorePointer(
                  ignoring: !_showingHoldContent,
                  child: Opacity(
                    opacity: holdOpacity,
                    child: Transform(
                      alignment: alignment,
                      transform: holdMatrix,
                      child: holdChild,
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildLeftIndexBadge(AppPalette p) {
    final bool isHoldActive = _stage == _HeroHoldStage.inProgress ||
        _stage == _HeroHoldStage.complete;
    final bool isComplete = _stage == _HeroHoldStage.complete;
    final bool isPlayedBefore =
        _showingHoldContent ? _holdPlayedSnapshot : _isCurrentlyPlayed;

    final Color badgeBg = isComplete
        ? p.accent
        : ((isHoldActive || widget.isDone || widget.isCurrent)
            ? p.accentSoft
            : p.surface2);
    final Color badgeFg = isComplete
        ? p.accentFg
        : ((isHoldActive || widget.isDone || widget.isCurrent)
            ? p.accent
            : p.textPassed);

    final Widget idleBadgeText = Text(
      widget.isDone
          ? '✓'
          : widget.item.lessonNumber.toString().padLeft(2, '0'),
      maxLines: 1,
      softWrap: false,
      style: TextStyle(
        fontSize: widget.item.lessonNumber >= 100 ? 11.5 : 13,
        fontWeight: FontWeight.w800,
        color: badgeFg,
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
    );

    final Widget holdBadgeIcon = AnimatedBuilder(
      animation: _iconSpinCtrl,
      builder: (context, child) {
        final double raw = _iconSpinCtrl.value.clamp(0.0, 1.0);
        final double eased = _M3Motion.easeSmoothOut.transform(raw);
        if (isPlayedBefore) {
          // Played episode (`↺`): single continuous 360° CCW spin + smooth sine scale swell
          final double spinAngle = -2.0 * math.pi * eased;
          final double spinScale = 1.0 + 0.12 * math.sin(math.pi * eased);
          final matrix = Matrix4.identity()
            ..rotateZ(spinAngle)
            ..scaleByDouble(spinScale, spinScale, 1.0, 1.0);
          return Transform(
            alignment: Alignment.center,
            transform: matrix,
            child: child,
          );
        } else {
          // Unplayed episode (`▶`): smooth continuous sine scale pop (1.0 -> 1.24 -> 1.0)
          final double pulseScale = 1.0 + 0.24 * math.sin(math.pi * eased);
          return Transform.scale(
            scale: pulseScale,
            child: child,
          );
        }
      },
      child: SizedBox(
        width: isPlayedBefore ? 17.5 : 16.5,
        height: isPlayedBefore ? 17.5 : 16.5,
        child: CustomPaint(
          painter: isPlayedBefore
              ? _ChunkyReplayIconPainter(color: badgeFg)
              : _ChunkyPlayTrianglePainter(color: badgeFg),
        ),
      ),
    );

    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      curve: _M3Motion.easeSmoothOut,
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        color: badgeBg,
        borderRadius: BorderRadius.circular(widget.isCurrent ? 12 : 10),
      ),
      alignment: Alignment.center,
      child: _buildKobra3DTransition(
        idleChild: idleBadgeText,
        holdChild: holdBadgeIcon,
        alignment: Alignment.center,
      ),
    );
  }

  Widget _buildRightStatusPill(BuildContext context, AppPalette p) {
    final bool isHoldActive = _stage == _HeroHoldStage.inProgress ||
        _stage == _HeroHoldStage.complete;
    final bool isComplete = _stage == _HeroHoldStage.complete;
    final bool isPlayedBefore =
        _showingHoldContent ? _holdPlayedSnapshot : _isCurrentlyPlayed;
    final String actionWord = isPlayedBefore ? 'replay' : 'start';

    final Color pillBg = isComplete
        ? p.accent
        : ((isHoldActive || widget.highlightStatusPill)
            ? p.accentSoft
            : p.surface2);
    final Color pillFg = isComplete
        ? p.accentFg
        : ((isHoldActive || widget.highlightStatusPill)
            ? p.accent
            : p.textPassed);

    final TextStyle pillTextStyle = TextStyle(
      fontSize: 10,
      height: 1.15,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.0,
      color: pillFg,
      fontFeatures: const [FontFeature.tabularFigures()],
    );

    final double idleW =
        _measureSingleTextWidth(context, widget.statusLabel, pillTextStyle);
    final double holdWordW =
        _measureStaggeredWordWidth(context, 'Hold', pillTextStyle);
    final double releaseWordW =
        _measureStaggeredWordWidth(context, 'Release', pillTextStyle);
    final double toWordW =
        _measureStaggeredWordWidth(context, 'to', pillTextStyle);
    final double actionWordW =
        _measureStaggeredWordWidth(context, actionWord, pillTextStyle);
    // Exact width with two identical explicit `_kPillWordGap` (3.5px == 3.5px) boxes!
    final double suffixW =
        _kPillWordGap + toWordW + _kPillWordGap + actionWordW;

    final String activePrefix = isComplete ? 'Release' : 'Hold';
    final double activePrefixW = isComplete ? releaseWordW : holdWordW;
    final double targetContentW =
        _showingHoldContent ? (activePrefixW + suffixW) : idleW;

    final Widget idlePillChild = Text(
      widget.statusLabel,
      maxLines: 1,
      softWrap: false,
      style: pillTextStyle,
      textHeightBehavior: const TextHeightBehavior(
        applyHeightToFirstAscent: false,
        applyHeightToLastDescent: false,
      ),
    );

    final Widget holdPillChild = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 240),
          curve: _M3Motion.easeSmoothOut,
          width: activePrefixW,
          alignment: Alignment.centerRight,
          child: _KobraPrefixWordSwitcher(
            word: activePrefix,
            style: pillTextStyle,
            entryEpoch: _holdEntryEpoch,
            startCharIndex: 0,
          ),
        ),
        _KobraStaggeredSuffixText(
          word1: 'to',
          word2: actionWord,
          wordGap: _kPillWordGap,
          style: pillTextStyle,
          entryEpoch: _holdEntryEpoch,
          startCharIndex: 4,
        ),
      ],
    );

    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      curve: _M3Motion.easeSmoothOut,
      padding: const EdgeInsets.symmetric(horizontal: 7.0, vertical: 2.0),
      decoration: BoxDecoration(
        color: pillBg,
        borderRadius: BorderRadius.circular(9999),
      ),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 240),
        curve: _M3Motion.easeSmoothOut,
        width: targetContentW,
        height: 13.0,
        alignment: Alignment.centerRight,
        child: OverflowBox(
          alignment: Alignment.centerRight,
          minWidth: 0.0,
          maxWidth: double.infinity,
          child: _buildKobra3DTransition(
            idleChild: idlePillChild,
            holdChild: holdPillChild,
            alignment: Alignment.centerRight,
            holdUsesOwnCharacterStagger: true,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.palette;
    final bool isHoldActive = _stage == _HeroHoldStage.inProgress ||
        _stage == _HeroHoldStage.complete;
    final bool isComplete = _stage == _HeroHoldStage.complete;
    final double cardRadius = widget.isCurrent ? 18.0 : 15.0;

    final Color fillerBg =
        p.accent.withValues(alpha: isComplete ? 0.24 : 0.16);
    final Color fillerEdge = p.accent.withValues(alpha: 0.55);

    return SizedBox(
      height: 88.0,
      child: Listener(
        behavior: HitTestBehavior.opaque,
        onPointerDown: _handlePointerDown,
        onPointerMove: _handlePointerMove,
        onPointerUp: _handlePointerUp,
        onPointerCancel: _handlePointerCancel,
        child: AnimatedContainer(
          duration: _M3Motion.durFast,
          curve: _M3Motion.easeSmoothOut,
          margin: const EdgeInsets.only(bottom: 9),
          decoration: BoxDecoration(
            color: p.surface1,
            borderRadius: BorderRadius.circular(cardRadius),
            border: Border.all(
              color: (widget.isCurrent || isHoldActive) ? p.accent : p.border,
              width: 1,
            ),
            boxShadow: isComplete
                ? [
                    BoxShadow(
                      color: p.accentSoft,
                      blurRadius: 16,
                      offset: const Offset(0, 4),
                    ),
                  ]
                : null,
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(cardRadius - 1.0),
            child: Stack(
              fit: StackFit.expand,
              alignment: Alignment.center,
              children: [
                // Sinja Asymmetric Card Sweep Filler
                Positioned.fill(
                  child: IgnorePointer(
                    child: CustomPaint(
                      painter: _SinjaHoldFillerPainter(
                        fillListenable: _fillCtrl,
                        confirmListenable: _confirmCtrl,
                        fillerBg: fillerBg,
                        fillerEdge: fillerEdge,
                      ),
                    ),
                  ),
                ),

                // Card Content Row
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 11,
                  ),
                  child: Row(
                    children: [
                      _buildLeftIndexBadge(p),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              widget.item.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 14.5,
                                fontWeight: FontWeight.w700,
                                color: p.textPrimary,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  '${widget.item.level} · ${widget.item.code}',
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w500,
                                    color: p.textPassed,
                                  ),
                                ),
                                _buildRightStatusPill(context, p),
                              ],
                            ),
                            const SizedBox(height: 6),
                            ClipRRect(
                              borderRadius: BorderRadius.circular(9999),
                              child: TweenAnimationBuilder<double>(
                                tween: Tween<double>(
                                  begin: widget.displayBarValue,
                                  end: widget.displayBarValue,
                                ),
                                duration: _M3Motion.durFast,
                                curve: _M3Motion.easeSmoothOut,
                                builder: (context, val, _) =>
                                    LinearProgressIndicator(
                                  value: val,
                                  minHeight: 3.5,
                                  backgroundColor: p.surface2,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    p.accent,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Full-phrase Kobra staggered character switcher (`"Hold to replay"` → `"Release to replay"` /
/// `"Hold to start"` → `"Release to start"`) for the Top Now-Playing Card's top-left badge:
/// - Animates EVERY character across all three words (`[prefixWord]` + `wordGap` + `["to"]` + `wordGap` + `[actionWord]`)
///   with a sequential left-to-right 3D wave both when entering Hold (`entryEpoch` increments)
///   AND when flipping from `"Hold"` to `"Release"` at `100%` completion!
/// - Uses explicit `SizedBox(width: wordGap)` (`3.5px == 3.5px`) between words and aligns left (`Alignment.centerLeft`).
class _KobraFullPhraseSwitcher extends StatefulWidget {
  final String prefixWord;
  final String middleWord;
  final String actionWord;
  final double wordGap;
  final TextStyle style;
  final int entryEpoch;

  const _KobraFullPhraseSwitcher({
    required this.prefixWord,
    required this.middleWord,
    required this.actionWord,
    required this.wordGap,
    required this.style,
    required this.entryEpoch,
  });

  @override
  State<_KobraFullPhraseSwitcher> createState() =>
      _KobraFullPhraseSwitcherState();
}

class _KobraFullPhraseSwitcherState extends State<_KobraFullPhraseSwitcher>
    with TickerProviderStateMixin {
  late String _currentPrefix;
  late String _currentMiddle;
  late String _currentAction;
  String? _exitingPrefix;
  String? _exitingMiddle;
  String? _exitingAction;

  late AnimationController _enterCtrl;
  late AnimationController _exitCtrl;

  @override
  void initState() {
    super.initState();
    _currentPrefix = widget.prefixWord;
    _currentMiddle = widget.middleWord;
    _currentAction = widget.actionWord;
    _enterCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 380),
    )..forward();
    _exitCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 250),
      value: 1.0,
    );
  }

  @override
  void didUpdateWidget(covariant _KobraFullPhraseSwitcher oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.entryEpoch != widget.entryEpoch) {
      // Fresh entry into Hold: whole 3-word phrase staggers in from left to right without an exiting ghost
      _exitingPrefix = null;
      _exitingMiddle = null;
      _exitingAction = null;
      _currentPrefix = widget.prefixWord;
      _currentMiddle = widget.middleWord;
      _currentAction = widget.actionWord;
      _exitCtrl.value = 1.0;
      _enterCtrl.forward(from: 0.0);
    } else if (oldWidget.prefixWord != widget.prefixWord ||
        oldWidget.middleWord != widget.middleWord ||
        oldWidget.actionWord != widget.actionWord) {
      // Reached 100% ("Hold to replay" -> "Release to replay"):
      // Exit ALL characters of the old 3-word phrase and enter ALL characters of the new 3-word phrase!
      _exitingPrefix = _currentPrefix;
      _exitingMiddle = _currentMiddle;
      _exitingAction = _currentAction;
      _currentPrefix = widget.prefixWord;
      _currentMiddle = widget.middleWord;
      _currentAction = widget.actionWord;
      _exitCtrl.forward(from: 0.0);
      _enterCtrl.forward(from: 0.0);
    }
  }

  @override
  void dispose() {
    _enterCtrl.dispose();
    _exitCtrl.dispose();
    super.dispose();
  }

  Widget _buildAnimatedChar(
    String ch,
    int globalIdx,
    double rawT, {
    required bool isEntering,
  }) {
    final double delayFrac =
        (globalIdx * (isEntering ? 0.034 : 0.036)).clamp(0.0, 0.58);
    final double spanFrac = 1.0 - delayFrac;
    final double localLinear =
        ((rawT - delayFrac) / spanFrac).clamp(0.0, 1.0);

    if (isEntering) {
      final double curved = _M3Motion.easeBounce.transform(localLinear);
      final double opacity = localLinear.clamp(0.0, 1.0);
      final double dy = (1.0 - curved) * 6.5;
      final double rotX = (1.0 - curved) * (-40.0 * math.pi / 180.0);
      final double scale = 0.90 + 0.10 * curved;

      final matrix = Matrix4.identity()
        ..setEntry(3, 2, 0.004)
        ..translateByDouble(0.0, dy, 0.0, 1.0)
        ..rotateX(rotX)
        ..scaleByDouble(scale, scale, 1.0, 1.0);

      return Opacity(
        opacity: opacity,
        child: Transform(
          alignment: Alignment.bottomCenter,
          transform: matrix,
          child: Text(
            ch,
            style: widget.style,
            textHeightBehavior: const TextHeightBehavior(
              applyHeightToFirstAscent: false,
              applyHeightToLastDescent: false,
            ),
          ),
        ),
      );
    } else {
      final double curved = _M3Motion.easeSmoothOut.transform(localLinear);
      final double opacity = (1.0 - curved).clamp(0.0, 1.0);
      final double dy = -4.5 * curved;
      final double rotX = curved * (26.0 * math.pi / 180.0);
      final double scale = 1.0 - 0.06 * curved;

      final matrix = Matrix4.identity()
        ..setEntry(3, 2, 0.004)
        ..translateByDouble(0.0, dy, 0.0, 1.0)
        ..rotateX(rotX)
        ..scaleByDouble(scale, scale, 1.0, 1.0);

      return Opacity(
        opacity: opacity,
        child: Transform(
          alignment: Alignment.bottomCenter,
          transform: matrix,
          child: Text(
            ch,
            style: widget.style,
            textHeightBehavior: const TextHeightBehavior(
              applyHeightToFirstAscent: false,
              applyHeightToLastDescent: false,
            ),
          ),
        ),
      );
    }
  }

  Widget _buildFullPhraseRow(
    String w1,
    String w2,
    String w3,
    AnimationController ctrl, {
    required bool isEntering,
  }) {
    final chars1 = w1.split('');
    final chars2 = w2.split('');
    final chars3 = w3.split('');
    return AnimatedBuilder(
      animation: ctrl,
      builder: (context, _) {
        final double rawT = ctrl.value;
        if (!isEntering && rawT >= 0.999) {
          return const SizedBox.shrink();
        }
        final List<Widget> children = [];
        int charIdx = 0;
        for (final ch in chars1) {
          children.add(
            _buildAnimatedChar(ch, charIdx++, rawT, isEntering: isEntering),
          );
        }
        children.add(SizedBox(width: widget.wordGap));
        for (final ch in chars2) {
          children.add(
            _buildAnimatedChar(ch, charIdx++, rawT, isEntering: isEntering),
          );
        }
        children.add(SizedBox(width: widget.wordGap));
        for (final ch in chars3) {
          children.add(
            _buildAnimatedChar(ch, charIdx++, rawT, isEntering: isEntering),
          );
        }
        return Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: children,
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return OverflowBox(
      alignment: Alignment.centerLeft,
      minWidth: 0.0,
      maxWidth: double.infinity,
      child: Stack(
        alignment: Alignment.centerLeft,
        clipBehavior: Clip.none,
        children: [
          if (_exitingPrefix != null &&
              _exitingMiddle != null &&
              _exitingAction != null)
            _buildFullPhraseRow(
              _exitingPrefix!,
              _exitingMiddle!,
              _exitingAction!,
              _exitCtrl,
              isEntering: false,
            ),
          _buildFullPhraseRow(
            _currentPrefix,
            _currentMiddle,
            _currentAction,
            _enterCtrl,
            isEntering: true,
          ),
        ],
      ),
    );
  }
}

/// Top Pinned Now-Playing Card with Hold-to-Replay / Hold-to-Start:
/// - Full-bleed Sinja sweep filler (`0% → 100%` over `900ms`, `150ms` tap/scroll threshold, zero right-edge gap).
/// - Top-left status pill smoothly morphs from `liveHeaderBadge` (`CONTINUE LISTENING` / `START LISTENING` / `LESSON COMPLETED`)
///   to full-phrase staggered 3D character animation (`Hold to replay` → `Release to replay` for played lessons;
///   `Hold to start` → `Release to start` for unplayed `0%` lessons) on a single unified line.
/// - Right `40x40` Play/Pause button morphs in 3D to `↺` (with `360°` CCW spin at `100%`) or `▶` (with spring scale pulse at `100%`).
/// - Short tap (`<150ms`) on the right `40x40` button toggles Play/Pause; short tap elsewhere on the card opens the Player screen.
/// - Releasing at `100%` anywhere on the card (including on the right `40x40` button) triggers `onConfirmReplay` with zero release vibration.
class _HoldToReplayTopLiveCard extends StatefulWidget {
  final AppPalette palette;
  final int lessonNum;
  final String lessonTitle;
  final String trackTimeLabel;
  final String liveHeaderBadge;
  final String liveSentence;
  final double liveProgress;
  final bool isPlaying;
  final bool playActionOnly;
  final bool isPlayedBefore;
  final VoidCallback onCardTap;
  final VoidCallback onPlayPauseTap;
  final VoidCallback onConfirmReplay;

  const _HoldToReplayTopLiveCard({
    this.playActionOnly = false,
    super.key,
    required this.palette,
    required this.lessonNum,
    required this.lessonTitle,
    required this.trackTimeLabel,
    required this.liveHeaderBadge,
    required this.liveSentence,
    required this.liveProgress,
    required this.isPlaying,
    required this.isPlayedBefore,
    required this.onCardTap,
    required this.onPlayPauseTap,
    required this.onConfirmReplay,
  });

  @override
  State<_HoldToReplayTopLiveCard> createState() =>
      _HoldToReplayTopLiveCardState();
}

class _HoldToReplayTopLiveCardState extends State<_HoldToReplayTopLiveCard>
    with TickerProviderStateMixin {
  static const double _kPillWordGap = 3.5;

  final GlobalKey _rightBtnKey = GlobalKey();

  _HeroHoldStage _stage = _HeroHoldStage.idle;
  int? _activePointerId;
  Offset _downGlobalPos = Offset.zero;
  bool _downOnRightButton = false;
  Timer? _tapThresholdTimer;
  int _holdEntryEpoch = 0;
  bool _holdPlayedSnapshot = false;

  late AnimationController _fillCtrl;
  late AnimationController _confirmCtrl;
  late AnimationController _stageSwitchCtrl;
  bool _showingHoldContent = false;
  int _stageDirection = 1;
  late AnimationController _iconSpinCtrl;

  @override
  void initState() {
    super.initState();
    _holdPlayedSnapshot = widget.isPlayedBefore;
    _fillCtrl = AnimationController(vsync: this, value: 0.0)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed &&
            _stage == _HeroHoldStage.inProgress) {
          _onHoldReachedComplete();
        }
      });
    _confirmCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 200),
      value: 0.0,
    );
    _stageSwitchCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 260),
      value: 1.0,
    );
    _iconSpinCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 420),
      value: 0.0,
    );
  }

  @override
  void didUpdateWidget(covariant _HoldToReplayTopLiveCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_stage == _HeroHoldStage.idle && !_showingHoldContent) {
      _holdPlayedSnapshot = widget.isPlayedBefore;
    }
  }

  @override
  void dispose() {
    _tapThresholdTimer?.cancel();
    _fillCtrl.dispose();
    _confirmCtrl.dispose();
    _stageSwitchCtrl.dispose();
    _iconSpinCtrl.dispose();
    super.dispose();
  }

  TextStyle _resolveEffectiveTextStyle(BuildContext context, TextStyle style) {
    TextStyle effective = style;
    if (style.inherit) {
      effective = DefaultTextStyle.of(context).style.merge(style);
    }
    if (MediaQuery.boldTextOf(context)) {
      effective =
          effective.merge(const TextStyle(fontWeight: FontWeight.bold));
    }
    return effective;
  }

  double _measureSingleTextWidth(
    BuildContext context,
    String text,
    TextStyle style,
  ) {
    final effectiveStyle = _resolveEffectiveTextStyle(context, style);
    final tp = TextPainter(
      text: TextSpan(text: text, style: effectiveStyle),
      maxLines: 1,
      textDirection: Directionality.of(context),
      textScaler: MediaQuery.textScalerOf(context),
      locale: Localizations.maybeLocaleOf(context),
      textHeightBehavior: const TextHeightBehavior(
        applyHeightToFirstAscent: false,
        applyHeightToLastDescent: false,
      ),
    )..layout();
    return tp.width;
  }

  double _measureStaggeredWordWidth(
    BuildContext context,
    String word,
    TextStyle style,
  ) {
    final effectiveStyle = _resolveEffectiveTextStyle(context, style);
    final scaler = MediaQuery.textScalerOf(context);
    final dir = Directionality.of(context);
    final locale = Localizations.maybeLocaleOf(context);
    double total = 0.0;
    for (final ch in word.split('')) {
      final tp = TextPainter(
        text: TextSpan(text: ch, style: effectiveStyle),
        maxLines: 1,
        textDirection: dir,
        textScaler: scaler,
        locale: locale,
        textHeightBehavior: const TextHeightBehavior(
          applyHeightToFirstAscent: false,
          applyHeightToLastDescent: false,
        ),
      )..layout();
      total += tp.width;
    }
    return total;
  }

  bool _isPointInsideRightButton(Offset globalPos) {
    final btnCtx = _rightBtnKey.currentContext;
    if (btnCtx == null) return false;
    final box = btnCtx.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return false;
    final local = box.globalToLocal(globalPos);
    return local.dx >= -6.0 &&
        local.dx <= box.size.width + 6.0 &&
        local.dy >= -6.0 &&
        local.dy <= box.size.height + 6.0;
  }

  void _startHoldCountdown() {
    if (!mounted || _stage != _HeroHoldStage.pendingTap) return;
    _iconSpinCtrl.value = 0.0;
    setState(() {
      _holdPlayedSnapshot = widget.isPlayedBefore;
      _stage = _HeroHoldStage.inProgress;
      _showingHoldContent = true;
      _stageDirection = 1;
      _holdEntryEpoch++;
    });
    _confirmCtrl.value = 0.0;
    _stageSwitchCtrl.forward(from: 0.0);
    _fillCtrl.animateTo(
      1.0,
      duration: const Duration(milliseconds: 900),
      curve: Curves.linear,
    );
  }

  void _onHoldReachedComplete() {
    if (!mounted || _stage != _HeroHoldStage.inProgress) return;
    // Only haptic anchor during hold (while finger is still pressed down)
    HapticFeedback.mediumImpact();
    setState(() {
      _stage = _HeroHoldStage.complete;
    });
    _iconSpinCtrl.forward(from: 0.0);
  }

  void _cancelHold() {
    _tapThresholdTimer?.cancel();
    _tapThresholdTimer = null;
    if (_stage == _HeroHoldStage.idle) return;

    final bool wasHoldVisible = _stage == _HeroHoldStage.inProgress ||
        _stage == _HeroHoldStage.complete;

    setState(() {
      _stage = _HeroHoldStage.idle;
      _activePointerId = null;
      _downOnRightButton = false;
      if (wasHoldVisible) {
        _showingHoldContent = false;
        _stageDirection = -1;
      }
    });

    if (wasHoldVisible) {
      _stageSwitchCtrl.forward(from: 0.0);
    }

    _fillCtrl.animateTo(
      0.0,
      duration: const Duration(milliseconds: 220),
      curve: _M3Motion.easeSmoothOut,
    );
  }

  void _confirmHold() {
    _tapThresholdTimer?.cancel();
    _tapThresholdTimer = null;
    // Zero vibration on finger release!
    // Directly reset card filler and state (no post-release sweep animation since we navigate immediately to Player screen).
    _fillCtrl.value = 0.0;
    _confirmCtrl.value = 0.0;
    _stageSwitchCtrl.value = 1.0;
    setState(() {
      _stage = _HeroHoldStage.idle;
      _activePointerId = null;
      _downOnRightButton = false;
      _showingHoldContent = false;
      _stageDirection = 1;
      _holdPlayedSnapshot = widget.isPlayedBefore;
    });

    widget.onConfirmReplay();
  }

  void _handlePointerDown(PointerDownEvent event) {
    if (_activePointerId != null) return;
    _activePointerId = event.pointer;
    _downGlobalPos = event.position;
    _downOnRightButton = _isPointInsideRightButton(event.position);
    _tapThresholdTimer?.cancel();

    if (_stage == _HeroHoldStage.confirming) {
      _fillCtrl.value = 0.0;
      _confirmCtrl.value = 0.0;
    }

    setState(() {
      _stage = _HeroHoldStage.pendingTap;
    });

    _tapThresholdTimer = Timer(const Duration(milliseconds: 150), () {
      _tapThresholdTimer = null;
      _startHoldCountdown();
    });
  }

  void _handlePointerMove(PointerMoveEvent event) {
    if (event.pointer != _activePointerId) return;
    if (_stage == _HeroHoldStage.idle || _stage == _HeroHoldStage.confirming) {
      return;
    }

    final double moveDist = (event.position - _downGlobalPos).distance;
    if (_stage == _HeroHoldStage.pendingTap && moveDist > 8.0) {
      _cancelHold();
      return;
    }

    if ((event.position.dy - _downGlobalPos.dy).abs() > 18.0) {
      _cancelHold();
      return;
    }

    final box = context.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return;
    final pos = event.localPosition;
    final inside = pos.dx >= -8.0 &&
        pos.dx <= box.size.width + 8.0 &&
        pos.dy >= -8.0 &&
        pos.dy <= box.size.height + 8.0;
    if (!inside) {
      _cancelHold();
    }
  }

  void _handlePointerUp(PointerUpEvent event) {
    if (event.pointer != _activePointerId) return;
    if (_stage == _HeroHoldStage.pendingTap) {
      _tapThresholdTimer?.cancel();
      _tapThresholdTimer = null;
      final bool tappedRightBtn = _downOnRightButton;
      setState(() {
        _activePointerId = null;
        _downOnRightButton = false;
        _stage = _HeroHoldStage.idle;
      });
      if (tappedRightBtn) {
        widget.onPlayPauseTap();
      } else {
        widget.onCardTap();
      }
    } else if (_stage == _HeroHoldStage.inProgress) {
      _cancelHold();
    } else if (_stage == _HeroHoldStage.complete) {
      _confirmHold();
    } else {
      setState(() {
        _activePointerId = null;
        _downOnRightButton = false;
      });
    }
  }

  void _handlePointerCancel(PointerCancelEvent event) {
    if (event.pointer != _activePointerId) return;
    _cancelHold();
  }

  Widget _buildKobra3DTransition({
    required Widget idleChild,
    required Widget holdChild,
    required Alignment alignment,
    required String slotKeyPrefix,
    bool holdUsesOwnCharacterStagger = false,
  }) {
    return AnimatedBuilder(
      animation: _stageSwitchCtrl,
      builder: (context, _) {
        final double rawT = _stageSwitchCtrl.value.clamp(0.0, 1.0);
        final double exitLinear = (rawT / 0.72).clamp(0.0, 1.0);
        final double exitCurved = _M3Motion.easeSmoothOut.transform(exitLinear);
        final double exitDy = exitCurved * (-5.0 * _stageDirection);
        final double exitRotX =
            exitCurved * (30.0 * _stageDirection * math.pi / 180.0);
        final double exitScale = 1.0 - 0.08 * exitCurved;
        final exitMatrix = Matrix4.identity()
          ..setEntry(3, 2, 0.004)
          ..translateByDouble(0.0, exitDy, 0.0, 1.0)
          ..rotateX(exitRotX)
          ..scaleByDouble(exitScale, exitScale, 1.0, 1.0);

        final double enterCurved = _M3Motion.easeSmoothOut.transform(rawT);
        final double enterDy = (1.0 - enterCurved) * (6.0 * _stageDirection);
        final double enterRotX =
            (1.0 - enterCurved) * (-35.0 * _stageDirection * math.pi / 180.0);
        final double enterScale = 0.86 + 0.14 * enterCurved;
        final enterMatrix = Matrix4.identity()
          ..setEntry(3, 2, 0.004)
          ..translateByDouble(0.0, enterDy, 0.0, 1.0)
          ..rotateX(enterRotX)
          ..scaleByDouble(enterScale, enterScale, 1.0, 1.0);

        final double idleOpacity = _showingHoldContent
            ? (1.0 - exitCurved).clamp(0.0, 1.0)
            : rawT.clamp(0.0, 1.0);
        final Matrix4 idleMatrix =
            _showingHoldContent ? exitMatrix : enterMatrix;

        final double holdOpacity = _showingHoldContent
            ? (holdUsesOwnCharacterStagger ? 1.0 : rawT.clamp(0.0, 1.0))
            : (1.0 - exitCurved).clamp(0.0, 1.0);
        final Matrix4 holdMatrix = _showingHoldContent
            ? (holdUsesOwnCharacterStagger ? Matrix4.identity() : enterMatrix)
            : exitMatrix;

        return Stack(
          alignment: alignment,
          clipBehavior: Clip.none,
          children: [
            KeyedSubtree(
              key: ValueKey('${slotKeyPrefix}_idle'),
              child: Offstage(
                offstage: _showingHoldContent && exitLinear >= 0.999,
                child: IgnorePointer(
                  ignoring: _showingHoldContent,
                  child: Opacity(
                    opacity: idleOpacity,
                    child: Transform(
                      alignment: alignment,
                      transform: idleMatrix,
                      child: idleChild,
                    ),
                  ),
                ),
              ),
            ),
            KeyedSubtree(
              key: ValueKey('${slotKeyPrefix}_hold'),
              child: Offstage(
                offstage: !_showingHoldContent && exitLinear >= 0.999,
                child: IgnorePointer(
                  ignoring: !_showingHoldContent,
                  child: Opacity(
                    opacity: holdOpacity,
                    child: Transform(
                      alignment: alignment,
                      transform: holdMatrix,
                      child: holdChild,
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildTopLeftPill(BuildContext context, AppPalette p) {
    final bool isComplete = _stage == _HeroHoldStage.complete;
    final bool isPlayedBefore =
        _showingHoldContent ? _holdPlayedSnapshot : widget.isPlayedBefore;
    final String actionWord = isPlayedBefore ? 'replay' : 'start';

    final Color pillBg = isComplete ? p.accent : p.accentSoft;
    final Color pillFg = isComplete ? p.accentFg : p.accent;

    final TextStyle idleBadgeStyle = TextStyle(
      fontSize: 10,
      height: 1.0,
      fontWeight: FontWeight.w800,
      letterSpacing: 0.6,
      color: pillFg,
    );

    final TextStyle holdPillStyle = TextStyle(
      fontSize: 10,
      height: 1.15,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.0,
      color: pillFg,
      fontFeatures: const [FontFeature.tabularFigures()],
    );

    // 6.0px dot + 6.0px gap + idle text width
    final double idleW = 12.0 +
        _measureSingleTextWidth(
          context,
          widget.liveHeaderBadge,
          idleBadgeStyle,
        );
    final double holdWordW =
        _measureStaggeredWordWidth(context, 'Hold', holdPillStyle);
    final double releaseWordW =
        _measureStaggeredWordWidth(context, 'Release', holdPillStyle);
    final double toWordW =
        _measureStaggeredWordWidth(context, 'to', holdPillStyle);
    final double actionWordW =
        _measureStaggeredWordWidth(context, actionWord, holdPillStyle);
    final double suffixW =
        _kPillWordGap + toWordW + _kPillWordGap + actionWordW;

    final String activePrefix = isComplete ? 'Release' : 'Hold';
    final double activePhraseW =
        (isComplete ? releaseWordW : holdWordW) + suffixW;
    final double targetContentW = _showingHoldContent ? activePhraseW : idleW;

    final Widget idlePillChild = Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        AnimatedOpacity(
          duration: const Duration(milliseconds: 220),
          curve: _M3Motion.easeSmoothOut,
          opacity: widget.isPlaying ? 1.0 : 0.35,
          child: AnimatedScale(
            duration: const Duration(milliseconds: 220),
            curve: _M3Motion.easeBounce,
            scale: widget.isPlaying ? 1.0 : 0.82,
            child: Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: pillFg,
              ),
            ),
          ),
        ),
        const SizedBox(width: 6),
        Text(
          widget.liveHeaderBadge,
          maxLines: 1,
          softWrap: false,
          style: idleBadgeStyle,
          textHeightBehavior: const TextHeightBehavior(
            applyHeightToFirstAscent: false,
            applyHeightToLastDescent: false,
          ),
        ),
      ],
    );

    final Widget holdPillChild = AnimatedContainer(
      duration: const Duration(milliseconds: 240),
      curve: _M3Motion.easeSmoothOut,
      width: activePhraseW,
      height: 14.0,
      alignment: Alignment.centerLeft,
      child: _KobraFullPhraseSwitcher(
        prefixWord: activePrefix,
        middleWord: 'to',
        actionWord: actionWord,
        wordGap: _kPillWordGap,
        style: holdPillStyle,
        entryEpoch: _holdEntryEpoch,
      ),
    );

    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      curve: _M3Motion.easeSmoothOut,
      height: 20,
      padding: const EdgeInsets.symmetric(horizontal: 9.0),
      decoration: BoxDecoration(
        color: pillBg,
        borderRadius: BorderRadius.circular(9999),
      ),
      alignment: Alignment.centerLeft,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 240),
        curve: _M3Motion.easeSmoothOut,
        width: targetContentW,
        height: 14.0,
        alignment: Alignment.centerLeft,
        child: OverflowBox(
          alignment: Alignment.centerLeft,
          minWidth: 0.0,
          maxWidth: double.infinity,
          child: _buildKobra3DTransition(
            idleChild: idlePillChild,
            holdChild: holdPillChild,
            alignment: Alignment.centerLeft,
            slotKeyPrefix: 'top_live_pill',
            holdUsesOwnCharacterStagger: true,
          ),
        ),
      ),
    );
  }

  Widget _buildRightPlayButton(AppPalette p) {
    final bool isHoldActive = _stage == _HeroHoldStage.inProgress ||
        _stage == _HeroHoldStage.complete;
    final bool isComplete = _stage == _HeroHoldStage.complete;
    final bool isPlayedBefore =
        _showingHoldContent ? _holdPlayedSnapshot : widget.isPlayedBefore;

    final Color btnBg = isComplete
        ? p.accent
        : (isHoldActive ? p.accentSoft : p.accent);
    final Color btnFg = isComplete
        ? p.accentFg
        : (isHoldActive ? p.accent : p.accentFg);
    final double btnRadius = (widget.isPlaying || isHoldActive) ? 13.0 : 20.0;

    final Widget idleIconChild = AnimatedSwitcher(
      duration: const Duration(milliseconds: 220),
      switchInCurve: _M3Motion.easeBounce,
      switchOutCurve: Curves.easeIn,
      transitionBuilder: (child, anim) => ScaleTransition(
        scale: Tween<double>(begin: 0.4, end: 1.0).animate(anim),
        child: FadeTransition(opacity: anim, child: child),
      ),
      child: Icon(
        widget.isPlaying && !widget.playActionOnly ? Icons.pause_rounded : Icons.play_arrow_rounded,
        key: ValueKey('home_play_${widget.isPlaying}'),
        size: 24,
        color: btnFg,
      ),
    );

    final Widget holdIconChild = AnimatedBuilder(
      animation: _iconSpinCtrl,
      builder: (context, child) {
        final double raw = _iconSpinCtrl.value.clamp(0.0, 1.0);
        final double eased = _M3Motion.easeSmoothOut.transform(raw);
        if (isPlayedBefore) {
          final double spinAngle = -2.0 * math.pi * eased;
          final double spinScale = 1.0 + 0.14 * math.sin(math.pi * eased);
          final matrix = Matrix4.identity()
            ..rotateZ(spinAngle)
            ..scaleByDouble(spinScale, spinScale, 1.0, 1.0);
          return Transform(
            alignment: Alignment.center,
            transform: matrix,
            child: child,
          );
        } else {
          final double pulseScale = 1.0 + 0.24 * math.sin(math.pi * eased);
          return Transform.scale(
            scale: pulseScale,
            child: child,
          );
        }
      },
      child: SizedBox(
        width: isPlayedBefore ? 19.0 : 18.0,
        height: isPlayedBefore ? 19.0 : 18.0,
        child: CustomPaint(
          painter: isPlayedBefore
              ? _ChunkyReplayIconPainter(color: btnFg)
              : _ChunkyPlayTrianglePainter(color: btnFg),
        ),
      ),
    );

    return AnimatedContainer(
      key: _rightBtnKey,
      duration: const Duration(milliseconds: 260),
      curve: _M3Motion.easeSmoothOut,
      width: 40,
      height: 40,
      decoration: ShapeDecoration(
        color: btnBg,
        shape: SmoothSquircleBorder(
          radius: btnRadius,
          cornerSmoothing: 0.6,
        ),
        shadows: isComplete
            ? [
                BoxShadow(
                  color: p.accentSoft,
                  blurRadius: 14,
                  offset: const Offset(0, 4),
                ),
              ]
            : null,
      ),
      alignment: Alignment.center,
      child: _buildKobra3DTransition(
        idleChild: idleIconChild,
        holdChild: holdIconChild,
        alignment: Alignment.center,
        slotKeyPrefix: 'top_live_btn',
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.palette;
    final bool isHoldActive = _stage == _HeroHoldStage.inProgress ||
        _stage == _HeroHoldStage.complete;
    final bool isComplete = _stage == _HeroHoldStage.complete;
    const double cardRadius = 18.0;

    final Color fillerBg =
        p.accent.withValues(alpha: isComplete ? 0.24 : 0.16);
    final Color fillerEdge = p.accent.withValues(alpha: 0.55);

    return Listener(
      behavior: HitTestBehavior.opaque,
      onPointerDown: _handlePointerDown,
      onPointerMove: _handlePointerMove,
      onPointerUp: _handlePointerUp,
      onPointerCancel: _handlePointerCancel,
      child: AnimatedContainer(
        duration: _M3Motion.durFast,
        curve: _M3Motion.easeSmoothOut,
        decoration: BoxDecoration(
          color: p.surfaceInset,
          borderRadius: BorderRadius.circular(cardRadius),
          border: Border.all(
            color: isHoldActive ? p.accent : p.locateBarBorder,
            width: 1.0,
          ),
          boxShadow: isComplete
              ? [
                  BoxShadow(
                    color: p.accentSoft,
                    blurRadius: 18,
                    offset: const Offset(0, 4),
                  ),
                ]
              : null,
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(cardRadius - 1.0),
          child: Stack(
            alignment: Alignment.center,
            children: [
              // Sinja Asymmetric Sweep Filler Layer (full right-edge coverage)
              Positioned.fill(
                child: IgnorePointer(
                  child: CustomPaint(
                    painter: _SinjaHoldFillerPainter(
                      fillListenable: _fillCtrl,
                      confirmListenable: _confirmCtrl,
                      fillerBg: fillerBg,
                      fillerEdge: fillerEdge,
                    ),
                  ),
                ),
              ),

              // Card Foreground Content
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox(
                      height: 20,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          _buildTopLeftPill(context, p),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                            widget.trackTimeLabel,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.end,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: p.textPassed,
                              fontFeatures: const [
                                FontFeature.tabularFigures(),
                              ],
                            ),
                          ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 6),
                    SizedBox(
                      height: 42,
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  '${widget.lessonNum.toString().padLeft(2, '0')} · ${widget.lessonTitle}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 14.5,
                                    height: 1.2,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: -0.2,
                                    color: p.textPrimary,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                ClipRect(
                                  child: AnimatedSwitcher(
                                    duration: _M3Motion.durQuick,
                                    switchInCurve: _M3Motion.easeSmoothOut,
                                    switchOutCurve: Curves.easeIn,
                                    layoutBuilder:
                                        (currentChild, previousChildren) {
                                      return Stack(
                                        alignment: Alignment.centerLeft,
                                        children: [
                                          ...previousChildren,
                                          if (currentChild != null)
                                            currentChild,
                                        ],
                                      );
                                    },
                                    transitionBuilder: (child, anim) {
                                      return FadeTransition(
                                        opacity: anim,
                                        child: SlideTransition(
                                          position: Tween<Offset>(
                                            begin: const Offset(0.0, 0.28),
                                            end: Offset.zero,
                                          ).animate(anim),
                                          child: child,
                                        ),
                                      );
                                    },
                                    child: Text(
                                      widget.liveSentence,
                                      key: ValueKey(
                                        'home_quote_${widget.liveSentence}',
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontSize: 12.5,
                                        height: 1.2,
                                        fontWeight: FontWeight.w600,
                                        color: p.accent,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 10),
                          _buildRightPlayButton(p),
                        ],
                      ),
                    ),
                    const SizedBox(height: 9),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(9999),
                      child: TweenAnimationBuilder<double>(
                        tween: Tween<double>(
                          begin: widget.liveProgress,
                          end: widget.liveProgress,
                        ),
                        duration: const Duration(milliseconds: 300),
                        curve: _M3Motion.easeSmoothOut,
                        builder: (context, animatedProgress, _) {
                          return LinearProgressIndicator(
                            value: animatedProgress,
                            minHeight: 3.0,
                            backgroundColor: p.surface2,
                            valueColor: AlwaysStoppedAnimation<Color>(p.accent),
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}


/// `transitions.dev` P21 Accordion Chevron (`https://transitions.dev/detail.html?t=accordion`):
/// Flips vertically (`scaleY: 1.0 ↔ -1.0`) about its center over `250ms` using `easeSmoothOut`,
/// passing cleanly through a flat horizontal line at midpoint.
class _P21AnimatedChevron extends StatelessWidget {
  final bool isOpen;
  final Color color;
  final double size;

  const _P21AnimatedChevron({
    required this.isOpen,
    required this.color,
    this.size = 18.0,
  });

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 1.0, end: isOpen ? -1.0 : 1.0),
      duration: _M3Motion.durFast,
      curve: _M3Motion.easeSmoothOut,
      builder: (context, scaleY, child) {
        return Transform(
          alignment: Alignment.center,
          transform: Matrix4.diagonal3Values(1.0, scaleY, 1.0),
          child: child,
        );
      },
      child: Icon(
        Icons.keyboard_arrow_down_rounded,
        size: size,
        color: color,
      ),
    );
  }
}

/// Dual-Track Independent Progress Record per Lesson:
/// - `isCompleted`: permanent completion badge (`true` once Podcast `pb` has ever reached >= 95% or finished)
/// - `hasStarted`: `true` once the user has ever opened/played this lesson (so restarting to 0% shows `Resume 0%` / `Replay 0%` instead of reverting to `New`)
/// - `progressPct`: 0..100 real-time current playback percentage bound strictly to Podcast (`pb`)
/// - `lastTrack`: 'pb' or 'dg'
/// - `pbPosSec`, `pbSegIdx`: exact saved position & sentence index for Podcast
/// - `dgPosSec`, `dgSegIdx`: exact saved position & sentence index for Dialogue
/// - `pbDurSec`, `dgDurSec`: cached track durations
class LessonProgressRecord {
  final bool isCompleted;
  final bool hasStarted;
  final int progressPct; // 0..100 real-time current position of Podcast 'pb'
  final String lastTrack; // 'pb' or 'dg'
  final double pbPosSec;
  final int pbSegIdx;
  final double pbDurSec;
  final double dgPosSec;
  final int dgSegIdx;
  final double dgDurSec;
  final int updatedAtMs;

  const LessonProgressRecord({
    this.isCompleted = false,
    this.hasStarted = false,
    this.progressPct = 0,
    this.lastTrack = 'pb',
    this.pbPosSec = 0.0,
    this.pbSegIdx = 0,
    this.pbDurSec = 0.0,
    this.dgPosSec = 0.0,
    this.dgSegIdx = 0,
    this.dgDurSec = 0.0,
    this.updatedAtMs = 0,
  });

  LessonProgressRecord copyWith({
    bool? isCompleted,
    bool? hasStarted,
    int? progressPct,
    String? lastTrack,
    double? pbPosSec,
    int? pbSegIdx,
    double? pbDurSec,
    double? dgPosSec,
    int? dgSegIdx,
    double? dgDurSec,
    int? updatedAtMs,
  }) {
    return LessonProgressRecord(
      isCompleted: isCompleted ?? this.isCompleted,
      hasStarted: hasStarted ?? this.hasStarted,
      progressPct: progressPct ?? this.progressPct,
      lastTrack: lastTrack ?? this.lastTrack,
      pbPosSec: pbPosSec ?? this.pbPosSec,
      pbSegIdx: pbSegIdx ?? this.pbSegIdx,
      pbDurSec: pbDurSec ?? this.pbDurSec,
      dgPosSec: dgPosSec ?? this.dgPosSec,
      dgSegIdx: dgSegIdx ?? this.dgSegIdx,
      dgDurSec: dgDurSec ?? this.dgDurSec,
      updatedAtMs: updatedAtMs ?? this.updatedAtMs,
    );
  }

  Map<String, dynamic> toJson() => {
        'isCompleted': isCompleted,
        'hasStarted': hasStarted,
        'progressPct': progressPct,
        'lastTrack': lastTrack,
        'pbPosSec': pbPosSec,
        'pbSegIdx': pbSegIdx,
        'pbDurSec': pbDurSec,
        'dgPosSec': dgPosSec,
        'dgSegIdx': dgSegIdx,
        'dgDurSec': dgDurSec,
        'updatedAtMs': updatedAtMs,
      };

  factory LessonProgressRecord.fromJson(Map<String, dynamic> json) {
    final int rawPct = (json['progressPct'] as num?)?.toInt() ?? 0;
    final double rawPbPos = ((json['pbPosSec'] as num?) ?? 0.0).toDouble();
    final double rawDgPos = ((json['dgPosSec'] as num?) ?? 0.0).toDouble();
    final int rawUpdated = (json['updatedAtMs'] as num?)?.toInt() ?? 0;
    final bool completed = (json['isCompleted'] as bool?) ?? (rawPct >= 95);
    final bool started = (json['hasStarted'] as bool?) ??
        (completed || rawPct > 0 || rawPbPos > 0.5 || rawDgPos > 0.5);
    return LessonProgressRecord(
      isCompleted: completed,
      hasStarted: started,
      progressPct: rawPct,
      lastTrack: (json['lastTrack'] as String?) ?? 'pb',
      pbPosSec: rawPbPos,
      pbSegIdx: (json['pbSegIdx'] as num?)?.toInt() ?? 0,
      pbDurSec: ((json['pbDurSec'] as num?) ?? 0.0).toDouble(),
      dgPosSec: rawDgPos,
      dgSegIdx: (json['dgSegIdx'] as num?)?.toInt() ?? 0,
      dgDurSec: ((json['dgDurSec'] as num?) ?? 0.0).toDouble(),
      updatedAtMs: rawUpdated,
    );
  }
}


/// Pure regression seam for the real player's in-memory PB/DG progress updates.
/// Keeps the existing persisted ep_study_progress_v1 wire format unchanged.
LessonProgressRecord nextLessonProgressSnapshot({
  required LessonProgressRecord prev,
  required String track,
  required double currentPositionSec,
  required int currentSegmentIndex,
  required double durationSec,
  required bool playing,
  required bool viewingPlayer,
  required bool markPbComplete,
  required int nowMs,
}) {
  // Real-time completion and percentage depend only on Podcast ('pb').
  int updatedPct = prev.progressPct;
  if (markPbComplete) {
    updatedPct = 100;
  } else if (track == 'pb' && durationSec > 1.0) {
    if (currentPositionSec < 3.0) {
      updatedPct = 0;
    } else {
      updatedPct =
          ((currentPositionSec / durationSec) * 100).floor().clamp(0, 100);
    }
  }
  final updatedCompleted =
      prev.isCompleted || markPbComplete || updatedPct >= 95;
  final updatedStarted = prev.hasStarted ||
      updatedCompleted ||
      updatedPct > 0 ||
      playing ||
      viewingPlayer ||
      currentPositionSec > 0.5;

  return prev.copyWith(
    isCompleted: updatedCompleted,
    hasStarted: updatedStarted,
    progressPct: updatedPct,
    lastTrack: track,
    pbPosSec: track == 'pb' ? currentPositionSec : prev.pbPosSec,
    pbSegIdx: track == 'pb' ? currentSegmentIndex : prev.pbSegIdx,
    pbDurSec: track == 'pb' && durationSec > 1.0
        ? durationSec
        : prev.pbDurSec,
    dgPosSec: track == 'dg' ? currentPositionSec : prev.dgPosSec,
    dgSegIdx: track == 'dg' ? currentSegmentIndex : prev.dgSegIdx,
    dgDurSec: track == 'dg' && durationSec > 1.0
        ? durationSec
        : prev.dgDurSec,
    updatedAtMs: nowMs,
  );
}

class EnglishPodTrancyApp extends StatelessWidget {
  final AppThemePreference initialPreference;

  const EnglishPodTrancyApp({
    super.key,
    this.initialPreference = AppThemePreference.system,
  });

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EnglishPod Player',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.system,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.light,
        scaffoldBackgroundColor: AppPalette.paper.bgWell,
        fontFamily: '.SF Pro Display',
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: AppPalette.dark.bgWell,
        fontFamily: '.SF Pro Display',
      ),
      home: ImmersivePlayerScreen(initialPreference: initialPreference),
    );
  }
}

/// Custom iOS Full-Screen Rightward Pop Gesture Recognizer (`interactiveContentPopGestureRecognizer`):
/// - Sets `onlyAcceptDragOnThreshold = true` so tapping a `Listener`-based widget
///   (with no competing `GestureRecognizer` in the arena) NEVER prematurely triggers `onStart`!
/// - Immediately yields the `GestureArena` (`GestureDisposition.rejected`) on leftward movement
///   (`dx < -8px`) or vertical movement (`dy > 10px && dy > dx * 0.75`) so `ScrollablePositionedList`
///   vertical transcript scrolling is 100% unaffected.
/// - Requires strictly rightward movement (`globalDistanceMoved > slop`) AND horizontal dominance
///   (`globalDistanceMoved > _maxVerticalDeviation * 1.6`) before accepting.
class _RightwardPopDragGestureRecognizer
    extends HorizontalDragGestureRecognizer {
  _RightwardPopDragGestureRecognizer({super.debugOwner}) {
    onlyAcceptDragOnThreshold = true;
  }

  Offset _downGlobalPos = Offset.zero;
  double _maxVerticalDeviation = 0.0;
  bool _disqualified = false;

  @override
  void addAllowedPointer(PointerDownEvent event) {
    _downGlobalPos = event.position;
    _maxVerticalDeviation = 0.0;
    _disqualified = false;
    super.addAllowedPointer(event);
  }

  @override
  void handleEvent(PointerEvent event) {
    if (event is PointerMoveEvent && !_disqualified) {
      final double dx = event.position.dx - _downGlobalPos.dx;
      final double dy = (event.position.dy - _downGlobalPos.dy).abs();
      if (dy > _maxVerticalDeviation) {
        _maxVerticalDeviation = dy;
      }
      if (dx < -8.0 || (dy > 10.0 && dy > dx * 0.75)) {
        _disqualified = true;
        resolve(GestureDisposition.rejected);
        return;
      }
    }
    super.handleEvent(event);
  }

  @override
  bool hasSufficientGlobalDistanceToAccept(
    PointerDeviceKind pointerDeviceKind,
    double? deviceTouchSlop,
  ) {
    if (_disqualified) return false;
    final double slop = computeHitSlop(pointerDeviceKind, gestureSettings);
    return globalDistanceMoved > slop &&
        globalDistanceMoved > _maxVerticalDeviation * 1.6;
  }
}

/// Custom Painter for EnglishPod Hand-Drawn Smiley Brand Mark:
/// Strict drawing order per authentic sketch flow:
/// 1. Head loop: Drawn counter-clockwise (Top -> Left -> Bottom -> Right -> Top)
/// 2. Left eye: Drawn from top to bottom
/// 3. Right eye: Drawn from top to bottom
/// 4. Smile curve: Drawn from left to right
class _HandDrawnSmileyPainter extends CustomPainter {
  final double progress; // 0.0 to 1.0 (relative to drawing phase 0.0 to 0.80)
  final Color color;
  final bool isDark;
  final double bloom; // 0.0 to 1.0 (ambient illumination glow)

  _HandDrawnSmileyPainter({
    required this.progress,
    required this.color,
    required this.isDark,
    this.bloom = 0.0,
  });

  // Canonical AppIcon Vector Paths (Exact 1:1 match to home screen brand icon)
  static final Path _canonicalHead = Path()
    ..fillType = PathFillType.evenOdd
    ..moveTo(47.21, 27.11)
    ..cubicTo(48.52, 26.86, 49.60, 27.00, 50.59, 27.41)
    ..cubicTo(51.59, 27.81, 52.21, 29.30, 53.18, 29.54)
    ..cubicTo(54.15, 29.77, 55.18, 28.88, 56.41, 28.81)
    ..cubicTo(57.64, 28.74, 58.93, 28.68, 60.56, 29.14)
    ..cubicTo(62.19, 29.61, 64.62, 30.63, 66.19, 31.61)
    ..cubicTo(67.76, 32.59, 68.82, 33.73, 69.97, 35.03)
    ..cubicTo(71.12, 36.33, 72.01, 37.29, 73.09, 39.41)
    ..cubicTo(74.17, 41.53, 75.74, 45.46, 76.46, 47.74)
    ..cubicTo(77.17, 50.03, 77.23, 51.52, 77.39, 53.11)
    ..cubicTo(77.54, 54.70, 77.54, 55.75, 77.39, 57.29)
    ..cubicTo(77.23, 58.83, 76.96, 60.61, 76.46, 62.36)
    ..cubicTo(75.96, 64.11, 75.23, 66.13, 74.40, 67.80)
    ..cubicTo(73.57, 69.47, 72.55, 71.00, 71.47, 72.37)
    ..cubicTo(70.38, 73.73, 69.71, 74.71, 67.87, 75.97)
    ..cubicTo(66.02, 77.22, 63.02, 79.07, 60.41, 79.91)
    ..cubicTo(57.80, 80.75, 54.61, 81.03, 52.21, 80.99)
    ..cubicTo(49.81, 80.95, 47.79, 80.26, 46.01, 79.69)
    ..cubicTo(44.23, 79.12, 42.61, 78.19, 41.51, 77.59)
    ..cubicTo(40.40, 77.00, 40.48, 77.17, 39.38, 76.12)
    ..cubicTo(38.28, 75.07, 36.10, 72.95, 34.91, 71.29)
    ..cubicTo(33.71, 69.64, 32.82, 67.58, 32.21, 66.19)
    ..cubicTo(31.60, 64.80, 31.56, 64.39, 31.24, 62.96)
    ..cubicTo(30.93, 61.52, 30.47, 59.23, 30.31, 57.59)
    ..cubicTo(30.16, 55.95, 30.21, 54.60, 30.31, 53.11)
    ..cubicTo(30.42, 51.62, 30.48, 50.63, 30.94, 48.64)
    ..cubicTo(31.41, 46.66, 32.25, 43.40, 33.11, 41.21)
    ..cubicTo(33.97, 39.02, 35.19, 36.99, 36.11, 35.51)
    ..cubicTo(37.03, 34.03, 37.52, 33.42, 38.62, 32.32)
    ..cubicTo(39.73, 31.22, 41.28, 29.78, 42.71, 28.91)
    ..cubicTo(44.14, 28.04, 45.90, 27.36, 47.21, 27.11)
    ..close()
    ..moveTo(50.57, 30.50)
    ..cubicTo(50.42, 30.30, 47.82, 31.03, 46.31, 31.91)
    ..cubicTo(44.79, 32.79, 42.78, 34.48, 41.48, 35.78)
    ..cubicTo(40.18, 37.08, 39.50, 38.00, 38.51, 39.71)
    ..cubicTo(37.51, 41.41, 36.27, 43.97, 35.51, 46.01)
    ..cubicTo(34.75, 48.05, 34.31, 49.96, 33.94, 51.94)
    ..cubicTo(33.58, 53.93, 33.32, 55.96, 33.32, 57.90)
    ..cubicTo(33.32, 59.84, 33.50, 61.66, 33.94, 63.56)
    ..cubicTo(34.39, 65.46, 35.10, 67.65, 36.00, 69.30)
    ..cubicTo(36.91, 70.94, 38.19, 72.36, 39.38, 73.42)
    ..cubicTo(40.56, 74.49, 41.46, 75.04, 43.10, 75.70)
    ..cubicTo(44.75, 76.35, 47.48, 77.07, 49.24, 77.36)
    ..cubicTo(51.01, 77.64, 51.95, 77.64, 53.69, 77.39)
    ..cubicTo(55.43, 77.14, 58.13, 76.38, 59.67, 75.87)
    ..cubicTo(61.20, 75.35, 61.55, 75.25, 62.89, 74.29)
    ..cubicTo(64.23, 73.33, 66.51, 71.41, 67.72, 70.12)
    ..cubicTo(68.94, 68.84, 69.25, 68.45, 70.20, 66.60)
    ..cubicTo(71.16, 64.76, 72.81, 60.86, 73.46, 59.06)
    ..cubicTo(74.10, 57.25, 73.98, 57.43, 74.09, 55.79)
    ..cubicTo(74.19, 54.15, 74.44, 51.56, 74.09, 49.21)
    ..cubicTo(73.74, 46.86, 72.69, 43.56, 72.00, 41.70)
    ..cubicTo(71.31, 39.84, 70.78, 39.17, 69.97, 38.03)
    ..cubicTo(69.15, 36.90, 67.97, 35.68, 67.09, 34.91)
    ..cubicTo(66.21, 34.14, 65.68, 33.82, 64.69, 33.41)
    ..cubicTo(63.70, 33.00, 62.67, 32.49, 61.16, 32.44)
    ..cubicTo(59.64, 32.39, 57.46, 32.48, 55.61, 33.11)
    ..cubicTo(53.76, 33.74, 52.52, 34.22, 50.03, 36.23)
    ..cubicTo(47.55, 38.25, 42.40, 43.72, 40.72, 45.22)
    ..cubicTo(39.04, 46.73, 39.92, 45.91, 39.95, 45.24)
    ..cubicTo(39.98, 44.57, 40.43, 42.46, 40.91, 41.21)
    ..cubicTo(41.39, 39.96, 41.79, 39.09, 42.83, 37.73)
    ..cubicTo(43.88, 36.38, 45.89, 34.28, 47.18, 33.08)
    ..cubicTo(48.47, 31.87, 50.71, 30.69, 50.57, 30.50)
    ..close();

  static final Path _canonicalLeftEye = Path()
    ..moveTo(46.36, 47.86)
    ..cubicTo(46.53, 47.65, 46.88, 47.58, 47.28, 47.82)
    ..cubicTo(47.68, 48.06, 48.00, 47.71, 48.79, 49.31)
    ..cubicTo(49.58, 50.91, 51.75, 56.12, 52.04, 57.44)
    ..cubicTo(52.32, 58.75, 50.96, 57.48, 50.51, 57.19)
    ..cubicTo(50.05, 56.90, 50.01, 57.04, 49.31, 55.69)
    ..cubicTo(48.61, 54.34, 46.80, 50.39, 46.31, 49.09)
    ..cubicTo(45.82, 47.79, 46.20, 48.08, 46.36, 47.86)
    ..close();

  static final Path _canonicalRightEye = Path()
    ..moveTo(51.77, 45.16)
    ..cubicTo(51.56, 43.92, 52.91, 45.09, 53.47, 45.53)
    ..cubicTo(54.02, 45.98, 54.39, 46.24, 55.09, 47.81)
    ..cubicTo(55.79, 49.38, 57.47, 53.79, 57.65, 54.96)
    ..cubicTo(57.84, 56.12, 56.70, 55.12, 56.21, 54.79)
    ..cubicTo(55.72, 54.46, 55.46, 54.59, 54.72, 52.98)
    ..cubicTo(53.98, 51.38, 51.97, 46.40, 51.77, 45.16)
    ..close();

  static final Path _canonicalSmile = Path()
    ..moveTo(66.75, 51.17)
    ..cubicTo(67.12, 50.52, 68.00, 51.56, 68.47, 52.13)
    ..cubicTo(68.93, 52.71, 69.49, 53.30, 69.56, 54.64)
    ..cubicTo(69.63, 55.99, 69.55, 58.36, 68.89, 60.19)
    ..cubicTo(68.24, 62.02, 66.69, 64.24, 65.62, 65.62)
    ..cubicTo(64.55, 67.00, 63.57, 67.67, 62.47, 68.47)
    ..cubicTo(61.36, 69.26, 60.55, 69.85, 58.99, 70.39)
    ..cubicTo(57.43, 70.93, 55.00, 71.71, 53.10, 71.70)
    ..cubicTo(51.20, 71.68, 49.21, 71.14, 47.60, 70.30)
    ..cubicTo(45.99, 69.46, 44.57, 68.08, 43.43, 66.67)
    ..cubicTo(42.30, 65.25, 41.39, 63.16, 40.80, 61.80)
    ..cubicTo(40.21, 60.44, 39.98, 59.42, 39.91, 58.49)
    ..cubicTo(39.84, 57.56, 40.13, 56.40, 40.39, 56.23)
    ..cubicTo(40.66, 56.07, 40.88, 56.12, 41.50, 57.50)
    ..cubicTo(42.12, 58.88, 43.30, 62.95, 44.10, 64.50)
    ..cubicTo(44.90, 66.05, 45.31, 66.19, 46.31, 66.79)
    ..cubicTo(47.31, 67.39, 48.98, 67.89, 50.10, 68.10)
    ..cubicTo(51.23, 68.31, 52.02, 68.22, 53.06, 68.06)
    ..cubicTo(54.09, 67.89, 54.97, 67.72, 56.29, 67.09)
    ..cubicTo(57.61, 66.46, 59.67, 65.32, 60.97, 64.27)
    ..cubicTo(62.27, 63.22, 63.21, 62.16, 64.09, 60.79)
    ..cubicTo(64.97, 59.42, 65.81, 57.66, 66.26, 56.06)
    ..cubicTo(66.70, 54.46, 66.39, 51.83, 66.75, 51.17)
    ..close();

  // Dynamic Reveal Clipping Helpers
  static Path _createHeadClip(double t) {
    if (t <= 0.0) return Path();
    if (t >= 1.0) return Path()..addRect(const Rect.fromLTWH(0, 0, 108, 108));
    final path = Path();
    const double cx = 53.5;
    const double cy = 54.0;
    const double r = 45.0;
    const double startAngle = -math.pi / 2; // 12 o'clock
    final double sweep = t * (2 * math.pi + 0.18); // counter-clockwise
    path.moveTo(cx, cy);
    final int steps = math.max(4, (36 * t).round());
    for (int i = 0; i <= steps; i++) {
      final double a = startAngle - (sweep * i / steps);
      path.lineTo(cx + r * math.cos(a), cy + r * math.sin(a));
    }
    path.close();
    return path;
  }

  static Path _createLeftEyeClip(double t) {
    if (t <= 0.0) return Path();
    if (t >= 1.0) return Path()..addRect(const Rect.fromLTWH(0, 0, 108, 108));
    final double yCut = 47.0 + t * (59.0 - 47.0);
    return Path()..addRect(Rect.fromLTRB(40.0, 46.0, 56.0, yCut));
  }

  static Path _createRightEyeClip(double t) {
    if (t <= 0.0) return Path();
    if (t >= 1.0) return Path()..addRect(const Rect.fromLTWH(0, 0, 108, 108));
    final double yCut = 43.0 + t * (57.0 - 43.0);
    return Path()..addRect(Rect.fromLTRB(50.0, 42.0, 62.0, yCut));
  }

  static Path _createSmileClip(double t) {
    if (t <= 0.0) return Path();
    if (t >= 1.0) return Path()..addRect(const Rect.fromLTWH(0, 0, 108, 108));
    const double cx = 53.5;
    const double cy = 45.0;
    const double r = 38.0;
    const double startAngle = 2.53; // ~145 deg (left corner of smile)
    const double endAngle = 0.35;   // ~20 deg (right corner of smile)
    final path = Path()..moveTo(cx, cy);
    final int steps = math.max(3, (24 * t).round());
    for (int i = 0; i <= steps; i++) {
      final double a = startAngle - (t * (startAngle - endAngle) * i / steps);
      path.lineTo(cx + r * math.cos(a), cy + r * math.sin(a));
    }
    path.close();
    return path;
  }

  @override
  void paint(Canvas canvas, Size size) {
    final double scale = size.width / 108.0;
    canvas.save();
    canvas.scale(scale, scale);

    // Clean canvas without any gray background lines per user request!
    final fillPaint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;

    // Staggered sequence strictly in order:
    // 1. Head loop counter-clockwise (0.00 ~ 0.44) - immediate positive velocity on frame 1!
    // 2. Left eye top-to-bottom (0.44 ~ 0.58)
    // 3. Right eye top-to-bottom (0.58 ~ 0.72)
    // 4. Smile curve left-to-right (0.72 ~ 1.00)
    final double tHead = (progress / 0.44).clamp(0.0, 1.0);
    final double pHead = Curves.easeOutCubic.transform(tHead);
    // Guarantee that on frame 0, the head stroke is ALREADY visibly emerging and drawing!
    final double drawPHead = math.max(0.025, pHead);

    final double tLE = ((progress - 0.44) / 0.14).clamp(0.0, 1.0);
    final double pLE = Curves.easeOutCubic.transform(tLE);

    final double tRE = ((progress - 0.58) / 0.14).clamp(0.0, 1.0);
    final double pRE = Curves.easeOutCubic.transform(tRE);

    final double tSmile = ((progress - 0.72) / 0.28).clamp(0.0, 1.0);
    final double pSmile = Curves.easeOutCubic.transform(tSmile);

    // 1. Draw head (counter-clockwise) - unconditionally drawn so frame 0 has active stroke!
    canvas.save();
    canvas.clipPath(_createHeadClip(drawPHead));
    canvas.drawPath(_canonicalHead, fillPaint);
    canvas.restore();

    // 2. Draw left eye (top to bottom)
    if (tLE > 0.0) {
      canvas.save();
      canvas.clipPath(_createLeftEyeClip(pLE));
      canvas.drawPath(_canonicalLeftEye, fillPaint);
      canvas.restore();
    }

    // 3. Draw right eye (top to bottom)
    if (tRE > 0.0) {
      canvas.save();
      canvas.clipPath(_createRightEyeClip(pRE));
      canvas.drawPath(_canonicalRightEye, fillPaint);
      canvas.restore();
    }

    // 4. Draw smile (left to right)
    if (tSmile > 0.0) {
      canvas.save();
      canvas.clipPath(_createSmileClip(pSmile));
      canvas.drawPath(_canonicalSmile, fillPaint);
      canvas.restore();
    }

    // Bloom glow underneath when drawing is completed
    if (bloom > 0.01) {
      final glowPaint = Paint()
        ..color = color.withValues(alpha: (0.35 * bloom).clamp(0.0, 1.0))
        ..style = PaintingStyle.fill
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8.0);

      canvas.drawPath(_canonicalHead, glowPaint);
      canvas.drawPath(_canonicalLeftEye, glowPaint);
      canvas.drawPath(_canonicalRightEye, glowPaint);
      canvas.drawPath(_canonicalSmile, glowPaint);
    }

    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _HandDrawnSmileyPainter oldDelegate) {
    return oldDelegate.progress != progress ||
        oldDelegate.color != color ||
        oldDelegate.isDark != isDark ||
        oldDelegate.bloom != bloom;
  }
}

/// Animated Hand-Drawn Splash Overlay:
/// 1. Draws the EnglishPod hand-drawn smiley stroke-by-stroke (0.00 ~ 0.80):
///    - Head loop counter-clockwise (0.00 ~ 0.35)
///    - Left eye (0.35 ~ 0.46)
///    - Right eye (0.46 ~ 0.58)
///    - Smile curve (0.58 ~ 0.80)
/// 2. Joyful pulse & light bloom anticipation upon smile completion (0.80 ~ 0.85)
/// 3. Camera Zoom (Scale 1.0 -> 3.8) & seamless dissolve reveal (0.85 ~ 1.00)
class _EnglishPodAnimatedSplashOverlay extends StatelessWidget {
  final AnimationController controller;
  final AppPalette palette;
  final VoidCallback? onSkip;

  const _EnglishPodAnimatedSplashOverlay({
    required this.controller,
    required this.palette,
    this.onSkip,
  });

  @override
  Widget build(BuildContext context) {
    final double v = controller.value.clamp(0.0, 1.0);

    // Phase 1: Hand-drawn stroke progress (0.00 ~ 0.80)
    final double drawProgress = (v / 0.80).clamp(0.0, 1.0);

    // Phase 2: Joyful pulse and bloom on finished smile (0.80 ~ 0.85)
    final double pulseT = ((v - 0.80) / 0.05).clamp(0.0, 1.0);
    final double pulseScale = 1.0 + 0.045 * math.sin(math.pi * pulseT);
    final double bloom = pulseT;

    // Phase 3: Hero Camera Zoom (0.85 ~ 1.00) - Only triggers after smile is finished!
    final double zoomT = ((v - 0.85) / 0.15).clamp(0.0, 1.0);
    final double curvedZoom = Curves.easeInOutCubic.transform(zoomT);
    final double zoomScale = 1.0 + 2.8 * curvedZoom; // 1.0 -> 3.8
    final double totalScale = pulseScale * zoomScale;

    // Splash background and content opacities
    final double bgOpacity = (1.0 - 1.25 * curvedZoom).clamp(0.0, 1.0);
    final double contentOpacity = (1.0 - 1.25 * curvedZoom).clamp(0.0, 1.0);

    return IgnorePointer(
      ignoring: v >= 0.99,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onSkip,
        child: ColoredBox(
          color: palette.bgWell.withValues(alpha: bgOpacity),
          child: Center(
            child: Opacity(
              opacity: contentOpacity,
              child: Transform.scale(
                scale: totalScale,
                child: CustomPaint(
                  size: const Size(160, 160),
                  painter: _HandDrawnSmileyPainter(
                    progress: drawProgress,
                    color: palette.accent,
                    isDark: palette.isDark,
                    bloom: bloom,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class ImmersivePlayerScreen extends StatefulWidget {
  final ContractPlayer? webPlayer;
  final AppThemePreference initialPreference;

  const ImmersivePlayerScreen({
    this.webPlayer,
    super.key,
    this.initialPreference = AppThemePreference.system,
  });

  @override
  State<ImmersivePlayerScreen> createState() => _ImmersivePlayerScreenState();
}

class _ImmersivePlayerScreenState extends State<ImmersivePlayerScreen>
    with WidgetsBindingObserver, TickerProviderStateMixin {
  static const MethodChannel _wakelockChannel =
      MethodChannel('com.englishpod.trancy/wakelock');
  AppLifecycleState _appLifecycleState = AppLifecycleState.resumed;
  bool _lastKeepScreenOnApplied = false;

  ItemScrollController _itemScrollController = ItemScrollController();
  ItemPositionsListener _itemPositionsListener =
      ItemPositionsListener.create();
  final ScrollController _libraryScrollController =
      ScrollController(keepScrollOffset: false);
  double _lastLibraryViewportHeight = 520.0;
  final Map<String, double> _filterScrollOffsets = {
    'all': 0.0,
    'in_progress': 0.0,
    'completed': 0.0,
  };
  final ScrollController _vocabScrollController = ScrollController();

  // Two main screens: 'library' (Screen 1) and 'player' (Screen 2)
  String _activeScreen = 'library';
  String _libraryFilter = 'all'; // 'all', 'in_progress', 'completed'

  // Unified 2-Layer Navigation Controller (0.0 = Library Screen 1, 1.0 = Player Screen 2)
  // Drives both full-screen interactive right-swipe pop and button push/pop transitions
  // while keeping both screens permanently mounted in the Stack (zero unmount/remount flash!).
  late final AnimationController _screenTransitionController;
  // Explicit filter pill transition controller (only runs when user taps a filter chip)
  late final AnimationController _filterSwitchController;
  bool _isInteractivePopActive = false;
  bool _pointerInSliderZone = false;

  // Screen 2 inline view tab: 'pb' (Podcast), 'dg' (Dialogue), or 'vocab' (Inline Vocab)
  String _playerTab = 'pb';
  // Currently active audio source track ('pb' or 'dg')
  String _currentTrack = 'pb';

  // Directional slide state for P8 Page Slide transitions (+1 = forward/right, -1 = backward/left)
  int _tabSlideDirection = 1;
  int _filterSlideDirection = 1;

  // P21 Accordion state (`transitions.dev/detail.html?t=accordion`)
  final Set<String> _expandedVocabWords = {};
  final Set<int> _collapsedStageBoxIds = {};

  List<LessonSummary> _lessons = [];
  LessonDetail? _currentLesson;
  RegExp? _vocabHighlightRegex;

  Map<String, LessonProgressRecord> _progressMap = {};
  String _lastPlayedLessonId = '0001';

  int _activeSegIndex = 0;
  double _currentPositionSec = 0.0;
  double _durationSec = 1.0;
  bool _isPlaying = false;

  // Audio loading guard: prevents transient 0.0s emissions during setFilePath/setAsset
  // from ever resetting _currentPositionSec, _activeSegIndex, or saved progress!
  bool _isAudioLoading = false;
  bool _isDraggingSlider = false;
  int _audioLoadToken = 0;

  // EP-PBC-001: progress snapshots are serialised in the order they were taken.
  // A failed write must not poison the queue — the next snapshot rewrites the
  // whole state, so a transient storage failure self-heals instead of dropping
  // everything that follows it.
  Future<void> _progressWrites = Future<void>.value();
  int _progressRevision = 0;
  bool _progressSaved = true;

  /// Whether the last progress snapshot actually reached disk. Kept for the
  /// existing status surface; no layout depends on it.
  bool get progressSaved => _progressSaved;

  /// Audio load timeout: a stalled request must fail like any other failure
  /// instead of leaving the player half-loaded forever.
  static const Duration _audioLoadTimeout = Duration(seconds: 20);

  /// Starts playback and swallows the rejection.
  ///
  /// Browsers reject `play()` when no user gesture is present. Awaiting it
  /// unguarded turns that expected state into an uncaught async error, which
  /// also trips the Web boot smoke test. The player stream stays paused, so
  /// the UI needs no extra state for the blocked case.
  Future<void> _safePlay() async {
    try {
      await _globalPlayer.play();
    } catch (error) {
      final blocked = isAutoplayBlocked(error);
      debugPrint(
        blocked
            ? 'Playback waits for user gesture: $error'
            : 'Playback start failed: $error',
      );
    }
  }

  // Loop 1: Single-sentence loop
  bool _singleSentenceLoop = false;
  // Course completion mode: false = Auto-Next Episode (default), true = Repeat Current Episode
  bool _repeatCurrentEpisode = false;
  bool _handlingCompletion = false;

  static const List<(double, String)> _speedOptions = [
    (0.8, '0.8x · Slow & Clear'),
    (0.9, '0.9x · Slightly Slower'),
    (1.0, '1.0x · Normal Speed (Default)'),
    (1.1, '1.1x · Brisk'),
    (1.25, '1.25x · Fast Review'),
  ];
  double _currentSpeed = 1.0;

  ContractPlayer? _web;
  static const _webProgressKey = 'ep_web_learning_v2';
  bool _webChromeHidden = false;
  Timer? _webIdleTimer;
  Timer? _webLoadingIndicatorTimer;
  bool _webShowAudioLoading = false;
  static const _webLoadingIndicatorDelay = Duration(milliseconds: 400);
  final GlobalKey _webTranscriptKey = GlobalKey();
  double _webTextSize = 22;

  // Smart 5s Return Banner state
  bool _showReturnBanner = false;
  int _returnCountdown = 5;
  Timer? _returnCountdownTimer;
  int _programmaticScrollUntilMs = 0;
  int _lastDiskFlushMs = 0;

  StreamSubscription<Duration>? _posSub;
  StreamSubscription<Duration?>? _durSub;
  StreamSubscription<PlayerState>? _stateSub;

  int _tabIndexFor(String tabKey) {
    if (tabKey == 'pb') return 0;
    if (tabKey == 'dg') return 1;
    return 2;
  }

  int _filterIndexFor(String filterKey) {
    if (filterKey == 'all') return 0;
    if (filterKey == 'in_progress') return 1;
    return 2;
  }

  static const String _kThemePrefKey = 'user_theme_preference';
  AppThemePreference _themePreference = AppThemePreference.system;
  bool _systemIsDark =
      WidgetsBinding.instance.platformDispatcher.platformBrightness ==
          Brightness.dark;
  bool _isDarkTheme =
      WidgetsBinding.instance.platformDispatcher.platformBrightness ==
          Brightness.dark;
  Uri? _darkBrandArtUri;
  Uri? _lightBrandArtUri;

  // Theme Circular Reveal Animation State
  final GlobalKey _appRepaintKey = GlobalKey();
  final GlobalKey _libraryThemeSwitchKey = GlobalKey();
  late final AnimationController _themeRevealController;
  late final Animation<double> _themeRevealAnimation;
  ui.Image? _themeSnapshot;
  Offset _themeRevealCenter = Offset.zero;
  double _themeRevealMaxRadius = 1.0;
  bool _themeRevealIsForward = true;
  bool _isThemeRevealing = false;

  // Hand-Drawn Splash Screen Animation State
  late final AnimationController _splashAnimationController;
  bool _isSplashActive = true;
  bool _splashHapticFired = false;

  AppPalette _paletteFor(BuildContext context) {
    return _isDarkTheme ? AppPalette.dark : AppPalette.paper;
  }

  Uri? get _currentBrandArtUri {
    return _isDarkTheme ? _darkBrandArtUri : _lightBrandArtUri;
  }

  void _applyConfirmedBrightness(bool isDark) {
    _systemIsDark = isDark;
    if (_themePreference != AppThemePreference.system) {
      // User manual override has precedence over system changes
      return;
    }
    if (_isDarkTheme == isDark) {
      _audioHandler.setDefaultArtUri(_currentBrandArtUri);
      return;
    }
    _isDarkTheme = isDark;
    _audioHandler.setDefaultArtUri(_currentBrandArtUri);
    if (mounted) {
      setState(() {});
    }
  }


  double _computeMaxRadius(Offset center, Size size) {
    final double dx = math.max(center.dx, size.width - center.dx);
    final double dy = math.max(center.dy, size.height - center.dy);
    return math.sqrt(dx * dx + dy * dy) + 2.0;
  }

  Future<void> _toggleThemeWithCircularReveal(BuildContext buttonContext) async {
    if (_isThemeRevealing) return;
    _isThemeRevealing = true;
    unawaited(HapticFeedback.lightImpact());

    // Extract screen metrics and button coordinates BEFORE any async gaps
    final Size screenSize = MediaQuery.sizeOf(context);
    final double pixelRatio = MediaQuery.devicePixelRatioOf(context);
    final RenderBox? box = buttonContext.findRenderObject() as RenderBox?;
    final Offset center = box != null
        ? box.localToGlobal(box.size.center(Offset.zero))
        : screenSize.center(Offset.zero);
    final double maxRadius = _computeMaxRadius(center, screenSize);

    final bool currentDark = _isDarkTheme;
    final bool nextDark = !currentDark;

    // Single tap always sets explicit manual preference:
    // If next is dark -> AppThemePreference.dark (Button label: Dark)
    // If next is light -> AppThemePreference.light (Button label: Light)
    final AppThemePreference nextPref =
        nextDark ? AppThemePreference.dark : AppThemePreference.light;

    // Forward vs Reverse animation physics:
    // When expanding to Dark -> Forward (0.0 -> 1.0, dark circle expands outward)
    // When retracting to Light -> Reverse (1.0 -> 0.0, dark circle shrinks back into switch)
    final bool isForward = nextDark;

    // Persist preference
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kThemePrefKey, nextPref.name);
      unawaited(_wakelockChannel.invokeMethod('syncThemeOverride', {
        'preference': nextPref.name,
      }));
    } catch (_) {}

    // Capture snapshot of current screen
    final boundary = _appRepaintKey.currentContext?.findRenderObject()
        as RenderRepaintBoundary?;

    if (boundary == null) {
      if (mounted) {
        setState(() {
          _themePreference = nextPref;
          _isDarkTheme = nextDark;
        });
      }
      _audioHandler.setDefaultArtUri(_currentBrandArtUri);
      _isThemeRevealing = false;
      return;
    }

    if (boundary.debugNeedsPaint) {
      await WidgetsBinding.instance.endOfFrame;
    }

    ui.Image? image;
    try {
      image = await boundary.toImage(pixelRatio: pixelRatio);
    } catch (e) {
      debugPrint('Theme reveal snapshot error: $e');
    }

    if (image == null || !mounted) {
      if (mounted) {
        setState(() {
          _themePreference = nextPref;
          _isDarkTheme = nextDark;
        });
      }
      _audioHandler.setDefaultArtUri(_currentBrandArtUri);
      _isThemeRevealing = false;
      return;
    }

    _themeSnapshot?.dispose();
    _themeSnapshot = image;
    _themeRevealCenter = center;
    _themeRevealMaxRadius = maxRadius;
    _themeRevealIsForward = isForward;
    _themePreference = nextPref;
    _isDarkTheme = nextDark;
    _audioHandler.setDefaultArtUri(_currentBrandArtUri);

    setState(() {});

    if (isForward) {
      unawaited(_themeRevealController.forward(from: 0.0));
    } else {
      unawaited(_themeRevealController.reverse(from: 1.0));
    }
  }

  Future<void> _resetThemeToSystem(BuildContext buttonContext) async {
    if (_isThemeRevealing) return;

    if (_themePreference == AppThemePreference.system) {
      unawaited(HapticFeedback.selectionClick());
      return;
    }
    unawaited(HapticFeedback.mediumImpact());

    // Extract screen metrics and button coordinates BEFORE any async gaps
    final Size screenSize = MediaQuery.sizeOf(context);
    final double pixelRatio = MediaQuery.devicePixelRatioOf(context);
    final RenderBox? box = buttonContext.findRenderObject() as RenderBox?;
    final Offset center = box != null
        ? box.localToGlobal(box.size.center(Offset.zero))
        : screenSize.center(Offset.zero);
    final double maxRadius = _computeMaxRadius(center, screenSize);

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kThemePrefKey, 'system');
      unawaited(_wakelockChannel.invokeMethod('syncThemeOverride', {
        'preference': 'system',
      }));
    } catch (_) {}

    final bool targetDark = _systemIsDark;
    if (_isDarkTheme == targetDark) {
      if (mounted) {
        setState(() {
          _themePreference = AppThemePreference.system;
        });
      }
      return;
    }

    final boundary = _appRepaintKey.currentContext?.findRenderObject()
        as RenderRepaintBoundary?;
    if (boundary == null) {
      if (mounted) {
        setState(() {
          _themePreference = AppThemePreference.system;
          _isDarkTheme = targetDark;
        });
      }
      _audioHandler.setDefaultArtUri(_currentBrandArtUri);
      return;
    }

    if (boundary.debugNeedsPaint) {
      await WidgetsBinding.instance.endOfFrame;
    }

    ui.Image? image;
    try {
      image = await boundary.toImage(pixelRatio: pixelRatio);
    } catch (e) {
      debugPrint('Theme reveal snapshot error: $e');
    }

    if (image == null || !mounted) {
      if (mounted) {
        setState(() {
          _themePreference = AppThemePreference.system;
          _isDarkTheme = targetDark;
        });
      }
      _audioHandler.setDefaultArtUri(_currentBrandArtUri);
      return;
    }

    final bool isForward = targetDark;

    _isThemeRevealing = true;
    _themeSnapshot?.dispose();
    _themeSnapshot = image;
    _themeRevealCenter = center;
    _themeRevealMaxRadius = maxRadius;
    _themeRevealIsForward = isForward;
    _themePreference = AppThemePreference.system;
    _isDarkTheme = targetDark;
    _audioHandler.setDefaultArtUri(_currentBrandArtUri);

    setState(() {});
    if (isForward) {
      unawaited(_themeRevealController.forward(from: 0.0));
    } else {
      unawaited(_themeRevealController.reverse(from: 1.0));
    }
  }

  Widget _buildThemeToggleButton(AppPalette p) {
    final String label;
    if (_themePreference == AppThemePreference.system) {
      label = 'Auto';
    } else if (_isDarkTheme) {
      label = 'Dark';
    } else {
      label = 'Light';
    }

    final button = Builder(
      builder: (btnContext) {
        return _M3TactileScale(
          pressedScale: 0.93,
          onTap: () => _toggleThemeWithCircularReveal(btnContext),
          onLongPress: () => _resetThemeToSystem(btnContext),
          child: Container(
            key: _libraryThemeSwitchKey,
            height: 28,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: p.surfaceInset,
              borderRadius: BorderRadius.circular(9999),
              border: Border.all(
                color: _themePreference == AppThemePreference.system
                    ? p.border
                    : p.accent.withValues(alpha: 0.45),
                width: 1.0,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 250),
                  transitionBuilder: (child, anim) {
                    return ScaleTransition(
                      scale: anim,
                      child: RotationTransition(
                        turns: anim.drive(
                          Tween<double>(
                            begin: _isDarkTheme ? -0.2 : 0.2,
                            end: 0.0,
                          ),
                        ),
                        child: child,
                      ),
                    );
                  },
                  child: Icon(
                    _isDarkTheme
                        ? Icons.nightlight_round
                        : Icons.wb_sunny_rounded,
                    key: ValueKey('theme_icon_$_isDarkTheme'),
                    size: 13.5,
                    color: p.accent,
                  ),
                ),
                const SizedBox(width: 4.5),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: _themePreference == AppThemePreference.system
                        ? FontWeight.w600
                        : FontWeight.w700,
                    color: _themePreference == AppThemePreference.system
                        ? p.textPassed
                        : p.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
    return _useWeb
        ? ExcludeSemantics(excluding: _activeScreen != 'library',
            child: Semantics(button: true, label: 'Change appearance',
              hint: 'Current appearance: $label. Long press to follow system.',
              onTap: () => _toggleThemeWithCircularReveal(_libraryThemeSwitchKey.currentContext ?? context),
              onLongPress: () => _resetThemeToSystem(_libraryThemeSwitchKey.currentContext ?? context),
              excludeSemantics: true, child: button))
        : button;
  }

  Future<void> _syncSystemAppearanceFromPlatform() async {
    if (playback_platform.isIOS) {
      try {
        final confirmedDark =
            await _wakelockChannel.invokeMethod<bool>('getSystemIsDark');
        if (confirmedDark != null) {
          _applyConfirmedBrightness(confirmedDark);
        }
      } catch (_) {}
    } else {
      final isDark =
          WidgetsBinding.instance.platformDispatcher.platformBrightness ==
              Brightness.dark;
      _applyConfirmedBrightness(isDark);
    }
  }

  Future<void> _prepareBrandArtUris() async {
    try {
      final artwork = await playback_platform.prepareBrandArtwork();
      _darkBrandArtUri = artwork.$1;
      _lightBrandArtUri = artwork.$2;
      if (playback_platform.isIOS) {
        try {
          final confirmedDark = await _wakelockChannel.invokeMethod<bool>(
            'configureBrandArtwork',
            {
              'darkPath': artwork.$1.toFilePath(),
              'lightPath': artwork.$2.toFilePath(),
            },
          );
          if (confirmedDark != null) {
            _systemIsDark = confirmedDark;
            if (_themePreference == AppThemePreference.system) {
              _isDarkTheme = confirmedDark;
            }
          }
        } catch (_) {}
      } else {
        _systemIsDark =
            WidgetsBinding.instance.platformDispatcher.platformBrightness ==
                Brightness.dark;
        if (_themePreference == AppThemePreference.system) {
          _isDarkTheme = _systemIsDark;
        }
      }
      _audioHandler.setDefaultArtUri(_currentBrandArtUri);
    } catch (e) {
      debugPrint('Brand art init warning: $e');
    }
  }

  SystemUiOverlayStyle _systemOverlayFor(AppPalette p) {
    return SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: p.isDark ? Brightness.light : Brightness.dark,
      statusBarBrightness: p.isDark ? Brightness.dark : Brightness.light,
      systemNavigationBarColor: Colors.transparent,
      systemNavigationBarDividerColor: Colors.transparent,
      systemNavigationBarIconBrightness:
          p.isDark ? Brightness.light : Brightness.dark,
      systemNavigationBarContrastEnforced: false,
      systemStatusBarContrastEnforced: false,
    );
  }

  /// Keeps the screen awake (`FLAG_KEEP_SCREEN_ON`) strictly while audio is playing
  /// AND the app is in the foreground (`AppLifecycleState.resumed`).
  /// Releases the flag immediately when paused, stopped, or moved to the background.
  void _syncKeepScreenOn({bool force = false}) {
    if (_useWeb) return;
    final bool shouldKeepOn =
        _isPlaying && _appLifecycleState == AppLifecycleState.resumed;
    if (!force && shouldKeepOn == _lastKeepScreenOnApplied) return;
    _lastKeepScreenOnApplied = shouldKeepOn;
    unawaited(
      _wakelockChannel.invokeMethod<void>(
        'setKeepScreenOn',
        {'enable': shouldKeepOn},
      ).catchError((_) {}),
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _appLifecycleState = state;
    _syncKeepScreenOn(force: state == AppLifecycleState.resumed);
    if (_useWeb && state != AppLifecycleState.resumed) unawaited(_web?.checkpoint());
    if (state == AppLifecycleState.resumed) {
      unawaited(_syncSystemAppearanceFromPlatform());
    }
  }

  @override
  void didChangePlatformBrightness() {
    // On iOS, entering background triggers UIKit's automatic dual-appearance
    // (Light + Dark) App Switcher snapshot generator, which temporarily flips
    // FlutterViewController's traitCollection and leaves platformBrightness inverted!
    // Never trust raw platformBrightness on iOS when not resumed; rely on native
    // UIScreen.main.traitCollection verification via AppDelegate.swift.
    if (playback_platform.isIOS) {
      if (_appLifecycleState == AppLifecycleState.resumed) {
        unawaited(_syncSystemAppearanceFromPlatform());
      }
      return;
    }
    if (_appLifecycleState != AppLifecycleState.resumed) return;
    final isDark =
        WidgetsBinding.instance.platformDispatcher.platformBrightness ==
            Brightness.dark;
    _applyConfirmedBrightness(isDark);
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _appLifecycleState =
        WidgetsBinding.instance.lifecycleState ?? AppLifecycleState.resumed;
    _systemIsDark =
        WidgetsBinding.instance.platformDispatcher.platformBrightness ==
            Brightness.dark;
    _themePreference = widget.initialPreference;
    if (_themePreference == AppThemePreference.dark) {
      _isDarkTheme = true;
    } else if (_themePreference == AppThemePreference.light) {
      _isDarkTheme = false;
    } else {
      _isDarkTheme = _systemIsDark;
    }

    _themeRevealController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 440),
      value: 0.0,
    );
    _themeRevealAnimation = CurvedAnimation(
      parent: _themeRevealController,
      curve: Curves.easeInOutCubic,
      reverseCurve: Curves.easeInOutCubic,
    );
    _themeRevealController.addStatusListener((status) {
      if (status == AnimationStatus.completed ||
          status == AnimationStatus.dismissed) {
        _themeSnapshot?.dispose();
        _themeSnapshot = null;
        _isThemeRevealing = false;
        if (mounted) {
          setState(() {});
        }
      }
    });

    _splashAnimationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2000),
    );
    _splashAnimationController.addListener(() {
      if (_splashAnimationController.value >= 0.80 && !_splashHapticFired) {
        _splashHapticFired = true;
        HapticFeedback.lightImpact();
      }
    });
    _splashAnimationController.addStatusListener((status) {
      if (status == AnimationStatus.completed) {
        if (mounted && _isSplashActive) {
          setState(() {
            _isSplashActive = false;
          });
        }
      }
    });
    _splashAnimationController.forward();

    _wakelockChannel.setMethodCallHandler((call) async {
      if (call.method == 'onSystemAppearanceChanged') {
        final args = call.arguments;
        if (args is Map) {
          final isDark = args['isDark'];
          if (isDark is bool) {
            _applyConfirmedBrightness(isDark);
          }
        }
      }
    });
    _screenTransitionController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 280),
      value: 0.0,
    );
    _filterSwitchController = AnimationController(
      vsync: this,
      duration: _M3Motion.durFast,
      value: 1.0,
    );
    if (!_useWeb) {
      _audioHandler.onSkipToPreviousSentence = _prevSentence;
      _audioHandler.onSkipToNextSentence = _nextSentence;
    }
    _itemPositionsListener.itemPositions
        .addListener(_onTranscriptPositionsChanged);
    _setupAudioListeners();
    _loadInitialData();
  }

  bool get _useWeb => kIsWeb || widget.webPlayer != null;

  void _resetTranscriptScrollController() {
    _itemPositionsListener.itemPositions
        .removeListener(_onTranscriptPositionsChanged);
    _itemScrollController = ItemScrollController();
    _itemPositionsListener = ItemPositionsListener.create();
    _itemPositionsListener.itemPositions
        .addListener(_onTranscriptPositionsChanged);
  }
  int? _webReadIndex;
  double _webReadAlignment = 0, _webLastWidth = 0, _webLastFont = 0, _webLastHeight = 0;
  bool _webMoreOpen = false;
  ModalRoute<void>? _webMoreRoute;
  bool _webWide = true;
  bool _webRestoringAnchor = false;

  Future<void> _initWebPlayer() async {
    final supplied = widget.webPlayer;
    if (supplied != null) {
      _web = supplied;
    } else {
      SharedPreferences? storage;
      try { storage = await SharedPreferences.getInstance(); } catch (_) {}
      final prefs = storage;
      final raw = await rootBundle.loadString('assets/lessons_safe/index.json');
      if (!mounted) return;
      _web = ContractPlayer(
        audioFactory: WebContractAudio.new,
        readLesson: (id) async => LessonDetail.fromJson(jsonDecode(
          await rootBundle.loadString('assets/lessons_safe/lesson_$id.json')) as Map<String, dynamic>),
        write: (snapshot) async {
          if (prefs == null || !await prefs.setString(_webProgressKey, snapshot)) throw StateError('Storage unavailable');
        },
      )..lessons = (jsonDecode(raw) as List).map((e) => LessonSummary.fromJson(e as Map<String, dynamic>)).toList();
      try { _web!.restore(prefs?.getString(_webProgressKey)); } catch (_) { /* Invalid container type: start a fresh Web schema. */ }
    }
    if (!mounted) return;
    final w = _web!;
    w.addListener(_syncWebPlayer);
    _lessons = w.lessons;
    _syncWebPlayer();
    // Cold start shows the original library, never requests audio playback.
    // Loading a resume target supplies its PB card without deleting legacy data.
    final id = w.lessons.any((l) => l.lessonId == w.lastOpened) ? w.lastOpened : w.lessons.firstOrNull?.lessonId;
    if (id != null && w.lesson == null) await w.open(id, EntryIntent.preload, updateAnchor: w.lastOpened != null);
  }

  void _syncWebPlayer() {
    final w = _web;
    if (!mounted || w == null) return;
    final startedPlaying = !_isPlaying && w.playing;
    if (!w.playing || !w.wantsPlay || w.loading || w.error != null || w.waitingGesture) {
      _webIdleTimer?.cancel();
      _setWebChromeHidden(false);
    }
    if (w.loading) {
      // One continuous pending operation across resize/rapid track changes.
      // Fast loads never flash; tapping Play/Pause still updates the latest intent.
      if (!_webShowAudioLoading && _webLoadingIndicatorTimer == null) {
        _webLoadingIndicatorTimer = Timer(_webLoadingIndicatorDelay, () {
          _webLoadingIndicatorTimer = null;
          if (mounted && (_web?.loading ?? false)) {
            setState(() => _webShowAudioLoading = true);
          }
        });
      }
    } else {
      _webLoadingIndicatorTimer?.cancel();
      _webLoadingIndicatorTimer = null;
    }
    final identityChanged = _currentLesson?.lessonId != w.lesson?.lessonId || _currentTrack != w.track;
    final changedSentence = _activeSegIndex != w.activeIndex;
    if (identityChanged || (_playerTab == 'vocab' && w.tab != 'vocab')) {
      // Outgoing transcripts remain mounted for the original page-slide animation.
      // Give a new media identity its own list controller, never a resized window.
      _itemPositionsListener.itemPositions.removeListener(_onTranscriptPositionsChanged);
      _itemScrollController = ItemScrollController();
      _itemPositionsListener = ItemPositionsListener.create();
      _itemPositionsListener.itemPositions.addListener(_onTranscriptPositionsChanged);
    }
    if (identityChanged) {
      _vocabHighlightRegex = w.lesson == null ? null : _compileVocabRegex(w.lesson!.vocabulary);
      _collapsedStageBoxIds.clear();
      _expandedVocabWords.clear();
      _showReturnBanner = false;
      _webReadIndex = null;
    }
    setState(() {
      _lessons = w.lessons;
      _currentLesson = w.lesson;
      _lastPlayedLessonId = w.lastOpened ?? w.lessons.firstOrNull?.lessonId ?? '0001';
      _currentTrack = w.track;
      _playerTab = w.tab;
      if (!_isDraggingSlider) _currentPositionSec = w.position;
      _durationSec = w.duration > 0 ? w.duration : 1;
      _activeSegIndex = w.activeIndex;
      _isPlaying = w.playing;
      _isAudioLoading = w.loading;
      if (!w.loading) _webShowAudioLoading = false;
      _singleSentenceLoop = w.sentenceLoop;
      _repeatCurrentEpisode = w.trackLoop;
      _currentSpeed = w.rate;
      _progressMap = w.records.map((id, r) {
        final pb = r.tracks['pb']!, dg = r.tracks['dg']!;
        return MapEntry(id, LessonProgressRecord(
          isCompleted: r.completed,
          hasStarted: pb.position > 0 || dg.position > 0 || w.lastOpened == id,
          progressPct: pb.duration > 0 ? (pb.position / pb.duration * 100).floor().clamp(0,100) : 0,
          pbPosSec: pb.position, pbDurSec: pb.duration,
          dgPosSec: dg.position, dgDurSec: dg.duration,
        ));
      });
    });
    if (startedPlaying) _webTouch();
    if ((identityChanged || changedSentence) && !_showReturnBanner && !_webRestoringAnchor && w.tab != 'vocab') {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_showReturnBanner && !_webRestoringAnchor) {
          _safeScrollTranscriptToIndex(_activeSegIndex, isJump: identityChanged);
        }
      });
    }
  }

  void _setWebChromeHidden(bool value) {
    if (_webChromeHidden == value) return;
    _captureWebReadAnchor();
    setState(() => _webChromeHidden = value);
  }

  void _webTouch({bool reveal = true}) {
    if (reveal && _webChromeHidden) _setWebChromeHidden(false);
    _webIdleTimer?.cancel();
    if (!_webCanHide) return;
    _webIdleTimer = Timer(const Duration(seconds: 4), () {
      if (mounted && _webCanHide) {
        _setWebChromeHidden(true);
      }
    });
  }

  bool get _webCanHide => !_webWide && _activeScreen == 'player' &&
    (_web?.immersive ?? false) && (_web?.playing ?? false) &&
    (_web?.wantsPlay ?? false) && !(_web?.loading ?? true) &&
    _web?.error == null && !(_web?.waitingGesture ?? true) && !_webMoreOpen;

  void _captureWebReadAnchor() {
    if (!_showReturnBanner || _webRestoringAnchor) return;
    final visible = _itemPositionsListener.itemPositions.value
      .where((x) => x.itemTrailingEdge > 0 && x.itemLeadingEdge < 1 && x.itemTrailingEdge > x.itemLeadingEdge).toList()
      ..sort((a,b) => a.itemLeadingEdge.compareTo(b.itemLeadingEdge));
    if (visible.isNotEmpty) {
      _webReadIndex = visible.first.index;
      _webReadAlignment = visible.first.itemLeadingEdge;
    }
  }

  Widget _webButton(String label, IconData icon, AppPalette p, VoidCallback? action, {bool active = false}) {
    return Tooltip(message: label, excludeFromSemantics: true,
      decoration: BoxDecoration(color: p.deckBg, border: Border.all(color: p.border), borderRadius: BorderRadius.circular(8)),
      textStyle: TextStyle(color: p.textPrimary, fontSize: 12), child: Semantics(button: true, label: label, enabled: action != null,
      child: Opacity(opacity: action == null ? .35 : 1, child: IgnorePointer(ignoring: action == null,
        child: _M3TactileScale(onTap: () { _webTouch(); action?.call(); }, pressedScale: .93,
          child: Container(width: 48, height: 48, alignment: Alignment.center,
            decoration: BoxDecoration(color: active ? p.accentSoft : p.surface2,
              borderRadius: BorderRadius.circular(9999), border: Border.all(color: p.border)),
            child: Icon(icon, color: active ? p.accent : p.textPrimary, size: 24)))))));
  }

  Widget _webHero(AppPalette p) {
    final w = _web;
    final requested = w?.wantsPlay ?? false;
    final action = w?.ended == true ? 'Replay' : requested ? 'Pause' : 'Play';
    return Semantics(key: const ValueKey('web_audio_hero'), button: true, excludeSemantics: true,
      label: _webShowAudioLoading ? '$action · Loading audio' : action,
      child: Listener(onPointerDown: (_) => _webTouch(reveal: false),
        child: _HoldToReplayHeroButton(
        palette: p, isPlaying: requested, isEnded: w?.ended ?? false,
        isLoading: _webShowAudioLoading, fitHoldContent: true,
        onTap: () { _webTouch(reveal: false); unawaited(w?.setPlaying(!requested)); },
        onConfirmReplay: () => _restartCurrentTrackFromBeginning(),
      )));
  }

  Widget _webScrubber(AppPalette p) {
    final w = _web;
    return Semantics(label: 'Playback position', child: SliderTheme(
      data: SliderTheme.of(context).copyWith(trackHeight: 7,
        activeTrackColor: p.accent, inactiveTrackColor: p.surface2, thumbColor: p.accent,
        overlayColor: p.accentSoft, disabledActiveTrackColor: p.accent.withValues(alpha: .35),
        disabledInactiveTrackColor: p.surface2, disabledThumbColor: p.textPassed,
        thumbShape: _MetrolistVerticalThumbShape(width: 4, height: 18, borderColor: p.bottomBg),
        overlayShape: const RoundSliderOverlayShape(overlayRadius: 10)),
      child: Slider(value: (_currentPositionSec / _durationSec).clamp(0,1),
        onChangeStart: w == null || w.loading || w.error != null ? null : (_) => setState(() => _isDraggingSlider = true),
        onChanged: w == null || w.loading || w.error != null ? null : (v) => setState(() => _currentPositionSec = v * _durationSec),
        onChangeEnd: w == null || w.loading || w.error != null ? null : (v) async {
          setState(() => _isDraggingSlider = false);
          await w.seek(v * w.duration);
        },
      )));
  }

  Widget _webTime(AppPalette p) => Text('${_formatTime(_currentPositionSec)} / ${_formatTime(_durationSec)}',
    style: TextStyle(color: p.textPassed, fontSize: 11, fontWeight: FontWeight.w700,
      fontFeatures: const [FontFeature.tabularFigures()]));

  Widget _buildWebPlayer(AppPalette p) {
    final w = _web;
    return ColoredBox(key: const ValueKey('web_player'), color: p.bgWell,
      child: LayoutBuilder(builder: (context, box) {
        final wide = box.maxWidth >= 1000;
        if (_webWide != wide) {
          _webWide = wide;
          _webChromeHidden = false;
          _webIdleTimer?.cancel();
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            final route = _webMoreRoute;
            if (wide && route != null && route.isActive) route.navigator?.removeRoute(route);
            _webTouch();
          });
        }
        final immersive = !wide && (w?.immersive ?? false);
        final hidden = immersive && _webChromeHidden && _webCanHide;
        final right = wide && !hidden ? 276.0 : 0.0;
        final top = hidden ? 0.0 : 60.0;
        final bottom = !wide && !hidden ? 66.0 : 0.0;
        final readWidth = box.maxWidth - right;
        final readHeight = box.maxHeight - top - bottom;
        _webTextSize = (readWidth / (immersive ? 25 : 30)).clamp(22,38).toDouble();
        if (_webLastWidth != 0 && (_webLastWidth != readWidth || _webLastFont != _webTextSize || _webLastHeight != readHeight)) {
          final index = _showReturnBanner ? _webReadIndex : _activeSegIndex;
          final alignment = _showReturnBanner ? _webReadAlignment : .28;
          _webRestoringAnchor = true;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted && index != null && _itemScrollController.isAttached && _playerTab != 'vocab') {
              _itemScrollController.jumpTo(index: index.clamp(0, math.max(0, _activeSegments.length-1)), alignment: alignment);
            }
            _webRestoringAnchor = false;
          });
        }
        _webLastWidth = readWidth;
        _webLastHeight = readHeight;
        _webLastFont = _webTextSize;
        // Same transcript element/controller across resize and chrome changes.
        return Stack(clipBehavior: Clip.hardEdge, children: [
          Positioned(top: top, left: 0, right: right, bottom: bottom,
            child: SizedBox(key: const ValueKey('web_reading_area'),
              child: KeyedSubtree(key: _webTranscriptKey,
                child: ScrollConfiguration(
                  behavior: ScrollConfiguration.of(context).copyWith(scrollbars: false),
                  child: _currentLesson == null ? Center(child: CircularProgressIndicator(color: p.accent)) : _buildTranscriptBody(p))))),
          // The first gesture reveals controls only; it never reaches a sentence.
          if (hidden) Positioned.fill(child: Semantics(button: true, label: 'Show player controls',
            onTap: _webTouch, child: GestureDetector(key: const ValueKey('web_reveal_controls'),
              behavior: HitTestBehavior.opaque, onTap: _webTouch,
              onVerticalDragStart: (_) => _webTouch(),
              child: Listener(onPointerSignal: (_) => _webTouch(), child: const SizedBox.expand())))),
          if (!hidden) Positioned(top: 0, left: 0, right: right, height: 60,
            child: _buildPlayerTopBar(p)),
          // Wide controls are always in the sidebar; compact immersion keeps only
          // the hero visible. No persisted preference changes on viewport resize.
          if (wide) Positioned(top: 0, right: 0, bottom: 0, width: 276,
            child: Container(key: const ValueKey('web_control_deck'),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: p.bottomBg,
                border: Border(left: BorderSide(color: p.deckBorder))),
              child: Column(children: [
                _buildLessonInlineHeaderIfAvailable(p),
                const SizedBox(height: 16), SizedBox(height: 58, child: _webHero(p)),
                const SizedBox(height: 12), _webScrubber(p), _webTime(p), const SizedBox(height: 16),
                Expanded(child: SingleChildScrollView(child: _webOptions(p, showImmersive: false))),
              ]))),
          if (!wide) Positioned(left: 0, right: 0, bottom: 0, height: 66,
            child: Container(key: const ValueKey('web_control_deck'),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: hidden ? null : BoxDecoration(color: p.bottomBg),
              // Paint the separator without adding a 1px layout inset to the hero.
              foregroundDecoration: hidden ? null : BoxDecoration(border: Border(top: BorderSide(color: p.deckBorder))),
              child: Row(children: [
                SizedBox(width: 160, height: 58, child: _webHero(p)),
                if (hidden) const Spacer() else Expanded(child: _webScrubber(p)),
                if (!hidden) _webTime(p), const SizedBox(width: 8),
                if (!hidden) _webButton('More', Icons.more_horiz_rounded, p, () => _showWebMore(p)),
              ]))),
          Positioned(left: 0, right: right, bottom: hidden ? (wide ? 90 : 66) : bottom,
            child: Semantics(label: _showReturnBanner ? 'Manual transcript reading. Current sentence' : null, child: _buildFullWidthReturnBanner(p))),
          if (w != null && (w.error != null || w.waitingGesture || !w.saved))
            Positioned(left: 16, right: right + 16, top: hidden ? 16 : 64, child: _webStatus(p)),
        ]);
      }));
  }

  Widget _buildLessonInlineHeaderIfAvailable(AppPalette p) => _currentLesson == null ? const SizedBox() : _buildLessonInlineHeader(_currentLesson!, p);

  Widget _webStatus(AppPalette p) {
    final w = _web!;
    final message = w.error ?? (w.waitingGesture ? 'Tap Play to start audio.'
      : 'Progress is not saved. It remains available in this session.');
    return Container(padding: const EdgeInsets.all(8), decoration: BoxDecoration(color: p.deckBg,
      borderRadius: BorderRadius.circular(12), border: Border.all(color: p.stageBoxBorder)),
      child: Row(children: [Expanded(child: Text(message, style: TextStyle(color: p.textPrimary))),
        if (w.error != null) TextButton(style: TextButton.styleFrom(foregroundColor: p.accent), onPressed: () => w.retry(), child: Text('Retry', style: TextStyle(color: p.accent))),
        if (w.error != null) TextButton(style: TextButton.styleFrom(foregroundColor: p.accent), onPressed: _returnToLibraryScreen, child: Text('Library', style: TextStyle(color: p.accent))),
      ]));
  }

  Widget _webOptions(AppPalette p, {VoidCallback? refresh, bool showImmersive = true}) {
    final w = _web;
    if (w == null) return const SizedBox();
    Widget option(String label, bool value, VoidCallback toggle) => SwitchListTile(
      dense: true, contentPadding: EdgeInsets.zero, title: Text(label, style: TextStyle(color: p.textPrimary, fontSize: 13)),
      activeThumbColor: p.accent, activeTrackColor: p.accentSoft,
      inactiveThumbColor: p.textPassed, inactiveTrackColor: p.surface2,
      trackOutlineColor: WidgetStateProperty.all(p.border), value: value, onChanged: (_) { _webTouch(); toggle(); refresh?.call(); });
    return Material(type: MaterialType.transparency, child: Column(mainAxisSize: MainAxisSize.min, children: [
      Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
        _webButton('Previous sentence', Icons.skip_previous_rounded, p, w.loading ? null : _prevSentence),
        _webButton('Previous lesson', Icons.fast_rewind_rounded, p, w.canNavigate(-1) ? () => unawaited(w.navigate(-1)) : null),
        _webButton('Next lesson', Icons.fast_forward_rounded, p, w.canNavigate(1) ? () => unawaited(w.navigate(1)) : null),
        _webButton('Next sentence', Icons.skip_next_rounded, p, w.loading ? null : _nextSentence),
      ]),
      option('Sentence loop', w.sentenceLoop, w.toggleSentenceLoop),
      option('Track loop', w.trackLoop, w.toggleTrackLoop),
      option('Auto-next Podcast', w.autoNext, w.toggleAutoNext),
      if (showImmersive) option('Immersive mode', w.immersive, () { w.toggleImmersive(); _webTouch(); }),
      TextButton(style: TextButton.styleFrom(foregroundColor: p.accent), onPressed: () => _showSpeedPickerModal(p), child: Text('Speed ${_formatSpeedMultiplier(w.rate)}', style: TextStyle(color: p.accent))),
      TextButton(style: TextButton.styleFrom(foregroundColor: p.accent), onPressed: _snapBackToActiveSentence, child: Text('Current sentence', style: TextStyle(color: p.accent))),
    ]));
  }

  Future<void> _showWebMore(AppPalette p) async {
    final w = _web;
    if (w == null) return;
    _webMoreOpen = true;
    _webTouch();
    await showModalBottomSheet<void>(context: context, backgroundColor: p.deckBg,
      builder: (context) {
        _webMoreRoute = ModalRoute.of<void>(context);
        return AnimatedBuilder(animation: w, builder: (context, _) => SafeArea(
          child: SingleChildScrollView(padding: const EdgeInsets.all(24),
            child: _webOptions(p, showImmersive: MediaQuery.sizeOf(context).width < 1000))));
      });
    _webMoreRoute = null;
    _webMoreOpen = false;
    if (mounted) _webTouch();
  }

  void _setupAudioListeners() {
    if (_useWeb) return;
    _posSub = _globalPlayer
        .createPositionStream(
          steps: 800,
          minPeriod: const Duration(milliseconds: 40),
          maxPeriod: const Duration(milliseconds: 60),
        )
        .listen((pos) {
      if (_isAudioLoading) return;
      final sec = pos.inMilliseconds / 1000.0;
      _onPositionTick(sec);
    });
    _durSub = _globalPlayer.durationStream.listen((dur) {
      if (dur != null && dur.inMilliseconds > 0 && mounted) {
        final dSec = dur.inMilliseconds / 1000.0;
        setState(() {
          _durationSec = dSec;
        });
      }
    });
    _stateSub = _globalPlayer.playerStateStream.listen((st) {
      final bool nowPlaying =
          st.playing && st.processingState != ProcessingState.completed;
      if (mounted) {
        setState(() {
          _isPlaying = nowPlaying;
        });
      } else {
        _isPlaying = nowPlaying;
      }
      _syncKeepScreenOn();
      if (!_isAudioLoading && st.processingState == ProcessingState.completed) {
        _onTrackPlaybackCompleted();
      }
    });
  }

  /// Finds the active transcript segment index for `sec` using the Dynamic 0.5s Pre-Scroll Rule:
  /// - For each spoken sentence `i`, let `gap = s.start - prevSpokenEnd`.
  /// - If `gap >= 0.5s`, advance & scroll to sentence `i` **0.5s early** (`triggerStart = s.start - 0.5`)
  ///   so the scroll animation settles right as the speaker's voice begins.
  /// - If `gap < 0.5s`, advance & scroll at the **original timestamp** (`triggerStart = s.start`)
  ///   so the preceding sentence is never cut off early.
  int _findSegmentIndexForSec(
    List<TranscriptSegment> segs,
    double sec, {
    int fallbackIdx = 0,
  }) =>
      findActiveTranscriptSegmentIndex(
        segs,
        sec,
        fallbackIdx: fallbackIdx,
      );

  Future<void> _onTrackPlaybackCompleted() async {
    if (_handlingCompletion || !mounted) return;
    _handlingCompletion = true;
    try {
      // Only mark overall lesson 100% complete when Podcast ('pb') finishes!
      await _saveProgressSnapshot(
        forceDiskFlush: true,
        markPbComplete: _currentTrack == 'pb',
      );
      if (_singleSentenceLoop) {
        final segs = _activeSegments;
        if (segs.isNotEmpty) {
          final cur = segs[_activeSegIndex.clamp(0, segs.length - 1)];
          await _globalPlayer.seek(
            Duration(milliseconds: (cur.start * 1000).round()),
          );
          await _safePlay();
        }
      } else if (_repeatCurrentEpisode) {
        // Repeat Current Episode from beginning (locked seek + Replay 0% reset)
        await _restartCurrentTrackFromBeginning(
          showToast: false,
          allowBackgroundAutoPlay: true,
        );
      } else {
        // Default: Auto-advance and continue playing Next Podcast Episode
        // Pass saveOutgoing: false so the just-saved 100% completion is never overwritten!
        await _switchEpisode(1, autoPlay: true, saveOutgoing: false);
      }
    } finally {
      Future.delayed(const Duration(milliseconds: 500), () {
        _handlingCompletion = false;
      });
    }
  }

  Future<void> _loadInitialData() async {
    if (_useWeb) { await _initWebPlayer(); return; }
    await _prepareBrandArtUris();
    final prefs = await SharedPreferences.getInstance();
    final savedLastLesson = prefs.getString('ep_last_lesson_id') ?? '0001';
    final rawProgress = prefs.getString('ep_study_progress_v1');

    final Map<String, LessonProgressRecord> loadedProgress = {};
    if (rawProgress != null && rawProgress.isNotEmpty) {
      try {
        final decodedMap = jsonDecode(rawProgress) as Map<String, dynamic>;
        decodedMap.forEach((k, v) {
          if (v is Map<String, dynamic>) {
            loadedProgress[k] = LessonProgressRecord.fromJson(v);
          }
        });
      } catch (_) {}
    }

    final rawIndex = await rootBundle.loadString('assets/lessons_safe/index.json');
    final List<dynamic> decoded = jsonDecode(rawIndex) as List<dynamic>;
    final lessons = decoded
        .map((e) => LessonSummary.fromJson(e as Map<String, dynamic>))
        .toList();

    if (!mounted) return;
    final targetId = lessons.isNotEmpty
        ? (lessons.any((l) => l.lessonId == savedLastLesson)
            ? savedLastLesson
            : lessons.first.lessonId)
        : savedLastLesson;

    setState(() {
      _lessons = lessons;
      _progressMap = loadedProgress;
      _lastPlayedLessonId = targetId;
      final initialOffset = _computeCenteredLibraryOffset(
        targetLessonId: targetId,
        filterKey: _libraryFilter,
        viewportHeight: _lastLibraryViewportHeight,
      );
      _filterScrollOffsets[_libraryFilter] = initialOffset;
    });

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _centerActiveLessonInLibrary(animate: false);
    });

    if (lessons.isNotEmpty) {
      final savedTrack = loadedProgress[targetId]?.lastTrack ?? 'pb';
      final validTrack = (savedTrack == 'dg') ? 'dg' : 'pb';
      await _loadLesson(targetId, track: validTrack, autoPlay: false);
      if (mounted && _activeScreen == 'library') {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          _centerActiveLessonInLibrary(animate: false);
        });
      }
    }
  }

  void _animateToPlayerScreen() {
    if (_useWeb) {
      WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) _webTouch(); });
    }
    _isInteractivePopActive = false;
    _activeScreen = 'player';
    _screenTransitionController
        .animateTo(
          1.0,
          duration: const Duration(milliseconds: 280),
          curve: _M3Motion.easeSmoothOut,
        )
        .then((_) {
      if (mounted &&
          _activeScreen == 'player' &&
          !_isInteractivePopActive &&
          _screenTransitionController.value >= 0.99) {
        _syncLibraryScrollWhileHidden();
      }
    });
  }

  /// Silently ensures the Course Library (Layer 0, underneath the opaque Player screen)
  /// is on `'all'` filter and centered on the active episode while `navT == 1.0`.
  /// Because Layer 0 is permanently mounted in the 2-layer Stack, this updates
  /// `_libraryScrollController` while Layer 0 is 100% covered by Layer 1, so that when
  /// the user later swipes back or taps `< Library`, the Course Library is ALREADY
  /// at the exact centered scroll offset with zero jump, rebuild, or animation flash!
  void _syncLibraryScrollWhileHidden() {
    if (!mounted) return;
    if (_libraryFilter != 'all') {
      setState(() {
        _libraryFilter = 'all';
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _centerActiveLessonInLibrary(
            animate: false,
            allowWhileOnPlayer: true,
          );
        }
      });
    } else {
      _centerActiveLessonInLibrary(
        animate: false,
        allowWhileOnPlayer: true,
      );
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _centerActiveLessonInLibrary(
            animate: false,
            allowWhileOnPlayer: true,
          );
        }
      });
    }
  }

  RegExp? _compileVocabRegex(List<VocabEntry> vocab) {
    final words = vocab
        .map((v) => v.word.trim())
        .where((w) => w.length >= 2)
        .toSet()
        .toList();
    if (words.isEmpty) return null;
    words.sort((a, b) => b.length.compareTo(a.length));
    final pattern = words.map(RegExp.escape).join('|');
    return RegExp(r'\b(?:' + pattern + r')\b', caseSensitive: false);
  }

  /// Flushes the in-memory `_progressMap` and `lastLessonId` to `SharedPreferences`,
  /// even while `_isAudioLoading` is active (e.g. entering or restarting a lesson
  /// at `0%` and immediately navigating back to the Library).
  ///
  /// The snapshot is queued behind every earlier one and encoded synchronously at
  /// call time, so a later tick cannot retroactively change what an earlier write
  /// persists. Writes therefore land in revision order even when the platform
  /// store is slow, and a failure is recorded instead of breaking the queue.
  Future<void> _flushProgressToPrefs(String lastLessonId) {
    _lastDiskFlushMs = DateTime.now().millisecondsSinceEpoch;
    final int revision = ++_progressRevision;
    final String lessonSnapshot = lastLessonId;
    final String encoded =
        jsonEncode(_progressMap.map((k, v) => MapEntry(k, v.toJson())));
    _progressWrites = _progressWrites.then((_) async {
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('ep_last_lesson_id', lessonSnapshot);
        await prefs.setString('ep_study_progress_v1', encoded);
        _progressSaved = true;
      } catch (error) {
        _progressSaved = false;
        debugPrint('Progress snapshot $revision not persisted: $error');
      }
    });
    return _progressWrites;
  }

  /// Updates in-memory `_progressMap` immediately (so switching tabs NEVER loses state)
  /// and flushes to `SharedPreferences` either periodically or immediately when `forceDiskFlush` is true.
  /// - `progressPct` (`0..100`) always reflects the real-time current position of Podcast (`pb`),
  ///   using `.floor()` (and `0%` for the first 3 seconds) so entering from zero and exiting stays `0%`.
  /// - `isCompleted` permanently records whether Podcast (`pb`) has ever reached completion (`>= 95%`).
  /// - `hasStarted` permanently records that the user has opened/started this lesson so it never reverts to `New`.
  Future<void> _saveProgressSnapshot({
    bool forceDiskFlush = false,
    bool markPbComplete = false,
  }) async {
    if (_useWeb) { await _web?.checkpoint(); return; }
    final lesson = _currentLesson;
    if (lesson == null) return;
    if (_isAudioLoading && !markPbComplete) {
      if (forceDiskFlush) {
        await _flushProgressToPrefs(lesson.lessonId);
      }
      return;
    }

    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final lid = lesson.lessonId;
    final prev = _progressMap[lid] ?? const LessonProgressRecord();

    final nextRec = nextLessonProgressSnapshot(
      prev: prev,
      track: _currentTrack,
      currentPositionSec: _currentPositionSec,
      currentSegmentIndex: _activeSegIndex,
      durationSec: _durationSec,
      playing: _isPlaying,
      viewingPlayer: _activeScreen == 'player',
      markPbComplete: markPbComplete,
      nowMs: nowMs,
    );

    _progressMap[lid] = nextRec;
    _lastPlayedLessonId = lid;

    if (!forceDiskFlush && nowMs - _lastDiskFlushMs < 2500) return;
    await _flushProgressToPrefs(lid);
  }

  /// Restarts the active (or specified) audio track of the current lesson from `00:00`,
  /// resetting replay progress to `0%` and smoothly scrolling to the top.
  Future<void> _restartCurrentTrackFromBeginning({
    String? forceTrack,
    bool switchToPlayer = false,
    bool resetBothTracks = false,
    bool showToast = true,
    bool autoPlay = true,
    bool allowBackgroundAutoPlay = false,
  }) async {
    if (_useWeb) {
      final w = _web;
      if (w == null || w.loading) return;
      if (switchToPlayer) setState(_animateToPlayerScreen);
      final pending = forceTrack != null && forceTrack != w.track ? w.switchTrack(forceTrack) : Future<void>.value();
      final my = w.generation;
      await pending;
      if (my == w.generation) await w.restart(requestPlay: autoPlay);
      return;
    }
    final lesson = _currentLesson;
    if (lesson == null) return;

    _hideReturnBanner();
    final String targetTrack =
        (forceTrack == 'dg' || forceTrack == 'pb') ? forceTrack! : _currentTrack;

    final lid = lesson.lessonId;
    final prevRec = _progressMap[lid] ?? const LessonProgressRecord();
    final bool wasCompleted =
        prevRec.isCompleted || prevRec.progressPct >= 95;

    final bool resetPb = targetTrack == 'pb' || resetBothTracks;
    final bool resetDg = targetTrack == 'dg' || resetBothTracks;

    _progressMap[lid] = prevRec.copyWith(
      isCompleted: wasCompleted,
      hasStarted: true,
      progressPct: resetPb ? 0 : prevRec.progressPct,
      lastTrack: targetTrack,
      pbPosSec: resetPb ? 0.0 : prevRec.pbPosSec,
      pbSegIdx: resetPb ? 0 : prevRec.pbSegIdx,
      dgPosSec: resetDg ? 0.0 : prevRec.dgPosSec,
      dgSegIdx: resetDg ? 0 : prevRec.dgSegIdx,
      updatedAtMs: DateTime.now().millisecondsSinceEpoch,
    );
    unawaited(_flushProgressToPrefs(lid));

    if (targetTrack != _currentTrack) {
      // AnimatedSwitcher keeps the outgoing transcript mounted during the
      // transition. Give the incoming track its own controller so both lists
      // never attach to the same ItemScrollController.
      _resetTranscriptScrollController();

      // Lock immediately before switching track state so no stale tick can fire
      _isAudioLoading = true;
      ++_audioLoadToken;
      final int oldIdx = _tabIndexFor(_playerTab);
      final int newIdx = _tabIndexFor(targetTrack);
      setState(() {
        if (switchToPlayer) {
          _animateToPlayerScreen();
        }
        _tabSlideDirection = newIdx >= oldIdx ? 1 : -1;
        _playerTab = targetTrack;
        _currentTrack = targetTrack;
        _currentPositionSec = 0.0;
        _activeSegIndex = 0;
        _collapsedStageBoxIds.clear();
      });
      await _loadTrackAudio(
        targetTrack,
        autoPlay: autoPlay,
        initialSeekSec: 0.0,
        initialSegIndex: 0,
        allowBackgroundAutoPlay: allowBackgroundAutoPlay || !switchToPlayer,
      );
      return;
    }

    // Lock _isAudioLoading during seek(Duration.zero) so stale pre-seek position ticks
    // from just_audio can NEVER overwrite _currentPositionSec or progressPct!
    final int myToken = ++_audioLoadToken;
    _isAudioLoading = true;

    final segs = lesson.segmentsForTrack(targetTrack);
    final int firstSpokenIdx = _findSegmentIndexForSec(segs, 0.0, fallbackIdx: 0);

    setState(() {
      if (switchToPlayer) {
        _animateToPlayerScreen();
      }
      if (forceTrack != null || (switchToPlayer && _playerTab == 'vocab')) {
        _playerTab = targetTrack;
      }
      _currentPositionSec = 0.0;
      _activeSegIndex = firstSpokenIdx;
      _collapsedStageBoxIds.clear();
    });

    if (_activeScreen == 'player' &&
        _playerTab != 'vocab' &&
        _itemScrollController.isAttached &&
        segs.isNotEmpty) {
      _programmaticScrollUntilMs =
          DateTime.now().millisecondsSinceEpoch + 900;
      _itemScrollController.scrollTo(
        index: 0,
        duration: _M3Motion.durScroll,
        curve: _M3Motion.easeSmoothOut,
        alignment: 0.0,
      );
    } else if (_activeScreen == 'player' && _playerTab != 'vocab') {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_itemScrollController.isAttached && _activeSegments.isNotEmpty) {
          _programmaticScrollUntilMs =
              DateTime.now().millisecondsSinceEpoch + 900;
          _itemScrollController.scrollTo(
            index: 0,
            duration: _M3Motion.durScroll,
            curve: _M3Motion.easeSmoothOut,
            alignment: 0.0,
          );
        }
      });
    }

    try {
      await _globalPlayer.seek(Duration.zero);
      await Future.delayed(const Duration(milliseconds: 65));
      if (myToken != _audioLoadToken) return;
      if (mounted) {
        setState(() {
          _currentPositionSec = 0.0;
          _activeSegIndex = firstSpokenIdx;
        });
      }
      _isAudioLoading = false;
      await _saveProgressSnapshot(forceDiskFlush: true);
      final bool canAutoPlayNow = autoPlay &&
          (allowBackgroundAutoPlay ||
              !switchToPlayer ||
              _activeScreen == 'player');
      if (canAutoPlayNow && !_globalPlayer.playing && myToken == _audioLoadToken) {
        unawaited(_safePlay());
      }
    } catch (_) {
      if (myToken == _audioLoadToken) {
        _isAudioLoading = false;
      }
    }
  }

  /// Unified Home -> Player Entry ("同课直入、异课续播", plus `startFromBeginning` on Long Press,
  /// and automatic new-cycle replay from `00:00` when re-entering any finished `>= 95%` lesson):
  Future<void> _openLessonFromLibrary(
    String lessonId, {
    required bool autoPlayIfPaused,
    bool startFromBeginning = false,
    bool resume = false,
  }) async {
    if (_useWeb) {
      final w = _web;
      if (w == null) return;
      setState(_animateToPlayerScreen);
      final pending = w.open(lessonId, resume ? EntryIntent.resume : EntryIntent.library,
        requestPlay: true);
      final my = w.generation;
      await pending;
      if (my == w.generation && startFromBeginning && w.lesson?.lessonId == lessonId && !w.loading) {
        await w.restart();
      }
      return;
    }
    _hideReturnBanner();

    final rec = _progressMap[lessonId];
    // Whenever a lesson is currently in the finished state (`progressPct >= 95`),
    // re-entering it (whether from the Course List or Pinned Top Live Card)
    // automatically begins a fresh replay cycle at `00:00` (`Replay 0%`)!
    final bool isReenteringFinishedLesson =
        rec != null && rec.progressPct >= 95;
    final bool shouldStartAtZero =
        startFromBeginning || isReenteringFinishedLesson;

    final bool isAlreadyLoadedLesson = _currentLesson?.lessonId == lessonId;
    if (isAlreadyLoadedLesson) {
      if (shouldStartAtZero) {
        await _restartCurrentTrackFromBeginning(
          forceTrack: 'pb',
          switchToPlayer: true,
          resetBothTracks: startFromBeginning,
          showToast: startFromBeginning,
          autoPlay: startFromBeginning ? true : autoPlayIfPaused,
        );
        return;
      }
      // Mark lesson as started even on direct entry so returning at 0% shows Resume 0% / Replay 0%
      final prevRec = _progressMap[lessonId] ?? const LessonProgressRecord();
      _progressMap[lessonId] = prevRec.copyWith(
        hasStarted: true,
        updatedAtMs: DateTime.now().millisecondsSinceEpoch,
      );
      unawaited(_flushProgressToPrefs(lessonId));

      // Zero-Reload Direct Entry: preserve _currentTrack, _currentPositionSec, and _activeSegIndex!
      setState(() {
        _animateToPlayerScreen();
        // If user was on Vocab tab, show the active audio track tab ('pb' or 'dg')
        if (_playerTab == 'vocab') {
          _playerTab = _currentTrack;
        }
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _jumpToActiveSentenceImmediate();
      });
      if (autoPlayIfPaused && !_globalPlayer.playing) {
        unawaited(_safePlay());
      }
      return;
    }

    // Switching to a different lesson:
    // 1. Flush outgoing lesson progress BEFORE locking or changing lesson state
    await _saveProgressSnapshot(forceDiskFlush: true);

    // 2. Immediately lock _isAudioLoading and pause the outgoing player BEFORE loading new JSON
    //    so stale position ticks from the old lesson can NEVER pollute the new lesson!
    _isAudioLoading = true;
    ++_audioLoadToken;
    unawaited(_globalPlayer.pause());

    final targetTrack =
        shouldStartAtAtZeroTrack(rec, shouldStartAtZero: shouldStartAtZero);
    final bool wasCompleted =
        (rec?.isCompleted ?? false) || (rec?.progressPct ?? 0) >= 95;

    if (shouldStartAtZero) {
      final prevRec = rec ?? const LessonProgressRecord();
      _progressMap[lessonId] = prevRec.copyWith(
        isCompleted: wasCompleted,
        hasStarted: true,
        progressPct: 0,
        lastTrack: 'pb',
        pbPosSec: 0.0,
        pbSegIdx: 0,
        dgPosSec: startFromBeginning ? 0.0 : prevRec.dgPosSec,
        dgSegIdx: startFromBeginning ? 0 : prevRec.dgSegIdx,
        updatedAtMs: DateTime.now().millisecondsSinceEpoch,
      );
    } else {
      final prevRec = rec ?? const LessonProgressRecord();
      _progressMap[lessonId] = prevRec.copyWith(
        hasStarted: true,
        updatedAtMs: DateTime.now().millisecondsSinceEpoch,
      );
    }
    unawaited(_flushProgressToPrefs(lessonId));

    _resetTranscriptScrollController();
    setState(() {
      _animateToPlayerScreen();
      _playerTab = targetTrack;
      _currentTrack = targetTrack;
      _lastPlayedLessonId = lessonId;
      if (shouldStartAtZero) {
        _currentPositionSec = 0.0;
        _activeSegIndex = 0;
      }
    });

    await _loadLesson(
      lessonId,
      track: targetTrack,
      autoPlay: startFromBeginning ? true : autoPlayIfPaused,
      resumeSavedPosition: !shouldStartAtZero,
      allowBackgroundAutoPlay: false,
    );
  }

  String shouldStartAtAtZeroTrack(
    LessonProgressRecord? rec, {
    required bool shouldStartAtZero,
  }) {
    if (shouldStartAtZero) return 'pb';
    return (rec?.lastTrack == 'dg') ? 'dg' : 'pb';
  }

  Future<void> _switchEpisode(
    int delta, {
    bool autoPlay = true,
    bool saveOutgoing = true,
  }) async {
    if (_useWeb) { await _web?.navigate(delta); return; }
    if (_lessons.isEmpty) return;
    if (saveOutgoing) {
      await _saveProgressSnapshot(forceDiskFlush: true);
    }
    int curIdx = _lessons.indexWhere(
      (l) => l.lessonId == (_currentLesson?.lessonId ?? _lastPlayedLessonId),
    );
    if (curIdx < 0) curIdx = 0;
    final nextIdx = (curIdx + delta + _lessons.length) % _lessons.length;
    final targetLessonId = _lessons[nextIdx].lessonId;

    _hideReturnBanner();
    _isAudioLoading = true;
    ++_audioLoadToken;
    unawaited(_globalPlayer.pause());

    final rec = _progressMap[targetLessonId];
    final bool isTargetFinished = rec != null && rec.progressPct >= 95;
    final bool wasCompleted = (rec?.isCompleted ?? false) || isTargetFinished;
    if (isTargetFinished) {
      _progressMap[targetLessonId] = rec.copyWith(
        isCompleted: wasCompleted,
        hasStarted: true,
        progressPct: 0,
        lastTrack: 'pb',
        pbPosSec: 0.0,
        pbSegIdx: 0,
        updatedAtMs: DateTime.now().millisecondsSinceEpoch,
      );
    } else if (_activeScreen == 'player' || autoPlay) {
      final prevRec = rec ?? const LessonProgressRecord();
      _progressMap[targetLessonId] = prevRec.copyWith(
        hasStarted: true,
        updatedAtMs: DateTime.now().millisecondsSinceEpoch,
      );
    }
    unawaited(_flushProgressToPrefs(targetLessonId));

    // Switching episode defaults to Podcast ('pb') main course
    const nextTrack = 'pb';
    _resetTranscriptScrollController();
    setState(() {
      _currentTrack = nextTrack;
      if (_playerTab != 'vocab') {
        _playerTab = nextTrack;
      }
      _lastPlayedLessonId = targetLessonId;
      if (isTargetFinished) {
        _currentPositionSec = 0.0;
        _activeSegIndex = 0;
      }
    });

    if (_activeScreen == 'player' &&
        !_isInteractivePopActive &&
        _screenTransitionController.value >= 0.99) {
      _syncLibraryScrollWhileHidden();
    }

    await _loadLesson(
      targetLessonId,
      track: nextTrack,
      autoPlay: autoPlay,
      resumeSavedPosition: !isTargetFinished,
      allowBackgroundAutoPlay: true,
    );
  }

  Future<void> _loadLesson(
    String lessonId, {
    String track = 'pb',
    bool autoPlay = false,
    bool resumeSavedPosition = true,
    bool allowBackgroundAutoPlay = false,
  }) async {
    _isAudioLoading = true;
    final rawJson =
        await rootBundle.loadString('assets/lessons_safe/lesson_$lessonId.json');
    final detail =
        LessonDetail.fromJson(jsonDecode(rawJson) as Map<String, dynamic>);
    final compiledRegex = _compileVocabRegex(detail.vocabulary);

    final rec = _progressMap[lessonId];
    final double savedSec = !resumeSavedPosition || rec == null
        ? 0.0
        : (track == 'dg' ? rec.dgPosSec : rec.pbPosSec);
    final int savedSegIdx = !resumeSavedPosition || rec == null
        ? 0
        : (track == 'dg' ? rec.dgSegIdx : rec.pbSegIdx);
    final segs = detail.segmentsForTrack(track);
    final int initialIdx = _findSegmentIndexForSec(
      segs,
      savedSec,
      fallbackIdx: savedSegIdx,
    );

    if (!mounted) return;
    if (_currentLesson?.lessonId != lessonId || _currentTrack != track) {
      _resetTranscriptScrollController();
    }
    setState(() {
      _currentLesson = detail;
      _vocabHighlightRegex = compiledRegex;
      _currentTrack = track;
      if (_playerTab != 'vocab') {
        _playerTab = track;
      }
      _currentPositionSec = savedSec;
      _activeSegIndex = initialIdx;
      _lastPlayedLessonId = lessonId;
      _collapsedStageBoxIds.clear();
      _expandedVocabWords
        ..clear()
        ..addAll(
          detail.vocabulary.isNotEmpty
              ? [detail.vocabulary.first.word.toLowerCase()]
              : const [],
        );
    });

    await _loadTrackAudio(
      track,
      autoPlay: autoPlay,
      initialSeekSec: savedSec,
      initialSegIndex: initialIdx,
      allowBackgroundAutoPlay: allowBackgroundAutoPlay,
    );
  }

  Future<void> _loadTrackAudio(
    String track, {
    required bool autoPlay,
    required double initialSeekSec,
    required int initialSegIndex,
    bool allowBackgroundAutoPlay = false,
  }) async {
    if (_useWeb) {
      final w = _web;
      if (w == null) return;
      final pending = w.switchTrack(track);
      final my = w.generation;
      await pending;
      if (my != w.generation || w.track != track) return;
      await w.seek(initialSeekSec);
      if (my == w.generation && autoPlay) await w.setPlaying(true);
      return;
    }
    final lesson = _currentLesson;
    if (lesson == null) return;

    final int myToken = ++_audioLoadToken;
    _isAudioLoading = true;

    final segs = lesson.segmentsForTrack(track);
    final resolvedInitialIdx = _findSegmentIndexForSec(
      segs,
      initialSeekSec,
      fallbackIdx: initialSegIndex,
    );

    if (mounted) {
      setState(() {
        _currentPositionSec = initialSeekSec;
        _activeSegIndex = resolvedInitialIdx;
      });
    }

    try {
      await _globalPlayer.pause();
      if (myToken != _audioLoadToken) return;

      final audioPath = lesson.audio[track] ?? '';
      Duration? loadedDuration;
      Object? loadFailure;
      for (int attempt = 0; attempt < 3; attempt++) {
        if (myToken != _audioLoadToken) return;
        try {
          loadedDuration = await playback_platform
              .loadLessonAudio(_globalPlayer, lesson.lessonId, audioPath)
              .timeout(_audioLoadTimeout);
          loadFailure = null;
          break;
        } catch (error) {
          loadFailure = error;
          // A missing or undecodable asset cannot be fixed by asking again.
          if (isPermanentAudioError(error) || attempt == 2) break;
          await Future<void>.delayed(
            Duration(milliseconds: 500 * (attempt + 1)),
          );
        }
      }
      if (myToken != _audioLoadToken) return;
      if (loadFailure != null) throw loadFailure;

      await _globalPlayer.setSpeed(_currentSpeed);
      final effectiveDur = loadedDuration ?? _globalPlayer.duration;
      final durSec = (effectiveDur != null && effectiveDur.inMilliseconds > 0)
          ? effectiveDur.inMilliseconds / 1000.0
          : (segs.isNotEmpty ? segs.last.end + 1.0 : 1.0);

      _audioHandler.updateCurrentMediaItem(
        title:
            '${lesson.lessonNumber.toString().padLeft(2, '0')} · ${lesson.title}',
        subtitle:
            '${lesson.level} (${track == 'pb' ? 'Podcast' : 'Dialogue'})',
        duration: effectiveDur,
        artUri: _currentBrandArtUri,
      );

      double targetSeekSec = 0.0;
      if (initialSeekSec > 0.2) {
        // If previously stopped before the very end, resume at initialSeekSec;
        // if at the very end (>= durSec - 1.5s) and autoPlay is requested, start from 0.0 for replay.
        if (durSec <= 2.0 || initialSeekSec < durSec - 1.5 || !autoPlay) {
          targetSeekSec = initialSeekSec.clamp(0.0, durSec);
        }
      }

      final targetSegIdx = _findSegmentIndexForSec(
        segs,
        targetSeekSec,
        fallbackIdx: targetSeekSec > 0 ? resolvedInitialIdx : 0,
      );

      await _globalPlayer.seek(
        Duration(milliseconds: (targetSeekSec * 1000).round()),
      );
      if (myToken != _audioLoadToken) return;

      if (mounted) {
        setState(() {
          _durationSec = durSec;
          _currentPositionSec = targetSeekSec;
          _activeSegIndex = targetSegIdx;
        });
      }

      // Allow any buffered 0.0s stream event from setAsset/setFilePath to flush
      // before unlocking _isAudioLoading.
      await Future.delayed(const Duration(milliseconds: 60));
      if (myToken != _audioLoadToken) return;

      _isAudioLoading = false;
      await _saveProgressSnapshot(forceDiskFlush: true);

      WidgetsBinding.instance.addPostFrameCallback((_) {
        _jumpToActiveSentenceImmediate();
      });

      final bool canStartPlayback = autoPlay &&
          myToken == _audioLoadToken &&
          (allowBackgroundAutoPlay || _activeScreen == 'player');
      if (canStartPlayback) {
        unawaited(_safePlay());
      }
    } catch (e) {
      if (myToken == _audioLoadToken) {
        _isAudioLoading = false;
      }
      debugPrint('Audio load warning: $e');
    }
  }

  List<TranscriptSegment> get _activeSegments {
    final lesson = _currentLesson;
    if (lesson == null) return const [];
    return lesson.segmentsForTrack(_currentTrack);
  }

  String get _currentLiveSentenceText {
    final segs = _activeSegments;
    if (segs.isEmpty) return 'Tap to start listening...';
    final clamped = _activeSegIndex.clamp(0, segs.length - 1);
    final seg = segs[clamped];
    if (!seg.isSection && seg.text.trim().isNotEmpty) {
      return '"${seg.text.trim()}"';
    }
    for (int i = clamped; i < segs.length; i++) {
      if (!segs[i].isSection && segs[i].text.trim().isNotEmpty) {
        return '"${segs[i].text.trim()}"';
      }
    }
    return '"${seg.text.trim()}"';
  }

  /// Classifies every segment in `segs` into either `null` (regular open host commentary,
  /// section jingles, and phrase drills) or a `_StageGroupInfo` (`'dialogue'` or `'example'`)
  /// so ONLY Dialogue and Example blocks receive Stage Container Box background emphasis.
  List<_StageGroupInfo?> _computeStageGroups(
    List<TranscriptSegment> segs,
    String track,
  ) {
    final n = segs.length;
    if (n == 0) return const [];

    if (track == 'dg') {
      return List.generate(
        n,
        (i) => _StageGroupInfo(
          boxGroupId: 0,
          kind: 'dialogue',
          badgeText: '🎭 FULL DIALOGUE TRACK',
          subText: 'Original Scene',
          isFirstInBox: i == 0,
          isLastInBox: i == n - 1,
        ),
      );
    }

    final List<String?> rawKind = List<String?>.filled(n, null);
    final List<String> customBadge = List<String>.filled(n, '');

    int i = 0;
    while (i < n) {
      final s = segs[i];
      final spk = s.speaker.trim();
      final txt = s.text.trim();

      if (s.isSection || s.inDialogueBlock) {
        rawKind[i] = 'dialogue';
        if (s.isSection) {
          customBadge[i] = '📌 ${txt.toUpperCase()}';
        }
        i++;
        continue;
      }

      if (spk.toLowerCase().startsWith('example')) {
        rawKind[i] = 'example';
        customBadge[i] = '💡 EXAMPLES · IN ACTION';
        i++;
        continue;
      }

      if (spk == 'Voice' && txt.toLowerCase().startsWith('example')) {
        rawKind[i] = 'example';
        customBadge[i] = '💡 EXAMPLES · IN ACTION';
        if (i + 1 < n &&
            !segs[i + 1].isSection &&
            segs[i + 1].speaker != 'M' &&
            segs[i + 1].speaker != 'Voice') {
          rawKind[i + 1] = 'example';
          final firstSpk = segs[i + 1].speaker;
          if (i + 2 < n && !segs[i + 2].isSection) {
            final secSpk = segs[i + 2].speaker;
            final secTxt = segs[i + 2].text.trim();
            final isPairedTurn = (firstSpk == 'A' && secSpk == 'B') ||
                (firstSpk == 'C' && secSpk == 'D') ||
                (firstSpk == 'E' && secSpk == 'F') ||
                (firstSpk == 'B' &&
                    secSpk == 'C' &&
                    !secTxt.startsWith('Alright'));
            if (isPairedTurn) {
              rawKind[i + 2] = 'example';
              i += 3;
              continue;
            }
          }
          i += 2;
          continue;
        }
        i++;
        continue;
      }

      i++;
    }

    final List<_StageGroupInfo?> result = List<_StageGroupInfo?>.filled(n, null);
    int currentBoxId = 0;
    for (int idx = 0; idx < n; idx++) {
      final k = rawKind[idx];
      if (k == null) continue;
      final isFirst = idx == 0 || rawKind[idx - 1] != k;
      if (isFirst) {
        currentBoxId++;
      }
      final isLast = idx == n - 1 || rawKind[idx + 1] != k;

      String badge = customBadge[idx];
      if (badge.isEmpty) {
        if (k == 'dialogue') {
          badge = '📌 DIALOGUE · SCENE';
        } else {
          badge = '💡 EXAMPLES · IN ACTION';
        }
      }
      final sub = k == 'dialogue' ? 'Scene Transcript' : 'Usage Examples';

      result[idx] = _StageGroupInfo(
        boxGroupId: currentBoxId,
        kind: k,
        badgeText: badge,
        subText: sub,
        isFirstInBox: isFirst,
        isLastInBox: isLast,
      );
    }
    return result;
  }

  void _ensureStageBoxExpandedForSegment(int segIdx) {
    final segs = _activeSegments;
    if (segIdx < 0 || segIdx >= segs.length) return;
    final groups = _computeStageGroups(segs, _currentTrack);
    if (segIdx < groups.length && groups[segIdx] != null) {
      final gid = groups[segIdx]!.boxGroupId;
      if (_collapsedStageBoxIds.contains(gid)) {
        _collapsedStageBoxIds.remove(gid);
      }
    }
  }

  // ===========================================================================
  // SMART 5-SECOND AUTO-RETURN BANNER & VIEWPORT VISIBILITY LOGIC
  // ===========================================================================

  bool _isActiveSegmentVisibleInViewport() {
    if (_activeScreen != 'player' || _playerTab == 'vocab') return true;
    final positions = _itemPositionsListener.itemPositions.value;
    if (positions.isEmpty) return true;
    for (final pos in positions) {
      if (pos.index == _activeSegIndex) {
        return pos.itemLeadingEdge >= -0.08 && pos.itemTrailingEdge <= 1.08;
      }
    }
    return false;
  }

  void _onTranscriptPositionsChanged() {
    if (_useWeb) { _captureWebReadAnchor(); return; }
    if (!mounted || _isInteractivePopActive) return;
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    if (nowMs < _programmaticScrollUntilMs) return;

    if (_isActiveSegmentVisibleInViewport()) {
      if (_showReturnBanner) {
        _hideReturnBanner();
      }
    }
  }

  void _onUserScrollInteraction() {
    if (_useWeb) {
      _webTouch();
      if (!_showReturnBanner) setState(() => _showReturnBanner = true);
      _captureWebReadAnchor();
      return;
    }
    if (_isInteractivePopActive || _screenTransitionController.value < 0.999) {
      return;
    }
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    if (nowMs < _programmaticScrollUntilMs) return;

    if (_isActiveSegmentVisibleInViewport()) {
      if (_showReturnBanner) {
        _hideReturnBanner();
      }
    } else {
      _start5sReturnBanner();
    }
  }

  void _start5sReturnBanner() {
    _returnCountdownTimer?.cancel();
    setState(() {
      _showReturnBanner = true;
      _returnCountdown = 5;
    });
    _returnCountdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_returnCountdown <= 1) {
        timer.cancel();
        _snapBackToActiveSentence();
      } else {
        setState(() {
          _returnCountdown--;
        });
      }
    });
  }

  void _hideReturnBanner() {
    _returnCountdownTimer?.cancel();
    _returnCountdownTimer = null;
    if (_showReturnBanner && mounted) {
      setState(() {
        _showReturnBanner = false;
      });
    } else {
      _showReturnBanner = false;
    }
  }

  void _safeScrollTranscriptToIndex(
    int targetIndex, {
    Duration duration = _M3Motion.durScroll,
    Curve curve = _M3Motion.easeSmoothOut,
    bool isJump = false,
  }) {
    if (!_itemScrollController.isAttached) return;
    final segs = _activeSegments;
    if (segs.isEmpty) return;
    final int totalCount = segs.length;
    final int clampedIndex = targetIndex.clamp(0, totalCount - 1);

    final positions = _itemPositionsListener.itemPositions.value;
    ItemPosition? lastPos;
    ItemPosition? targetPos;
    for (final pos in positions) {
      if (pos.index == totalCount - 1) lastPos = pos;
      if (pos.index == clampedIndex) targetPos = pos;
    }

    // 1. Apple Podcasts Specification - Natural Bottom Docking:
    // If the entire transcript has already reached the physical bottom edge (lastPos.itemTrailingEdge <= 1.01)
    // and the target sentence is already fully visible on screen, DO NOT invoke scrollTo/jumpTo!
    // Simply let the in-place highlight and sound wave marker glow without any viewport movement.
    final bool isDockedAtBottom =
        lastPos != null && lastPos.itemTrailingEdge <= 1.01;
    final bool isTargetFullyVisible = targetPos != null &&
        targetPos.itemLeadingEdge >= -0.05 &&
        targetPos.itemTrailingEdge <= 1.05;

    if (isDockedAtBottom && isTargetFullyVisible) {
      return; // Apple Podcasts Docked Mode: 0px scroll, 0 bounce, 100% visible
    }

    // 2. Base alignment calculation:
    // Tail zone items naturally sit lower in the viewport rather than forcing top 0.32
    double targetAlignment;
    if (clampedIndex == 0) {
      targetAlignment = 0.0;
    } else if (clampedIndex >= totalCount - 1) {
      targetAlignment = 0.85;
    } else if (clampedIndex >= totalCount - 2) {
      targetAlignment = 0.65;
    } else if (clampedIndex >= totalCount - 3) {
      targetAlignment = 0.50;
    } else {
      targetAlignment = _useWeb ? 0.28 : 0.32;
    }

    // 3. Dynamic Clamped Alignment if approaching bottom:
    if (lastPos != null && targetPos != null) {
      final double maxScrollUpFraction = lastPos.itemTrailingEdge - 1.0;
      if (maxScrollUpFraction >= 0) {
        final double desiredScrollUpFraction =
            targetPos.itemLeadingEdge - targetAlignment;
        if (desiredScrollUpFraction > maxScrollUpFraction) {
          // Centering further would overshoot the bottom!
          // Clamp alignment so the list glides to physical bottom (1.0) with zero overshoot.
          final double clampedAlignment =
              targetPos.itemLeadingEdge - maxScrollUpFraction;
          targetAlignment = clampedAlignment.clamp(0.0, 0.85);
        }
      }
    }

    if (isJump) {
      _itemScrollController.jumpTo(
        index: clampedIndex,
        alignment: targetAlignment,
      );
    } else {
      _itemScrollController.scrollTo(
        index: clampedIndex,
        duration: duration,
        curve: curve,
        alignment: targetAlignment,
      );
    }
  }

  void _jumpToActiveSentenceImmediate() {
    _hideReturnBanner();
    _programmaticScrollUntilMs = DateTime.now().millisecondsSinceEpoch + 350;
    if (_itemScrollController.isAttached) {
      _safeScrollTranscriptToIndex(
        _activeSegIndex,
        isJump: true,
      );
    }
  }

  void _snapBackToActiveSentence() {
    _hideReturnBanner();
    _programmaticScrollUntilMs = DateTime.now().millisecondsSinceEpoch + 950;
    if (_itemScrollController.isAttached) {
      _safeScrollTranscriptToIndex(
        _activeSegIndex,
        duration: _M3Motion.durScroll,
        curve: _M3Motion.easeSmoothOut,
      );
    }
  }

  void _onPositionTick(double sec) {
    if (!mounted || _isAudioLoading || _isDraggingSlider) return;
    final segs = _activeSegments;
    if (segs.isEmpty) {
      setState(() => _currentPositionSec = sec);
      return;
    }

    if (_singleSentenceLoop &&
        _activeSegIndex >= 0 &&
        _activeSegIndex < segs.length) {
      final curSeg = segs[_activeSegIndex];
      if (!curSeg.isSection && sec >= curSeg.end + 0.05) {
        _globalPlayer.seek(
          Duration(milliseconds: (curSeg.start * 1000).round()),
        );
        return;
      }
    }

    final int foundIdx = _findSegmentIndexForSec(
      segs,
      sec,
      fallbackIdx: _activeSegIndex,
    );

    final changedSeg = foundIdx != _activeSegIndex;
    final posDelta = (sec - _currentPositionSec).abs();
    final minPosDelta = _activeScreen == 'player' ? 0.16 : 0.45;
    if (changedSeg || posDelta >= minPosDelta) {
      setState(() {
        _currentPositionSec = sec;
        _activeSegIndex = foundIdx;
        if (changedSeg) {
          _ensureStageBoxExpandedForSegment(foundIdx);
        }
      });
    } else {
      _currentPositionSec = sec;
    }

    // Always keep in-memory progress up to date on every tick
    _saveProgressSnapshot(forceDiskFlush: false);

    if (_activeScreen == 'player' &&
        _playerTab != 'vocab' &&
        changedSeg &&
        !_showReturnBanner &&
        _itemScrollController.isAttached) {
      _programmaticScrollUntilMs = DateTime.now().millisecondsSinceEpoch + 550;
      _safeScrollTranscriptToIndex(
        foundIdx,
        duration: _M3Motion.durScroll,
        curve: _M3Motion.easeSmoothOut,
      );
    }
  }

  Future<void> _jumpToSegment(int index) async {
    final segs = _activeSegments;
    if (index < 0 || index >= segs.length) return;
    final seg = segs[index];

    _hideReturnBanner();
    final targetSec = sentenceSeekTargetSeconds(seg);
    setState(() {
      _activeSegIndex = index;
      _currentPositionSec = targetSec;
      _ensureStageBoxExpandedForSegment(index);
    });

    _programmaticScrollUntilMs = DateTime.now().millisecondsSinceEpoch + 750;
    if (_itemScrollController.isAttached) {
      _safeScrollTranscriptToIndex(
        index,
        duration: _M3Motion.durMedium,
        curve: _M3Motion.easeSmoothOut,
      );
    }

    if (_useWeb) { await _web?.seek(targetSec); return; }
    final targetMs = (targetSec * 1000).round();
    await _globalPlayer.seek(Duration(milliseconds: targetMs));
    if (!_globalPlayer.playing) {
      unawaited(_safePlay());
    }
    await _saveProgressSnapshot(forceDiskFlush: true);
  }

  void _prevSentence() {
    final target = previousTranscriptSegmentIndex(
      _activeSegments, _activeSegIndex);
    if (target != null) _jumpToSegment(target);
  }

  void _nextSentence() {
    final target = nextTranscriptSegmentIndex(
      _activeSegments, _activeSegIndex);
    if (target != null) _jumpToSegment(target);
  }

  void _toggleSingleLoop() {
    if (_useWeb) { _web?.toggleSentenceLoop(); return; }
    setState(() {
      _singleSentenceLoop = !_singleSentenceLoop;
    });
  }

  void _toggleRepeatEpisode() {
    if (_useWeb) { _web?.toggleTrackLoop(); return; }
    setState(() {
      _repeatCurrentEpisode = !_repeatCurrentEpisode;
    });
  }

  Future<void> _setPlaybackSpeed(double speed) async {
    if (_useWeb) { await _web?.setRate(speed); return; }
    setState(() {
      _currentSpeed = speed;
    });
    await _globalPlayer.setSpeed(speed);
  }

  String _formatTime(double seconds) {
    if (seconds.isNaN || seconds < 0) return '00:00';
    final mins = seconds ~/ 60;
    final secs = (seconds % 60).floor();
    return '${mins.toString().padLeft(2, '0')}:${secs.toString().padLeft(2, '0')}';
  }

  String _formatSpeedMultiplier(double speed) {
    if (speed == speed.roundToDouble()) {
      return '${speed.toStringAsFixed(1)}x';
    }
    return '${speed}x';
  }

  @override
  void dispose() {
    _webIdleTimer?.cancel();
    _webLoadingIndicatorTimer?.cancel();
    _web?.removeListener(_syncWebPlayer);
    _web?.dispose();
    WidgetsBinding.instance.removeObserver(this);
    unawaited(
      _wakelockChannel.invokeMethod<void>(
        'setKeepScreenOn',
        {'enable': false},
      ).catchError((_) {}),
    );
    _screenTransitionController.dispose();
    _filterSwitchController.dispose();
    _themeRevealController.dispose();
    _splashAnimationController.dispose();
    _themeSnapshot?.dispose();
    _themeSnapshot = null;
    _returnCountdownTimer?.cancel();
    _itemPositionsListener.itemPositions
        .removeListener(_onTranscriptPositionsChanged);
    _libraryScrollController.dispose();
    _vocabScrollController.dispose();
    _posSub?.cancel();
    _durSub?.cancel();
    _stateSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = _paletteFor(context);
    final overlayStyle = _systemOverlayFor(p);
    SystemChrome.setSystemUIOverlayStyle(overlayStyle);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      SystemChrome.setSystemUIOverlayStyle(overlayStyle);
    });

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: overlayStyle,
      child: PopScope(
        canPop: _activeScreen == 'library',
        onPopInvokedWithResult: (didPop, _) {
          if (didPop) return;
          if (_activeScreen == 'player') {
            _returnToLibraryScreen();
          }
        },
        child: Scaffold(
          backgroundColor: p.bgWell,
          body: Stack(
            fit: StackFit.expand,
            children: [
              RepaintBoundary(
                key: _appRepaintKey,
                child: ColoredBox(
                  color: p.bgWell,
                  child: SafeArea(
                    top: false,
                    bottom: false,
                    child: AnimatedBuilder(
                      animation: _isSplashActive
                          ? Listenable.merge([
                              _screenTransitionController,
                              _splashAnimationController,
                            ])
                          : _screenTransitionController,
                      builder: (context, _) {
                        final double navT =
                            _screenTransitionController.value.clamp(0.0, 1.0);
                        final double screenW = MediaQuery.sizeOf(context).width;
                        final bool isPlayerOffstage = navT <= 0.001 &&
                            !_isInteractivePopActive &&
                            _activeScreen == 'library';

                        final double libraryScale;
                        final double libraryOpacity;
                        if (_isSplashActive) {
                          final double sv = _splashAnimationController.value;
                          if (sv >= 0.85) {
                            final double zT =
                                ((sv - 0.85) / 0.15).clamp(0.0, 1.0);
                            final double curvedZ =
                                Curves.easeInOutCubic.transform(zT);
                            libraryScale = 0.95 + 0.05 * curvedZ;
                            libraryOpacity = curvedZ;
                          } else {
                            libraryScale = 0.95;
                            libraryOpacity = 0.0;
                          }
                        } else {
                          libraryScale = 1.0;
                          libraryOpacity = 1.0;
                        }

                        return Stack(
                          fit: StackFit.expand,
                          children: [
                            // Layer 0: Permanent Course Library Screen (Screen 1)
                            // Never unmounted or remounted! Moves with iOS native -28% parallax during push/pop.
                            KeyedSubtree(
                              key: const ValueKey('layer_library'),
                              child: IgnorePointer(
                                ignoring: _activeScreen == 'player' ||
                                    navT > 0.001 ||
                                    (_isSplashActive &&
                                        _splashAnimationController.value <
                                            0.96),
                                child: Transform.translate(
                                  offset: Offset(-0.28 * navT * screenW, 0.0),
                                  child: Transform.scale(
                                    scale: libraryScale,
                                    child: Opacity(
                                      opacity: libraryOpacity,
                                      child: Stack(
                                        fit: StackFit.expand,
                                        children: [
                                          _buildCourseLibraryScreen(p),
                                          IgnorePointer(
                                            child: ColoredBox(
                                              color: navT <= 0.001
                                                  ? Colors.transparent
                                                  : Colors.black.withValues(
                                                      alpha: (p.isDark
                                                              ? 0.34
                                                              : 0.14) *
                                                          navT,
                                                    ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),

                            // Layer 1: Permanent Immersive Player Screen (Screen 2)
                            // Never unmounted or remounted! Slides horizontally from x = (1 - navT) * screenW.
                            KeyedSubtree(
                              key: const ValueKey('layer_player'),
                              child: Offstage(
                                offstage: isPlayerOffstage,
                                child: IgnorePointer(
                                  ignoring: _activeScreen != 'player' ||
                                      _isInteractivePopActive ||
                                      navT < 0.999,
                                  child: Transform.translate(
                                    offset: Offset((1.0 - navT) * screenW, 0.0),
                                    child: _buildImmersivePlayerScreen(p, navT: navT),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        );
                      },
                    ),
                  ),
                ),
              ),
              if (_themeSnapshot != null)
                Positioned.fill(
                  child: IgnorePointer(
                    child: AnimatedBuilder(
                      animation: _themeRevealAnimation,
                      builder: (context, _) {
                        return CustomPaint(
                          painter: _ThemeRevealPainter(
                            image: _themeSnapshot!,
                            center: _themeRevealCenter,
                            progress:
                                _themeRevealAnimation.value.clamp(0.0, 1.0),
                            maxRadius: _themeRevealMaxRadius,
                            isForward: _themeRevealIsForward,
                          ),
                        );
                      },
                    ),
                  ),
                ),
              if (_isSplashActive)
                Positioned.fill(
                  child: AnimatedBuilder(
                    animation: _splashAnimationController,
                    builder: (context, _) {
                      return _EnglishPodAnimatedSplashOverlay(
                        controller: _splashAnimationController,
                        palette: p,
                        onSkip: () {
                          if (_splashAnimationController.value < 0.85) {
                            _splashAnimationController.animateTo(
                              1.0,
                              duration: const Duration(milliseconds: 280),
                              curve: Curves.easeOutCubic,
                            );
                          }
                        },
                      );
                    },
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  List<LessonSummary> _filteredLessonsFor(String filterKey) {
    return _lessons.where((item) {
      final rec = _progressMap[item.lessonId];
      final pct = rec?.progressPct ?? 0;
      final isCompleted = (rec?.isCompleted ?? false) || (!_useWeb && pct >= 95);
      final hasStarted = (rec?.hasStarted ?? false) || isCompleted || pct > 0;
      if (filterKey == 'completed') return isCompleted;
      if (filterKey == 'in_progress') return hasStarted && (_useWeb ? !isCompleted : pct < 95);
      return true;
    }).toList();
  }

  /// Computes the exact scroll offset in the Course Library `ListView` that places
  /// `targetLessonId` at the vertical center (`alignment: 0.5`) of `viewportHeight`.
  ///
  /// Exact geometry of the Course Library `ListView`:
  /// - Top padding: `14.0` px
  /// - Index 0 (`COURSE LIST` header): `24.0` px
  /// - Each Course Card item: `88.0` px stride (`79.0` px card height + `9.0` px bottom margin)
  /// - Bottom padding: `28.0 + bottomInset` px
  double _computeMaxLibraryOffset({
    required String filterKey,
    required double viewportHeight,
  }) {
    final filtered = _filteredLessonsFor(filterKey);
    if (filtered.isEmpty) return 0.0;
    const double topPad = 14.0;
    const double headerH = 24.0;
    const double cardStride = 88.0;
    final double bottomInset =
        mounted ? MediaQuery.paddingOf(context).bottom : 0.0;
    final double bottomPad = 28.0 + bottomInset;
    final double totalContentHeight =
        topPad + headerH + (filtered.length * cardStride) + bottomPad;
    return (totalContentHeight - viewportHeight).clamp(0.0, double.infinity);
  }

  double _computeCenteredLibraryOffset({
    required String targetLessonId,
    required String filterKey,
    required double viewportHeight,
  }) {
    final filtered = _filteredLessonsFor(filterKey);
    if (filtered.isEmpty) return 0.0;
    final idx = filtered.indexWhere((l) => l.lessonId == targetLessonId);
    if (idx < 0) return 0.0;

    const double topPad = 14.0;
    const double headerH = 24.0;
    const double cardStride = 88.0;
    const double cardBodyH = 79.0;
    final double bottomInset =
        mounted ? MediaQuery.paddingOf(context).bottom : 0.0;
    final double bottomPad = 28.0 + bottomInset;

    final double totalContentHeight =
        topPad + headerH + (filtered.length * cardStride) + bottomPad;
    final double maxExtent =
        (totalContentHeight - viewportHeight).clamp(0.0, double.infinity);
    final double rawCenteredOffset = topPad +
        headerH +
        (idx * cardStride) -
        ((viewportHeight - cardBodyH) / 2.0);
    return rawCenteredOffset.clamp(0.0, maxExtent);
  }

  /// iOS Full-Screen Interactive Pop Gesture Handlers (`interactiveContentPopGestureRecognizer`)
  void _onFullScreenPopDragStart(DragStartDetails details) {
    if (_activeScreen != 'player' ||
        _pointerInSliderZone ||
        _isDraggingSlider) {
      return;
    }
    _screenTransitionController.stop();
    _hideReturnBanner();
    unawaited(_saveProgressSnapshot(forceDiskFlush: true));
    // Ensure Layer 0 (Course Library) is already centered on the active episode
    // before any pixel of Layer 0 is revealed!
    if (_screenTransitionController.value >= 0.98) {
      _syncLibraryScrollWhileHidden();
    }
    setState(() {
      _isInteractivePopActive = true;
    });
  }

  void _onFullScreenPopDragUpdate(DragUpdateDetails details) {
    if (!_isInteractivePopActive ||
        _pointerInSliderZone ||
        _isDraggingSlider) {
      return;
    }
    final double screenW = MediaQuery.sizeOf(context).width;
    if (screenW <= 0.0) return;
    final double nextNavT =
        (_screenTransitionController.value - (details.delta.dx / screenW))
            .clamp(0.0, 1.0);
    _screenTransitionController.value = nextNavT;
  }

  void _onFullScreenPopDragEnd(DragEndDetails details) {
    if (!_isInteractivePopActive) {
      return;
    }
    final double vx = details.primaryVelocity ?? 0.0;
    final double popProgress =
        (1.0 - _screenTransitionController.value).clamp(0.0, 1.0);
    final bool shouldCompletePop =
        (vx > 240.0) || (popProgress >= 0.20 && vx >= -100.0);

    if (shouldCompletePop) {
      HapticFeedback.lightImpact();
      setState(() {
        _isInteractivePopActive = false;
        _activeScreen = 'library';
      });
      _screenTransitionController.animateTo(
        0.0,
        duration: const Duration(milliseconds: 210),
        curve: _M3Motion.easeSmoothOut,
      );
    } else {
      _screenTransitionController
          .animateTo(
            1.0,
            duration: const Duration(milliseconds: 180),
            curve: _M3Motion.easeSmoothOut,
          )
          .then((_) {
        if (!mounted) return;
        setState(() {
          _isInteractivePopActive = false;
        });
      });
    }
  }

  void _onFullScreenPopDragCancel() {
    if (!_isInteractivePopActive) {
      return;
    }
    _screenTransitionController
        .animateTo(
          1.0,
          duration: const Duration(milliseconds: 160),
          curve: _M3Motion.easeSmoothOut,
        )
        .then((_) {
      if (!mounted) return;
      setState(() {
        _isInteractivePopActive = false;
      });
    });
  }

  /// Unified Player -> Library return handler:
  /// Saves progress snapshot, ensures Layer 0 is already centered while covered at `navT == 1.0`,
  /// and smoothly slides Layer 1 out to `navT == 0.0` with zero post-animation jump or rebuild.
  void _returnToLibraryScreen() {
    _hideReturnBanner();
    unawaited(_saveProgressSnapshot(forceDiskFlush: true));
    if (_screenTransitionController.value >= 0.98) {
      _syncLibraryScrollWhileHidden();
    }

    setState(() {
      _isInteractivePopActive = false;
      _activeScreen = 'library';
    });

    _screenTransitionController.animateTo(
      0.0,
      duration: const Duration(milliseconds: 250),
      curve: _M3Motion.easeSmoothOut,
    );
  }

  /// Positions the Course Library scroll view so the currently playing episode
  /// (`_currentLesson?.lessonId ?? _lastPlayedLessonId`) sits at the vertical center (`alignment: 0.5`)
  /// of the scrollable viewport.
  void _centerActiveLessonInLibrary({
    bool animate = false,
    bool allowWhileOnPlayer = false,
  }) {
    if (!mounted) return;
    if (!allowWhileOnPlayer && _activeScreen != 'library') return;
    if (!_libraryScrollController.hasClients ||
        _libraryScrollController.positions.length != 1) {
      return;
    }

    final targetId = _currentLesson?.lessonId ?? _lastPlayedLessonId;
    final filtered = _filteredLessonsFor(_libraryFilter);
    if (!filtered.any((l) => l.lessonId == targetId)) {
      return;
    }

    final pos = _libraryScrollController.position;
    final viewportH = pos.viewportDimension > 0
        ? pos.viewportDimension
        : _lastLibraryViewportHeight;
    _lastLibraryViewportHeight = viewportH;

    final rawOffset = _computeCenteredLibraryOffset(
      targetLessonId: targetId,
      filterKey: _libraryFilter,
      viewportHeight: viewportH,
    );
    final targetOffset = rawOffset.clamp(0.0, pos.maxScrollExtent);
    _filterScrollOffsets[_libraryFilter] = targetOffset;

    if ((pos.pixels - targetOffset).abs() <= 0.5) return;

    if (animate) {
      _libraryScrollController.animateTo(
        targetOffset,
        duration: _M3Motion.durFast,
        curve: _M3Motion.easeSmoothOut,
      );
    } else {
      _libraryScrollController.jumpTo(targetOffset);
    }
  }

  // ===========================================================================
  // SCREEN 1: COURSE LIBRARY (EDGE-TO-EDGE GRADIENT TOP DECK + RECESSED WELL)
  // ===========================================================================

  Widget _buildCourseLibraryScreen(AppPalette p) {
    final topInset = MediaQuery.of(context).padding.top;
    final completedCount = _progressMap.values
        .where((r) => r.isCompleted || (!_useWeb && r.progressPct >= 95))
        .length;

    final filteredLessons = _filteredLessonsFor(_libraryFilter);

    return ColoredBox(
      key: const ValueKey('screen_library'),
      color: p.bgWell,
      child: Column(
        children: [
        // 1. Edge-to-Edge Pinned Top Deck (Starts at y=0 behind Status Bar!)
        Container(
          padding: EdgeInsets.fromLTRB(18, topInset + 10, 18, 14),
          decoration: BoxDecoration(
            color: p.deckBg,
            gradient: RadialGradient(
              center: const Alignment(0.0, -1.0),
              radius: 1.35,
              colors: p.deckGradientColors,
              stops: const [0.0, 0.58, 1.0],
            ),
            borderRadius: const BorderRadius.vertical(
              bottom: Radius.circular(26),
            ),
            border: Border(
              bottom: BorderSide(color: p.deckBorder, width: 1.0),
            ),
            boxShadow: [
              BoxShadow(
                color: p.isDark
                    ? const Color(0xAD000000)
                    : const Color(0x1A141413),
                blurRadius: 28,
                offset: const Offset(0, 12),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'EnglishPod',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.6,
                          color: p.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Elementary · ${_lessons.length} Lessons',
                        style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w500,
                          color: p.textPassed,
                        ),
                      ),
                    ],
                  ),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _buildThemeToggleButton(p),
                      const SizedBox(width: 8),
                      Container(
                        height: 28,
                        padding: const EdgeInsets.symmetric(horizontal: 11),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: p.surfaceInset,
                          borderRadius: BorderRadius.circular(9999),
                          border: Border.all(color: p.border),
                        ),
                        child: Text(
                          '$completedCount / ${_lessons.length} Done',
                          style: TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                            color: p.accent,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _buildPinnedTopLiveCard(p),
              const SizedBox(height: 12),
              _buildFilterPillsRow(p),
            ],
          ),
        ),

        if (_useWeb && _web?.saved == false) _webStatus(p),

        // 2. Recessed Scrollable Course List Well (with explicit P8 Directional Filter Transition)
        Expanded(
          child: LayoutBuilder(
            builder: (context, constraints) {
              if (constraints.maxHeight > 100) {
                _lastLibraryViewportHeight = constraints.maxHeight;
              }
              return AnimatedBuilder(
                animation: _filterSwitchController,
                builder: (context, child) {
                  final double t = _M3Motion.easeSmoothOut.transform(
                    _filterSwitchController.value.clamp(0.0, 1.0),
                  );
                  final double dx = (1.0 - t) * 12.0 * _filterSlideDirection;
                  return Opacity(
                    opacity: t.clamp(0.0, 1.0),
                    child: Transform.translate(
                      offset: Offset(dx, 0.0),
                      child: child,
                    ),
                  );
                },
                child: RawScrollbar(
                  controller: _libraryScrollController,
                  thumbColor: p.scrollbarThumb,
                  radius: const Radius.circular(9999),
                  thickness: 4,
                  padding: const EdgeInsets.only(right: 2),
                  child: filteredLessons.isEmpty
                      ? Center(
                          child: Text(
                            'No lessons in this filter yet.',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: p.textPassed,
                            ),
                          ),
                        )
                      : NotificationListener<ScrollNotification>(
                          onNotification: (notification) {
                            if (notification.metrics.axis == Axis.vertical) {
                              _filterScrollOffsets[_libraryFilter] =
                                  notification.metrics.pixels
                                      .clamp(0.0, double.infinity);
                            }
                            return false;
                          },
                          child: ListView.builder(
                            key: const ValueKey<String>('course_list_view'),
                            controller: _libraryScrollController,
                            padding: EdgeInsets.fromLTRB(
                              16,
                              14,
                              16,
                              28 + MediaQuery.paddingOf(context).bottom,
                            ),
                            itemCount: filteredLessons.length + 1,
                            itemBuilder: (context, index) {
                              if (index == 0) {
                                return SizedBox(
                                  height: 24.0,
                                  child: Padding(
                                    padding:
                                        const EdgeInsets.fromLTRB(4, 0, 4, 8),
                                    child: Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.spaceBetween,
                                      children: [
                                        Text(
                                          'COURSE LIST',
                                          style: TextStyle(
                                            fontSize: 10.5,
                                            fontWeight: FontWeight.w800,
                                            letterSpacing: 0.8,
                                            color: p.textPassed,
                                          ),
                                        ),
                                        Text(
                                          'SCROLL TO BROWSE ↓',
                                          style: TextStyle(
                                            fontSize: 10.5,
                                            fontWeight: FontWeight.w800,
                                            letterSpacing: 0.8,
                                            color: p.textPassed,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                );
                              }
                              return _buildCourseCard(
                                filteredLessons[index - 1],
                                p,
                              );
                            },
                          ),
                        ),
                ),
              );
            },
          ),
        ),
      ],
    ),
  );
}

  Widget _buildPinnedTopLiveCard(AppPalette p) {
    final lesson = _currentLesson;
    LessonSummary? summary;
    for (final l in _lessons) {
      if (l.lessonId == _lastPlayedLessonId) {
        summary = l;
        break;
      }
    }
    summary ??= _lessons.isNotEmpty ? _lessons.first : null;
    if (summary == null && lesson == null) return const SizedBox.shrink();

    final lessonId = lesson?.lessonId ?? summary!.lessonId;
    final lessonNum = lesson?.lessonNumber ?? summary!.lessonNumber;
    final lessonTitle = lesson?.title ?? summary!.title;
    final trackLabel = _useWeb ? 'PODCAST' : _currentTrack == 'dg' ? 'DIALOGUE' : 'PODCAST';

    final currentRec = _progressMap[lessonId];
    final int currentPct = currentRec?.progressPct ?? 0;
    final bool isCurrentDone =
        (currentRec?.isCompleted ?? false) || (!_useWeb && currentPct >= 95);
    final bool hasCurrentStarted =
        (currentRec?.hasStarted ?? false) || isCurrentDone || currentPct > 0;

    final cardPosition = _useWeb ? (_currentTrack == 'pb' ? _currentPositionSec : currentRec?.pbPosSec ?? 0.0) : _currentPositionSec;
    final cardDuration = _useWeb && _currentTrack != 'pb' ? currentRec?.pbDurSec ?? 0.0 : _durationSec;

    final double liveProgress = _useWeb ? (cardDuration > 0 ? (cardPosition / cardDuration).clamp(0.0,1.0) : 0.0) : (isCurrentDone && currentPct >= 95 && !_isPlaying)
        ? 1.0
        : ((_durationSec > 1.0)
            ? (_currentPositionSec / _durationSec).clamp(0.0, 1.0)
            : (currentPct / 100.0).clamp(0.0, 1.0));
    final pbSegments = lesson?.pbSegments ?? <TranscriptSegment>[];
    final pbIndex = _findSegmentIndexForSec(pbSegments, cardPosition);
    final liveSentence = _useWeb && _currentTrack != 'pb' && pbSegments.isNotEmpty
        ? '"${pbSegments[pbIndex.clamp(0,pbSegments.length-1)].text.trim()}"'
        : _currentLiveSentenceText;

    String liveHeaderBadge;
    if (isCurrentDone) {
      liveHeaderBadge =
          currentPct >= 95 ? 'LESSON COMPLETED' : 'REPLAYING LESSON';
    } else if (hasCurrentStarted) {
      liveHeaderBadge = 'CONTINUE LISTENING';
    } else {
      liveHeaderBadge = 'START LISTENING';
    }

    final bool isPlayedBefore =
        isCurrentDone || hasCurrentStarted || currentPct > 0 || _currentPositionSec > 0.5;
    final String trackTimeLabel =
        '$trackLabel · ${_formatTime(cardPosition)} / ${_formatTime(cardDuration)}';

    final card = _HoldToReplayTopLiveCard(
      key: ValueKey('top_live_card_$lessonId'),
      palette: p,
      lessonNum: lessonNum,
      lessonTitle: lessonTitle,
      trackTimeLabel: trackTimeLabel,
      liveHeaderBadge: liveHeaderBadge,
      liveSentence: liveSentence,
      liveProgress: liveProgress,
      isPlaying: _isPlaying && (!_useWeb || _currentTrack == 'pb'),
      playActionOnly: _useWeb,
      isPlayedBefore: isPlayedBefore,
      onCardTap: () => _openLessonFromLibrary(
        lessonId,
        autoPlayIfPaused: false,
        resume: true,
      ),
      onPlayPauseTap: () {
        if (_useWeb) { unawaited(_openLessonFromLibrary(lessonId, autoPlayIfPaused: true, resume: true)); return; }
        if (_isPlaying) {
          _globalPlayer.pause();
          _saveProgressSnapshot(forceDiskFlush: true);
        } else {
          unawaited(_safePlay());
        }
      },
      onConfirmReplay: () => _openLessonFromLibrary(
        lessonId,
        autoPlayIfPaused: true,
        startFromBeginning: true,
      ),
    );
    return _useWeb ? Semantics(label: 'Continue listening · Podcast', button: true, child: card) : card;
  }

  /// P16 — Sliding Active Pill Indicator (`transitions.dev`) for Course Library Filter Bar
  Widget _buildFilterPillsRow(AppPalette p) {
    final filters = [
      ('all', 'All (${_lessons.length})'),
      ('in_progress', 'In Progress'),
      ('completed', 'Completed'),
    ];
    final int activeIdx = _filterIndexFor(_libraryFilter);
    const double chipHeight = 30.0;

    return LayoutBuilder(builder: (context, constraints) {
      final chipWidth = math.min(98.0, math.max(0.0, (constraints.maxWidth - 8) / filters.length));
      return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: p.surfaceInset,
        borderRadius: BorderRadius.circular(9999),
        border: Border.all(color: p.border, width: 0.8),
      ),
      child: SizedBox(
        width: chipWidth * filters.length,
        height: chipHeight,
        child: Stack(
          clipBehavior: Clip.none,
          alignment: Alignment.centerLeft,
          children: [
            AnimatedPositioned(
              duration: _M3Motion.durFast,
              curve: _M3Motion.easeSmoothOut,
              left: activeIdx * chipWidth,
              top: 0,
              width: chipWidth,
              height: chipHeight,
              child: Container(
                decoration: BoxDecoration(
                  color: p.accent,
                  borderRadius: BorderRadius.circular(9999),
                ),
              ),
            ),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: filters.map((f) {
                final isSelected = _libraryFilter == f.$1;
                return _M3TactileScale(
                  pressedScale: 0.95,
                  onTap: () {
                    if (_libraryFilter == f.$1) {
                      // Re-tap on any already-selected filter pill → re-center active lesson if present in this filter
                      _centerActiveLessonInLibrary(animate: true);
                      return;
                    }
                    if (_libraryScrollController.hasClients &&
                        _libraryScrollController.positions.length == 1) {
                      _filterScrollOffsets[_libraryFilter] =
                          _libraryScrollController.position.pixels;
                    }
                    final oldIdx = _filterIndexFor(_libraryFilter);
                    final newIdx = _filterIndexFor(f.$1);
                    final maxOffset = _computeMaxLibraryOffset(
                      filterKey: f.$1,
                      viewportHeight: _lastLibraryViewportHeight,
                    );
                    final savedOffset =
                        (_filterScrollOffsets[f.$1] ?? 0.0).clamp(0.0, maxOffset);
                    _filterScrollOffsets[f.$1] = savedOffset;
                    setState(() {
                      _filterSlideDirection = newIdx >= oldIdx ? 1 : -1;
                      _libraryFilter = f.$1;
                    });
                    _filterSwitchController.forward(from: 0.0);
                    if (_libraryScrollController.hasClients &&
                        _libraryScrollController.positions.length == 1) {
                      _libraryScrollController.jumpTo(savedOffset);
                    }
                    WidgetsBinding.instance.addPostFrameCallback((_) {
                      if (!mounted) return;
                      if (_libraryScrollController.hasClients &&
                          _libraryScrollController.positions.length == 1) {
                        final clamped = savedOffset.clamp(
                          0.0,
                          _libraryScrollController.position.maxScrollExtent,
                        );
                        if ((_libraryScrollController.position.pixels - clamped)
                                .abs() >
                            0.5) {
                          _libraryScrollController.jumpTo(clamped);
                        }
                      }
                    });
                  },
                  child: SizedBox(
                    width: chipWidth,
                    height: chipHeight,
                    child: Center(
                      child: AnimatedDefaultTextStyle(
                        duration: _M3Motion.durFast,
                        curve: _M3Motion.easeSmoothOut,
                        style: TextStyle(
                          fontSize: 11.5,
                          height: 1.15,
                          fontWeight: FontWeight.w700,
                          color: isSelected ? p.accentFg : p.textPassed,
                        ),
                        child: Text(
                          f.$2,
                          maxLines: 1,
                          softWrap: false,
                          overflow: TextOverflow.ellipsis,
                          textHeightBehavior: const TextHeightBehavior(
                            applyHeightToFirstAscent: false,
                            applyHeightToLastDescent: false,
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
      ),
      );
    });
  }

  Widget _buildCourseCard(
    LessonSummary item,
    AppPalette p,
  ) {
    final rec = _progressMap[item.lessonId];
    // Real-time progressPct is bound strictly to Podcast ('pb'),
    // while `isDone` reflects permanent lesson completion (`isCompleted`),
    // and `hasStarted` ensures any opened/restarted uncompleted lesson at 0% shows `Resume 0%`
    // while completed lessons at 0% show `Replay 0%` (never reverting to `New`).
    final pct = rec?.progressPct ?? 0;
    final isDone = (rec?.isCompleted ?? false) || (!_useWeb && pct >= 95);
    final hasStarted = (rec?.hasStarted ?? false) || isDone || pct > 0;
    final isCurrent = item.lessonId == _lastPlayedLessonId;

    String statusLabel = 'New';
    double displayBarValue = (pct / 100.0).clamp(0.0, 1.0);
    if (isDone) {
      if (pct >= 95) {
        statusLabel = 'Done 100%';
        displayBarValue = 1.0;
      } else if (pct > 0) {
        statusLabel = 'Replay $pct%';
      } else {
        statusLabel = 'Replay 0%';
      }
    } else if (pct > 0) {
      statusLabel = 'Resume $pct%';
    } else if (hasStarted) {
      statusLabel = 'Resume 0%';
    }

    final bool highlightStatusPill = isDone || hasStarted || pct > 0;

    final card = _HoldToReplayCourseCard(
      key: ValueKey('course_card_${item.lessonId}'),
      item: item,
      palette: p,
      isDone: isDone,
      isCurrent: isCurrent,
      highlightStatusPill: highlightStatusPill,
      statusLabel: statusLabel,
      displayBarValue: displayBarValue,
      onTap: () => _openLessonFromLibrary(
        item.lessonId,
        autoPlayIfPaused: !_useWeb,
      ),
      onConfirmReplay: () => _openLessonFromLibrary(
        item.lessonId,
        autoPlayIfPaused: true,
        startFromBeginning: true,
      ),
    );
    return _useWeb ? Semantics(button: true, label: 'Open lesson ${item.lessonId} · Podcast', child: card) : card;
  }

  // ===========================================================================
  // SCREEN 2: UNIFIED [Podcast | Dialogue | Vocab] PLAYER
  // ===========================================================================

  Widget _buildImmersivePlayerScreen(AppPalette p, {required double navT}) {
    final lesson = _currentLesson;
    if (_useWeb) return _buildWebPlayer(p);
    final bool showEdgeShadow = navT > 0.001 && navT < 0.999;

    return DecoratedBox(
      key: const ValueKey('screen_player'),
      decoration: BoxDecoration(
        color: p.bgWell,
        boxShadow: showEdgeShadow
            ? [
                BoxShadow(
                  color: Colors.black.withValues(
                    alpha: (p.isDark ? 0.45 : 0.18) * navT,
                  ),
                  blurRadius: 24,
                  offset: const Offset(-6, 0),
                ),
              ]
            : const [],
      ),
      child: Column(
        children: [
          Expanded(
            child: RawGestureDetector(
              behavior: HitTestBehavior.translucent,
              gestures: <Type, GestureRecognizerFactory>{
                _RightwardPopDragGestureRecognizer:
                    GestureRecognizerFactoryWithHandlers<
                        _RightwardPopDragGestureRecognizer>(
                  () => _RightwardPopDragGestureRecognizer(
                    debugOwner: this,
                  ),
                  (_RightwardPopDragGestureRecognizer instance) {
                    instance
                      ..onStart = _onFullScreenPopDragStart
                      ..onUpdate = _onFullScreenPopDragUpdate
                      ..onEnd = _onFullScreenPopDragEnd
                      ..onCancel = _onFullScreenPopDragCancel;
                  },
                ),
              },
              child: Column(
                children: [
                  _buildPlayerTopBar(p),
                  Expanded(
                    child: lesson == null
                        ? Center(
                            child: CircularProgressIndicator(color: p.accent),
                          )
                        : _buildTranscriptBody(p),
                  ),
                ],
              ),
            ),
          ),
          // Option 1: Full-Width Docked Locate Banner Bar (`Return ↑ (5s)`) with P22 Toast Motion
          _buildFullWidthReturnBanner(p),
          // Metrolist Bottom Player Control Dock
          _buildMetrolistBottomDock(p),
        ],
      ),
    );
  }

  Widget _buildTranscriptBody(AppPalette p) {
    final lesson = _currentLesson!;
    final segs = _activeSegments;
    final stageGroups = _computeStageGroups(segs, _currentTrack);
    final clampedInitialIdx = segs.isEmpty ? 0 : _activeSegIndex.clamp(0, segs.length - 1);
    return AnimatedSwitcher(
                            // P8 — Directional Page Slide (`transitions.dev`) between Podcast / Dialogue / Vocab
                            duration: _M3Motion.durFast,
                            switchInCurve: _M3Motion.easeSmoothOut,
                            switchOutCurve: _M3Motion.m3EmphasizedAccelerate,
                            transitionBuilder: (child, animation) {
                              return FadeTransition(
                                opacity: animation,
                                child: SlideTransition(
                                  position: Tween<Offset>(
                                    begin: Offset(
                                        0.04 * _tabSlideDirection, 0.0),
                                    end: Offset.zero,
                                  ).animate(animation),
                                  child: child,
                                ),
                              );
                            },
                            child: _playerTab == 'vocab'
                                ? KeyedSubtree(
                                    key: ValueKey(
                                        'tab_vocab_${lesson.lessonId}'),
                                    child:
                                        _buildInlineVocabularyTab(lesson, p),
                                  )
                                : KeyedSubtree(
                                    key: ValueKey(
                                        'tab_transcript_${lesson.lessonId}_$_currentTrack'),
                                    child: NotificationListener<
                                        ScrollNotification>(
                                      onNotification: (notification) {
                                        if (_useWeb ? (notification is UserScrollNotification && notification.direction != ScrollDirection.idle || notification is ScrollUpdateNotification && notification.dragDetails != null) : (notification is UserScrollNotification || notification is ScrollUpdateNotification)) {
                                          _onUserScrollInteraction();
                                        }
                                        return false;
                                      },
                                      child: Listener(onPointerSignal: (_) { if (_useWeb) _onUserScrollInteraction(); }, child:
                                          ScrollablePositionedList.builder(
                                        itemScrollController:
                                            _itemScrollController,
                                        itemPositionsListener:
                                            _itemPositionsListener,
                                        initialScrollIndex:
                                            clampedInitialIdx,
                                        initialAlignment:
                                            clampedInitialIdx > 0
                                                ? (_useWeb ? 0.28 : 0.32)
                                                : 0.0,
                                        padding: _useWeb ? const EdgeInsets.fromLTRB(32, 24, 32, 80) : const EdgeInsets.fromLTRB(18, 16, 18, 6),
                                        itemCount: segs.length,
                                        itemBuilder: (context, index) {
                                          final seg = segs[index];
                                          final stageInfo =
                                              index < stageGroups.length
                                                  ? stageGroups[index]
                                                  : null;
                                          final isActive =
                                              index == _activeSegIndex;

                                          final Widget itemWidget =
                                              _buildTranscriptItem(
                                            seg: seg,
                                            index: index,
                                            isActive: isActive,
                                            stageInfo: stageInfo,
                                            p: p,
                                          );

                                          if (index == 0) {
                                            return Column(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.start,
                                              children: [
                                                _buildLessonInlineHeader(
                                                    lesson, p),
                                                itemWidget,
                                              ],
                                            );
                                          }
                                          return itemWidget;
                                        },
                                      )),
                                    ),
                                  ),
                          );
  }

  /// Unified Top Bar: `[← Library]` on the left + `[Podcast | Dialogue | Vocab]` capsule on the right.
  /// Uses `transitions.dev` P16 Sliding Active Pill Indicator + animated theme-accent underline
  /// when an audio source (`Podcast` or `Dialogue`) is active in the background while viewing `Vocab`.
  Widget _buildPlayerTopBar(AppPalette p) {
    final topInset = MediaQuery.of(context).padding.top;
    final compact = MediaQuery.sizeOf(context).width < 360;
    final int activeTabIdx = _tabIndexFor(_playerTab);
    final double tabWidth = compact ? 70.0 : 76.0;
    const double tabHeight = 30.0;

    return Container(
      padding: EdgeInsets.fromLTRB(16, topInset + 8, 16, 10),
        decoration: BoxDecoration(
          color: p.deckBg,
          gradient: RadialGradient(
            center: const Alignment(0.0, -1.0),
            radius: 1.35,
            colors: p.deckGradientColors,
            stops: const [0.0, 0.58, 1.0],
          ),
          border: Border(bottom: BorderSide(color: p.deckBorder)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            // Left: Back to Course Library with tactile M3 scale
            _M3TactileScale(
              pressedScale: 0.93,
              onTap: _returnToLibraryScreen,
              child: Container(
                height: 36,
                padding: EdgeInsets.symmetric(horizontal: compact ? 10 : 13),
                decoration: BoxDecoration(
                  color: p.surface2,
                  borderRadius: BorderRadius.circular(9999),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.arrow_back_rounded,
                        size: 16, color: p.textPrimary),
                    const SizedBox(width: 5),
                    if (!compact)
                      Text(
                      'Library',
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: p.textPrimary,
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // Right: 3-in-1 Segmented Capsule [Podcast | Dialogue | Vocab] with P16 Sliding Pill
            Container(
              height: 36,
              padding: const EdgeInsets.all(3),
              decoration: BoxDecoration(
                color: p.surface2,
                borderRadius: BorderRadius.circular(9999),
              ),
              child: Stack(
                children: [
                  // P16 Sliding Active Pill Indicator (`transitions.dev`)
                  AnimatedPositioned(
                    duration: _M3Motion.durFast,
                    curve: _M3Motion.easeSmoothOut,
                    left: activeTabIdx * tabWidth,
                    top: 0,
                    width: tabWidth,
                    height: tabHeight,
                    child: Container(
                      decoration: BoxDecoration(
                        color: p.accent,
                        borderRadius: BorderRadius.circular(9999),
                      ),
                    ),
                  ),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _buildTopTabChip('pb', 'Podcast', p),
                      _buildTopTabChip('dg', 'Dialogue', p),
                      _buildTopTabChip('vocab', 'Vocab', p),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

  Widget _buildTopTabChip(String tabKey, String label, AppPalette p) {
    final double chipWidth = MediaQuery.sizeOf(context).width < 360 ? 70.0 : 76.0;
    final bool isSelectedView = _playerTab == tabKey;
    final bool isPlayingAudioSource =
        (tabKey == 'pb' || tabKey == 'dg') && _currentTrack == tabKey;
    final bool showUnselectedUnderline =
        !isSelectedView && isPlayingAudioSource;

    final chip = _M3TactileScale(
      pressedScale: 0.94,
      onTap: () async {
        if (_useWeb) {
          _webTouch();
          _tabSlideDirection = _tabIndexFor(tabKey) >= _tabIndexFor(_playerTab) ? 1 : -1;
          await _web?.switchTrack(tabKey);
          return;
        }
        if (_playerTab == tabKey) return;
        _hideReturnBanner();

        final int oldIdx = _tabIndexFor(_playerTab);
        final int newIdx = _tabIndexFor(tabKey);
        final int dir = newIdx >= oldIdx ? 1 : -1;

        // 1. Clicking 'Vocab': switch view only, do NOT interrupt or reload audio!
        if (tabKey == 'vocab') {
          await _saveProgressSnapshot(forceDiskFlush: false);
          _resetTranscriptScrollController();
          setState(() {
            _tabSlideDirection = dir;
            _playerTab = 'vocab';
          });
          return;
        }

        // 2. Clicking 'Podcast' ('pb') or 'Dialogue' ('dg'):
        // If this track is ALREADY the active audio source (e.g. returning from 'vocab' to 'pb'),
        // do NOT reload audio! Simply switch view back and jump immediately to the active sentence!
        if (_currentTrack == tabKey) {
          _resetTranscriptScrollController();
          setState(() {
            _tabSlideDirection = dir;
            _playerTab = tabKey;
          });
          WidgetsBinding.instance.addPostFrameCallback((_) {
            _jumpToActiveSentenceImmediate();
          });
          return;
        }

        // 3. Switching audio source between 'pb' and 'dg':
        // Save the outgoing track's exact position first (if not currently loading)
        await _saveProgressSnapshot(forceDiskFlush: true);

        final lesson = _currentLesson;
        final lid = lesson?.lessonId;
        final rec = lid != null ? _progressMap[lid] : null;
        final double savedSec = rec == null
            ? 0.0
            : (tabKey == 'dg' ? rec.dgPosSec : rec.pbPosSec);
        final int savedSegIdx = rec == null
            ? 0
            : (tabKey == 'dg' ? rec.dgSegIdx : rec.pbSegIdx);

        _resetTranscriptScrollController();
        setState(() {
          _tabSlideDirection = dir;
          _playerTab = tabKey;
          _currentTrack = tabKey;
        });

        await _loadTrackAudio(
          tabKey,
          autoPlay: true,
          initialSeekSec: savedSec,
          initialSegIndex: savedSegIdx,
        );
      },
      child: SizedBox(
        width: chipWidth,
        height: 30,
        child: Stack(
          alignment: Alignment.center,
          children: [
            AnimatedDefaultTextStyle(
              duration: _M3Motion.durFast,
              curve: _M3Motion.easeSmoothOut,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: isSelectedView
                    ? p.accentFg
                    : (isPlayingAudioSource ? p.textPrimary : p.textPassed),
              ),
              child: Text(label),
            ),
            // Theme-colored underline when unselected & active audio source;
            // smoothly shrinks/covered when selected pill glides over it!
            Positioned(
              bottom: 3.5,
              child: AnimatedContainer(
                duration: _M3Motion.durFast,
                curve: _M3Motion.easeSmoothOut,
                width: showUnselectedUnderline ? 42.0 : 0.0,
                height: 2.2,
                decoration: BoxDecoration(
                  color: showUnselectedUnderline
                      ? p.accent
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(9999),
                ),
              ),
            ),
          ],
        ),
      ),
    );
    return _useWeb ? Semantics(button: true, selected: isSelectedView, label: label, excludeSemantics: true, onTap: () { _webTouch(); unawaited(_web?.switchTrack(tabKey)); }, child: chip) : chip;
  }

  Widget _buildLessonInlineHeader(LessonDetail lesson, AppPalette p) {
    final trackTag = _currentTrack == 'dg' ? 'DIALOGUE TRACK' : 'PODCAST TRACK';
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'LESSON ${lesson.lessonNumber.toString().padLeft(2, '0')} · ${lesson.level.toUpperCase()} · $trackTag',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.8,
              color: p.accent,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            lesson.title,
            style: TextStyle(
              fontSize: 19,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.4,
              color: p.textPrimary,
            ),
          ),
        ],
      ),
    );
  }

  /// Renders either an open host commentary sentence or a contiguous Stage Container Box
  /// segment (`Dialogue`, `Examples`, `Phrase Drill`, `Section`) with P21 Accordion support.
  Widget _buildTranscriptItem({
    required TranscriptSegment seg,
    required int index,
    required bool isActive,
    required _StageGroupInfo? stageInfo,
    required AppPalette p,
  }) {
    final bool isBoxCollapsed = stageInfo != null &&
        _collapsedStageBoxIds.contains(stageInfo.boxGroupId);

    // If this segment is inside a collapsed Stage Box and is NOT the first header item,
    // smoothly collapse its height to 0 using P21 Accordion timing (`250ms` `easeSmoothOut`).
    if (stageInfo != null && !stageInfo.isFirstInBox && isBoxCollapsed) {
      return const AnimatedSize(
        duration: _M3Motion.durFast,
        curve: _M3Motion.easeSmoothOut,
        alignment: Alignment.topCenter,
        child: SizedBox(width: double.infinity, height: 0),
      );
    }

    if (seg.isSection && stageInfo != null && stageInfo.isFirstInBox) {
      final bool roundBottom = stageInfo.isLastInBox || isBoxCollapsed;
      return AnimatedContainer(
        duration: _M3Motion.durFast,
        curve: _M3Motion.easeSmoothOut,
        padding: EdgeInsets.fromLTRB(
          15,
          13,
          15,
          roundBottom ? 13 : 4,
        ),
        margin: EdgeInsets.only(
          top: 6,
          bottom: roundBottom ? 20 : 0,
        ),
        decoration: BoxDecoration(
          color: p.stageBoxBg,
          borderRadius: BorderRadius.vertical(
            top: const Radius.circular(20),
            bottom: Radius.circular(roundBottom ? 20 : 0),
          ),
          border: Border(
            top: BorderSide(color: p.stageBoxBorder),
            left: BorderSide(color: p.stageBoxBorder),
            right: BorderSide(color: p.stageBoxBorder),
            bottom: roundBottom
                ? BorderSide(color: p.stageBoxBorder)
                : BorderSide.none,
          ),
        ),
        child: _buildStageBoxHeaderRow(
          boxGroupId: stageInfo.boxGroupId,
          badgeText: stageInfo.badgeText,
          subText: stageInfo.subText,
          isCollapsed: isBoxCollapsed,
          p: p,
        ),
      );
    }

    final sentenceContent = _buildSentenceInnerContent(
      seg,
      index,
      isActive,
      stageInfo,
      p,
    );

    if (stageInfo == null) {
      return _M3TactileScale(
        pressedScale: 0.985,
        onTap: () => _jumpToSegment(index),
        child: Container(
          margin: const EdgeInsets.only(bottom: 18),
          child: sentenceContent,
        ),
      );
    }

    final bool roundBottom = stageInfo.isLastInBox || isBoxCollapsed;
    return AnimatedSize(
      duration: _M3Motion.durFast,
      curve: _M3Motion.easeSmoothOut,
      alignment: Alignment.topCenter,
      child: AnimatedContainer(
        duration: _M3Motion.durFast,
        curve: _M3Motion.easeSmoothOut,
        margin: EdgeInsets.only(
          top: stageInfo.isFirstInBox ? 6 : 0,
          bottom: roundBottom ? 20 : 0,
        ),
        padding: EdgeInsets.fromLTRB(
          15,
          stageInfo.isFirstInBox ? 13 : 6,
          15,
          roundBottom ? 14 : 6,
        ),
        decoration: BoxDecoration(
          color: p.stageBoxBg,
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(stageInfo.isFirstInBox ? 20 : 0),
            bottom: Radius.circular(roundBottom ? 20 : 0),
          ),
          border: Border(
            top: stageInfo.isFirstInBox
                ? BorderSide(color: p.stageBoxBorder)
                : BorderSide.none,
            left: BorderSide(color: p.stageBoxBorder),
            right: BorderSide(color: p.stageBoxBorder),
            bottom: roundBottom
                ? BorderSide(color: p.stageBoxBorder)
                : BorderSide.none,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (stageInfo.isFirstInBox) ...[
              _buildStageBoxHeaderRow(
                boxGroupId: stageInfo.boxGroupId,
                badgeText: stageInfo.badgeText,
                subText: stageInfo.subText,
                isCollapsed: isBoxCollapsed,
                p: p,
              ),
              AnimatedSize(
                duration: _M3Motion.durFast,
                curve: _M3Motion.easeSmoothOut,
                alignment: Alignment.topCenter,
                child: isBoxCollapsed
                    ? const SizedBox.shrink()
                    : Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: _M3TactileScale(
                          pressedScale: 0.985,
                          onTap: () => _jumpToSegment(index),
                          child: sentenceContent,
                        ),
                      ),
              ),
            ] else
              _M3TactileScale(
                pressedScale: 0.985,
                onTap: () => _jumpToSegment(index),
                child: sentenceContent,
              ),
          ],
        ),
      ),
    );
  }

  /// Stage Box Header Row with P21 Accordion toggle (`transitions.dev/detail.html?t=accordion`)
  Widget _buildStageBoxHeaderRow({
    required int boxGroupId,
    required String badgeText,
    required String subText,
    required bool isCollapsed,
    required AppPalette p,
  }) {
    return _M3TactileScale(
      pressedScale: 0.98,
      onTap: () {
        setState(() {
          if (_collapsedStageBoxIds.contains(boxGroupId)) {
            _collapsedStageBoxIds.remove(boxGroupId);
          } else {
            _collapsedStageBoxIds.add(boxGroupId);
          }
        });
      },
      child: AnimatedContainer(
        duration: _M3Motion.durFast,
        curve: _M3Motion.easeSmoothOut,
        padding: EdgeInsets.only(bottom: isCollapsed ? 2 : 9),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: isCollapsed ? Colors.transparent : p.border,
            ),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Flexible(
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 3.5),
                decoration: BoxDecoration(
                  color: p.accentSoft,
                  borderRadius: BorderRadius.circular(9999),
                ),
                child: Text(
                  badgeText,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.6,
                    color: p.accent,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  isCollapsed ? 'Tap to expand' : subText,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: p.textPassed,
                  ),
                ),
                const SizedBox(width: 4),
                _P21AnimatedChevron(
                  isOpen: !isCollapsed,
                  color: p.textPassed,
                  size: 16,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _resolveSpeakerDisplayName(
    TranscriptSegment seg,
    _StageGroupInfo? stageInfo,
  ) {
    final spk = seg.speaker.trim();
    if (spk.isEmpty) return '•';

    // When outside Dialogue and Example Stage Boxes (open Podcast host flow),
    // display hosts by their full names!
    if (stageInfo == null) {
      if (spk == 'M') return 'MARCO';
      if (spk == 'E') return 'ERICA';
      if (spk == 'C') return 'CATHERINE';
      if (spk == 'A') return 'AMIRA';
      if (spk == 'S') return 'SARAH';
      if (spk == 'P') return 'PETER';
      if (spk == 'C,M' || spk == 'M,C') return 'MARCO & CATHERINE';
    } else if (spk == 'M') {
      return 'MARCO';
    }
    return spk.toUpperCase();
  }

  Widget _buildSentenceInnerContent(
    TranscriptSegment seg,
    int index,
    bool isActive,
    _StageGroupInfo? stageInfo,
    AppPalette p,
  ) {
    final bool isPassed = index < _activeSegIndex;
    final bool isLoopingThis = isActive && _singleSentenceLoop;
    final String speakerLabel = _resolveSpeakerDisplayName(seg, stageInfo);

    return AnimatedContainer(
      duration: _M3Motion.durFast,
      curve: _M3Motion.easeSmoothOut,
      padding: EdgeInsets.fromLTRB(14, _useWeb ? 12 : 6, 4, _useWeb ? 12 : 6),
      decoration: BoxDecoration(
        border: Border(
          left: BorderSide(
            color: isActive ? p.accent : Colors.transparent,
            width: 3.0,
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: 18,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                AnimatedDefaultTextStyle(
                  duration: _M3Motion.durFast,
                  curve: _M3Motion.easeSmoothOut,
                  style: TextStyle(
                    fontSize: 11,
                    height: 1.0,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.85,
                    color: isActive ? p.accent : p.textPassed,
                  ),
                  child: Text(speakerLabel),
                ),
                AnimatedSwitcher(
                  duration: _M3Motion.durFast,
                  switchInCurve: _M3Motion.easeBounce,
                  switchOutCurve: Curves.easeIn,
                  transitionBuilder: (child, anim) => ScaleTransition(
                    scale: anim,
                    child: FadeTransition(opacity: anim, child: child),
                  ),
                  child: isLoopingThis
                      ? Padding(
                          key: const ValueKey('loop_badge_on'),
                          padding: const EdgeInsets.only(left: 8),
                          child: Container(
                            height: 16,
                            padding: const EdgeInsets.symmetric(horizontal: 7),
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: p.accentSoft,
                              borderRadius: BorderRadius.circular(9999),
                            ),
                            child: Text(
                              'LOOP 1',
                              style: TextStyle(
                                fontSize: 9.5,
                                height: 1.0,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 0.5,
                                color: p.accent,
                              ),
                            ),
                          ),
                        )
                      : const SizedBox.shrink(key: ValueKey('loop_badge_off')),
                ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          _buildVocabularyHighlightedText(
            text: seg.text,
            isActive: isActive,
            isPassed: isPassed,
            p: p,
          ),
        ],
      ),
    );
  }

  /// Highlights vocabulary words/phrases in pure theme accent color WITHOUT underline,
  /// smoothly animating color transitions between upcoming, active, and passed states
  /// while keeping text geometry and line wrapping 100% invariant.
  Widget _buildVocabularyHighlightedText({
    required String text,
    required bool isActive,
    required bool isPassed,
    required AppPalette p,
  }) {
    final Color targetBaseColor = isActive
        ? p.textPrimary
        : isPassed
            ? p.textPassed
            : p.textUpcoming;

    final Color targetVocabColor = isActive
        ? p.vocabHlActive
        : isPassed
            ? p.vocabHlPassed
            : p.vocabHlUnplayed;

    return TweenAnimationBuilder<Color?>(
      tween: ColorTween(begin: targetBaseColor, end: targetBaseColor),
      duration: const Duration(milliseconds: 220),
      curve: _M3Motion.easeSmoothOut,
      builder: (context, animatedBaseColor, _) {
        final baseColor = animatedBaseColor ?? targetBaseColor;
        final TextStyle baseMetrics = TextStyle(
          fontSize: _useWeb ? _webTextSize : 21.5,
          height: _useWeb ? 1.5 : 1.40,
          letterSpacing: -0.35,
          fontWeight: FontWeight.w700,
          decoration: TextDecoration.none,
        );
        final TextStyle baseStyle = baseMetrics.copyWith(color: baseColor);

        final regex = _vocabHighlightRegex;
        if (regex == null || text.isEmpty) {
          return Text(text, style: baseStyle);
        }

        final matches = regex.allMatches(text).toList();
        if (matches.isEmpty) {
          return Text(text, style: baseStyle);
        }

        final TextStyle vocabStyle =
            baseMetrics.copyWith(color: targetVocabColor);
        final List<TextSpan> spans = [];
        int lastEnd = 0;
        for (final m in matches) {
          if (m.start > lastEnd) {
            spans.add(TextSpan(text: text.substring(lastEnd, m.start)));
          }
          spans.add(
            TextSpan(
              text: text.substring(m.start, m.end),
              style: vocabStyle,
            ),
          );
          lastEnd = m.end;
        }
        if (lastEnd < text.length) {
          spans.add(TextSpan(text: text.substring(lastEnd)));
        }

        return Text.rich(
          TextSpan(style: baseStyle, children: spans),
        );
      },
    );
  }

  /// Option 1: Full-Width Docked Locate Banner (`Return ↑ (5s)`)
  /// Uses `transitions.dev` P22 Toast open/close motion (`320ms` open, `180ms` close, `easeSmoothOut`)
  /// and P9 Number pop-in for the 5s countdown.
  Widget _buildFullWidthReturnBanner(AppPalette p) {
    final bool isVisible = _showReturnBanner && _playerTab != 'vocab';

    return AnimatedSize(
      duration: isVisible ? _M3Motion.durMedium : _M3Motion.durQuick,
      curve: _M3Motion.easeSmoothOut,
      alignment: Alignment.bottomCenter,
      child: isVisible
          ? TweenAnimationBuilder<double>(
              tween: Tween<double>(begin: 0.0, end: 1.0),
              duration: _M3Motion.durMedium,
              curve: _M3Motion.easeSmoothOut,
              builder: (context, t, child) {
                return Opacity(
                  opacity: t.clamp(0.0, 1.0),
                  child: Transform.translate(
                    offset: Offset(0.0, (1.0 - t) * 14.0),
                    child: Transform.scale(
                      scale: 0.97 + 0.03 * t,
                      child: child,
                    ),
                  ),
                );
              },
              child: _M3TactileScale(
                pressedScale: 0.98,
                onTap: _snapBackToActiveSentence,
                child: Container(
                  height: 42,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  decoration: BoxDecoration(
                    color: p.locateBarBg,
                    border: Border(
                      top: BorderSide(color: p.locateBarBorder, width: 1.0),
                    ),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 22,
                        height: 22,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: p.accentSoft,
                        ),
                        alignment: Alignment.center,
                        child: Icon(
                          Icons.my_location_rounded,
                          size: 13,
                          color: p.accent,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _currentLiveSentenceText,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: p.textPrimary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            )
          : const SizedBox(width: double.infinity, height: 0),
    );
  }

  // ===========================================================================
  // INLINE VOCABULARY TAB WITH P21 ACCORDION (`https://transitions.dev/detail.html?t=accordion`)
  // ===========================================================================

  /// Finds matching transcript sentences in the current lesson where `word` appears,
  /// so expanding a Vocabulary Accordion card (`P21`) reveals live interactive examples!
  List<(String, int, TranscriptSegment)> _findContextualSentencesForWord(
    LessonDetail lesson,
    String word,
  ) {
    final trimmed = word.trim();
    if (trimmed.isEmpty) return const [];
    final pattern = RegExp(r'\b' + RegExp.escape(trimmed) + r'\b',
        caseSensitive: false);
    final List<(String, int, TranscriptSegment)> matches = [];

    for (int i = 0; i < lesson.pbSegments.length; i++) {
      final seg = lesson.pbSegments[i];
      if (!seg.isSection && pattern.hasMatch(seg.text)) {
        matches.add(('pb', i, seg));
        if (matches.length >= 3) return matches;
      }
    }
    for (int i = 0; i < lesson.dgSegments.length; i++) {
      final seg = lesson.dgSegments[i];
      if (!seg.isSection && pattern.hasMatch(seg.text)) {
        final duplicate = matches.any((m) => m.$3.text.trim() == seg.text.trim());
        if (!duplicate) {
          matches.add(('dg', i, seg));
          if (matches.length >= 3) return matches;
        }
      }
    }
    return matches;
  }

  Widget _buildInlineVocabularyTab(LessonDetail lesson, AppPalette p) {
    final vocab = lesson.vocabulary;
    final keyVocab = vocab.where((v) => v.type == 'key').toList();
    final suppVocab = vocab.where((v) => v.type != 'key').toList();
    final activeAudioLabel =
        _currentTrack == 'dg' ? 'PLAYING: DIALOGUE' : 'PLAYING: PODCAST';

    return RawScrollbar(
      controller: _vocabScrollController,
      thumbColor: p.scrollbarThumb,
      radius: const Radius.circular(9999),
      thickness: 4,
      padding: const EdgeInsets.only(right: 2),
      child: ListView(
        controller: _vocabScrollController,
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 28),
        children: [
          Text(
            'LESSON ${lesson.lessonNumber.toString().padLeft(2, '0')} · $activeAudioLabel',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.8,
              color: p.accent,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            'Vocabulary (${vocab.length})',
            style: TextStyle(
              fontSize: 19,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.4,
              color: p.textPrimary,
            ),
          ),
          const SizedBox(height: 14),
          if (keyVocab.isNotEmpty) ...[
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                'KEY VOCABULARY · TAP CARD TO EXPAND EXAMPLES',
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.8,
                  color: p.accent,
                ),
              ),
            ),
            ...keyVocab.map((v) => _buildVocabCard(lesson, v, p)),
            const SizedBox(height: 8),
          ],
          if (suppVocab.isNotEmpty) ...[
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                'SUPPLEMENTARY VOCABULARY',
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.8,
                  color: p.accent,
                ),
              ),
            ),
            ...suppVocab.map((v) => _buildVocabCard(lesson, v, p)),
          ],
        ],
      ),
    );
  }

  /// P21 Accordion Vocabulary Card (`https://transitions.dev/detail.html?t=accordion`):
  /// Top-aligned fixed header with `scaleY(1 ↔ -1)` chevron + smooth `250ms` `easeSmoothOut`
  /// height & opacity expansion revealing clickable in-lesson contextual sentences!
  Widget _buildVocabCard(LessonDetail lesson, VocabEntry v, AppPalette p) {
    final String wordKey = v.word.toLowerCase();
    final bool isOpen = _expandedVocabWords.contains(wordKey);
    final examples = _findContextualSentencesForWord(lesson, v.word);

    return _M3TactileScale(
      pressedScale: 0.985,
      onTap: () {
        setState(() {
          if (isOpen) {
            _expandedVocabWords.remove(wordKey);
          } else {
            _expandedVocabWords.add(wordKey);
          }
        });
      },
      child: AnimatedContainer(
        duration: _M3Motion.durFast,
        curve: _M3Motion.easeSmoothOut,
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
        decoration: BoxDecoration(
          color: p.surface1,
          borderRadius: BorderRadius.circular(isOpen ? 16 : 14),
          border: Border.all(
            color: isOpen ? p.locateBarBorder : p.border,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Fixed-position Accordion Header Row
            Row(
              children: [
                Expanded(
                  child: Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 6,
                    children: [
                      Text(
                        v.word,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                          color: p.accent,
                        ),
                      ),
                      Text(
                        '${v.pos} · ${v.type == 'key' ? 'Key' : 'Supplementary'}',
                        style: TextStyle(
                          fontSize: 12,
                          fontStyle: FontStyle.italic,
                          color: p.textPassed,
                        ),
                      ),
                    ],
                  ),
                ),
                if (examples.isNotEmpty)
                  Container(
                    margin: const EdgeInsets.only(right: 6),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 7, vertical: 2),
                    decoration: BoxDecoration(
                      color: isOpen ? p.accentSoft : p.surface2,
                      borderRadius: BorderRadius.circular(9999),
                    ),
                    child: Text(
                      '${examples.length} in lesson',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: isOpen ? p.accent : p.textPassed,
                      ),
                    ),
                  ),
                _P21AnimatedChevron(
                  isOpen: isOpen,
                  color: isOpen ? p.accent : p.textPassed,
                  size: 18,
                ),
              ],
            ),
            const SizedBox(height: 5),
            Text(
              v.definition,
              style: TextStyle(
                fontSize: 13.5,
                height: 1.45,
                color: p.textPrimary,
              ),
            ),
            // P21 Accordion Panel (`grid-template-rows: 0fr ↔ 1fr` equivalent in Flutter)
            AnimatedSize(
              duration: _M3Motion.durFast,
              curve: _M3Motion.easeSmoothOut,
              alignment: Alignment.topCenter,
              child: AnimatedOpacity(
                duration: _M3Motion.durFast,
                curve: _M3Motion.easeSmoothOut,
                opacity: isOpen ? 1.0 : 0.0,
                child: isOpen
                    ? Padding(
                        padding: const EdgeInsets.only(top: 11),
                        child: Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(11),
                          decoration: BoxDecoration(
                            color: p.surfaceInset,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: p.border),
                          ),
                          child: examples.isEmpty
                              ? Text(
                                  'Tap "${v.word}" inside the transcript to hear it in context.',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: p.textPassed,
                                  ),
                                )
                              : Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'IN THIS LESSON · TAP SENTENCE TO PLAY',
                                      style: TextStyle(
                                        fontSize: 9.5,
                                        fontWeight: FontWeight.w800,
                                        letterSpacing: 0.7,
                                        color: p.accent,
                                      ),
                                    ),
                                    const SizedBox(height: 6),
                                    ...examples.map((ex) {
                                      final trackKey = ex.$1;
                                      final segIdx = ex.$2;
                                      final seg = ex.$3;
                                      return Padding(
                                        padding:
                                            const EdgeInsets.only(bottom: 6),
                                        child: _M3TactileScale(
                                          pressedScale: 0.97,
                                          onTap: () async {
                                            _resetTranscriptScrollController();
                                            setState(() {
                                              _tabSlideDirection = -1;
                                              _playerTab = trackKey;
                                            });
                                            if (_currentTrack != trackKey) {
                                              await _saveProgressSnapshot(
                                                  forceDiskFlush: true);
                                              _resetTranscriptScrollController();
                                              setState(() {
                                                _currentTrack = trackKey;
                                              });
                                              await _loadTrackAudio(
                                                trackKey,
                                                autoPlay: true,
                                                initialSeekSec: seg.start,
                                                initialSegIndex: segIdx,
                                              );
                                            } else {
                                              await _jumpToSegment(segIdx);
                                            }
                                          },
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(
                                                horizontal: 10, vertical: 8),
                                            decoration: BoxDecoration(
                                              color: p.surface1,
                                              borderRadius:
                                                  BorderRadius.circular(10),
                                              border:
                                                  Border.all(color: p.border),
                                            ),
                                            child: Row(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.start,
                                              children: [
                                                Padding(
                                                  padding:
                                                      const EdgeInsets.only(
                                                          top: 1),
                                                  child: Icon(
                                                    Icons
                                                        .play_circle_fill_rounded,
                                                    size: 16,
                                                    color: p.accent,
                                                  ),
                                                ),
                                                const SizedBox(width: 8),
                                                Expanded(
                                                  child: Text(
                                                    seg.text,
                                                    style: TextStyle(
                                                      fontSize: 12.5,
                                                      height: 1.35,
                                                      fontWeight:
                                                          FontWeight.w600,
                                                      color: p.textPrimary,
                                                    ),
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                      );
                                    }),
                                  ],
                                ),
                        ),
                      )
                    : const SizedBox(width: double.infinity, height: 0),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ===========================================================================
  // METROLIST-INSPIRED BOTTOM PLAYER CONTROL DOCK (WITH M3 EXPRESSIVE MOTION)
  // ===========================================================================

  Widget _buildMetrolistBottomDock(AppPalette p) {
    final progress = (_durationSec > 0)
        ? (_currentPositionSec / _durationSec).clamp(0.0, 1.0)
        : 0.0;
    final bool isCustomSpeed = (_currentSpeed - 1.0).abs() > 0.01;
    final double bottomInset = MediaQuery.paddingOf(context).bottom;
    final double bottomPad =
        14.0 + (bottomInset > 0.0 ? math.max(6.0, bottomInset - 6.0) : 0.0);

    return Container(
      padding: EdgeInsets.fromLTRB(20, 10, 20, bottomPad),
      decoration: BoxDecoration(
        color: p.bottomBg,
        border: Border(top: BorderSide(color: p.deckBorder)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Row 1: Metrolist Scrubber with Vertical Pill Thumb + Timestamps Below
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Listener(
                onPointerDown: (_) => _pointerInSliderZone = true,
                onPointerUp: (_) => _pointerInSliderZone = false,
                onPointerCancel: (_) => _pointerInSliderZone = false,
                child: SizedBox(
                  height: 22,
                  child: TweenAnimationBuilder<double>(
                  tween: Tween<double>(begin: 0.0, end: progress),
                  duration: _isDraggingSlider
                      ? Duration.zero
                      : const Duration(milliseconds: 260),
                  curve: _M3Motion.easeSmoothOut,
                  builder: (context, animatedSliderValue, _) {
                    return SliderTheme(
                      data: SliderTheme.of(context).copyWith(
                        trackHeight: 7.0,
                        activeTrackColor: p.accent,
                        inactiveTrackColor: p.surface2,
                        thumbColor: p.accent,
                        thumbShape: _MetrolistVerticalThumbShape(
                          width: 4.0,
                          height: 18.0,
                          borderColor: p.bottomBg,
                        ),
                        overlayShape:
                            const RoundSliderOverlayShape(overlayRadius: 10.0),
                      ),
                      child: Slider(
                        value: _isDraggingSlider
                            ? progress
                            : animatedSliderValue.clamp(0.0, 1.0),
                        onChangeStart: (_) {
                          setState(() {
                            _isDraggingSlider = true;
                          });
                        },
                        onChanged: (v) {
                          final targetSec = v * _durationSec;
                          final segs = _activeSegments;
                          final targetIdx = _findSegmentIndexForSec(
                            segs,
                            targetSec,
                            fallbackIdx: _activeSegIndex,
                          );
                          setState(() {
                            _currentPositionSec = targetSec;
                            _activeSegIndex = targetIdx;
                          });
                        },
                        onChangeEnd: (v) async {
                          final targetSec = v * _durationSec;
                          final segs = _activeSegments;
                          final targetIdx = _findSegmentIndexForSec(
                            segs,
                            targetSec,
                            fallbackIdx: _activeSegIndex,
                          );
                          _hideReturnBanner();
                          setState(() {
                            _isDraggingSlider = false;
                            _currentPositionSec = targetSec;
                            _activeSegIndex = targetIdx;
                            _ensureStageBoxExpandedForSegment(targetIdx);
                          });
                          if (_activeScreen == 'player' &&
                              _playerTab != 'vocab' &&
                              _itemScrollController.isAttached &&
                              segs.isNotEmpty) {
                            _programmaticScrollUntilMs =
                                DateTime.now().millisecondsSinceEpoch + 850;
                            _safeScrollTranscriptToIndex(
                              targetIdx,
                              duration: _M3Motion.durMedium,
                              curve: _M3Motion.easeSmoothOut,
                            );
                          }
                          await _globalPlayer.seek(
                            Duration(milliseconds: (targetSec * 1000).round()),
                          );
                          await _saveProgressSnapshot(forceDiskFlush: true);
                        },
                      ),
                    );
                  },
                ),
                ),
              ),
              const SizedBox(height: 2),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    _formatTime(_currentPositionSec),
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: p.textPassed,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                  Text(
                    _formatTime(_durationSec),
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: p.textPassed,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
            ],
          ),

          const SizedBox(height: 10),

          // Row 2: Primary Hero Transport Row (Big Prev Sentence | Giant M3 Morphing Play/Pause | Big Next Sentence)
          Row(
            children: [
              _M3TactileScale(
                pressedScale: 0.90,
                onTap: _prevSentence,
                child: Container(
                  width: 58,
                  height: 58,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: p.surface2,
                    border: Border.all(color: p.border),
                  ),
                  alignment: Alignment.center,
                  child: Icon(
                    Icons.skip_previous_rounded,
                    size: 28,
                    color: p.textPrimary,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: _HoldToReplayHeroButton(
                  isPlaying: _isPlaying,
                  palette: p,
                  onTap: () {
                    if (_isPlaying) {
                      _globalPlayer.pause();
                      _saveProgressSnapshot(forceDiskFlush: true);
                    } else {
                      unawaited(_safePlay());
                    }
                  },
                  onConfirmReplay: () => _restartCurrentTrackFromBeginning(),
                ),
              ),
              const SizedBox(width: 14),
              _M3TactileScale(
                pressedScale: 0.90,
                onTap: _nextSentence,
                child: Container(
                  width: 58,
                  height: 58,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: p.surface2,
                    border: Border.all(color: p.border),
                  ),
                  alignment: Alignment.center,
                  child: Icon(
                    Icons.skip_next_rounded,
                    size: 28,
                    color: p.textPrimary,
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 12),

          // Row 3: Metrolist Segmented Utility Bar
          // [1. Prev Ep] [2. Next Ep] [3. Sentence Loop (Repeat-1)] [4. Repeat Ep] [5. Speed]
          Row(
            children: [
              Expanded(
                child: _buildMetrolistSegmentedBtn(
                  icon: Icons.fast_rewind_rounded,
                  active: false,
                  borderRadius: const BorderRadius.horizontal(
                    left: Radius.circular(20),
                    right: Radius.circular(6),
                  ),
                  p: p,
                  onTap: () => _switchEpisode(-1, autoPlay: true),
                ),
              ),
              const SizedBox(width: 5),
              Expanded(
                child: _buildMetrolistSegmentedBtn(
                  icon: Icons.fast_forward_rounded,
                  active: false,
                  borderRadius: BorderRadius.circular(6),
                  p: p,
                  onTap: () => _switchEpisode(1, autoPlay: true),
                ),
              ),
              const SizedBox(width: 5),
              Expanded(
                child: _buildMetrolistSegmentedBtn(
                  icon: Icons.repeat_one_rounded,
                  active: _singleSentenceLoop,
                  borderRadius: BorderRadius.circular(
                    _singleSentenceLoop ? 14 : 6,
                  ),
                  p: p,
                  onTap: _toggleSingleLoop,
                ),
              ),
              const SizedBox(width: 5),
              Expanded(
                child: _buildMetrolistSegmentedBtn(
                  icon: Icons.repeat_rounded,
                  active: _repeatCurrentEpisode,
                  borderRadius: BorderRadius.circular(
                    _repeatCurrentEpisode ? 14 : 6,
                  ),
                  p: p,
                  onTap: _toggleRepeatEpisode,
                ),
              ),
              const SizedBox(width: 5),
              Expanded(
                child: _buildMetrolistSegmentedBtn(
                  icon: Icons.speed_rounded,
                  active: isCustomSpeed,
                  badgeText: isCustomSpeed
                      ? _formatSpeedMultiplier(_currentSpeed)
                      : null,
                  borderRadius: BorderRadius.horizontal(
                    left: Radius.circular(isCustomSpeed ? 14 : 6),
                    right: const Radius.circular(20),
                  ),
                  p: p,
                  onTap: () => _showSpeedPickerModal(p),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMetrolistSegmentedBtn({
    required IconData icon,
    required bool active,
    String? badgeText,
    required BorderRadius borderRadius,
    required AppPalette p,
    required VoidCallback onTap,
  }) {
    final Color fgColor = active ? p.accent : p.textPassed;
    return _M3TactileScale(
      pressedScale: 0.91,
      onTap: onTap,
      child: AnimatedContainer(
        duration: _M3Motion.durFast,
        curve: _M3Motion.easeSmoothOut,
        height: 38,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: active ? p.accentSoft : p.metroBtnBg,
          borderRadius: borderRadius,
          border: Border.all(
            color: active ? p.accent : p.metroOutline,
            width: 1.0,
          ),
        ),
        child: AnimatedSwitcher(
          duration: _M3Motion.durFast,
          switchInCurve: _M3Motion.easeBounce,
          switchOutCurve: Curves.easeIn,
          transitionBuilder: (child, anim) => ScaleTransition(
            scale: Tween<double>(begin: 0.85, end: 1.0).animate(anim),
            child: FadeTransition(opacity: anim, child: child),
          ),
          child: badgeText == null
              ? Icon(
                  icon,
                  key: ValueKey('seg_icon_${icon.codePoint}_$active'),
                  size: 20,
                  color: fgColor,
                )
              : Row(
                  key: ValueKey('seg_badge_$badgeText'),
                  mainAxisAlignment: MainAxisAlignment.center,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(icon, size: 16, color: fgColor),
                    const SizedBox(width: 3),
                    Flexible(
                      child: Text(
                        badgeText,
                        maxLines: 1,
                        overflow: TextOverflow.clip,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: fgColor,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  void _showSpeedPickerModal(AppPalette p) {
    showModalBottomSheet(
      context: context,
      backgroundColor: p.surface1,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 36,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 14),
                  decoration: BoxDecoration(
                    color: p.border,
                    borderRadius: BorderRadius.circular(9999),
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Playback Speed',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: p.textPrimary,
                      ),
                    ),
                    _M3TactileScale(
                      pressedScale: 0.92,
                      onTap: () => Navigator.pop(sheetContext),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: p.surface2,
                          borderRadius: BorderRadius.circular(9999),
                        ),
                        child: Text(
                          'Close',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: p.textPrimary,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                ..._speedOptions.map((opt) {
                  final isSelected = (opt.$1 - _currentSpeed).abs() < 0.01;
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: _M3TactileScale(
                      pressedScale: 0.97,
                      onTap: () {
                        _setPlaybackSpeed(opt.$1);
                        Navigator.pop(sheetContext);
                      },
                      child: AnimatedContainer(
                        duration: _M3Motion.durFast,
                        curve: _M3Motion.easeSmoothOut,
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 13),
                        decoration: BoxDecoration(
                          color: isSelected ? p.accentSoft : Colors.transparent,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              opt.$2,
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                                color: isSelected ? p.accent : p.textPrimary,
                              ),
                            ),
                            if (isSelected)
                              Icon(Icons.check_rounded,
                                  size: 20, color: p.accent),
                          ],
                        ),
                      ),
                    ),
                  );
                }),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _ThemeRevealPainter extends CustomPainter {
  final ui.Image image;
  final Offset center;
  final double progress;
  final double maxRadius;
  final bool isForward;

  _ThemeRevealPainter({
    required this.image,
    required this.center,
    required this.progress,
    required this.maxRadius,
    required this.isForward,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final double radius = (progress * maxRadius).clamp(0.0, maxRadius);
    final Rect rect = Offset.zero & size;
    canvas.save();

    final Path path = Path();
    if (isForward) {
      // Forward switch: image is the snapshot of the OLD theme.
      // The live NEW theme (rendered underneath) expands outward through a circular hole.
      path.addRect(rect);
      path.addOval(Rect.fromCircle(center: center, radius: radius));
      path.fillType = PathFillType.evenOdd;
      canvas.clipPath(path);
    } else {
      // Reverse switch: image is the snapshot of the PREVIOUS theme.
      // The previous theme retracts back along original path into the switch center.
      path.addOval(Rect.fromCircle(center: center, radius: radius));
      canvas.clipPath(path);
    }

    final Rect src = Rect.fromLTWH(
      0,
      0,
      image.width.toDouble(),
      image.height.toDouble(),
    );
    canvas.drawImageRect(
      image,
      src,
      rect,
      Paint()
        ..filterQuality = FilterQuality.low
        ..isAntiAlias = true,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _ThemeRevealPainter oldDelegate) {
    return oldDelegate.progress != progress ||
        oldDelegate.image != image ||
        oldDelegate.center != center ||
        oldDelegate.maxRadius != maxRadius ||
        oldDelegate.isForward != isForward;
  }
}


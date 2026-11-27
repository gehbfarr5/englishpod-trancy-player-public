import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../services/sync/sync_platform.dart';

/// Harmonized Replay icon matching the optical weight and bounds of Play/Pause.
class EpReplayIcon extends StatelessWidget {
  final Color color;
  final double size;

  const EpReplayIcon({
    super.key,
    required this.color,
    this.size = 30.0,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _EpReplayPainter(color: color),
      ),
    );
  }
}

class _EpReplayPainter extends CustomPainter {
  final Color color;

  const _EpReplayPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24.0;
    canvas.save();
    canvas.scale(s, s);

    // SVG: <path d="M12.1 6.35A6.15 6.15 0 1 1 5.98 13.3" stroke-width="2.55" stroke-linecap="round"/>
    // Center = (12.1, 12.5), radius = 6.15, start = -pi/2 (12.1, 6.35),
    // clockwise through bottom to (5.98, 13.3) => sweep ~ 4.5823 rad.
    final arcRect = Rect.fromCircle(
      center: const Offset(12.1, 12.5),
      radius: 6.15,
    );
    final arcPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.55
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(arcRect, -math.pi / 2, 4.5823, false, arcPaint);

    // Arrowhead: M12.35 3.35 L8.2 6.35 L12.35 9.35 Z with strokeWidth 0.9, round join.
    final arrowPath = Path()
      ..moveTo(12.35, 3.35)
      ..lineTo(8.2, 6.35)
      ..lineTo(12.35, 9.35)
      ..close();
    canvas.drawPath(
      arrowPath,
      Paint()
        ..color = color
        ..style = PaintingStyle.fill,
    );
    canvas.drawPath(
      arrowPath,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 0.9
        ..strokeJoin = StrokeJoin.round,
    );

    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _EpReplayPainter oldDelegate) =>
      oldDelegate.color != color;
}

/// Platform-aware hero Loading indicator: uses OpenHarmony's official
/// LoadingProgress port on HarmonyOS and the harmonized spinner elsewhere.
class EpHeroLoadingIcon extends StatelessWidget {
  final Color color;
  final double size;
  final bool? useHarmonyOverride;

  const EpHeroLoadingIcon({
    super.key,
    required this.color,
    this.size = 30.0,
    this.useHarmonyOverride,
  });

  @override
  Widget build(BuildContext context) {
    final useHarmony = useHarmonyOverride ?? isHarmonyHost;
    if (useHarmony) {
      return EpHarmonyLoadingIcon(color: color, size: size);
    }
    return EpGeneralLoadingIcon(color: color, size: size);
  }
}

/// General harmonized spinner (20px optical diameter, 3.0px rounded stroke,
/// 22% subtle circular track, 1050ms organic breathing rotation).
class EpGeneralLoadingIcon extends StatefulWidget {
  final Color color;
  final double size;

  const EpGeneralLoadingIcon({
    super.key,
    required this.color,
    this.size = 30.0,
  });

  @override
  State<EpGeneralLoadingIcon> createState() => _EpGeneralLoadingIconState();
}

class _EpGeneralLoadingIconState extends State<EpGeneralLoadingIcon>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1050),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final disabled = MediaQuery.disableAnimationsOf(context);
    if (disabled) {
      _ctrl.stop();
      _ctrl.value = 0.35;
    } else if (!_initialized || !_ctrl.isAnimating) {
      _ctrl.repeat();
    }
    _initialized = true;
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: AnimatedBuilder(
        animation: _ctrl,
        builder: (context, _) {
          return CustomPaint(
            painter: _EpGeneralSpinnerPainter(
              color: widget.color,
              progress: _ctrl.value,
            ),
          );
        },
      ),
    );
  }
}

class _EpGeneralSpinnerPainter extends CustomPainter {
  final Color color;
  final double progress;

  static const double _tuneDiam = 20.0;
  static const double _tuneStroke = 3.0;
  static const double _tuneTrackAlpha = 0.22;
  static const int _segments = 28;

  const _EpGeneralSpinnerPainter({
    required this.color,
    required this.progress,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / 30.0;
    final cx = size.width / 2.0;
    final cy = size.height / 2.0;
    final sw = _tuneStroke * scale;
    final r = ((_tuneDiam - _tuneStroke) / 2.0) * scale;
    final rect = Rect.fromCircle(center: Offset(cx, cy), radius: r);

    canvas.drawCircle(
      Offset(cx, cy),
      r,
      Paint()
        ..color = color.withValues(alpha: _tuneTrackAlpha)
        ..style = PaintingStyle.stroke
        ..strokeWidth = sw,
    );

    final baseAngle = progress * math.pi * 2.0 - math.pi / 2.0;
    final breath = 0.5 - 0.5 * math.cos(progress * math.pi * 2.0);
    final sweepRad = (115.0 + 125.0 * breath) * math.pi / 180.0;

    for (var i = 0; i < _segments; i++) {
      final f0 = i / _segments;
      final f1 = (i + 1) / _segments;
      final a0 = baseAngle + sweepRad * f0;
      final stepSweep = sweepRad * (f1 - f0) + 0.03;
      final alpha = (0.25 + 0.75 * math.pow(f1, 1.35)).toDouble().clamp(0.0, 1.0);
      final isCap = i == 0 || i == _segments - 1;

      canvas.drawArc(
        rect,
        a0,
        stepSweep,
        false,
        Paint()
          ..color = color.withValues(alpha: alpha)
          ..style = PaintingStyle.stroke
          ..strokeWidth = sw
          ..strokeCap = isCap ? StrokeCap.round : StrokeCap.butt,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _EpGeneralSpinnerPainter oldDelegate) =>
      oldDelegate.progress != progress || oldDelegate.color != color;
}

/// Official OpenHarmony `LoadingProgress` port (Apache-2.0, `arkui_ace_engine`:
/// `loading_progress_modifier.cpp` & `loading_progress_utill.h`) with
/// user-approved `hmosDiam = 28.0`, `hmosStrokeMul = 2.0`, `hmosCometMul = 1.05`.
class EpHarmonyLoadingIcon extends StatefulWidget {
  final Color color;
  final double size;

  const EpHarmonyLoadingIcon({
    super.key,
    required this.color,
    this.size = 30.0,
  });

  @override
  State<EpHarmonyLoadingIcon> createState() => _EpHarmonyLoadingIconState();
}

class _EpHarmonyLoadingIconState extends State<EpHarmonyLoadingIcon>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final disabled = MediaQuery.disableAnimationsOf(context);
    if (disabled) {
      _ctrl.stop();
      _ctrl.value = 0.65;
    } else if (!_initialized || !_ctrl.isAnimating) {
      _ctrl.repeat();
    }
    _initialized = true;
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: AnimatedBuilder(
        animation: _ctrl,
        builder: (context, _) {
          return CustomPaint(
            painter: _EpHarmonyLoadingPainter(
              color: widget.color,
              t: _ctrl.value,
            ),
          );
        },
      ),
    );
  }
}

class _EpHarmonyLoadingPainter extends CustomPainter {
  final Color color;
  final double t;

  static const double _hmosDiam = 28.0;
  static const double _hmosStrokeMul = 2.0;
  static const double _hmosCometMul = 1.05;

  static const List<double> _diamTable = [16, 24, 32, 40, 48, 76];
  static const List<double> _ringStrokeTable = [1.12, 1.5, 1.76, 1.9, 2.16, 2.28];
  static const List<double> _cometRadiusTable = [1.2, 1.8, 2.4, 3.0, 3.36, 4.18];

  static const List<List<double>> _opacityKf = [
    [0.00, 0.70],
    [0.25, 0.20],
    [0.65, 1.00],
    [0.75, 1.00],
    [0.85, 1.00],
    [1.00, 0.70],
  ];
  static const List<List<double>> _scaleKf = [
    [0.00, 0.825],
    [0.25, 0.65],
    [0.65, 0.93],
    [0.75, 1.00],
    [0.85, 0.93],
    [1.00, 0.825],
  ];

  // Exact Sk3DView(Y=30, X=-116, Z=22) + OpenHarmony AdjustMatrix (swap SKEW_Y & SCALE_Y)
  static const double _matScaleX = 0.97131;
  static const double _matSkewX = -0.09225;
  static const double _matSkewY = -0.40645;
  static const double _matScaleY = 0.16422;
  static const double _matPersp0 = 0.000299;
  static const double _matPersp1 = 0.001578;

  const _EpHarmonyLoadingPainter({
    required this.color,
    required this.t,
  });

  static double _lerpTable(double d, List<double> table) {
    if (d <= _diamTable[0]) return (d / _diamTable[0]) * table[0];
    if (d >= _diamTable[5]) return (d / _diamTable[5]) * table[5];
    for (var i = 1; i < _diamTable.length; i++) {
      if (d <= _diamTable[i]) {
        final u = (d - _diamTable[i - 1]) / (_diamTable[i] - _diamTable[i - 1]);
        return table[i - 1] + (table[i] - table[i - 1]) * u;
      }
    }
    return table[3];
  }

  static double _cubicBezierY(
    double x,
    double x1,
    double y1,
    double x2,
    double y2,
  ) {
    if (x <= 0.0) return 0.0;
    if (x >= 1.0) return 1.0;
    var lo = 0.0;
    var hi = 1.0;
    var u = x;
    for (var i = 0; i < 14; i++) {
      u = 0.5 * (lo + hi);
      final inv = 1.0 - u;
      final bx = 3.0 * inv * inv * u * x1 +
          3.0 * inv * u * u * x2 +
          u * u * u;
      if (bx < x) {
        lo = u;
      } else {
        hi = u;
      }
    }
    final inv = 1.0 - u;
    return 3.0 * inv * inv * u * y1 +
        3.0 * inv * u * u * y2 +
        u * u * u;
  }

  static double _centerDeviation(double t) {
    if (t < 0.25) {
      final u = _cubicBezierY(t / 0.25, 0.0, 0.0, 0.67, 1.0);
      return -0.06 * u;
    } else if (t < 0.75) {
      final u = _cubicBezierY((t - 0.25) / 0.50, 0.33, 0.0, 0.67, 1.0);
      return -0.06 + 0.12 * u;
    } else {
      final u = _cubicBezierY((t - 0.75) / 0.25, 0.33, 0.0, 1.0, 1.0);
      return 0.06 * (1.0 - u);
    }
  }

  static double _keyframedValue(double t, List<List<double>> points) {
    for (var i = 1; i < points.length; i++) {
      if (t <= points[i][0]) {
        final span = points[i][0] - points[i - 1][0];
        final u = span > 0 ? (t - points[i - 1][0]) / span : 0.0;
        return points[i - 1][1] + (points[i][1] - points[i - 1][1]) * u;
      }
    }
    return points.last[1];
  }

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / 30.0;
    final cx = size.width / 2.0;
    final cy = size.height / 2.0;
    final cl = t.clamp(0.0, 1.0);

    final date = 100.0 * _cubicBezierY(cl, 0.25, 0.30, 0.50, 0.14);
    final angle = 360.0 * date / 100.0;

    final ringRadius = (10.5 * _hmosDiam / 40.0) * scale;
    final orbitRadius = (17.0 * _hmosDiam / 40.0) * scale;
    final ringStrokeWidth =
        _lerpTable(_hmosDiam, _ringStrokeTable) * _hmosStrokeMul * scale;
    final cometRadius =
        _lerpTable(_hmosDiam, _cometRadiusTable) * _hmosCometMul * scale;
    final cometOpacityScale = _keyframedValue(cl, _opacityKf);
    final cometSizeScale = _keyframedValue(cl, _scaleKf);

    final deviation = _centerDeviation(cl);
    final movement = (ringRadius * 2.0 + ringStrokeWidth) * deviation;

    void drawRing() {
      canvas.drawCircle(
        Offset(cx, cy + movement),
        ringRadius,
        Paint()
          ..color = color.withValues(alpha: 200.0 / 255.0)
          ..style = PaintingStyle.stroke
          ..strokeWidth = ringStrokeWidth,
      );
    }

    void drawOrbit() {
      const pointCount = 20;
      const tailAngle = 3.0;
      const tailAlphaRatio = 0.82;
      final safeScale = scale == 0.0 ? 1.0 : scale;

      for (var i = 0; i < pointCount; i++) {
        final idx = pointCount - i; // 20 .. 1 (tail -> head)
        final cometAngle = angle - (idx - 1) * tailAngle;
        final rad = cometAngle * math.pi / 180.0;
        final px = math.cos(rad) * orbitRadius;
        final py = -math.sin(rad) * orbitRadius;

        final w = (_matPersp0 * px) / safeScale +
            (_matPersp1 * py) / safeScale +
            1.0;
        final mx = (_matScaleX * px + _matSkewX * py) / w;
        final my = (_matSkewY * px + _matScaleY * py) / w;

        final alpha = cometOpacityScale *
            math.pow(tailAlphaRatio, idx - 1).toDouble();
        if (alpha <= 0.01) continue;

        canvas.drawCircle(
          Offset(cx + mx, cy + my),
          cometRadius * cometSizeScale,
          Paint()..color = color.withValues(alpha: alpha.clamp(0.0, 1.0)),
        );
      }
    }

    if (date > 50.0) {
      drawRing();
      drawOrbit();
    } else {
      drawOrbit();
      drawRing();
    }
  }

  @override
  bool shouldRepaint(covariant _EpHarmonyLoadingPainter oldDelegate) =>
      oldDelegate.t != t || oldDelegate.color != color;
}

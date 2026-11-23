import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' show ImageFilter, lerpDouble;

import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';
import 'package:flutter/services.dart';

import '../../services/sync/sync_models.dart';
import 'sync_theme.dart';

/// Interactive 3D folder progress visual inspired by RareUI's FolderComponent
/// (https://www.rareui.com/components/foldercomponent), themed with AppPalette tokens.
class SyncFolderHero extends StatefulWidget {
  final SyncPaletteTokens tokens;
  final int completedCount;
  final int totalCount;
  final int deviceCount;
  final SyncStatus syncStatus;
  final List<String> devicePlatforms;
  final bool initiallyOpen;
  final double scale;

  const SyncFolderHero({
    super.key,
    required this.tokens,
    required this.completedCount,
    required this.totalCount,
    required this.deviceCount,
    required this.syncStatus,
    this.devicePlatforms = const [],
    this.initiallyOpen = true,
    this.scale = 0.56,
  });

  @override
  State<SyncFolderHero> createState() => _SyncFolderHeroState();
}

class _SyncFolderHeroState extends State<SyncFolderHero>
    with TickerProviderStateMixin {
  static const double _baseWidth = 321.0;
  static const double _baseHeight = 270.0;
  static const double _flapHeight = 241.0;
  static const double _headroom = 156.0;

  static const _cardSpring =
      SpringDescription(mass: 1.0, stiffness: 120.0, damping: 13.0);
  static const _flapSpring =
      SpringDescription(mass: 1.0, stiffness: 120.0, damping: 14.0);

  late final AnimationController _cardLeftCtrl;
  late final AnimationController _cardCenterCtrl;
  late final AnimationController _cardRightCtrl;
  late final AnimationController _flapCtrl;

  Timer? _delayLeft;
  Timer? _delayCenter;
  Timer? _delayRight;

  bool _isOpen = false;
  bool _isHovered = false;

  @override
  void initState() {
    super.initState();
    _cardLeftCtrl = AnimationController.unbounded(vsync: this, value: 0.0);
    _cardCenterCtrl = AnimationController.unbounded(vsync: this, value: 0.0);
    _cardRightCtrl = AnimationController.unbounded(vsync: this, value: 0.0);
    _flapCtrl = AnimationController.unbounded(vsync: this, value: 0.0);

    if (widget.initiallyOpen) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _setTargetState(open: true, hovered: false);
      });
    }
  }

  @override
  void dispose() {
    _delayLeft?.cancel();
    _delayCenter?.cancel();
    _delayRight?.cancel();
    _cardLeftCtrl.dispose();
    _cardCenterCtrl.dispose();
    _cardRightCtrl.dispose();
    _flapCtrl.dispose();
    super.dispose();
  }

  double get _targetProgress => _isOpen ? 1.0 : (_isHovered ? 0.35 : 0.0);

  void _setTargetState({required bool open, required bool hovered}) {
    _isOpen = open;
    _isHovered = hovered;
    final target = _targetProgress;
    final reducedMotion =
        mounted ? MediaQuery.disableAnimationsOf(context) : false;

    _delayLeft?.cancel();
    _delayCenter?.cancel();
    _delayRight?.cancel();

    if (reducedMotion) {
      for (final ctrl in [
        _cardLeftCtrl,
        _cardCenterCtrl,
        _cardRightCtrl,
        _flapCtrl,
      ]) {
        ctrl.animateTo(
          target,
          duration: const Duration(milliseconds: 160),
          curve: Curves.easeOut,
        );
      }
      return;
    }

    _animateSpring(_flapCtrl, _flapSpring, target);
    _animateSpring(_cardLeftCtrl, _cardSpring, target);

    final centerDelayMs = open ? 50 : (hovered ? 60 : 0);
    final rightDelayMs = open ? 100 : (hovered ? 120 : 0);

    if (centerDelayMs == 0) {
      _animateSpring(_cardCenterCtrl, _cardSpring, target);
    } else {
      _delayCenter = Timer(Duration(milliseconds: centerDelayMs), () {
        if (mounted) _animateSpring(_cardCenterCtrl, _cardSpring, target);
      });
    }

    if (rightDelayMs == 0) {
      _animateSpring(_cardRightCtrl, _cardSpring, target);
    } else {
      _delayRight = Timer(Duration(milliseconds: rightDelayMs), () {
        if (mounted) _animateSpring(_cardRightCtrl, _cardSpring, target);
      });
    }
  }

  void _animateSpring(
    AnimationController ctrl,
    SpringDescription spring,
    double target,
  ) {
    final sim = SpringSimulation(spring, ctrl.value, target, ctrl.velocity);
    ctrl.animateWith(sim);
  }

  void _toggleOpen() {
    HapticFeedback.selectionClick();
    _setTargetState(open: !_isOpen, hovered: _isHovered);
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.tokens;
    final s = widget.scale;
    final reducedMotion = MediaQuery.disableAnimationsOf(context);
    final progressRatio = widget.totalCount > 0
        ? (widget.completedCount / widget.totalCount).clamp(0.0, 1.0)
        : 0.0;

    return Semantics(
      button: true,
      label: _isOpen ? '收起同步进度文件夹动画' : '展开同步进度文件夹动画',
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        onEnter: (_) => _setTargetState(open: _isOpen, hovered: true),
        onExit: (_) => _setTargetState(open: _isOpen, hovered: false),
        child: GestureDetector(
          key: const ValueKey('sync_folder_hero_tap'),
          behavior: HitTestBehavior.opaque,
          onTap: _toggleOpen,
          child: SizedBox(
            width: (_baseWidth + 90) * s,
            height: (_baseHeight + _headroom) * s,
            child: Align(
              alignment: Alignment.bottomCenter,
              child: SizedBox(
                width: _baseWidth * s,
                height: _baseHeight * s,
                child: Stack(
                  clipBehavior: Clip.none,
                  alignment: Alignment.center,
                  children: [
                    // 1. Back plate
                    Container(
                      width: _baseWidth * s,
                      height: _baseHeight * s,
                      decoration: BoxDecoration(
                        color: t.folderBackFill,
                        borderRadius: BorderRadius.circular(25 * s),
                        border: Border.all(color: t.cardBorder, width: 1),
                        boxShadow: [
                          BoxShadow(
                            color: t.folderBackInnerGlow,
                            blurRadius: 6 * s,
                            spreadRadius: 1 * s,
                          ),
                        ],
                      ),
                    ),

                    // 2. Right card (Devices summary)
                    _AnimatedFolderCard(
                      controller: _cardRightCtrl,
                      scale: s,
                      reducedMotion: reducedMotion,
                      idleX: 40,
                      idleY: -10,
                      idleDeg: 10,
                      peekX: 40,
                      peekY: -30,
                      peekDeg: 14,
                      openX: 70,
                      openY: -160,
                      openDeg: 18,
                      child: _buildRightDeviceCard(t, s),
                    ),

                    // 3. Center card (Sync focus)
                    _AnimatedFolderCard(
                      controller: _cardCenterCtrl,
                      scale: s,
                      reducedMotion: reducedMotion,
                      idleX: 3,
                      idleY: -20,
                      idleDeg: 2,
                      peekX: 3,
                      peekY: -35,
                      peekDeg: -1,
                      openX: 0,
                      openY: -180,
                      openDeg: -3,
                      child: _buildCenterStatusCard(t, s),
                    ),

                    // 4. Left card (Lesson completion)
                    _AnimatedFolderCard(
                      controller: _cardLeftCtrl,
                      scale: s,
                      reducedMotion: reducedMotion,
                      idleX: -40,
                      idleY: -22,
                      idleDeg: -5,
                      peekX: -40,
                      peekY: -44,
                      peekDeg: -9,
                      openX: -65,
                      openY: -170,
                      openDeg: -14,
                      child: _buildLeftProgressCard(t, s, progressRatio),
                    ),

                    // 5. Frosted 3D Front Flap
                    Positioned(
                      bottom: 0,
                      child: AnimatedBuilder(
                        animation: _flapCtrl,
                        builder: (context, child) {
                          final v = _flapCtrl.value;
                          final deg = reducedMotion
                              ? lerpDouble(-10, -28, v.clamp(0.0, 1.0))!
                              : _evalThreeStop(v, -15, -45, -55);
                          final matrix = Matrix4.identity();
                          if (!reducedMotion) {
                            matrix.setEntry(3, 2, 1.0 / (800.0 * s));
                            matrix.rotateX(deg * math.pi / 180.0);
                          }
                          return Transform(
                            alignment: Alignment.bottomCenter,
                            transform: matrix,
                            child: child,
                          );
                        },
                        child: _FrostedFlap(
                          width: _baseWidth * s,
                          height: _flapHeight * s,
                          tokens: t,
                          syncStatus: widget.syncStatus,
                          scale: s,
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
    );
  }

  Widget _buildLeftProgressCard(
    SyncPaletteTokens t,
    double s,
    double ratio,
  ) {
    return _CardShell(
      tokens: t,
      scale: s,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'DONE',
            style: TextStyle(
              fontSize: 10 * s * 1.4,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.1,
              color: t.textSecondary,
            ),
          ),
          SizedBox(height: 6 * s),
          Text(
            '${widget.completedCount}',
            style: TextStyle(
              fontSize: 28 * s * 1.25,
              fontWeight: FontWeight.w800,
              height: 1.0,
              color: t.accent,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          Text(
            '/ ${widget.totalCount}',
            style: TextStyle(
              fontSize: 12 * s * 1.25,
              fontWeight: FontWeight.w600,
              color: t.textSecondary,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const Spacer(),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: ratio,
              minHeight: 7 * s,
              backgroundColor: t.cardSkeletonLine,
              valueColor: AlwaysStoppedAnimation<Color>(t.accent),
            ),
          ),
          SizedBox(height: 8 * s),
          Container(
            height: 6 * s,
            width: 72 * s,
            decoration: BoxDecoration(
              color: t.cardSkeletonLine,
              borderRadius: BorderRadius.circular(999),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCenterStatusCard(SyncPaletteTokens t, double s) {
    final (IconData icon, String label, Color color) = switch (widget.syncStatus) {
      SyncStatus.synced => (Icons.cloud_done_rounded, '多端已同步', t.accent),
      SyncStatus.syncing => (Icons.sync_rounded, '正在同步', t.accent),
      SyncStatus.pendingOffline => (
          Icons.cloud_upload_outlined,
          '待上传变更',
          t.textPrimary,
        ),
      SyncStatus.revoked => (Icons.link_off_rounded, '已断开连接', t.warning),
      SyncStatus.error => (Icons.error_outline_rounded, '同步待重试', t.warning),
      SyncStatus.unlinked => (Icons.qr_code_2_rounded, '跨端进度同步', t.accent),
    };

    return _CardShell(
      tokens: t,
      scale: s,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34 * s * 1.15,
            height: 34 * s * 1.15,
            decoration: BoxDecoration(
              color: t.accentSoft,
              borderRadius: BorderRadius.circular(10 * s),
            ),
            child: Icon(icon, size: 20 * s * 1.15, color: color),
          ),
          SizedBox(height: 12 * s),
          Text(
            label,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 13 * s * 1.25,
              fontWeight: FontWeight.w800,
              color: t.textPrimary,
            ),
          ),
          SizedBox(height: 6 * s),
          Container(
            height: 6 * s,
            width: 112 * s,
            decoration: BoxDecoration(
              color: t.cardSkeletonLine,
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          SizedBox(height: 6 * s),
          Container(
            height: 6 * s,
            width: 78 * s,
            decoration: BoxDecoration(
              color: t.cardSkeletonLine,
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          const Spacer(),
          Text(
            'PB · DG · Anchor',
            style: TextStyle(
              fontSize: 9.5 * s * 1.2,
              fontWeight: FontWeight.w600,
              color: t.textSecondary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRightDeviceCard(SyncPaletteTokens t, double s) {
    final linked = widget.syncStatus != SyncStatus.unlinked &&
        widget.syncStatus != SyncStatus.revoked;
    final countText = linked ? '${math.max(1, widget.deviceCount)}' : '1';
    final subLabel = linked ? '台已连接设备' : '当前单机设备';
    final tags = widget.devicePlatforms.isNotEmpty
        ? widget.devicePlatforms.take(3).join(' · ')
        : 'iOS · Web · 微信';

    return _CardShell(
      tokens: t,
      scale: s,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'DEVICES',
            style: TextStyle(
              fontSize: 10 * s * 1.4,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.1,
              color: t.textSecondary,
            ),
          ),
          SizedBox(height: 6 * s),
          Text(
            countText,
            style: TextStyle(
              fontSize: 28 * s * 1.25,
              fontWeight: FontWeight.w800,
              height: 1.0,
              color: t.textPrimary,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          SizedBox(height: 4 * s),
          Text(
            subLabel,
            style: TextStyle(
              fontSize: 11 * s * 1.2,
              fontWeight: FontWeight.w600,
              color: t.textSecondary,
            ),
          ),
          const Spacer(),
          Text(
            tags,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 10 * s * 1.2,
              fontWeight: FontWeight.w700,
              color: t.accent,
            ),
          ),
        ],
      ),
    );
  }
}

double _evalThreeStop(double v, double idle, double peek, double open) {
  if (v <= 0.35) {
    return lerpDouble(idle, peek, v / 0.35)!;
  }
  return lerpDouble(peek, open, (v - 0.35) / 0.65)!;
}

class _AnimatedFolderCard extends StatelessWidget {
  final AnimationController controller;
  final double scale;
  final bool reducedMotion;
  final double idleX, idleY, idleDeg;
  final double peekX, peekY, peekDeg;
  final double openX, openY, openDeg;
  final Widget child;

  const _AnimatedFolderCard({
    required this.controller,
    required this.scale,
    required this.reducedMotion,
    required this.idleX,
    required this.idleY,
    required this.idleDeg,
    required this.peekX,
    required this.peekY,
    required this.peekDeg,
    required this.openX,
    required this.openY,
    required this.openDeg,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, inner) {
        final v = controller.value;
        final x = _evalThreeStop(v, idleX, peekX, openX) * scale;
        final y = _evalThreeStop(v, idleY, peekY, openY) * scale;
        final deg = reducedMotion ? 0.0 : _evalThreeStop(v, idleDeg, peekDeg, openDeg);
        return Transform.translate(
          offset: Offset(x, y),
          child: Transform.rotate(
            angle: deg * math.pi / 180.0,
            child: inner,
          ),
        );
      },
      child: child,
    );
  }
}

class _CardShell extends StatelessWidget {
  final SyncPaletteTokens tokens;
  final double scale;
  final Widget child;

  const _CardShell({
    required this.tokens,
    required this.scale,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 164 * scale,
      height: 214 * scale,
      padding: EdgeInsets.all(15 * scale),
      decoration: BoxDecoration(
        color: tokens.cardFill,
        borderRadius: BorderRadius.circular(20 * scale),
        border: Border.all(color: tokens.cardBorder, width: 1),
        boxShadow: [
          BoxShadow(
            color: tokens.isDark
                ? const Color(0x45000000)
                : const Color(0x16141413),
            blurRadius: 12 * scale,
            offset: Offset(0, 4 * scale),
          ),
        ],
      ),
      child: child,
    );
  }
}

class _FrostedFlap extends StatelessWidget {
  final double width;
  final double height;
  final SyncPaletteTokens tokens;
  final SyncStatus syncStatus;
  final double scale;

  const _FrostedFlap({
    required this.width,
    required this.height,
    required this.tokens,
    required this.syncStatus,
    required this.scale,
  });

  @override
  Widget build(BuildContext context) {
    final (String badgeText, Color badgeColor) = switch (syncStatus) {
      SyncStatus.synced => ('已同步', tokens.accent),
      SyncStatus.syncing => ('同步中', tokens.accent),
      SyncStatus.pendingOffline => ('待同步', tokens.textSecondary),
      SyncStatus.revoked => ('已断开', tokens.warning),
      SyncStatus.error => ('待重试', tokens.warning),
      SyncStatus.unlinked => ('未开启', tokens.textSecondary),
    };

    return SizedBox(
      width: width,
      height: height,
      child: ClipPath(
        clipper: _RareUiFlapClipper(),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 6, sigmaY: 6),
          child: CustomPaint(
            painter: _RareUiFlapPainter(
              fillColor: tokens.flapFill,
              strokeColor: tokens.flapStroke,
            ),
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                20 * scale,
                56 * scale,
                20 * scale,
                18 * scale,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '进度同步',
                        style: TextStyle(
                          fontSize: 15 * scale * 1.35,
                          fontWeight: FontWeight.w800,
                          color: tokens.textPrimary,
                        ),
                      ),
                      Container(
                        padding: EdgeInsets.symmetric(
                          horizontal: 10 * scale,
                          vertical: 4 * scale,
                        ),
                        decoration: BoxDecoration(
                          color: tokens.surfaceInset,
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(color: tokens.border),
                        ),
                        child: Text(
                          badgeText,
                          style: TextStyle(
                            fontSize: 10.5 * scale * 1.25,
                            fontWeight: FontWeight.w700,
                            color: badgeColor,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

Path _buildFlapPath(Size size) {
  final sx = size.width / 321.0;
  final sy = size.height / 241.0;
  final p = Path()
    ..moveTo(0 * sx, 25 * sy)
    ..cubicTo(0 * sx, 11.1929 * sy, 11.1929 * sx, 0 * sy, 25 * sx, 0 * sy)
    ..lineTo(136.084 * sx, 0 * sy)
    ..cubicTo(
      143.044 * sx,
      0 * sy,
      149.689 * sx,
      2.90139 * sy,
      154.42 * sx,
      8.00608 * sy,
    )
    ..lineTo(178.08 * sx, 33.5343 * sy)
    ..cubicTo(
      182.811 * sx,
      38.639 * sy,
      189.456 * sx,
      41.5404 * sy,
      196.416 * sx,
      41.5404 * sy,
    )
    ..lineTo(296 * sx, 41.5404 * sy)
    ..cubicTo(
      309.807 * sx,
      41.5404 * sy,
      321 * sx,
      52.7333 * sy,
      321 * sx,
      66.5404 * sy,
    )
    ..lineTo(321 * sx, 216 * sy)
    ..cubicTo(
      321 * sx,
      229.807 * sy,
      309.807 * sx,
      241 * sy,
      296 * sx,
      241 * sy,
    )
    ..lineTo(25 * sx, 241 * sy)
    ..cubicTo(
      11.1929 * sx,
      241 * sy,
      0 * sx,
      229.807 * sy,
      0 * sx,
      216 * sy,
    )
    ..close();
  return p;
}

class _RareUiFlapClipper extends CustomClipper<Path> {
  @override
  Path getClip(Size size) => _buildFlapPath(size);

  @override
  bool shouldReclip(covariant CustomClipper<Path> oldClipper) => false;
}

class _RareUiFlapPainter extends CustomPainter {
  final Color fillColor;
  final Color strokeColor;

  const _RareUiFlapPainter({
    required this.fillColor,
    required this.strokeColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final path = _buildFlapPath(size);
    canvas.drawPath(
      path,
      Paint()
        ..color = fillColor
        ..style = PaintingStyle.fill,
    );
    canvas.drawPath(
      path,
      Paint()
        ..color = strokeColor
        ..strokeWidth = 1.0
        ..style = PaintingStyle.stroke,
    );
  }

  @override
  bool shouldRepaint(covariant _RareUiFlapPainter oldDelegate) =>
      oldDelegate.fillColor != fillColor ||
      oldDelegate.strokeColor != strokeColor;
}

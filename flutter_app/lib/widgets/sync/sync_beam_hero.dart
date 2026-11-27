import 'dart:math' as math;
import 'dart:ui' show PathMetric;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../services/sync/sync_models.dart';
import 'sync_theme.dart';

/// Animated dual-device beam visual for the progress sync modal,
/// inspired by Magic UI's Animated Beam pattern and themed with AppPalette tokens.
class SyncBeamHero extends StatefulWidget {
  final SyncPaletteTokens tokens;
  final int completedCount;
  final int totalCount;
  final int deviceCount;
  final SyncStatus syncStatus;
  final String localPlatform;
  final String localDeviceName;
  final String? peerPlatform;
  final String? peerLabel;
  final VoidCallback? onTap;

  const SyncBeamHero({
    super.key,
    required this.tokens,
    required this.completedCount,
    required this.totalCount,
    required this.deviceCount,
    required this.syncStatus,
    this.localPlatform = 'web',
    this.localDeviceName = '本机设备',
    this.peerPlatform,
    this.peerLabel,
    this.onTap,
  });

  @override
  State<SyncBeamHero> createState() => _SyncBeamHeroState();
}

class _SyncBeamHeroState extends State<SyncBeamHero>
    with TickerProviderStateMixin {
  late final AnimationController _beamCtrl;
  late final AnimationController _checkCtrl;
  bool _initializedAnim = false;

  @override
  void initState() {
    super.initState();
    _beamCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1150),
    );
    _checkCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 360),
      value: widget.syncStatus == SyncStatus.synced ? 1.0 : 0.0,
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_initializedAnim) {
      _initializedAnim = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _applyStatusAnimation(previousStatus: null);
      });
    }
  }

  @override
  void didUpdateWidget(covariant SyncBeamHero oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.syncStatus != widget.syncStatus) {
      _applyStatusAnimation(previousStatus: oldWidget.syncStatus);
    }
  }

  void _applyStatusAnimation({SyncStatus? previousStatus}) {
    final reducedMotion = MediaQuery.disableAnimationsOf(context);
    if (widget.syncStatus == SyncStatus.synced) {
      if (reducedMotion) {
        _checkCtrl.value = 1.0;
      } else {
        _checkCtrl.forward(from: previousStatus == SyncStatus.synced ? 1.0 : 0.0);
      }
    } else {
      _checkCtrl.value = 0.0;
    }

    if (reducedMotion) {
      _beamCtrl.stop();
      _beamCtrl.value = 0.0;
      return;
    }

    if (widget.syncStatus == SyncStatus.syncing) {
      if (!_beamCtrl.isAnimating || _beamCtrl.velocity == 0) {
        _beamCtrl.repeat();
      }
    } else {
      // Finite single sweep on modal open or transition into synced/linked so
      // interactive feedback feels alive without starving settle loops.
      _beamCtrl.forward(from: 0.0);
    }
  }

  void _handleTap() {
    HapticFeedback.selectionClick();
    if (!MediaQuery.disableAnimationsOf(context) &&
        widget.syncStatus != SyncStatus.syncing) {
      _beamCtrl.forward(from: 0.0);
    }
    widget.onTap?.call();
  }

  @override
  void dispose() {
    _beamCtrl.dispose();
    _checkCtrl.dispose();
    super.dispose();
  }

  IconData _platformIcon(String? platform) {
    switch (platform) {
      case 'ios':
        return Icons.phone_iphone_rounded;
      case 'ipad':
        return Icons.tablet_mac_rounded;
      case 'android':
        return Icons.phone_android_rounded;
      case 'wechat':
        return Icons.chat_bubble_rounded;
      case 'harmonyos':
        return Icons.devices_rounded;
      case 'web':
      default:
        return Icons.laptop_mac_rounded;
    }
  }

  String _statusChipText() {
    switch (widget.syncStatus) {
      case SyncStatus.syncing:
        return '正在双向同步学习断点…';
      case SyncStatus.synced:
        return '已完成 ${widget.completedCount} / ${widget.totalCount} 课 · ${math.max(1, widget.deviceCount)} 台设备已对齐';
      case SyncStatus.pendingOffline:
        return '网络离线 · 待同步变更已本地保留';
      case SyncStatus.error:
        return '同步暂未完成 · 稍后自动重试';
      case SyncStatus.revoked:
        return '已断开同步组 · 本地进度完整保留';
      case SyncStatus.unlinked:
        return '扫码或输入 8 位设备码即可联通多端';
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.tokens;
    final hasPeer = widget.peerPlatform != null && widget.peerPlatform!.isNotEmpty;
    final isSyncing = widget.syncStatus == SyncStatus.syncing;
    final isSynced = widget.syncStatus == SyncStatus.synced;
    final isWarn = widget.syncStatus == SyncStatus.pendingOffline ||
        widget.syncStatus == SyncStatus.error ||
        widget.syncStatus == SyncStatus.revoked;

    final peerTitle = hasPeer
        ? (widget.peerLabel ?? '对端设备')
        : (widget.deviceCount > 1 ? '${widget.deviceCount - 1} 台对端' : '待扫码接入');

    return GestureDetector(
      key: const ValueKey('sync_beam_hero_tap'),
      onTap: _handleTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: t.border),
          gradient: RadialGradient(
            center: const Alignment(0, -0.15),
            radius: 0.95,
            colors: [
              isWarn
                  ? t.warning.withValues(alpha: 0.14)
                  : t.accentSoft.withValues(alpha: isSynced || isSyncing ? 0.95 : 0.60),
              t.surfaceInset,
            ],
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              height: 86,
              width: double.infinity,
              child: AnimatedBuilder(
                animation: Listenable.merge([_beamCtrl, _checkCtrl]),
                builder: (context, _) {
                  final pulseActive = _beamCtrl.isAnimating || isSyncing;
                  return Stack(
                    alignment: Alignment.center,
                    children: [
                      Positioned.fill(
                        child: CustomPaint(
                          painter: _SyncBeamPainter(
                            tokens: t,
                            syncStatus: widget.syncStatus,
                            hasPeer: hasPeer,
                            progress: pulseActive ? _beamCtrl.value : 0.0,
                            pulseActive: pulseActive,
                          ),
                        ),
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          _DeviceNode(
                            tokens: t,
                            icon: _platformIcon(widget.localPlatform),
                            label: '本机',
                            active: true,
                            isDashed: false,
                          ),
                          _CenterHub(
                            tokens: t,
                            syncStatus: widget.syncStatus,
                            checkScale: _checkCtrl.value,
                            beamProgress: _beamCtrl.value,
                          ),
                          _DeviceNode(
                            tokens: t,
                            icon: hasPeer
                                ? _platformIcon(widget.peerPlatform)
                                : Icons.qr_code_scanner_rounded,
                            label: peerTitle,
                            active: hasPeer || isSynced || isSyncing,
                            isDashed: !hasPeer,
                          ),
                        ],
                      ),
                    ],
                  );
                },
              ),
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
              decoration: BoxDecoration(
                color: isWarn ? t.warning.withValues(alpha: 0.14) : t.accentSoft,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: isWarn
                      ? t.warning.withValues(alpha: 0.36)
                      : t.accent.withValues(alpha: 0.25),
                ),
              ),
              child: Text(
                _statusChipText(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: isWarn ? t.warning : t.accent,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DeviceNode extends StatelessWidget {
  final SyncPaletteTokens tokens;
  final IconData icon;
  final String label;
  final bool active;
  final bool isDashed;

  const _DeviceNode({
    required this.tokens,
    required this.icon,
    required this.label,
    required this.active,
    required this.isDashed,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 72,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: tokens.cardFill,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: isDashed
                    ? tokens.textMuted.withValues(alpha: 0.45)
                    : (active ? tokens.accent.withValues(alpha: 0.72) : tokens.cardBorder),
                width: active && !isDashed ? 1.4 : 1.0,
              ),
              boxShadow: [
                BoxShadow(
                  color: tokens.isDark
                      ? const Color(0x40000000)
                      : const Color(0x14141413),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Icon(
              icon,
              size: 20,
              color: active ? tokens.textPrimary : tokens.textSecondary,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: active ? tokens.textPrimary : tokens.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class _CenterHub extends StatelessWidget {
  final SyncPaletteTokens tokens;
  final SyncStatus syncStatus;
  final double checkScale;
  final double beamProgress;

  const _CenterHub({
    required this.tokens,
    required this.syncStatus,
    required this.checkScale,
    required this.beamProgress,
  });

  @override
  Widget build(BuildContext context) {
    final isSynced = syncStatus == SyncStatus.synced;
    final isSyncing = syncStatus == SyncStatus.syncing;
    final isWarn = syncStatus == SyncStatus.pendingOffline ||
        syncStatus == SyncStatus.error ||
        syncStatus == SyncStatus.revoked;

    final fill = isSynced ? tokens.accent : tokens.cardFill;
    final borderColor = isWarn ? tokens.warning : tokens.accent;

    Widget child;
    if (isSynced) {
      final s = Curves.easeOutBack.transform(checkScale.clamp(0.0, 1.0));
      child = Transform.scale(
        scale: 0.65 + 0.35 * s,
        child: Icon(
          Icons.check_rounded,
          size: 24,
          color: tokens.accentFg,
        ),
      );
    } else if (isSyncing) {
      child = Transform.rotate(
        angle: -beamProgress * math.pi * 2,
        child: Icon(
          Icons.sync_rounded,
          size: 22,
          color: tokens.accent,
        ),
      );
    } else if (isWarn) {
      child = Icon(
        Icons.cloud_off_rounded,
        size: 20,
        color: tokens.warning,
      );
    } else {
      child = Text(
        'EP',
        style: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w800,
          letterSpacing: -0.3,
          color: tokens.accent,
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: fill,
          border: Border.all(color: borderColor, width: 1.8),
          boxShadow: [
            BoxShadow(
              color: (isWarn ? tokens.warning : tokens.accent)
                  .withValues(alpha: isSynced || isSyncing ? 0.32 : 0.16),
              blurRadius: 16,
              spreadRadius: 1,
            ),
          ],
        ),
        child: Center(child: child),
      ),
    );
  }
}

class _SyncBeamPainter extends CustomPainter {
  final SyncPaletteTokens tokens;
  final SyncStatus syncStatus;
  final bool hasPeer;
  final double progress;
  final bool pulseActive;

  const _SyncBeamPainter({
    required this.tokens,
    required this.syncStatus,
    required this.hasPeer,
    required this.progress,
    required this.pulseActive,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final cy = (size.height - 18) / 2;
    final leftAnchor = Offset(58, cy);
    final hubLeft = Offset(size.width / 2 - 26, cy);
    final hubRight = Offset(size.width / 2 + 26, cy);
    final rightAnchor = Offset(size.width - 58, cy);
    final hubCenter = Offset(size.width / 2, cy);

    if (hubLeft.dx <= leftAnchor.dx + 4 || rightAnchor.dx <= hubRight.dx + 4) {
      return;
    }

    final leftPath = Path()
      ..moveTo(leftAnchor.dx, leftAnchor.dy)
      ..quadraticBezierTo(
        (leftAnchor.dx + hubLeft.dx) / 2,
        cy - 20,
        hubLeft.dx,
        hubLeft.dy,
      );

    final rightPath = Path()
      ..moveTo(hubRight.dx, hubRight.dy)
      ..quadraticBezierTo(
        (hubRight.dx + rightAnchor.dx) / 2,
        cy + 20,
        rightAnchor.dx,
        rightAnchor.dy,
      );

    final isSynced = syncStatus == SyncStatus.synced;
    final isSyncing = syncStatus == SyncStatus.syncing;
    final isWarn = syncStatus == SyncStatus.pendingOffline ||
        syncStatus == SyncStatus.error ||
        syncStatus == SyncStatus.revoked;

    final trackPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = isSynced ? 2.2 : 1.7
      ..strokeCap = StrokeCap.round
      ..color = isSynced
          ? tokens.accent.withValues(alpha: 0.85)
          : isWarn
              ? tokens.warning.withValues(alpha: 0.35)
              : tokens.border;

    if (isSynced || isSyncing) {
      canvas.drawPath(leftPath, trackPaint);
      canvas.drawPath(
        rightPath,
        hasPeer || isSynced
            ? trackPaint
            : (Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = 1.5
              ..color = tokens.border),
      );
    } else {
      _drawDashedPath(canvas, leftPath, trackPaint);
      _drawDashedPath(
        canvas,
        rightPath,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5
          ..color = tokens.border,
      );
    }

    if (pulseActive && !isWarn) {
      // Expand soft sonar ping around center hub.
      final ringAlpha = ((1.0 - progress) * 0.45).clamp(0.0, 1.0);
      if (ringAlpha > 0.01) {
        canvas.drawCircle(
          hubCenter,
          24 + 13 * progress,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.6
            ..color = tokens.accent.withValues(alpha: ringAlpha),
        );
      }

      // Draw animated comet segment along left curve (left -> hub).
      _drawBeamSegment(
        canvas,
        leftPath,
        startFraction: progress * 1.25 - 0.32,
        endFraction: progress * 1.25,
      );

      // Draw animated comet segment along right curve (peer -> hub when linked, or hub -> slot).
      if (hasPeer || isSynced) {
        _drawBeamSegment(
          canvas,
          rightPath,
          startFraction: 1.0 - progress * 1.25,
          endFraction: 1.0 - (progress * 1.25 - 0.32),
          reverseHead: true,
        );
      } else {
        _drawBeamSegment(
          canvas,
          rightPath,
          startFraction: progress * 1.25 - 0.32,
          endFraction: progress * 1.25,
        );
      }
    }
  }

  void _drawDashedPath(Canvas canvas, Path source, Paint paint) {
    for (final metric in source.computeMetrics()) {
      double distance = 0;
      const dashLen = 4.5;
      const gapLen = 4.5;
      while (distance < metric.length) {
        final next = math.min(distance + dashLen, metric.length);
        canvas.drawPath(metric.extractPath(distance, next), paint);
        distance += dashLen + gapLen;
      }
    }
  }

  void _drawBeamSegment(
    Canvas canvas,
    Path path, {
    required double startFraction,
    required double endFraction,
    bool reverseHead = false,
  }) {
    final s = startFraction.clamp(0.0, 1.0);
    final e = endFraction.clamp(0.0, 1.0);
    if (e - s <= 0.02) return;

    for (final PathMetric metric in path.computeMetrics()) {
      final segment = metric.extractPath(metric.length * s, metric.length * e);
      canvas.drawPath(
        segment,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 3.0
          ..strokeCap = StrokeCap.round
          ..color = tokens.accent,
      );

      final headFraction = reverseHead ? s : e;
      final headTangent = metric.getTangentForOffset(metric.length * headFraction);
      if (headTangent != null) {
        canvas.drawCircle(
          headTangent.position,
          3.2,
          Paint()..color = tokens.isDark ? Colors.white : tokens.accent,
        );
      }
    }
  }

  @override
  bool shouldRepaint(covariant _SyncBeamPainter oldDelegate) {
    return oldDelegate.progress != progress ||
        oldDelegate.pulseActive != pulseActive ||
        oldDelegate.syncStatus != syncStatus ||
        oldDelegate.hasPeer != hasPeer ||
        oldDelegate.tokens.accent != tokens.accent ||
        oldDelegate.tokens.isDark != tokens.isDark;
  }
}

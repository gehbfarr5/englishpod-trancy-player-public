import 'dart:math' as math;
import 'dart:ui' show PathMetric;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../services/sync/sync_models.dart';
import 'sync_theme.dart';

/// Continuous two-stage animated beam hero (`本机 → 云端 → 其他设备`)
/// using Warm Parchment / Dark Cocoon tokens.
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
  final bool waitingForPeer;
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
    this.waitingForPeer = false,
    this.onTap,
  });

  @override
  State<SyncBeamHero> createState() => _SyncBeamHeroState();
}

class _SyncBeamHeroState extends State<SyncBeamHero>
    with TickerProviderStateMixin {
  late final AnimationController _beamCtrl;
  bool _initializedAnim = false;

  @override
  void initState() {
    super.initState();
    _beamCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2400),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_initializedAnim) {
      _initializedAnim = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _applyStatusAnimation();
      });
    } else {
      _applyStatusAnimation();
    }
  }

  @override
  void didUpdateWidget(covariant SyncBeamHero oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.syncStatus != widget.syncStatus ||
        oldWidget.waitingForPeer != widget.waitingForPeer) {
      _applyStatusAnimation();
    }
  }

  bool get _isWarn =>
      widget.syncStatus == SyncStatus.pendingOffline ||
      widget.syncStatus == SyncStatus.error ||
      widget.syncStatus == SyncStatus.revoked;

  void _applyStatusAnimation() {
    final reducedMotion = MediaQuery.disableAnimationsOf(context);
    if (reducedMotion || _isWarn) {
      _beamCtrl.stop();
      _beamCtrl.value = 0.0;
      return;
    }
    if (!_beamCtrl.isAnimating || _beamCtrl.velocity == 0) {
      _beamCtrl.repeat();
    }
  }

  void _handleTap() {
    HapticFeedback.selectionClick();
    if (!MediaQuery.disableAnimationsOf(context) && !_isWarn) {
      _beamCtrl.forward(from: 0.0).whenComplete(() {
        if (mounted && !_isWarn && !MediaQuery.disableAnimationsOf(context)) {
          _beamCtrl.repeat();
        }
      });
    }
    widget.onTap?.call();
  }

  @override
  void dispose() {
    _beamCtrl.dispose();
    super.dispose();
  }

  static bool _isWebPlatform(String? platform) => platform == 'web';

  String _statusChipText() {
    if (widget.waitingForPeer &&
        widget.syncStatus != SyncStatus.error &&
        widget.syncStatus != SyncStatus.pendingOffline) {
      return '等待其他设备连接 · 配对后自动云端同步';
    }
    switch (widget.syncStatus) {
      case SyncStatus.syncing:
        return '本机进度上传云端 · 正在分发到其他设备…';
      case SyncStatus.synced:
        return '已完成 ${widget.completedCount} / ${widget.totalCount} 课 · ${math.max(1, widget.deviceCount)} 台设备通过云端实时同步';
      case SyncStatus.pendingOffline:
        return '网络离线 · 本机进度已本地保存，联网后自动上传';
      case SyncStatus.error:
        return '同步暂未完成 · 稍后自动重试';
      case SyncStatus.revoked:
        return '已退出同步组 · 本机学习进度完整保留';
      case SyncStatus.unlinked:
        return '本机进度上传云端 · 自动分发到其他设备';
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.tokens;
    final hasPeer =
        (widget.peerPlatform != null && widget.peerPlatform!.isNotEmpty) ||
            widget.deviceCount > 1;
    final isSyncing = widget.syncStatus == SyncStatus.syncing;
    final isSynced = widget.syncStatus == SyncStatus.synced;
    final isWarn = _isWarn;
    final isLinkedVisual =
        !widget.waitingForPeer && !isWarn && (isSynced || isSyncing) && hasPeer;

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
                  : t.accentSoft.withValues(
                      alpha: isLinkedVisual ? 0.95 : 0.72,
                    ),
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
                animation: _beamCtrl,
                builder: (context, _) {
                  final pulseActive = _beamCtrl.isAnimating || isSyncing;
                  return Stack(
                    alignment: Alignment.topCenter,
                    children: [
                      Positioned.fill(
                        child: CustomPaint(
                          painter: _SyncBeamPainter(
                            tokens: t,
                            syncStatus: widget.syncStatus,
                            isLinkedVisual: isLinkedVisual,
                            progress: pulseActive ? _beamCtrl.value : 0.0,
                            pulseActive: pulseActive,
                          ),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _DeviceNode(
                              tokens: t,
                              icon: _isWebPlatform(widget.localPlatform)
                                  ? Icons.laptop_mac_rounded
                                  : Icons.smartphone_rounded,
                              label: '本机',
                              active: true,
                              isDashed: false,
                            ),
                            _CenterHub(
                              tokens: t,
                              isSynced: isLinkedVisual,
                              isWarn: isWarn,
                            ),
                            _DeviceNode(
                              tokens: t,
                              icon: Icons.devices_rounded,
                              label: '其他设备',
                              active: isLinkedVisual,
                              isDashed: !isLinkedVisual,
                            ),
                          ],
                        ),
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
          SizedBox(
            height: 48,
            child: Center(
              child: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: tokens.cardFill,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: isDashed
                        ? tokens.textMuted.withValues(alpha: 0.45)
                        : (active
                            ? tokens.accent.withValues(alpha: 0.72)
                            : tokens.cardBorder),
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
            ),
          ),
          const SizedBox(height: 3),
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
  final bool isSynced;
  final bool isWarn;

  const _CenterHub({
    required this.tokens,
    required this.isSynced,
    required this.isWarn,
  });

  @override
  Widget build(BuildContext context) {
    final fill = isSynced ? tokens.accent : tokens.cardFill;
    final borderColor = isWarn ? tokens.warning : tokens.accent;

    return SizedBox(
      width: 72,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: fill,
              border: Border.all(color: borderColor, width: 1.8),
              boxShadow: [
                BoxShadow(
                  color: (isWarn ? tokens.warning : tokens.accent)
                      .withValues(alpha: isSynced ? 0.36 : 0.24),
                  blurRadius: 16,
                  spreadRadius: isSynced ? 2 : 1,
                ),
              ],
            ),
            child: Center(
              child: Icon(
                isWarn ? Icons.cloud_off_rounded : Icons.cloud_rounded,
                size: isWarn ? 20 : 22,
                color: isWarn
                    ? tokens.warning
                    : (isSynced ? tokens.accentFg : tokens.accent),
              ),
            ),
          ),
          const SizedBox(height: 3),
          Text(
            '云端',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: tokens.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

class _SyncBeamPainter extends CustomPainter {
  final SyncPaletteTokens tokens;
  final SyncStatus syncStatus;
  final bool isLinkedVisual;
  final double progress;
  final bool pulseActive;

  const _SyncBeamPainter({
    required this.tokens,
    required this.syncStatus,
    required this.isLinkedVisual,
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

    final isWarn = syncStatus == SyncStatus.pendingOffline ||
        syncStatus == SyncStatus.error ||
        syncStatus == SyncStatus.revoked;

    final trackPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = isLinkedVisual ? 2.0 : 1.6
      ..strokeCap = StrokeCap.round
      ..color = isLinkedVisual
          ? tokens.accent.withValues(alpha: 0.45)
          : isWarn
              ? tokens.warning.withValues(alpha: 0.35)
              : tokens.border;

    if (isLinkedVisual) {
      canvas.drawPath(leftPath, trackPaint);
      canvas.drawPath(rightPath, trackPaint);
    } else {
      _drawDashedPath(canvas, leftPath, trackPaint);
      _drawDashedPath(canvas, rightPath, trackPaint);
    }

    if (pulseActive && !isWarn) {
      // Stage 1 (0.00 -> 0.48): 本机 -> 云端
      if (progress < 0.54) {
        final t1 = progress / 0.48;
        _drawBeamSegment(
          canvas,
          leftPath,
          startFraction: t1 * 1.25 - 0.34,
          endFraction: t1 * 1.25,
        );
      }

      // Center Cloud Relay Sonar Ping (0.38 -> 0.88)
      if (progress >= 0.38 && progress <= 0.88) {
        final rp = (progress - 0.38) / 0.50;
        final ringAlpha = ((1.0 - rp) * 0.48).clamp(0.0, 1.0);
        if (ringAlpha > 0.01) {
          canvas.drawCircle(
            hubCenter,
            24 + 13 * rp,
            Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = 1.6
              ..color = tokens.accent.withValues(alpha: ringAlpha),
          );
        }
      }

      // Stage 2 (0.44 -> 0.96): 云端 -> 其他设备
      if (progress >= 0.44) {
        final t2 = (progress - 0.44) / 0.48;
        _drawBeamSegment(
          canvas,
          rightPath,
          startFraction: t2 * 1.25 - 0.34,
          endFraction: t2 * 1.25,
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

      final headTangent = metric.getTangentForOffset(metric.length * e);
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
        oldDelegate.isLinkedVisual != isLinkedVisual ||
        oldDelegate.tokens.accent != tokens.accent ||
        oldDelegate.tokens.isDark != tokens.isDark;
  }
}

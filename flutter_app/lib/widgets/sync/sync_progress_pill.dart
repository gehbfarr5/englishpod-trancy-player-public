import 'package:flutter/material.dart';

import '../../services/sync/sync_models.dart';
import 'sync_theme.dart';

/// Top-right library completion pill that also serves as the single restrained entry
/// point to the multi-device progress sync modal.
class SyncProgressPill extends StatefulWidget {
  final int completedCount;
  final int totalCount;
  final SyncStatus syncStatus;
  final SyncPaletteTokens tokens;
  final VoidCallback onTap;

  const SyncProgressPill({
    super.key,
    required this.completedCount,
    required this.totalCount,
    required this.syncStatus,
    required this.tokens,
    required this.onTap,
  });

  @override
  State<SyncProgressPill> createState() => _SyncProgressPillState();
}

class _SyncProgressPillState extends State<SyncProgressPill>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseCtrl;
  bool _pressed = false;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
      value: 1.0,
    );
    _syncPulse();
  }

  @override
  void didUpdateWidget(covariant SyncProgressPill oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.syncStatus != widget.syncStatus) {
      _syncPulse();
    }
  }

  void _syncPulse() {
    if (widget.syncStatus == SyncStatus.syncing) {
      _pulseCtrl.repeat(reverse: true);
    } else {
      _pulseCtrl.stop();
      _pulseCtrl.value = 1.0;
    }
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    super.dispose();
  }

  Color? _dotColor(SyncPaletteTokens t) {
    switch (widget.syncStatus) {
      case SyncStatus.unlinked:
        return null;
      case SyncStatus.synced:
      case SyncStatus.syncing:
        return t.accent;
      case SyncStatus.pendingOffline:
        return t.textSecondary;
      case SyncStatus.error:
      case SyncStatus.revoked:
        return t.warning;
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.tokens;
    final dotColor = _dotColor(t);

    return Semantics(
      button: true,
      label:
          'Progress sync, ${widget.completedCount} of ${widget.totalCount} done',
      child: GestureDetector(
        key: const ValueKey('top_right_progress_sync_pill'),
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => setState(() => _pressed = true),
        onTapCancel: () => setState(() => _pressed = false),
        onTapUp: (_) => setState(() => _pressed = false),
        onTap: widget.onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minWidth: 44, minHeight: 36),
          child: Center(
            widthFactor: 1.0,
            heightFactor: 1.0,
            child: AnimatedScale(
              scale: _pressed ? 0.96 : 1.0,
              duration: const Duration(milliseconds: 100),
              curve: Curves.easeOut,
              child: Container(
                height: 28,
                padding: const EdgeInsets.symmetric(horizontal: 11),
                decoration: BoxDecoration(
                  color: t.surfaceInset,
                  borderRadius: BorderRadius.circular(9999),
                  border: Border.all(color: t.border),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (dotColor != null) ...[
                      FadeTransition(
                        opacity: _pulseCtrl.drive(Tween(begin: 0.35, end: 1.0)),
                        child: Container(
                          width: 5,
                          height: 5,
                          decoration: BoxDecoration(
                            color: dotColor,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                    ],
                    Text(
                      '${widget.completedCount} / ${widget.totalCount} Done',
                      style: TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                        color: t.accent,
                        fontFeatures: const [FontFeature.tabularFigures()],
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
}

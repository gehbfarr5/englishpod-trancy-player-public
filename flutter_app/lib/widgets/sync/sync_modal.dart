import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../services/sync/sync_engine.dart';
import '../../services/sync/sync_models.dart';
import '../../services/sync/sync_platform.dart';
import 'sync_qr_code.dart';
import 'sync_theme.dart';

typedef QrScannerCallback = Future<String?> Function(BuildContext context);

enum _ModalViewMode { home, showCode, enterCode }

Future<void> showProgressSyncModal({
  required BuildContext context,
  required SyncEngine engine,
  required SyncPaletteTokens tokens,
  required int completedCount,
  required int totalCount,
  QrScannerCallback? onScanQr,
}) {
  final isMobileSheet = !syncIsWeb && engine.platform != 'web';
  return showGeneralDialog<void>(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Close progress sync modal',
    barrierColor: tokens.scrimColor,
    transitionDuration: const Duration(milliseconds: 220),
    pageBuilder: (dialogCtx, _, __) {
      return _ProgressSyncDialog(
        engine: engine,
        tokens: tokens,
        completedCount: completedCount,
        totalCount: totalCount,
        isMobileSheet: isMobileSheet,
        onScanQr: onScanQr,
      );
    },
    transitionBuilder: (ctx, animation, _, child) {
      final reduced = MediaQuery.disableAnimationsOf(ctx);
      if (reduced) {
        return child;
      }
      final curved = CurvedAnimation(
        parent: animation,
        curve: Curves.easeOutCubic,
        reverseCurve: Curves.easeInCubic,
      );
      return SlideTransition(
        position: Tween<Offset>(
          begin: isMobileSheet ? const Offset(0, 1) : const Offset(0, 0.06),
          end: Offset.zero,
        ).animate(curved),
        child: child,
      );
    },
  );
}

class _ProgressSyncDialog extends StatefulWidget {
  final SyncEngine engine;
  final SyncPaletteTokens tokens;
  final int completedCount;
  final int totalCount;
  final bool isMobileSheet;
  final QrScannerCallback? onScanQr;

  const _ProgressSyncDialog({
    required this.engine,
    required this.tokens,
    required this.completedCount,
    required this.totalCount,
    required this.isMobileSheet,
    this.onScanQr,
  });

  @override
  State<_ProgressSyncDialog> createState() => _ProgressSyncDialogState();
}

class _ProgressSyncDialogState extends State<_ProgressSyncDialog> {
  _ModalViewMode _mode = _ModalViewMode.home;
  bool _busy = false;
  bool _ticketExpired = false;
  String? _localError;
  String? _bannerNotice;
  final TextEditingController _codeInputController = TextEditingController();
  final FocusNode _codeFocusNode = FocusNode();
  final ValueNotifier<double> _dragOffset = ValueNotifier<double>(0.0);

  bool get _canScan =>
      !syncIsWeb &&
      widget.engine.platform != 'web' &&
      widget.onScanQr != null;

  @override
  void initState() {
    super.initState();
    widget.engine.addListener(_onEngineChanged);
    if (widget.engine.isLinked && widget.engine.isConfigured) {
      unawaited(widget.engine.refreshDevices().catchError((_) {}));
    }
  }

  @override
  void dispose() {
    widget.engine.stopPairingPoll();
    widget.engine.removeListener(_onEngineChanged);
    _codeInputController.dispose();
    _codeFocusNode.dispose();
    _dragOffset.dispose();
    super.dispose();
  }

  void _onEngineChanged() {
    if (!mounted) return;
    final st = widget.engine.lastPairingStatus;
    if (_mode == _ModalViewMode.showCode && st?.status == 'consumed') {
      setState(() {
        _mode = _ModalViewMode.home;
        _ticketExpired = false;
        _bannerNotice = st?.claimedDeviceName != null
            ? '已连接「${st!.claimedDeviceName}」，进度已同步'
            : '新设备已加入，进度已同步';
      });
      return;
    }
    if (_mode == _ModalViewMode.showCode && st?.status == 'expired') {
      if (!_ticketExpired) {
        setState(() => _ticketExpired = true);
      }
      return;
    }
    setState(() {});
  }

  Future<void> _handleGenerateCode() async {
    setState(() {
      _busy = true;
      _ticketExpired = false;
      _localError = null;
      _bannerNotice = null;
    });
    try {
      await widget.engine.generatePairingCode();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _ticketExpired = false;
        _mode = _ModalViewMode.showCode;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _localError = widget.engine.errorMessage ?? e.toString();
      });
    }
  }

  Future<void> _handleScanQr() async {
    final scanner = widget.onScanQr;
    if (scanner == null) {
      _enterManualCodeMode();
      return;
    }
    widget.engine.stopPairingPoll();
    setState(() {
      _localError = null;
      _bannerNotice = null;
    });
    final scanned = await scanner(context);
    if (!mounted || scanned == null || scanned.trim().isEmpty) return;
    await _submitPairingInput(scanned);
  }

  void _enterManualCodeMode() {
    widget.engine.stopPairingPoll();
    _codeInputController.clear();
    setState(() {
      _localError = null;
      _bannerNotice = null;
      _mode = _ModalViewMode.enterCode;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _mode == _ModalViewMode.enterCode) {
        _codeFocusNode.requestFocus();
      }
    });
  }

  Future<void> _submitPairingInput(String raw) async {
    setState(() {
      _busy = true;
      _localError = null;
      _bannerNotice = null;
    });
    try {
      await widget.engine.claimPairingCode(raw);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _mode = _ModalViewMode.home;
        _codeInputController.clear();
        _bannerNotice =
            widget.engine.statusMessage ?? '已加入同步组，多端进度已合并';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _localError = widget.engine.errorMessage ?? '连接失败，请核对 8 位配对码';
      });
    }
  }

  Future<void> _handleSyncNow() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _localError = null;
    });
    try {
      await widget.engine.syncNow(forcePull: true);
      await widget.engine.refreshDevices();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _bannerNotice = '已完成双向同步';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _localError = widget.engine.errorMessage ?? '同步暂不可用';
      });
    }
  }

  Future<void> _showSelfDeviceMenu() async {
    final t = widget.tokens;
    final action = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: t.dialogBg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        final bottomPad = MediaQuery.paddingOf(ctx).bottom;
        return Padding(
          padding: EdgeInsets.fromLTRB(16, 12, 16, 16 + bottomPad),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 34,
                  height: 4,
                  decoration: BoxDecoration(
                    color: t.textMuted,
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                '${widget.engine.deviceName}（本机）',
                style: TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w800,
                  color: t.textPrimary,
                ),
              ),
              const SizedBox(height: 12),
              _SheetMenuOption(
                key: const ValueKey('sync_rename_self_btn'),
                label: '重命名本机',
                textColor: t.textPrimary,
                bgColor: t.cardFill,
                onTap: () => Navigator.of(ctx).pop('rename'),
              ),
              const SizedBox(height: 8),
              _SheetMenuOption(
                key: const ValueKey('sync_leave_group_btn'),
                label: '退出同步组',
                textColor: t.warning,
                bgColor: t.cardFill,
                onTap: () => Navigator.of(ctx).pop('leave'),
              ),
              const SizedBox(height: 4),
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: Text(
                  '取消',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: t.textSecondary,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
    if (!mounted || action == null) return;
    if (action == 'rename') {
      await _showRenameDialog();
    } else if (action == 'leave') {
      await _confirmAndLeave();
    }
  }

  Future<void> _confirmAndRevokePeer(SyncDeviceSummary dev) async {
    final t = widget.tokens;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: t.dialogBg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: t.dialogBorder),
        ),
        title: Text(
          '移除「${dev.deviceName}」？',
          style: TextStyle(
            color: t.textPrimary,
            fontSize: 16,
            fontWeight: FontWeight.w800,
          ),
        ),
        content: Text(
          '移除后该设备将断开同步，但对方本地已学进度会完整保留。',
          style: TextStyle(color: t.textSecondary, fontSize: 13.5, height: 1.45),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text('取消', style: TextStyle(color: t.textSecondary)),
          ),
          TextButton(
            key: const ValueKey('sync_confirm_revoke_btn'),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text('确认移除', style: TextStyle(color: t.warning)),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _busy = true;
      _localError = null;
    });
    try {
      await widget.engine.revokeDevice(dev.deviceId);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _bannerNotice = widget.engine.hasLinkedPeers
            ? '已移除「${dev.deviceName}」'
            : '已移除「${dev.deviceName}」，当前仅剩本机，可随时重新配对';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _localError = widget.engine.errorMessage ?? '移除失败，请稍后重试';
      });
    }
  }

  Future<void> _confirmAndLeave() async {
    final t = widget.tokens;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: t.dialogBg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: t.dialogBorder),
        ),
        title: Text(
          '退出同步组',
          style: TextStyle(
            color: t.textPrimary,
            fontSize: 16,
            fontWeight: FontWeight.w800,
          ),
        ),
        content: Text(
          '仅解除多端同步关系，本机已学进度不会丢失。确认退出？',
          style: TextStyle(color: t.textSecondary, fontSize: 13.5, height: 1.45),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text('取消', style: TextStyle(color: t.textSecondary)),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text('确认退出', style: TextStyle(color: t.warning)),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    await widget.engine.leaveGroup();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _mode = _ModalViewMode.home;
      _bannerNotice = widget.engine.statusMessage ?? '已退出同步组，本机进度完整保留';
    });
  }

  Future<void> _showRenameDialog() async {
    final t = widget.tokens;
    final ctrl = TextEditingController(text: widget.engine.deviceName);
    final updatedName = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: t.dialogBg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: t.dialogBorder),
        ),
        title: Text(
          '重命名本机',
          style: TextStyle(
            color: t.textPrimary,
            fontSize: 16,
            fontWeight: FontWeight.w800,
          ),
        ),
        content: TextField(
          controller: ctrl,
          maxLength: 32,
          autofocus: true,
          style: TextStyle(color: t.textPrimary),
          decoration: InputDecoration(
            hintText: '例如：HUAWEI Pura X View',
            hintStyle: TextStyle(color: t.textMuted),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: t.border),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: t.accent),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text('取消', style: TextStyle(color: t.textSecondary)),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()),
            child: Text('保存', style: TextStyle(color: t.accent)),
          ),
        ],
      ),
    );
    ctrl.dispose();
    if (updatedName == null || updatedName.isEmpty || !mounted) return;
    await widget.engine.renameCurrentDevice(updatedName);
    if (!mounted) return;
    setState(() => _bannerNotice = '设备名称已更新为「$updatedName」');
  }

  void _onCodeInputChanged(String raw) {
    final filtered = StringBuffer();
    for (var i = 0; i < raw.length; i++) {
      final ch = raw[i].toUpperCase();
      if (kSyncPairingAlphabet.contains(ch)) {
        filtered.write(ch);
      }
      if (filtered.length >= 8) break;
    }
    final clean = filtered.toString();
    final formatted = clean.length > 4
        ? '${clean.substring(0, 4)}-${clean.substring(4)}'
        : clean;
    if (formatted != raw) {
      _codeInputController.value = TextEditingValue(
        text: formatted,
        selection: TextSelection.collapsed(offset: formatted.length),
      );
    }
    setState(() {});
  }

  void _handleDragUpdate(DragUpdateDetails details) {
    if (!widget.isMobileSheet || _busy) return;
    final next = (_dragOffset.value + details.delta.dy).clamp(0.0, 420.0);
    _dragOffset.value = next;
  }

  void _handleDragEnd(DragEndDetails details) {
    if (!widget.isMobileSheet || _busy) return;
    final velocity = details.primaryVelocity ?? 0.0;
    if (_dragOffset.value > 68.0 || velocity > 550.0) {
      Navigator.of(context).pop();
    } else {
      _dragOffset.value = 0.0;
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.tokens;
    final media = MediaQuery.of(context);
    final engine = widget.engine;
    final isMobile = widget.isMobileSheet;
    final bottomInset = media.viewInsets.bottom;
    final safeBottom = media.padding.bottom;

    final Widget body = switch (_mode) {
      _ModalViewMode.showCode => _buildShowCodeBody(t),
      _ModalViewMode.enterCode => _buildEnterCodeBody(t),
      _ModalViewMode.home => engine.hasLinkedPeers
          ? _buildLinkedHomeBody(t)
          : _buildUnlinkedHomeBody(t),
    };

    final Widget sheetSurface = RepaintBoundary(
      child: Material(
        color: Colors.transparent,
        child: Container(
          width: double.infinity,
          decoration: BoxDecoration(
            color: t.dialogBg,
            borderRadius: isMobile
                ? const BorderRadius.vertical(top: Radius.circular(24))
                : BorderRadius.circular(22),
            border: isMobile
                ? Border(top: BorderSide(color: t.dialogBorder))
                : Border.all(color: t.dialogBorder),
          ),
          padding: EdgeInsets.fromLTRB(
            18,
            isMobile ? 8 : 16,
            18,
            (isMobile ? (18 + safeBottom) : 18),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (isMobile)
                Padding(
                  padding: const EdgeInsets.only(top: 2, bottom: 10),
                  child: Center(
                    child: Container(
                      width: 36,
                      height: 4,
                      decoration: BoxDecoration(
                        color: t.textMuted,
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                  ),
                ),
              body,
            ],
          ),
        ),
      ),
    );

    if (isMobile) {
      return AnimatedPadding(
        duration: const Duration(milliseconds: 140),
        curve: Curves.easeOut,
        padding: EdgeInsets.only(bottom: bottomInset),
        child: Align(
          alignment: Alignment.bottomCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onVerticalDragUpdate: _handleDragUpdate,
              onVerticalDragEnd: _handleDragEnd,
              child: ValueListenableBuilder<double>(
                valueListenable: _dragOffset,
                builder: (_, dy, child) => dy == 0.0
                    ? child!
                    : Transform.translate(offset: Offset(0, dy), child: child),
                child: sheetSurface,
              ),
            ),
          ),
        ),
      );
    }

    // Web / Tesla centered compact dialog (keeps top-right close button, zero heavy blur shadow)
    return AnimatedPadding(
      duration: const Duration(milliseconds: 140),
      curve: Curves.easeOut,
      padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + bottomInset),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 400),
          child: sheetSurface,
        ),
      ),
    );
  }

  Widget _buildWebCloseButton(SyncPaletteTokens t) {
    if (widget.isMobileSheet) return const SizedBox.shrink();
    return InkWell(
      key: const ValueKey('sync_modal_close_btn'),
      onTap: () => Navigator.of(context).pop(),
      borderRadius: BorderRadius.circular(15),
      child: Container(
        width: 30,
        height: 30,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: t.surfaceInset,
          border: Border.all(color: t.border),
        ),
        child: Icon(Icons.close_rounded, size: 16, color: t.textSecondary),
      ),
    );
  }

  Widget _buildBanners(SyncPaletteTokens t) {
    final engine = widget.engine;
    final items = <Widget>[];
    if (_bannerNotice != null && _bannerNotice!.isNotEmpty) {
      items.add(
        _NoticeBanner(
          text: _bannerNotice!,
          bgColor: t.accentSoft,
          borderColor: t.accent,
          textColor: t.textPrimary,
          onDismiss: () => setState(() => _bannerNotice = null),
        ),
      );
    }
    if (_localError != null && _localError!.isNotEmpty) {
      items.add(
        _NoticeBanner(
          text: _localError!,
          bgColor: t.warning.withValues(alpha: 0.14),
          borderColor: t.warning,
          textColor: t.textPrimary,
          onDismiss: () => setState(() => _localError = null),
        ),
      );
    } else if (engine.status == SyncStatus.revoked &&
        engine.statusMessage != null) {
      items.add(
        _NoticeBanner(
          text: engine.statusMessage!,
          bgColor: t.warning.withValues(alpha: 0.14),
          borderColor: t.warning,
          textColor: t.textPrimary,
        ),
      );
    }
    if (!engine.isConfigured) {
      items.add(
        _NoticeBanner(
          text: '当前构建未配置同步服务端地址，暂以单机离线模式运行。',
          bgColor: t.surfaceInset,
          borderColor: t.border,
          textColor: t.textSecondary,
        ),
      );
    }
    if (items.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: items,
    );
  }

  Widget _buildSubViewHeader(SyncPaletteTokens t, String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        children: [
          InkWell(
            key: const ValueKey('sync_modal_back_btn'),
            onTap: _busy
                ? null
                : () {
                    widget.engine.stopPairingPoll();
                    setState(() {
                      _mode = _ModalViewMode.home;
                      _localError = null;
                    });
                  },
            borderRadius: BorderRadius.circular(999),
            child: Container(
              height: 28,
              padding: const EdgeInsets.symmetric(horizontal: 10),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: t.surfaceInset,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: t.border),
              ),
              child: Text(
                '‹ 返回',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: t.textPrimary,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 16.5,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.2,
                color: t.textPrimary,
              ),
            ),
          ),
          if (!widget.isMobileSheet) ...[
            const SizedBox(width: 8),
            _buildWebCloseButton(t),
          ],
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // View 1: Unlinked Home (also shown when solo 1-device ticket had no peer!)
  // ---------------------------------------------------------------------------
  Widget _buildUnlinkedHomeBody(SyncPaletteTokens t) {
    final configured = widget.engine.isConfigured;
    final canScan = _canScan;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '多端进度同步',
                    style: TextStyle(
                      fontSize: 17.5,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.3,
                      color: t.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '本机已学 ${widget.completedCount} / ${widget.totalCount} 课 · 未连接其他设备',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12,
                      color: t.textSecondary,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
            ),
            if (!widget.isMobileSheet) ...[
              const SizedBox(width: 8),
              _buildWebCloseButton(t),
            ],
          ],
        ),
        const SizedBox(height: 14),
        _buildBanners(t),
        Row(
          children: [
            Expanded(
              child: _DirectionTile(
                key: ValueKey(
                  canScan ? 'sync_scan_qr_btn' : 'sync_enter_code_btn',
                ),
                tokens: t,
                isPrimary: true,
                icon: canScan
                    ? Icons.qr_code_scanner_rounded
                    : Icons.keyboard_alt_outlined,
                title: canScan ? '扫码连接' : '输入配对码',
                subtitle: canScan ? '扫描另一台设备二维码' : '输入对方 8 位配对码',
                onTap: configured && !_busy
                    ? (canScan ? _handleScanQr : _enterManualCodeMode)
                    : null,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _DirectionTile(
                key: const ValueKey('sync_generate_code_btn'),
                tokens: t,
                isPrimary: false,
                loading: _busy,
                icon: Icons.qr_code_2_rounded,
                title: '展示二维码',
                subtitle: '让另一台设备扫我',
                onTap: configured && !_busy ? _handleGenerateCode : null,
              ),
            ),
          ],
        ),
        if (canScan) ...[
          const SizedBox(height: 10),
          Material(
            color: t.surfaceInset,
            borderRadius: BorderRadius.circular(12),
            child: InkWell(
              key: const ValueKey('sync_enter_code_btn'),
              onTap: configured && !_busy ? _enterManualCodeMode : null,
              borderRadius: BorderRadius.circular(12),
              child: Container(
                height: 40,
                padding: const EdgeInsets.symmetric(horizontal: 13),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: t.border),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '手动输入 8 位配对码',
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: t.textPrimary,
                      ),
                    ),
                    Text(
                      '›',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: t.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // View 2: Show QR & 8-Char Code (cached QR + isolated countdown)
  // ---------------------------------------------------------------------------
  Widget _buildShowCodeBody(SyncPaletteTokens t) {
    final ticket = widget.engine.activeTicket;
    if (ticket == null) {
      return const SizedBox.shrink();
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildSubViewHeader(t, '本机配对二维码'),
        _buildBanners(t),
        Container(
          padding: const EdgeInsets.fromLTRB(14, 16, 14, 14),
          decoration: BoxDecoration(
            color: t.cardFill,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: t.border),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SyncQrCodeWidget(
                key: const ValueKey('sync_pairing_qr_widget'),
                payload: ticket.qrPayload,
                tokens: t,
                size: 152,
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    ticket.displayCode,
                    key: const ValueKey('sync_display_pairing_code'),
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 2.5,
                      color: t.textPrimary,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                  const SizedBox(width: 8),
                  InkWell(
                    key: const ValueKey('sync_copy_code_btn'),
                    onTap: () {
                      unawaited(
                        Clipboard.setData(
                          ClipboardData(text: ticket.displayCode),
                        ),
                      );
                      setState(() => _bannerNotice = '已复制 ${ticket.displayCode}');
                    },
                    borderRadius: BorderRadius.circular(999),
                    child: Container(
                      height: 26,
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: t.surfaceInset,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: t.border),
                      ),
                      child: Text(
                        '复制',
                        style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: t.accent,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              _PairingCountdownText(
                key: ValueKey('countdown_${ticket.code}'),
                expiresAtMs: ticket.expiresAtMs,
                forceExpired: _ticketExpired,
                tokens: t,
                onExpired: () {
                  if (mounted && !_ticketExpired) {
                    setState(() => _ticketExpired = true);
                  }
                },
              ),
              if (_ticketExpired) ...[
                const SizedBox(height: 12),
                _PrimaryButton(
                  key: const ValueKey('sync_regenerate_code_btn'),
                  label: '重新生成配对码',
                  icon: Icons.refresh_rounded,
                  tokens: t,
                  loading: _busy,
                  onPressed: _busy ? null : _handleGenerateCode,
                ),
              ],
            ],
          ),
        ),
        if (_canScan) ...[
          const SizedBox(height: 6),
          TextButton(
            key: const ValueKey('sync_qr_to_scan_btn'),
            onPressed: _busy ? null : _handleScanQr,
            child: Text(
              '改为扫另一台设备的二维码',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: t.textSecondary,
              ),
            ),
          ),
        ],
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // View 3: Enter 8-Char Code (segmented boxes inspired by WeChat Input)
  // ---------------------------------------------------------------------------
  Widget _buildEnterCodeBody(SyncPaletteTokens t) {
    final linked = widget.engine.hasLinkedPeers;
    final cleanCode = _codeInputController.text.replaceAll('-', '');
    final codeReady = cleanCode.length == 8;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildSubViewHeader(t, linked ? '输入配对码关联设备' : '输入配对码连接'),
        _buildBanners(t),
        Text(
          linked
              ? '请输入另一台设备显示的 8 位配对码（将与当前组智能合并）'
              : '请输入另一台设备显示的 8 位配对码',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 12, color: t.textSecondary),
        ),
        const SizedBox(height: 12),
        GestureDetector(
          onTap: () => _codeFocusNode.requestFocus(),
          child: Stack(
            alignment: Alignment.center,
            children: [
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    for (var i = 0; i < 8; i++) ...[
                      if (i == 4)
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 3),
                          child: Text(
                            '-',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w800,
                              color: t.textMuted,
                            ),
                          ),
                        ),
                      _CodeBoxCell(
                        tokens: t,
                        char: i < cleanCode.length ? cleanCode[i] : '',
                        isActive: i == cleanCode.length.clamp(0, 7),
                      ),
                      if (i != 3 && i != 7) const SizedBox(width: 5),
                    ],
                  ],
                ),
              ),
              Positioned.fill(
                child: Opacity(
                  opacity: 0.0,
                  child: TextField(
                    key: const ValueKey('sync_code_text_field'),
                    controller: _codeInputController,
                    focusNode: _codeFocusNode,
                    onChanged: _onCodeInputChanged,
                    onSubmitted: (_) {
                      if (!_busy && codeReady) {
                        unawaited(_submitPairingInput(_codeInputController.text));
                      }
                    },
                    textCapitalization: TextCapitalization.characters,
                    autocorrect: false,
                    enableSuggestions: false,
                    decoration: const InputDecoration(border: InputBorder.none),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _PrimaryButton(
          key: const ValueKey('sync_submit_claim_btn'),
          label: linked ? '确认关联并合并进度' : '确认连接',
          icon: Icons.link_rounded,
          tokens: t,
          loading: _busy,
          enabled: !_busy && codeReady,
          onPressed: !_busy && codeReady
              ? () => _submitPairingInput(_codeInputController.text)
              : null,
        ),
        if (_canScan) ...[
          const SizedBox(height: 6),
          TextButton(
            key: const ValueKey('sync_scan_qr_btn'),
            onPressed: _busy ? null : _handleScanQr,
            child: Text(
              '改为打开相机扫码',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: t.textSecondary,
              ),
            ),
          ),
        ],
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // View 4: Linked Status & Device Management (inspired by WeChat Input 342.jpg)
  // ---------------------------------------------------------------------------
  Widget _buildLinkedHomeBody(SyncPaletteTokens t) {
    final engine = widget.engine;
    final devices = engine.devices;
    final lastSyncedLabel = _formatRelativeTime(engine.lastSyncedAtMs);
    final isSyncing = _busy || engine.status == SyncStatus.syncing;
    final isWarn = engine.status == SyncStatus.pendingOffline ||
        engine.status == SyncStatus.error;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '多端进度同步',
                    style: TextStyle(
                      fontSize: 17.5,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.3,
                      color: t.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      Container(
                        width: 6,
                        height: 6,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: isWarn ? t.warning : t.accent,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          isSyncing
                              ? '正在同步…'
                              : isWarn
                                  ? '待同步 · 联网后自动上传'
                                  : '已同步 · $lastSyncedLabel',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 12,
                            color: t.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            InkWell(
              key: const ValueKey('sync_now_btn'),
              onTap: _busy ? null : _handleSyncNow,
              borderRadius: BorderRadius.circular(15),
              child: Container(
                width: 30,
                height: 30,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: t.surfaceInset,
                  border: Border.all(color: t.border),
                ),
                child: isSyncing
                    ? Center(
                        child: SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: t.accent,
                          ),
                        ),
                      )
                    : Icon(
                        Icons.sync_rounded,
                        size: 16,
                        color: t.textSecondary,
                      ),
              ),
            ),
            if (!widget.isMobileSheet) ...[
              const SizedBox(width: 8),
              _buildWebCloseButton(t),
            ],
          ],
        ),
        const SizedBox(height: 12),
        _buildBanners(t),
        Padding(
          padding: const EdgeInsets.only(left: 2, bottom: 7),
          child: Text(
            '我的设备 (${devices.length})',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: t.textSecondary,
            ),
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: t.cardFill,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: t.border),
          ),
          clipBehavior: Clip.antiAlias,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 204),
            child: ListView.separated(
              shrinkWrap: true,
              physics: devices.length > 3
                  ? const ClampingScrollPhysics()
                  : const NeverScrollableScrollPhysics(),
              padding: EdgeInsets.zero,
              itemCount: devices.length,
              separatorBuilder: (_, __) =>
                  Divider(height: 1, thickness: 1, color: t.border),
              itemBuilder: (_, idx) {
                final dev = devices[idx];
                return Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          color: t.surfaceInset,
                          borderRadius: BorderRadius.circular(9),
                          border: Border.all(
                            color: dev.isCurrent
                                ? t.accent.withValues(alpha: 0.45)
                                : t.border,
                          ),
                        ),
                        child: Icon(
                          _platformIcon(dev.platform),
                          size: 17,
                          color: dev.isCurrent ? t.accent : t.textSecondary,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    dev.deviceName,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 13.5,
                                      fontWeight: FontWeight.w700,
                                      color: t.textPrimary,
                                    ),
                                  ),
                                ),
                                if (dev.isCurrent) ...[
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 6,
                                      vertical: 1.5,
                                    ),
                                    decoration: BoxDecoration(
                                      color: t.accentSoft,
                                      borderRadius: BorderRadius.circular(999),
                                    ),
                                    child: Text(
                                      '本机',
                                      style: TextStyle(
                                        fontSize: 10,
                                        fontWeight: FontWeight.w800,
                                        color: t.accent,
                                      ),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                            const SizedBox(height: 1.5),
                            Text(
                              '${_platformLabel(dev.platform)} · ${dev.isCurrent ? lastSyncedLabel : _formatRelativeTime(dev.lastSeenAtMs)}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 11,
                                color: t.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (dev.isCurrent) ...[
                        const SizedBox(width: 6),
                        InkWell(
                          key: const ValueKey('sync_add_device_btn'),
                          onTap: _busy ? null : _handleGenerateCode,
                          borderRadius: BorderRadius.circular(999),
                          child: Container(
                            height: 28,
                            padding: const EdgeInsets.symmetric(horizontal: 10),
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: t.accent,
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              '查看二维码',
                              style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w800,
                                color: t.accentFg,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 2),
                        InkWell(
                          key: const ValueKey('sync_self_more_btn'),
                          onTap: _busy ? null : _showSelfDeviceMenu,
                          borderRadius: BorderRadius.circular(8),
                          child: SizedBox(
                            width: 28,
                            height: 28,
                            child: Icon(
                              Icons.more_vert_rounded,
                              size: 17,
                              color: t.textSecondary,
                            ),
                          ),
                        ),
                      ] else ...[
                        const SizedBox(width: 2),
                        InkWell(
                          key: ValueKey('sync_revoke_${dev.deviceId}'),
                          onTap: _busy
                              ? null
                              : () => _confirmAndRevokePeer(dev),
                          borderRadius: BorderRadius.circular(8),
                          child: SizedBox(
                            width: 28,
                            height: 28,
                            child: Icon(
                              Icons.more_vert_rounded,
                              size: 17,
                              color: t.textSecondary,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                );
              },
            ),
          ),
        ),
        const SizedBox(height: 12),
        _PrimaryButton(
          key: ValueKey(
            _canScan ? 'sync_linked_scan_btn' : 'sync_linked_enter_code_btn',
          ),
          label: _canScan ? '扫码关联新设备' : '输入配对码关联设备',
          icon: _canScan
              ? Icons.qr_code_scanner_rounded
              : Icons.keyboard_alt_outlined,
          tokens: t,
          loading: _busy,
          onPressed: !_busy
              ? (_canScan ? _handleScanQr : _enterManualCodeMode)
              : null,
        ),
        if (_canScan) ...[
          const SizedBox(height: 4),
          TextButton(
            key: const ValueKey('sync_linked_enter_code_btn'),
            onPressed: _busy ? null : _enterManualCodeMode,
            style: TextButton.styleFrom(
              minimumSize: const Size.fromHeight(34),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text(
              '或手动输入 8 位配对码',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: t.textSecondary,
              ),
            ),
          ),
        ],
      ],
    );
  }

  static String _platformLabel(String p) => p == 'web' ? '网页端' : '移动设备';

  static IconData _platformIcon(String p) =>
      p == 'web' ? Icons.laptop_mac_rounded : Icons.smartphone_rounded;

  static String _formatRelativeTime(int tsMs) {
    if (tsMs <= 0) return '尚未同步';
    final diffSec =
        ((DateTime.now().millisecondsSinceEpoch - tsMs) / 1000).floor();
    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return '${diffSec ~/ 60} 分钟前';
    if (diffSec < 86400) return '${diffSec ~/ 3600} 小时前';
    return '${diffSec ~/ 86400} 天前';
  }
}

/// Isolated 1-second countdown widget so ticking NEVER rebuilds the modal or QR code.
class _PairingCountdownText extends StatefulWidget {
  final int expiresAtMs;
  final bool forceExpired;
  final SyncPaletteTokens tokens;
  final VoidCallback onExpired;

  const _PairingCountdownText({
    super.key,
    required this.expiresAtMs,
    required this.forceExpired,
    required this.tokens,
    required this.onExpired,
  });

  @override
  State<_PairingCountdownText> createState() => _PairingCountdownTextState();
}

class _PairingCountdownTextState extends State<_PairingCountdownText> {
  Timer? _timer;
  late int _remainingSec;

  @override
  void initState() {
    super.initState();
    _remainingSec = _computeRemainingSec();
    if (!widget.forceExpired && _remainingSec > 0) {
      _timer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted) return;
        final next = _computeRemainingSec();
        if (next != _remainingSec) {
          setState(() => _remainingSec = next);
        }
        if (next <= 0) {
          _timer?.cancel();
          widget.onExpired();
        }
      });
    }
  }

  int _computeRemainingSec() {
    final remMs =
        widget.expiresAtMs - DateTime.now().millisecondsSinceEpoch;
    if (remMs <= 0) return 0;
    return (remMs / 1000).ceil().clamp(0, 300);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final expired = widget.forceExpired || _remainingSec <= 0;
    final mm = (_remainingSec ~/ 60).toString().padLeft(2, '0');
    final ss = (_remainingSec % 60).toString().padLeft(2, '0');
    return Text(
      expired ? '配对码已过期，请重新生成' : '5 分钟有效 · 剩余 $mm:$ss',
      style: TextStyle(
        fontSize: 11.5,
        fontWeight: FontWeight.w600,
        color: expired ? widget.tokens.warning : widget.tokens.textSecondary,
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
    );
  }
}

class _DirectionTile extends StatelessWidget {
  final SyncPaletteTokens tokens;
  final bool isPrimary;
  final bool loading;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  const _DirectionTile({
    super.key,
    required this.tokens,
    required this.isPrimary,
    this.loading = false,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final t = tokens;
    return Material(
      color: isPrimary ? t.accentSoft : t.cardFill,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.fromLTRB(10, 16, 10, 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: isPrimary
                  ? t.accent.withValues(alpha: 0.55)
                  : t.border,
              width: 1.2,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: isPrimary ? t.accent : t.surfaceInset,
                  borderRadius: BorderRadius.circular(13),
                  border: isPrimary ? null : Border.all(color: t.border),
                ),
                child: loading
                    ? Center(
                        child: SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: isPrimary ? t.accentFg : t.accent,
                          ),
                        ),
                      )
                    : Icon(
                        icon,
                        size: 21,
                        color: isPrimary ? t.accentFg : t.accent,
                      ),
              ),
              const SizedBox(height: 9),
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: t.textPrimary,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 11.5,
                  color: t.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CodeBoxCell extends StatelessWidget {
  final SyncPaletteTokens tokens;
  final String char;
  final bool isActive;

  const _CodeBoxCell({
    required this.tokens,
    required this.char,
    required this.isActive,
  });

  @override
  Widget build(BuildContext context) {
    final t = tokens;
    final filled = char.isNotEmpty;
    return Container(
      width: 34,
      height: 44,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: isActive ? t.accentSoft : t.cardFill,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isActive
              ? t.accent
              : (filled ? t.accent.withValues(alpha: 0.45) : t.border),
          width: isActive ? 1.5 : 1.2,
        ),
      ),
      child: Text(
        char,
        style: TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w800,
          color: t.textPrimary,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
    );
  }
}

class _NoticeBanner extends StatelessWidget {
  final String text;
  final Color bgColor;
  final Color borderColor;
  final Color textColor;
  final VoidCallback? onDismiss;

  const _NoticeBanner({
    required this.text,
    required this.bgColor,
    required this.borderColor,
    required this.textColor,
    this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: borderColor.withValues(alpha: 0.45)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                height: 1.35,
                color: textColor,
              ),
            ),
          ),
          if (onDismiss != null)
            InkWell(
              onTap: onDismiss,
              child: Padding(
                padding: const EdgeInsets.only(left: 6),
                child: Icon(
                  Icons.close_rounded,
                  size: 15,
                  color: textColor.withValues(alpha: 0.65),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _SheetMenuOption extends StatelessWidget {
  final String label;
  final Color textColor;
  final Color bgColor;
  final VoidCallback onTap;

  const _SheetMenuOption({
    super.key,
    required this.label,
    required this.textColor,
    required this.bgColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: bgColor,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          height: 44,
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w700,
              color: textColor,
            ),
          ),
        ),
      ),
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final SyncPaletteTokens tokens;
  final bool loading;
  final bool enabled;
  final VoidCallback? onPressed;

  const _PrimaryButton({
    super.key,
    required this.label,
    required this.icon,
    required this.tokens,
    this.loading = false,
    this.enabled = true,
    this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    final active = enabled && onPressed != null;
    return ElevatedButton.icon(
      onPressed: active ? onPressed : null,
      style: ElevatedButton.styleFrom(
        backgroundColor: tokens.accent,
        foregroundColor: tokens.accentFg,
        disabledBackgroundColor: tokens.accent.withValues(alpha: 0.35),
        disabledForegroundColor: tokens.accentFg.withValues(alpha: 0.65),
        minimumSize: const Size.fromHeight(44),
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)),
      ),
      icon: loading
          ? SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: tokens.accentFg,
              ),
            )
          : Icon(icon, size: 18),
      label: Text(
        label,
        style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800),
      ),
    );
  }
}

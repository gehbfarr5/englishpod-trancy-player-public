import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../services/sync/sync_engine.dart';
import '../../services/sync/sync_models.dart';
import '../../services/sync/sync_platform.dart';
import 'sync_beam_hero.dart';
import 'sync_qr_code.dart';
import 'sync_theme.dart';

typedef QrScannerCallback = Future<String?> Function(BuildContext context);

enum _ModalViewMode { overview, showCode, enterCode }

Future<void> showProgressSyncModal({
  required BuildContext context,
  required SyncEngine engine,
  required SyncPaletteTokens tokens,
  required int completedCount,
  required int totalCount,
  QrScannerCallback? onScanQr,
}) {
  return showGeneralDialog<void>(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Close progress sync modal',
    barrierColor: tokens.scrimColor,
    transitionDuration: const Duration(milliseconds: 260),
    pageBuilder: (dialogCtx, _, __) {
      return _ProgressSyncDialog(
        engine: engine,
        tokens: tokens,
        completedCount: completedCount,
        totalCount: totalCount,
        onScanQr: onScanQr,
      );
    },
    transitionBuilder: (ctx, animation, _, child) {
      final reduced = MediaQuery.disableAnimationsOf(ctx);
      if (reduced) {
        return FadeTransition(opacity: animation, child: child);
      }
      final curved = CurvedAnimation(
        parent: animation,
        curve: const Cubic(0.05, 0.7, 0.1, 1.0),
        reverseCurve: Curves.easeIn,
      );
      return FadeTransition(
        opacity: curved,
        child: ScaleTransition(
          scale: Tween<double>(begin: 0.94, end: 1.0).animate(curved),
          child: child,
        ),
      );
    },
  );
}

class _ProgressSyncDialog extends StatefulWidget {
  final SyncEngine engine;
  final SyncPaletteTokens tokens;
  final int completedCount;
  final int totalCount;
  final QrScannerCallback? onScanQr;

  const _ProgressSyncDialog({
    required this.engine,
    required this.tokens,
    required this.completedCount,
    required this.totalCount,
    this.onScanQr,
  });

  @override
  State<_ProgressSyncDialog> createState() => _ProgressSyncDialogState();
}

class _ProgressSyncDialogState extends State<_ProgressSyncDialog> {
  _ModalViewMode _mode = _ModalViewMode.overview;
  bool _busy = false;
  String? _localError;
  String? _bannerNotice;
  Timer? _countdownTimer;
  final TextEditingController _codeInputController = TextEditingController();

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
    _countdownTimer?.cancel();
    widget.engine.stopPairingPoll();
    widget.engine.removeListener(_onEngineChanged);
    _codeInputController.dispose();
    super.dispose();
  }

  void _onEngineChanged() {
    if (!mounted) return;
    final st = widget.engine.lastPairingStatus;
    if (_mode == _ModalViewMode.showCode && st?.status == 'consumed') {
      _countdownTimer?.cancel();
      setState(() {
        _mode = _ModalViewMode.overview;
        _bannerNotice = st?.claimedDeviceName != null
            ? '已连接：${st!.claimedDeviceName}，进度已同步'
            : '新设备已加入，进度已同步';
      });
      return;
    }
    setState(() {});
  }

  void _startCountdown() {
    _countdownTimer?.cancel();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {});
    });
  }

  Future<void> _handleGenerateCode() async {
    setState(() {
      _busy = true;
      _localError = null;
      _bannerNotice = null;
    });
    try {
      await widget.engine.generatePairingCode();
      if (!mounted) return;
      _startCountdown();
      setState(() {
        _busy = false;
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
    if (scanner == null) return;
    setState(() {
      _localError = null;
      _bannerNotice = null;
    });
    final scanned = await scanner(context);
    if (!mounted || scanned == null || scanned.trim().isEmpty) return;
    await _submitPairingInput(scanned);
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
        _mode = _ModalViewMode.overview;
        _codeInputController.clear();
        _bannerNotice = '已加入同步组，多端进度已合并';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _localError = widget.engine.errorMessage ?? '连接失败，请核对 8 位配对码';
      });
    }
  }

  Future<void> _handleSyncNow() async {
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

  Future<void> _confirmAndLeave() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        final t = widget.tokens;
        return AlertDialog(
          backgroundColor: t.dialogBg,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: BorderSide(color: t.dialogBorder),
          ),
          title: Text(
            '退出同步组',
            style: TextStyle(color: t.textPrimary, fontWeight: FontWeight.w800),
          ),
          content: Text(
            '仅解除多端同步关系，本机已学进度不会丢失。确认退出？',
            style: TextStyle(color: t.textSecondary, fontSize: 13.5),
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
        );
      },
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    await widget.engine.leaveGroup();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _mode = _ModalViewMode.overview;
      _bannerNotice = widget.engine.statusMessage;
    });
  }

  Future<void> _showRenameDialog() async {
    final t = widget.tokens;
    final ctrl = TextEditingController(text: widget.engine.deviceName);
    final updatedName = await showDialog<String>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: t.dialogBg,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: BorderSide(color: t.dialogBorder),
          ),
          title: Text(
            '重命名本机',
            style: TextStyle(color: t.textPrimary, fontWeight: FontWeight.w800),
          ),
          content: TextField(
            controller: ctrl,
            maxLength: 32,
            style: TextStyle(color: t.textPrimary),
            decoration: InputDecoration(
              hintText: '例如：我的移动设备 / 桌面浏览器',
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
        );
      },
    );
    ctrl.dispose();
    if (updatedName == null || updatedName.isEmpty || !mounted) return;
    await widget.engine.renameCurrentDevice(updatedName);
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

  @override
  Widget build(BuildContext context) {
    final t = widget.tokens;
    final media = MediaQuery.of(context);
    final size = media.size;
    final engine = widget.engine;
    final peerDevice = engine.devices.cast<SyncDeviceSummary?>().firstWhere(
          (d) => d != null && !d.isCurrent,
          orElse: () => null,
        );

    return Center(
      child: Material(
        color: Colors.transparent,
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: 420,
            maxHeight: size.height * 0.90,
          ),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: t.dialogBg,
              borderRadius: BorderRadius.circular(26),
              border: Border.all(color: t.dialogBorder),
              boxShadow: [
                BoxShadow(
                  color: t.isDark
                      ? const Color(0x99000000)
                      : const Color(0x28141413),
                  blurRadius: 32,
                  offset: const Offset(0, 14),
                ),
              ],
            ),
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(
                20,
                18,
                20,
                20 + media.viewInsets.bottom,
              ),
              child: Column(
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
                              '多端学习进度同步',
                              style: TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w800,
                                letterSpacing: -0.3,
                                color: t.textPrimary,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '无需注册账号，设备配对后自动互通已学课程与播放断点。',
                              style: TextStyle(
                                fontSize: 12.5,
                                height: 1.45,
                                color: t.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      InkWell(
                        key: const ValueKey('sync_modal_close_btn'),
                        onTap: () => Navigator.of(context).pop(),
                        borderRadius: BorderRadius.circular(16),
                        child: Container(
                          width: 32,
                          height: 32,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: t.cardFill,
                            border: Border.all(color: t.border),
                          ),
                          child: Icon(
                            Icons.close_rounded,
                            size: 18,
                            color: t.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),

                  SyncBeamHero(
                    tokens: t,
                    completedCount: widget.completedCount,
                    totalCount: widget.totalCount,
                    deviceCount: engine.devices.length,
                    syncStatus: engine.status,
                    localPlatform: engine.platform,
                    localDeviceName: engine.deviceName,
                    peerPlatform: peerDevice?.platform,
                    peerLabel: peerDevice?.deviceName ??
                        (engine.devices.length > 1
                            ? '${engine.devices.length - 1} 台对端'
                            : null),
                    waitingForPeer: _mode == _ModalViewMode.showCode,
                  ),
                  const SizedBox(height: 14),

                  if (_bannerNotice != null && _bannerNotice!.isNotEmpty)
                    _BannerBox(
                      text: _bannerNotice!,
                      color: t.accentSoft,
                      borderColor: t.accent,
                      textColor: t.textPrimary,
                    ),
                  if (_localError != null && _localError!.isNotEmpty)
                    _BannerBox(
                      text: _localError!,
                      color: t.warning.withValues(alpha: 0.14),
                      borderColor: t.warning,
                      textColor: t.textPrimary,
                    ),
                  if (_localError == null &&
                      engine.status == SyncStatus.revoked &&
                      engine.statusMessage != null)
                    _BannerBox(
                      text: engine.statusMessage!,
                      color: t.warning.withValues(alpha: 0.14),
                      borderColor: t.warning,
                      textColor: t.textPrimary,
                    ),

                  if (!engine.isConfigured)
                    _BannerBox(
                      text: '当前构建未配置同步服务端地址，暂以单机离线模式运行。',
                      color: t.surfaceInset,
                      borderColor: t.border,
                      textColor: t.textSecondary,
                    ),

                  if (_mode == _ModalViewMode.showCode)
                    _buildShowCodeBody(t)
                  else if (_mode == _ModalViewMode.enterCode)
                    _buildEnterCodeBody(t)
                  else if (engine.isLinked)
                    _buildLinkedOverviewBody(t)
                  else
                    _buildUnlinkedOverviewBody(t),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildBackRow(SyncPaletteTokens t, String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          InkWell(
            key: const ValueKey('sync_modal_back_btn'),
            onTap: _busy
                ? null
                : () {
                    _countdownTimer?.cancel();
                    widget.engine.stopPairingPoll();
                    setState(() {
                      _mode = _ModalViewMode.overview;
                      _localError = null;
                    });
                  },
            borderRadius: BorderRadius.circular(999),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
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
          Text(
            title,
            style: TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w700,
              color: t.textPrimary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildUnlinkedOverviewBody(SyncPaletteTokens t) {
    final canScan = !syncIsWeb && widget.onScanQr != null;
    final configured = widget.engine.isConfigured;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ActionCard(
          key: const ValueKey('sync_generate_code_btn'),
          tokens: t,
          isPrimary: true,
          loading: _busy,
          icon: Icons.qr_code_2_rounded,
          title: '让其他设备连接我',
          description: '生成二维码与 8 位配对码，给另一台设备扫一扫或输入即可',
          onTap: configured && !_busy ? _handleGenerateCode : null,
        ),
        const SizedBox(height: 10),
        _ActionCard(
          key: const ValueKey('sync_enter_code_btn'),
          tokens: t,
          isPrimary: false,
          icon: canScan
              ? Icons.qr_code_scanner_rounded
              : Icons.keyboard_alt_outlined,
          title: canScan ? '我来扫码 / 输入配对码' : '输入配对码加入',
          description: canScan
              ? '可直接打开相机扫码，或输入另一台设备显示的 8 位配对码'
              : '输入另一台设备上显示的 8 位配对码即可完成连接',
          onTap: configured && !_busy
              ? () => setState(() {
                    _localError = null;
                    _mode = _ModalViewMode.enterCode;
                  })
              : null,
        ),
      ],
    );
  }

  Widget _buildShowCodeBody(SyncPaletteTokens t) {
    final ticket = widget.engine.activeTicket;
    if (ticket == null) {
      return const SizedBox.shrink();
    }

    final remainingMs =
        ticket.expiresAtMs - DateTime.now().millisecondsSinceEpoch;
    final expired = remainingMs <= 0 ||
        widget.engine.lastPairingStatus?.status == 'expired';
    final remSec = (remainingMs / 1000).ceil().clamp(0, 300);
    final mm = (remSec ~/ 60).toString().padLeft(2, '0');
    final ss = (remSec % 60).toString().padLeft(2, '0');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildBackRow(t, '让其他设备连接我'),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: t.cardFill,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: t.border),
          ),
          child: Column(
            children: [
              SyncQrCodeWidget(
                key: const ValueKey('sync_pairing_qr_widget'),
                payload: ticket.qrPayload,
                tokens: t,
                size: 148,
              ),
              const SizedBox(height: 12),
              Text(
                expired
                    ? '配对码已过期，请重新生成'
                    : '或手动输入 8 位配对码（剩余 $mm:$ss）',
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: expired ? t.warning : t.textSecondary,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(height: 4),
              Text(
                ticket.displayCode,
                key: const ValueKey('sync_display_pairing_code'),
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 3.0,
                  color: t.textPrimary,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                key: const ValueKey('sync_copy_code_btn'),
                onPressed: () {
                  unawaited(
                    Clipboard.setData(ClipboardData(text: ticket.displayCode)),
                  );
                  setState(() => _bannerNotice = '已复制配对码 ${ticket.displayCode}');
                },
                style: OutlinedButton.styleFrom(
                  foregroundColor: t.textPrimary,
                  backgroundColor: t.surfaceInset,
                  side: BorderSide(color: t.border),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(999),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 6,
                  ),
                ),
                icon: Icon(Icons.copy_rounded, size: 15, color: t.accent),
                label: const Text(
                  '复制配对码',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ),
              if (expired) ...[
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
              const SizedBox(height: 14),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
                decoration: BoxDecoration(
                  color: t.surfaceInset,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '第 1 步：在另一台设备上打开 EnglishPod，点右上角进度胶囊',
                      style: TextStyle(
                        fontSize: 12,
                        height: 1.5,
                        color: t.textSecondary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '第 2 步：选择「我来扫码 / 输入配对码」，扫描上方二维码或输入配对码',
                      style: TextStyle(
                        fontSize: 12,
                        height: 1.5,
                        color: t.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildEnterCodeBody(SyncPaletteTokens t) {
    final canScan = !syncIsWeb && widget.onScanQr != null;
    final cleanCode = _codeInputController.text.replaceAll('-', '');
    final codeReady = cleanCode.length == 8;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildBackRow(t, '加入已有同步组'),
        if (canScan) ...[
          _PrimaryButton(
            key: const ValueKey('sync_scan_qr_btn'),
            label: '打开相机扫码配对（推荐）',
            icon: Icons.qr_code_scanner_rounded,
            tokens: t,
            loading: _busy,
            onPressed: _busy ? null : _handleScanQr,
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: Divider(color: t.border, height: 1)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                child: Text(
                  '或者手动输入 8 位配对码',
                  style: TextStyle(fontSize: 11.5, color: t.textSecondary),
                ),
              ),
              Expanded(child: Divider(color: t.border, height: 1)),
            ],
          ),
          const SizedBox(height: 12),
        ] else ...[
          Text(
            '请输入另一台设备上显示的 8 位配对码：',
            style: TextStyle(fontSize: 12, color: t.textSecondary),
          ),
          const SizedBox(height: 10),
        ],
        Row(
          children: [
            Expanded(
              child: TextField(
                key: const ValueKey('sync_code_text_field'),
                controller: _codeInputController,
                onChanged: _onCodeInputChanged,
                textCapitalization: TextCapitalization.characters,
                autocorrect: false,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 2.2,
                  color: t.textPrimary,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
                textAlign: TextAlign.center,
                decoration: InputDecoration(
                  hintText: 'XXXX-XXXX',
                  hintStyle: TextStyle(color: t.textMuted),
                  filled: true,
                  fillColor: t.cardFill,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 12,
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(color: t.border, width: 1.4),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(color: t.accent, width: 1.5),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                key: const ValueKey('sync_submit_claim_btn'),
                onPressed: _busy
                    ? null
                    : () => _submitPairingInput(_codeInputController.text),
                style: ElevatedButton.styleFrom(
                  backgroundColor: codeReady ? t.accent : t.surfaceInset,
                  foregroundColor: codeReady ? t.accentFg : t.textPrimary,
                  elevation: 0,
                  padding: const EdgeInsets.symmetric(horizontal: 18),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: codeReady
                        ? BorderSide.none
                        : BorderSide(color: t.border),
                  ),
                ),
                child: const Text(
                  '配对',
                  style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          '配对后将自动合并两台设备的学习记录与播放断点，不会覆盖已学完的课程。',
          style: TextStyle(
            fontSize: 11.5,
            height: 1.5,
            color: t.textSecondary,
          ),
        ),
      ],
    );
  }

  Widget _buildLinkedOverviewBody(SyncPaletteTokens t) {
    final engine = widget.engine;
    final lastSyncedLabel = _formatRelativeTime(engine.lastSyncedAtMs);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              '已连接设备 (${engine.devices.length})',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: t.textPrimary,
              ),
            ),
            Text(
              lastSyncedLabel,
              style: TextStyle(fontSize: 11.5, color: t.textSecondary),
            ),
          ],
        ),
        const SizedBox(height: 8),
        for (final dev in engine.devices)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: t.cardFill,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color:
                    dev.isCurrent ? t.accent.withValues(alpha: 0.45) : t.border,
              ),
            ),
            child: Row(
              children: [
                Icon(
                  _platformIcon(dev.platform),
                  size: 18,
                  color: dev.isCurrent ? t.accent : t.textSecondary,
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
                                horizontal: 7,
                                vertical: 2,
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
                      const SizedBox(height: 2),
                      Text(
                        '${_platformLabel(dev.platform)} · ${_formatRelativeTime(dev.lastSeenAtMs)}',
                        style: TextStyle(fontSize: 11.5, color: t.textSecondary),
                      ),
                    ],
                  ),
                ),
                if (dev.isCurrent)
                  IconButton(
                    key: const ValueKey('sync_rename_self_btn'),
                    tooltip: '重命名本机',
                    icon: Icon(
                      Icons.edit_outlined,
                      size: 17,
                      color: t.textSecondary,
                    ),
                    onPressed: _busy ? null : _showRenameDialog,
                  )
                else
                  IconButton(
                    key: ValueKey('sync_revoke_${dev.deviceId}'),
                    tooltip: '移除设备',
                    icon: Icon(
                      Icons.remove_circle_outline_rounded,
                      size: 18,
                      color: t.textSecondary,
                    ),
                    onPressed: _busy
                        ? null
                        : () => widget.engine.revokeDevice(dev.deviceId),
                  ),
              ],
            ),
          ),
        const SizedBox(height: 6),
        Row(
          children: [
            Expanded(
              child: _PrimaryButton(
                key: const ValueKey('sync_add_device_btn'),
                label: '+ 添加新设备',
                icon: Icons.qr_code_2_rounded,
                tokens: t,
                loading: _busy,
                onPressed: !_busy ? _handleGenerateCode : null,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _SecondaryButton(
                key: const ValueKey('sync_now_btn'),
                label: '立即同步',
                icon: Icons.sync_rounded,
                tokens: t,
                onPressed: !_busy ? _handleSyncNow : null,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        TextButton(
          key: const ValueKey('sync_leave_group_btn'),
          onPressed: !_busy ? _confirmAndLeave : null,
          child: Text(
            '退出同步组',
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: t.warning,
            ),
          ),
        ),
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

class _ActionCard extends StatelessWidget {
  final SyncPaletteTokens tokens;
  final bool isPrimary;
  final bool loading;
  final IconData icon;
  final String title;
  final String description;
  final VoidCallback? onTap;

  const _ActionCard({
    super.key,
    required this.tokens,
    required this.isPrimary,
    this.loading = false,
    required this.icon,
    required this.title,
    required this.description,
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
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: isPrimary ? t.accent : t.border,
              width: 1.4,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: isPrimary ? t.accent : t.surfaceInset,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: loading && isPrimary
                    ? Center(
                        child: SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: t.accentFg,
                          ),
                        ),
                      )
                    : Icon(
                        icon,
                        size: 20,
                        color: isPrimary ? t.accentFg : t.accent,
                      ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w800,
                        color: t.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      description,
                      style: TextStyle(
                        fontSize: 12,
                        height: 1.4,
                        color: t.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '›',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
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

class _BannerBox extends StatelessWidget {
  final String text;
  final Color color;
  final Color borderColor;
  final Color textColor;

  const _BannerBox({
    required this.text,
    required this.color,
    required this.borderColor,
    required this.textColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderColor.withValues(alpha: 0.45)),
      ),
      child: Text(
        text,
        style: TextStyle(fontSize: 12, color: textColor),
      ),
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final SyncPaletteTokens tokens;
  final bool loading;
  final VoidCallback? onPressed;

  const _PrimaryButton({
    super.key,
    required this.label,
    required this.icon,
    required this.tokens,
    this.loading = false,
    this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return ElevatedButton.icon(
      onPressed: onPressed,
      style: ElevatedButton.styleFrom(
        backgroundColor: tokens.accent,
        foregroundColor: tokens.accentFg,
        disabledBackgroundColor: tokens.accent.withValues(alpha: 0.35),
        disabledForegroundColor: tokens.accentFg.withValues(alpha: 0.65),
        minimumSize: const Size.fromHeight(44),
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
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
        style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _SecondaryButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final SyncPaletteTokens tokens;
  final VoidCallback? onPressed;

  const _SecondaryButton({
    super.key,
    required this.label,
    required this.icon,
    required this.tokens,
    this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: tokens.textPrimary,
        backgroundColor: tokens.surfaceInset,
        side: BorderSide(color: tokens.border),
        minimumSize: const Size.fromHeight(44),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      icon: Icon(icon, size: 18),
      label: Text(
        label,
        style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
      ),
    );
  }
}

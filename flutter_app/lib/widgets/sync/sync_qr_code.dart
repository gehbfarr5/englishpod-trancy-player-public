import 'package:flutter/material.dart';
import 'package:qr/qr.dart';

import 'sync_theme.dart';

/// Pure-Dart cached QR code widget with an enforced high-contrast light quiet zone
/// and single-Path painting inside a RepaintBoundary for 120fps HarmonyOS/Web rendering.
class SyncQrCodeWidget extends StatefulWidget {
  final String payload;
  final SyncPaletteTokens tokens;
  final double size;

  const SyncQrCodeWidget({
    super.key,
    required this.payload,
    required this.tokens,
    this.size = 152,
  });

  @override
  State<SyncQrCodeWidget> createState() => _SyncQrCodeWidgetState();
}

class _SyncQrCodeWidgetState extends State<SyncQrCodeWidget> {
  late String _cachedPayload;
  late QrImage _cachedQrImage;

  @override
  void initState() {
    super.initState();
    _rebuildQr(widget.payload);
  }

  @override
  void didUpdateWidget(covariant SyncQrCodeWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.payload != widget.payload) {
      _rebuildQr(widget.payload);
    }
  }

  void _rebuildQr(String payload) {
    _cachedPayload = payload;
    final qrCode = QrCode.fromData(
      data: payload,
      errorCorrectLevel: QrErrorCorrectLevel.M,
    );
    _cachedQrImage = QrImage(qrCode);
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.tokens;
    return RepaintBoundary(
      child: Container(
        width: widget.size,
        height: widget.size,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: t.qrBg,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: t.isDark
                ? const Color(0x33FFFFFF)
                : const Color(0x1F141413),
          ),
        ),
        child: CustomPaint(
          isComplex: true,
          willChange: false,
          painter: _QrMatrixPainter(
            payload: _cachedPayload,
            qrImage: _cachedQrImage,
            foreground: t.qrFg,
          ),
        ),
      ),
    );
  }
}

class _QrMatrixPainter extends CustomPainter {
  final String payload;
  final QrImage qrImage;
  final Color foreground;

  const _QrMatrixPainter({
    required this.payload,
    required this.qrImage,
    required this.foreground,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final count = qrImage.moduleCount;
    if (count <= 0) return;

    final moduleSize = size.width / count;
    final path = Path();
    for (var row = 0; row < count; row++) {
      final top = row * moduleSize;
      for (var col = 0; col < count; col++) {
        if (!qrImage.isDark(row, col)) continue;
        path.addRect(
          Rect.fromLTWH(
            col * moduleSize,
            top,
            moduleSize + 0.3,
            moduleSize + 0.3,
          ),
        );
      }
    }

    canvas.drawPath(
      path,
      Paint()
        ..color = foreground
        ..style = PaintingStyle.fill
        ..isAntiAlias = false,
    );
  }

  @override
  bool shouldRepaint(covariant _QrMatrixPainter oldDelegate) =>
      oldDelegate.payload != payload || oldDelegate.foreground != foreground;
}

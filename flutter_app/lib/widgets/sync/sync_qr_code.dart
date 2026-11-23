import 'package:flutter/material.dart';
import 'package:qr/qr.dart';

import 'sync_theme.dart';

/// Pure-Dart QR code widget with an enforced light quiet zone for Dark & Paper themes.
class SyncQrCodeWidget extends StatelessWidget {
  final String payload;
  final SyncPaletteTokens tokens;
  final double size;

  const SyncQrCodeWidget({
    super.key,
    required this.payload,
    required this.tokens,
    this.size = 156,
  });

  @override
  Widget build(BuildContext context) {
    final qrCode = QrCode.fromData(
      data: payload,
      errorCorrectLevel: QrErrorCorrectLevel.M,
    );
    final qrImage = QrImage(qrCode);

    return Container(
      width: size,
      height: size,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tokens.qrBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: tokens.isDark
              ? const Color(0x33FFFFFF)
              : const Color(0x1F141413),
        ),
        boxShadow: [
          BoxShadow(
            color: tokens.isDark
                ? const Color(0x40000000)
                : const Color(0x12141413),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: CustomPaint(
        painter: _QrMatrixPainter(
          qrImage: qrImage,
          foreground: tokens.qrFg,
        ),
      ),
    );
  }
}

class _QrMatrixPainter extends CustomPainter {
  final QrImage qrImage;
  final Color foreground;

  const _QrMatrixPainter({
    required this.qrImage,
    required this.foreground,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final count = qrImage.moduleCount;
    if (count <= 0) return;

    final moduleSize = size.width / count;
    final paint = Paint()
      ..color = foreground
      ..style = PaintingStyle.fill;

    for (var row = 0; row < count; row++) {
      for (var col = 0; col < count; col++) {
        if (!qrImage.isDark(row, col)) continue;
        final rect = Rect.fromLTWH(
          col * moduleSize,
          row * moduleSize,
          moduleSize + 0.35,
          moduleSize + 0.35,
        );
        canvas.drawRRect(
          RRect.fromRectAndRadius(rect, Radius.circular(moduleSize * 0.18)),
          paint,
        );
      }
    }
  }

  @override
  bool shouldRepaint(covariant _QrMatrixPainter oldDelegate) =>
      oldDelegate.qrImage != qrImage || oldDelegate.foreground != foreground;
}

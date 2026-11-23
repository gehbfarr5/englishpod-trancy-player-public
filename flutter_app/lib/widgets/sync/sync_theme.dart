import 'package:flutter/material.dart';

/// Dual-theme tokens derived directly from EnglishPod's AppPalette
/// (Spotify Dark Cocoon & Claude Warm Parchment), per EP-SYNC-001 §8.2.
class SyncPaletteTokens {
  final bool isDark;
  final Color scrimColor;
  final Color dialogBg;
  final Color dialogBorder;
  final Color folderBackFill;
  final Color folderBackInnerGlow;
  final Color cardFill;
  final Color cardBorder;
  final Color cardSkeletonLine;
  final Color flapFill;
  final Color flapStroke;
  final Color surfaceInset;
  final Color border;
  final Color textPrimary;
  final Color textSecondary;
  final Color textMuted;
  final Color accent;
  final Color accentFg;
  final Color accentSoft;
  final Color warning;
  final Color qrBg;
  final Color qrFg;

  const SyncPaletteTokens({
    required this.isDark,
    required this.scrimColor,
    required this.dialogBg,
    required this.dialogBorder,
    required this.folderBackFill,
    required this.folderBackInnerGlow,
    required this.cardFill,
    required this.cardBorder,
    required this.cardSkeletonLine,
    required this.flapFill,
    required this.flapStroke,
    required this.surfaceInset,
    required this.border,
    required this.textPrimary,
    required this.textSecondary,
    required this.textMuted,
    required this.accent,
    required this.accentFg,
    required this.accentSoft,
    required this.warning,
    required this.qrBg,
    required this.qrFg,
  });

  factory SyncPaletteTokens.fromColors({
    required bool isDark,
    required Color bgWell,
    required Color deckBg,
    required Color deckBorder,
    required Color surface1,
    required Color surface2,
    required Color surface3,
    required Color surfaceInset,
    required Color border,
    required Color metroOutline,
    required Color textPrimary,
    required Color textPassed,
    required Color textUpcoming,
    required Color accent,
    required Color accentFg,
    required Color accentSoft,
  }) {
    return SyncPaletteTokens(
      isDark: isDark,
      scrimColor: isDark
          ? bgWell.withValues(alpha: 0.72)
          : const Color(0x5C141413),
      dialogBg: deckBg,
      dialogBorder: deckBorder,
      folderBackFill: isDark ? surface1 : surface2,
      folderBackInnerGlow:
          isDark ? const Color(0x14FFFFFF) : const Color(0x59FFFFFF),
      cardFill: isDark ? surface3 : surface1,
      cardBorder: isDark ? const Color(0x26FFFFFF) : border,
      cardSkeletonLine: isDark ? const Color(0x2EFFFFFF) : surface3,
      flapFill: isDark
          ? surface2.withValues(alpha: 0.78)
          : deckBg.withValues(alpha: 0.82),
      flapStroke: metroOutline,
      surfaceInset: surfaceInset,
      border: border,
      textPrimary: textPrimary,
      textSecondary: textPassed,
      textMuted: textUpcoming,
      accent: accent,
      accentFg: accentFg,
      accentSoft: accentSoft,
      warning: isDark ? const Color(0xFFF5B041) : const Color(0xFFD97706),
      // High-contrast light quiet zone ALWAYS preserved for reliable QR scanning.
      qrBg: const Color(0xFFFAF8F5),
      qrFg: const Color(0xFF141413),
    );
  }
}

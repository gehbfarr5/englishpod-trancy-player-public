export type BreakpointMode = 'portrait_wide' | 'landscape_workbench';

/**
 * System-Adaptive Dual Theme Palette (Dark Cocoon & Claude Paper)
 * Exact color parity with iOS 1.0.2+3 AppPalette + HarmonyOS 7.0 UIMaterial glass tokens.
 */
export interface AppPalette {
  isDark: boolean;
  bgWell: string;
  deckBg: string;
  deckGradStart: string;
  deckGradMid: string;
  deckGradEnd: string;
  deckBorder: string;
  bottomBg: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surfaceInset: string;
  stageBoxBg: string;
  stageBoxBorder: string;
  border: string;
  metroOutline: string;
  metroBtnBg: string;
  textPrimary: string;
  textPassed: string;
  textUpcoming: string;
  accent: string;
  accentFg: string;
  accentSoft: string;
  vocabHlUnplayed: string;
  vocabHlPassed: string;
  vocabHlActive: string;
  locateBarBg: string;
  locateBarBorder: string;
  scrollbarThumb: string;
  glassBg: string;
  glassBorder: string;
}

export const DARK_PALETTE: AppPalette = {
  isDark: true,
  bgWell: '#070709',
  deckBg: '#13151C',
  deckGradStart: '#1A2E24',
  deckGradMid: '#141720',
  deckGradEnd: '#121318',
  deckBorder: '#1FFFFFFF',
  bottomBg: '#FA0A0B0F',
  surface1: '#14151B',
  surface2: '#1F2029',
  surface3: '#282A36',
  surfaceInset: '#0EFFFFFF',
  stageBoxBg: '#0CFFFFFF',
  stageBoxBorder: '#1CFFFFFF',
  border: '#14FFFFFF',
  metroOutline: '#26FFFFFF',
  metroBtnBg: '#08FFFFFF',
  textPrimary: '#FFFFFF',
  textPassed: '#73FFFFFF',
  textUpcoming: '#38FFFFFF',
  accent: '#1ED760',
  accentFg: '#060608',
  accentSoft: '#291ED760',
  vocabHlUnplayed: '#801ED760',
  vocabHlPassed: '#BF1ED760',
  vocabHlActive: '#1ED760',
  locateBarBg: '#F714261C',
  locateBarBorder: '#731ED760',
  scrollbarThumb: '#2EFFFFFF',
  glassBg: '#B813151C',
  glassBorder: '#24FFFFFF'
};

export const PAPER_PALETTE: AppPalette = {
  isDark: false,
  bgWell: '#F2EDE2',
  deckBg: '#FAF8F5',
  deckGradStart: '#F5E3DC',
  deckGradMid: '#FCF9F4',
  deckGradEnd: '#FAF8F5',
  deckBorder: '#1A141413',
  bottomBg: '#FAFAF8F5',
  surface1: '#FAF8F5',
  surface2: '#E6E0D4',
  surface3: '#DAD2C3',
  surfaceInset: '#0A141413',
  stageBoxBg: '#E9E2D4',
  stageBoxBorder: '#40CC785C',
  border: '#14141413',
  metroOutline: '#29141413',
  metroBtnBg: '#08141413',
  textPrimary: '#141413',
  textPassed: '#7A141413',
  textUpcoming: '#3D141413',
  accent: '#CC785C',
  accentFg: '#FFFFFF',
  accentSoft: '#26CC785C',
  vocabHlUnplayed: '#8CCC785C',
  vocabHlPassed: '#CCCC785C',
  vocabHlActive: '#CC785C',
  locateBarBg: '#F7F7EBE6',
  locateBarBorder: '#73CC785C',
  scrollbarThumb: '#2E141413',
  glassBg: '#C4FAF8F5',
  glassBorder: '#1A141413'
};

/**
 * HUAWEI Pura X View (VOL-AL00) 16:9.5 Wide-Bar Layout Metrics.
 * - Portrait: ~440 x 744 vp (1320 x 2232 px)
 * - Landscape: ~744 x 440 vp (2232 x 1320 px)
 * - 1.05mm ultra-narrow bezel edge guard: >= 12 vp
 */
export class PuraXMetrics {
  static readonly EDGE_GUARD_VP: number = 14;
  static readonly PORTRAIT_MAX_READ_WIDTH_VP: number = 396;
  static readonly LANDSCAPE_LEFT_CONSOLE_PCT: string = '37%';
  static readonly LANDSCAPE_VOCAB_DRAWER_WIDTH_VP: number = 216;
  static readonly SQUIRCLE_CARD_RADIUS: number = 22;
  static readonly SQUIRCLE_GRID_RADIUS: number = 18;
  static readonly HOLD_TO_REPLAY_MS: number = 650;

  static resolveMode(widthVp: number, heightVp: number): BreakpointMode {
    return widthVp > heightVp ? 'landscape_workbench' : 'portrait_wide';
  }
}

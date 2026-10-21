/**
 * ============================================================================
 *  主题令牌（core/themeTokens.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  把 Flutter 原版 `AppPalette`（main.dart 第 46 行起）与 `_M3Motion`（第 243 行起）
 *  抽取为**平台无关**的设计令牌，作为全项目「颜色 / 尺寸 / 字号 / 字重 / 间距 / 动效」
 *  的唯一事实来源（Single Source of Truth）。
 *
 *  用途：
 *   1. JS/TS 侧运行时需要具体色值/时长时（如 Canvas、动画控制器）从此处取；
 *   2. 校验脚本据此核对 `theme.json` 是否覆盖了全部主题色变量；
 *   3. 禁止在 WXML / WXSS / 页面逻辑里再散落魔法色值或尺寸——一律引用此处令牌
 *      或其在 `theme.json` / `app.wxss` 中导出的 CSS 变量。
 *
 *  双主题：`dark`（Spotify Dark Cocoon）与 `paper`（Claude Warm Parchment）。
 * ============================================================================
 */

/** 主题模式：`dark` 深色 / `paper` 纸感浅色。 */
export type ThemeMode = 'dark' | 'paper';

/**
 * 主题色令牌集合。
 *
 * 字段命名与 Flutter `AppPalette` 一一对应，便于日后与源项目对齐/迁移。
 * 所有含透明度的颜色统一用 `rgba(...)` 表示（WXSS 对 rgba 支持最稳）。
 */
export interface ThemeColors {
  /** 页面内凹背景（滚动区底色）。 */
  bgWell: string;
  /** 顶部钉住区背景（渐变兜底色）。 */
  deckBg: string;
  /** 顶区径向渐变起始色。 */
  deckGradientTop: string;
  /** 顶区径向渐变中间色。 */
  deckGradientMid: string;
  /** 顶区径向渐变结束色。 */
  deckGradientBottom: string;
  /** 顶区描边。 */
  deckBorder: string;
  /** 顶区投影（`0 8px 24px <deckShadow>`）。 */
  deckShadow: string;
  /** 底部控件区底色。 */
  bottomBg: string;
  /** 一级表面（卡片）。 */
  surface1: string;
  /** 二级表面。 */
  surface2: string;
  /** 三级表面。 */
  surface3: string;
  /** 内嵌表面（筛选胶囊底、完成度 pill 底）。 */
  surfaceInset: string;
  /** 舞台容器盒背景。 */
  stageBoxBg: string;
  /** 舞台容器盒描边。 */
  stageBoxBorder: string;
  /** 通用描边（细分隔线）。 */
  border: string;
  /** 更强描边（Metrolist 风格控件轮廓）。 */
  metroOutline: string;
  /** Metrolist 风格按钮底。 */
  metroBtnBg: string;
  /** 主文本。 */
  textPrimary: string;
  /** 已读/次要文本。 */
  textPassed: string;
  /** 未读/极淡文本。 */
  textUpcoming: string;
  /** 强调色（Signal Green / Warm Terracotta）。 */
  accent: string;
  /** 强调色上的前景色。 */
  accentFg: string;
  /** 强调色柔和底（accent 约 15%）。 */
  accentSoft: string;
  /** 词汇高亮·未播放。 */
  vocabHlUnplayed: string;
  /** 词汇高亮·已播放。 */
  vocabHlPassed: string;
  /** 词汇高亮·当前。 */
  vocabHlActive: string;
  /** 定位条背景。 */
  locateBarBg: string;
  /** 定位条描边。 */
  locateBarBorder: string;
  /** 滚动条滑块。 */
  scrollbarThumb: string;
}

/** 深色主题（Spotify Dark Cocoon）。 */
export const DARK_COLORS: ThemeColors = {
  bgWell: '#070709',
  deckBg: '#13151C',
  deckGradientTop: '#1A2E24',
  deckGradientMid: '#141720',
  deckGradientBottom: '#121318',
  deckBorder: 'rgba(255,255,255,0.122)',
  deckShadow: 'rgba(0,0,0,0.45)',
  bottomBg: 'rgba(10,11,15,0.98)',
  surface1: '#14151B',
  surface2: '#1F2029',
  surface3: '#282A36',
  surfaceInset: 'rgba(255,255,255,0.055)',
  stageBoxBg: 'rgba(255,255,255,0.047)',
  stageBoxBorder: 'rgba(255,255,255,0.110)',
  border: 'rgba(255,255,255,0.078)',
  metroOutline: 'rgba(255,255,255,0.149)',
  metroBtnBg: 'rgba(255,255,255,0.031)',
  textPrimary: '#FFFFFF',
  textPassed: 'rgba(255,255,255,0.451)',
  textUpcoming: 'rgba(255,255,255,0.220)',
  accent: '#1ED760',
  accentFg: '#060608',
  accentSoft: 'rgba(30,215,96,0.161)',
  vocabHlUnplayed: 'rgba(30,215,96,0.502)',
  vocabHlPassed: 'rgba(30,215,96,0.749)',
  vocabHlActive: '#1ED760',
  locateBarBg: 'rgba(20,38,28,0.969)',
  locateBarBorder: 'rgba(30,215,96,0.451)',
  scrollbarThumb: 'rgba(255,255,255,0.180)',
};

/** 纸感浅色主题（Claude Warm Parchment）。 */
export const PAPER_COLORS: ThemeColors = {
  bgWell: '#F2EDE2',
  deckBg: '#FAF8F5',
  deckGradientTop: '#F5E3DC',
  deckGradientMid: '#FCF9F4',
  deckGradientBottom: '#FAF8F5',
  deckBorder: 'rgba(20,20,19,0.102)',
  deckShadow: 'rgba(120,92,60,0.16)',
  bottomBg: 'rgba(250,248,245,0.98)',
  surface1: '#FAF8F5',
  surface2: '#E6E0D4',
  surface3: '#DAD2C3',
  surfaceInset: 'rgba(20,20,19,0.039)',
  stageBoxBg: '#E9E2D4',
  stageBoxBorder: 'rgba(204,120,92,0.251)',
  border: 'rgba(20,20,19,0.078)',
  metroOutline: 'rgba(20,20,19,0.161)',
  metroBtnBg: 'rgba(20,20,19,0.031)',
  textPrimary: '#141413',
  textPassed: 'rgba(20,20,19,0.478)',
  textUpcoming: 'rgba(20,20,19,0.239)',
  accent: '#CC785C',
  accentFg: '#FFFFFF',
  accentSoft: 'rgba(204,120,92,0.149)',
  vocabHlUnplayed: 'rgba(204,120,92,0.549)',
  vocabHlPassed: 'rgba(204,120,92,0.800)',
  vocabHlActive: '#CC785C',
  locateBarBg: 'rgba(247,235,230,0.969)',
  locateBarBorder: 'rgba(204,120,92,0.451)',
  scrollbarThumb: 'rgba(20,20,19,0.180)',
};

/** 按主题模式取色板。 */
export function themeColorsFor(mode: ThemeMode): ThemeColors {
  return mode === 'dark' ? DARK_COLORS : PAPER_COLORS;
}

/**
 * 圆角令牌（单位 px，对齐 Flutter 的 dp）。
 *
 * WXSS 中对应 `app.wxss` 的 `--ep-radius-*` 变量。
 */
export const RADIUS = {
  /** 顶区底部圆角 `0 0 26px 26px`。 */
  deckBottom: 26,
  /** 胶囊（筛选 pill / 完成度 pill / 状态 pill）。 */
  pill: 9999,
  /** 课程卡片。 */
  card: 20,
  /** 次级小圆角（角标、进度条轨道）。 */
  chip: 12,
  /** 进度条轨道/填充。 */
  progressBar: 3,
} as const;

/**
 * 字号令牌（单位 px）。
 *
 * WXSS 中对应 `app.wxss` 的 `--ep-font-*` 变量。
 */
export const FONT_SIZE = {
  /** 品牌名（`EnglishPod 精听`，实际文案以 config/env.ts 的 APP_DISPLAY_NAME 为准）。 */
  brand: 22,
  /** 品牌副标题 `Elementary · 30 Lessons`。 */
  brandSub: 11.5,
  /** 完成度 pill 文本。 */
  completionPill: 11.5,
  /** 微标题（`COURSE LIST` / `SCROLL TO BROWSE ↓`）。 */
  sectionMicro: 10.5,
  /** 课程卡片标题。 */
  cardTitle: 15.5,
  /** 课程卡片序号。 */
  cardIndex: 13,
  /** 课程卡片 level。 */
  cardLevel: 11.5,
  /** 课程卡片完成度角标。 */
  cardStatus: 11.5,
  /** 继续收听·标题。 */
  continueTitle: 15,
  /** 继续收听·实时句。 */
  continueSentence: 12.5,
  /** 继续收听·徽章。 */
  continueBadge: 9.5,
} as const;

/** 字重令牌（对齐 Flutter `FontWeight`）。 */
export const FONT_WEIGHT = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  heavy: 800,
} as const;

/**
 * 间距令牌（单位 px）。
 *
 * WXSS 中对应 `app.wxss` 的 `--ep-space-*` 变量。
 */
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 26,
} as const;

/**
 * 布局尺寸令牌（单位 px）。
 *
 * 对应 `app.wxss` 的 `--ep-continue-* / --ep-status-dot / --ep-card-*` 变量，
 * 用于「继续收听」聚光灯卡等固定高度组件，避免在 WXSS 里写死像素。
 */
export const LAYOUT = {
  /** 继续收听卡·头部固定高度（20dp）。 */
  continueHeaderHeight: 20,
  /** 继续收听卡·主体固定高度（42dp）。 */
  continueBodyHeight: 42,
  /** 继续收听卡·圆形播放/暂停按钮直径（40dp）。 */
  continueButtonSize: 40,
  /** 状态圆点直径。 */
  statusDotSize: 7,
  /** 课程卡片序号列宽度。 */
  cardIndexWidth: 40,
  /** 课程卡片高度（不含外边距）。 */
  cardHeight: 79,
  /** 课程卡片外边距。 */
  cardGap: 9,
} as const;

/**
 * 动效令牌（对齐 Flutter `_M3Motion`）。
 *
 * 时长为毫秒；缓动曲线为 CSS `cubic-bezier(...)` 字符串，
 * 可直接用于 WXSS `transition-timing-function` 或 JS 缓动。
 */
export const MOTION = {
  /** 轻触按下（100ms）。 */
  durMicro: 100,
  /** 快速（160ms，如 Toast 关闭）。 */
  durQuick: 160,
  /** 基准（250ms，滑动 pill / 手风琴 / 标签切换）。 */
  durFast: 250,
  /** 中等（320ms，页面转场开启）。 */
  durMedium: 320,
  /** 滚动（380ms，歌词自动滚动）。 */
  durScroll: 380,
  /** `transitions.dev --ease-smooth-out`。 */
  easeSmoothOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** `transitions.dev --ease-bounce`。 */
  easeBounce: 'cubic-bezier(0.34, 1.38, 0.64, 1)',
  /** Material 3 Emphasized Decelerate（进场）。 */
  m3EmphasizedDecelerate: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  /** Material 3 Emphasized Accelerate（退场）。 */
  m3EmphasizedAccelerate: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
} as const;

/**
 * 滚动动画令牌（E：歌词/字幕自动滚动）。
 *
 * 小程序 `scroll-with-animation` **只接受系统默认时长与曲线** → 由逻辑层自建帧循环
 * 精确注入 380ms / 320ms + `easeSmoothOut`。这些值只在 **TS 侧**使用（定时器调度），
 * 故不映射为 CSS 变量（`app.wxss` 无需对应定义）。
 */
export const SCROLL = {
  /** 自动滚动（跟随当前句）总时长（ms），对齐 iOS。 */
  autoMs: 380,
  /** 跳句（点字幕行 / 上/下一句）总时长（ms），对齐 iOS。 */
  jumpMs: 320,
  /**
   * 帧间隔（ms）；小程序无 `requestAnimationFrame`，用 `setTimeout` 步进。
   *
   * ⚠️ **性能与平滑度的折中旋钮**（B 批「减少动效」）：16 → 24。
   * 380ms 自动滚动由 24 帧（≈62.5 次 setData/s）降为 16 帧（≈41.7 次/s），
   * 显著降低逻辑层 setData 压力；仍是逐帧滚动、功能完整保留，只是粒度略粗。
   */
  frameMs: 24,
  /** 目标行的竖向对齐比例（0.32 ⇒ 行落在视口 32% 高度处）。 */
  alignRatio: 0.32,
  /**
   * 「程序化滚动窗口」在动画时长之外的**余量**（ms）。
   * `bindscroll` 在程序化改 `scroll-top` 时同样触发，必须覆盖整个循环 + 尾沿回声，
   * 否则会被 `onTranscriptScroll` 误判为用户手动滚动而误弹返回定位条。
   */
  programmaticMarginMs: 120,
} as const;

/**
 * 主题色令牌 → WXSS CSS 变量名映射。
 *
 * `theme.json` 的 `light` / `dark` 两个对象都应包含这里列出的全部变量名
 * （允许额外存在 `navBgColor` / `navTxtStyle` 等供 `app.json` 使用的键），
 * 组件 WXSS 通过 `var(--xxx)` 引用即可实现双主题自适应。
 * 校验脚本 `scripts/validate-config.mjs` 会据此核对 `theme.json`。
 */
export const CSS_VAR: Record<keyof ThemeColors, string> = {
  bgWell: '--bgColor',
  deckBg: '--ep-deck-bg',
  deckGradientTop: '--ep-deck-gradient-top',
  deckGradientMid: '--ep-deck-gradient-mid',
  deckGradientBottom: '--ep-deck-gradient-bottom',
  deckBorder: '--ep-deck-border',
  deckShadow: '--ep-deck-shadow',
  bottomBg: '--ep-bottom-bg',
  surface1: '--ep-surface-1',
  surface2: '--ep-surface-2',
  surface3: '--ep-surface-3',
  surfaceInset: '--ep-surface-inset',
  stageBoxBg: '--ep-stage-box-bg',
  stageBoxBorder: '--ep-stage-box-border',
  border: '--ep-border',
  metroOutline: '--ep-metro-outline',
  metroBtnBg: '--ep-metro-btn-bg',
  textPrimary: '--ep-text-primary',
  textPassed: '--ep-text-passed',
  textUpcoming: '--ep-text-upcoming',
  accent: '--ep-accent',
  accentFg: '--ep-accent-fg',
  accentSoft: '--ep-accent-soft',
  vocabHlUnplayed: '--ep-vocab-hl-unplayed',
  vocabHlPassed: '--ep-vocab-hl-passed',
  vocabHlActive: '--ep-vocab-hl-active',
  locateBarBg: '--ep-locate-bar-bg',
  locateBarBorder: '--ep-locate-bar-border',
  scrollbarThumb: '--ep-scrollbar-thumb',
};

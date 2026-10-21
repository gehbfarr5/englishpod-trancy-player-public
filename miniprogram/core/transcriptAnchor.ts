/**
 * ============================================================================
 *  台本首帧重锚估算（core/transcriptAnchor.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  背景（BUG-004）：换轨时 `blocks` 整体替换，`scroll-view` 的旧偏移失效。
 *  修复前先 `setData({ playerScrollTop: 0 })` 再量测定位，导致**首帧必然显示第 1 条**。
 *
 *  本模块回答一个问题：**在台本行还没渲染出来之前，能不能给出一个足够接近的偏移？**
 *  能 —— 用该音轨历史上量到过的行位置（同一课、同一排版，行高稳定）做插值/外推；
 *  样本不足时用「内容总高 × 播放进度」做比例兜底。首帧落在目标句附近，
 *  随后由页面用精确量测做一次无动画校正（见 `REANCHOR_RETRY_DELAYS_MS`）。
 *
 *  ⚠️ `core/` 零 `wx.*`：本模块只做数学，量测与定时器留在页面层。
 * ============================================================================
 */

import { alignRatioFor, clampScrollTop } from './scrollAnim';

export { alignRatioFor };

/**
 * 首帧重锚的退避阶梯（ms）。
 *
 * 第 0 次在 `setData` 回调里立刻尝试（此时通常已渲染完成）；
 * 之后按 16/60/200/400ms 补试，覆盖「行节点延迟挂载」「视口高度暂为 0」等情况。
 * 全部失败后必须放开 `programmaticUntil`，让「找回当前句」条立即可用（BUG-004 ⑤）。
 */
export const REANCHOR_RETRY_DELAYS_MS: readonly number[] = [0, 16, 60, 200, 400];

/** 兜底行高（px）：仅在完全没有量测样本时使用，约为单行台词的行盒高度。 */
export const DEFAULT_ROW_HEIGHT_PX = 34;

/** 估算结果的可信来源，便于真机日志与测试断言。 */
export type AnchorSource = 'exact' | 'interpolated' | 'extrapolated' | 'proportional';

/** 一次成功的行量测（`itemTop` 为相对滚动内容顶部的偏移）。 */
export interface RowSample {
  /** 句下标。 */
  segIdx: number;
  /** 该行顶部相对内容顶部的偏移（px）。 */
  itemTop: number;
  /** 行高（px）。 */
  itemHeight: number;
  /**
   * 该行文本长度（字符数）。
   *
   * 台词行会按宽度换行，所以「行高」主要取决于字数。有了 (字符数, 行高) 的样本，
   * 就能为**还没显示过的另一条音轨**预测内容总高 —— 同一课同宽同字号，斜率可迁移。
   */
  chars?: number;
}

/** 估算输入。 */
export interface AnchorContext {
  /** 目标句下标。 */
  targetIndex: number;
  /** 该音轨总句数。 */
  totalCount: number;
  /** `scroll-view` 可视区高度（px）；≤0 时无法估算。 */
  viewportHeight: number;
  /** 该音轨内容总高（px）；未知时传 `null`/省略，仅影响夹取上界。 */
  contentHeight?: number | null;
  /** 该音轨历史量测样本（无序亦可）。 */
  samples?: readonly RowSample[] | null;
  /** 样本不足时的兜底行高；省略则用 `DEFAULT_ROW_HEIGHT_PX`。 */
  avgRowHeight?: number | null;
  /** 目标句在该音轨中的播放进度（0..1），用于「无样本」时的比例兜底。 */
  progressRatio?: number | null;
}

/** 估算出的目标偏移。 */
export interface AnchorEstimate {
  /** 建议的 `scroll-top`（px，整数，已夹到 `[0, maxTop]`）。 */
  scrollTop: number;
  /** 估算来源。 */
  source: AnchorSource;
  /** 估算出的目标行顶部偏移（px）。 */
  itemTop: number;
}

/**
 * 黄金阅读线对齐比例（与 `computePodcastScrollTarget` 完全一致，定义在 `scrollAnim.ts`）。
 */

/** 过滤并按下标升序整理样本（丢弃非法值，同一下标保留最后一条）。 */
function normalizeSamples(samples: readonly RowSample[] | null | undefined): RowSample[] {
  if (!samples || samples.length === 0) return [];
  const bySeg = new Map<number, RowSample>();
  for (const s of samples) {
    if (!s) continue;
    const segIdx = Math.round(s.segIdx);
    if (!Number.isFinite(segIdx) || segIdx < 0) continue;
    if (!Number.isFinite(s.itemTop) || s.itemTop < 0) continue;
    bySeg.set(segIdx, {
      segIdx,
      itemTop: s.itemTop,
      itemHeight: Number.isFinite(s.itemHeight) && s.itemHeight > 0 ? s.itemHeight : DEFAULT_ROW_HEIGHT_PX,
    });
  }
  return [...bySeg.values()].sort((a, b) => a.segIdx - b.segIdx);
}

/**
 * 估算某句的行顶部偏移。
 *
 * 优先级：精确命中 > 两侧夹逼插值 > 单侧外推 > 内容高度比例兜底。
 * 返回 `null` 表示连比例兜底都缺参数（没有内容高度、也没有进度比例）。
 */
export function estimateRowTop(
  ctx: AnchorContext,
): { itemTop: number; source: AnchorSource } | null {
  const total = Math.max(1, Math.round(ctx.totalCount));
  const target = Math.max(0, Math.min(total - 1, Math.round(ctx.targetIndex)));
  const avgRow =
    ctx.avgRowHeight && ctx.avgRowHeight > 0 ? ctx.avgRowHeight : DEFAULT_ROW_HEIGHT_PX;
  const samples = normalizeSamples(ctx.samples);

  for (const s of samples) {
    if (s.segIdx === target) {
      return { itemTop: s.itemTop, source: 'exact' };
    }
  }

  if (samples.length > 0) {
    let lower: RowSample | null = null;
    let upper: RowSample | null = null;
    for (const s of samples) {
      if (s.segIdx < target) lower = s;
      else if (s.segIdx > target && !upper) upper = s;
    }
    if (lower && upper) {
      const span = upper.segIdx - lower.segIdx;
      const k = span > 0 ? (target - lower.segIdx) / span : 0;
      return {
        itemTop: lower.itemTop + (upper.itemTop - lower.itemTop) * k,
        source: 'interpolated',
      };
    }
    const anchor = lower ?? upper;
    if (anchor) {
      return {
        itemTop: Math.max(0, anchor.itemTop + (target - anchor.segIdx) * avgRow),
        source: 'extrapolated',
      };
    }
  }

  const contentHeight = ctx.contentHeight ?? 0;
  const ratio = ctx.progressRatio;
  if (contentHeight > 0 && ratio !== null && ratio !== undefined && Number.isFinite(ratio)) {
    const clamped = Math.max(0, Math.min(1, ratio));
    return { itemTop: contentHeight * clamped, source: 'proportional' };
  }

  return null;
}

/**
 * 估算换轨后的首帧 `scroll-top`。
 *
 * 返回值会与 `blocks` 放在**同一次** `setData` 里下发 —— 这是「首帧不显示第 1 条」
 * 的关键：只要这次 patch 带了非 0 偏移，视图就不会从顶部开始画。
 *
 * `null` 表示无法估算（视口高度未知 / 参数不足），页面此时**不要**下发 0，
 * 应保留当前偏移并在渲染完成后直接做精确校正。
 */
export function estimateAnchorScrollTop(ctx: AnchorContext): AnchorEstimate | null {
  const viewportHeight = ctx.viewportHeight;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;

  const row = estimateRowTop(ctx);
  if (!row) return null;

  const total = Math.max(1, Math.round(ctx.totalCount));
  const target = Math.max(0, Math.min(total - 1, Math.round(ctx.targetIndex)));
  const ratio = alignRatioFor(target, total);
  const raw = row.itemTop - viewportHeight * ratio;

  const contentHeight = ctx.contentHeight ?? 0;
  // 内容总高未知时不做上界夹取（观感上「先落到深处再由精确量测拉回」远好于落到 0）。
  const scrollTop =
    contentHeight > 0
      ? Math.round(clampScrollTop(raw, Math.max(0, contentHeight - viewportHeight)))
      : Math.max(0, Math.round(raw));

  return { scrollTop, source: row.source, itemTop: row.itemTop };
}

/** 样本集合的简单统计：平均行高（供外推使用；无样本返回 `null`）。 */
export function averageRowHeight(samples: readonly RowSample[] | null | undefined): number | null {
  const list = normalizeSamples(samples);
  if (list.length === 0) return null;
  let sum = 0;
  for (const s of list) sum += s.itemHeight;
  return sum / list.length;
}

/** 行高线性模型：`height ≈ a + b * chars`。 */
export interface RowHeightModel {
  /** 截距（行内边距 / 说话人标签占位，px）。 */
  a: number;
  /** 斜率（每字符增加的高度，px）。 */
  b: number;
  /** 拟合所用样本数。 */
  samples: number;
}

/**
 * 用最小二乘拟合「字符数 → 行高」。
 *
 * 用途：另一条音轨还没显示过、没有任何行位置样本时，只要拿到它的每行字数，
 * 就能预测内容总高，从而让换轨首帧落在目标句附近（而不是第 1 条）。
 *
 * 样本不足时退化：1 条样本按 `a=0`；0 条返回 `null`。
 */
export function fitRowHeightModel(
  points: ReadonlyArray<{ chars: number; height: number }> | null | undefined,
): RowHeightModel | null {
  if (!points || points.length === 0) return null;
  const valid = points.filter(
    (p) =>
      p &&
      Number.isFinite(p.chars) &&
      p.chars > 0 &&
      Number.isFinite(p.height) &&
      p.height > 0,
  );
  if (valid.length === 0) return null;
  if (valid.length === 1) {
    return { a: 0, b: valid[0].height / valid[0].chars, samples: 1 };
  }
  const n = valid.length;
  let sx = 0;
  let sy = 0;
  for (const p of valid) {
    sx += p.chars;
    sy += p.height;
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let varX = 0;
  for (const p of valid) {
    const dx = p.chars - mx;
    cov += dx * (p.height - my);
    varX += dx * dx;
  }
  // 字数几乎相同的样本无法定斜率（除零保护）：退回「平均每字符高度」。
  if (varX < 1e-6) {
    return { a: 0, b: my / mx, samples: n };
  }
  const b = cov / varX;
  const a = my - b * mx;
  return { a, b, samples: n };
}

/** 预测单行高度（模型缺失时用兜底行高）。 */
export function predictRowHeight(
  model: RowHeightModel | null | undefined,
  chars: number,
  fallbackRowHeight: number = DEFAULT_ROW_HEIGHT_PX,
): number {
  const c = Number.isFinite(chars) && chars > 0 ? chars : 0;
  if (model) {
    const h = model.a + model.b * c;
    if (Number.isFinite(h) && h > 0) return h;
  }
  return fallbackRowHeight;
}

/**
 * 估算某音轨的内容总高（换轨首帧估算用）。
 *
 * `rowChars` 是**台本行**的字符数序列（不是句数 —— 舞台盒子里的每一行都算一行）。
 * 返回 0 表示无法估算（没有行、也没有兜底行高）。
 */
export function estimateContentHeight(opts: {
  rowChars: readonly number[];
  model?: RowHeightModel | null;
  fallbackRowHeight?: number;
}): number {
  const rows = opts.rowChars;
  if (!rows || rows.length === 0) return 0;
  const fallback = opts.fallbackRowHeight && opts.fallbackRowHeight > 0
    ? opts.fallbackRowHeight
    : DEFAULT_ROW_HEIGHT_PX;
  let total = 0;
  for (const chars of rows) {
    total += predictRowHeight(opts.model, chars, fallback);
  }
  return total;
}

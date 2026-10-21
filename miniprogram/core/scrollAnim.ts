/**
 * ============================================================================
 *  滚动动画纯函数（core/scrollAnim.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  用途：以**精确时长 + 精确缓动**驱动 `scroll-view` 的 `scroll-top`。
 *
 *  背景（E）：小程序 `scroll-view` 的 `scroll-with-animation` **只接受系统默认时长与曲线**，
 *  无法表达 iOS 的「380ms + `easeSmoothOut`」→ 故由逻辑层自建帧循环，逐帧算出 `scroll-top`。
 *  本模块只保留**可单测的数学**；定时器/量测留在页面层。
 *
 *  ⚠️ `core/` 零 `wx.*`：本模块不触碰任何平台 API。
 * ============================================================================
 */

/**
 * 黄金阅读线对齐比例（首句顶到容器顶部；末尾三句依次下沉 85% / 65% / 50%；
 * 其余收敛到视口 32%）。
 *
 * 首帧重锚（`core/transcriptAnchor.ts`）与精确落位共用这一套规则，
 * 否则「估算位置」与「校正后位置」会各自漂移。
 */
export function alignRatioFor(index: number, totalCount: number): number {
  const total = Math.max(1, Math.round(totalCount));
  const i = Math.max(0, Math.min(total - 1, Math.round(index)));
  if (i === 0) return 0.0;
  if (i >= total - 1) return 0.85;
  if (i >= total - 2) return 0.65;
  if (i >= total - 3) return 0.50;
  return 0.32;
}

/**
 * 计算三阶贝塞尔在参数 `t` 处的分量值（P0=0、P3=1）。
 *
 * @param t 参数（0..1）
 * @param c1 第一个控制点分量
 * @param c2 第二个控制点分量
 */
function bezierAt(t: number, c1: number, c2: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) {
    return 0;
  }
  if (v <= 0) {
    return 0;
  }
  if (v >= 1) {
    return 1;
  }
  return v;
}

/**
 * `easeSmoothOut` = `cubic-bezier(0.22, 1, 0.36, 1)`（与 iOS `_M3Motion.easeSmoothOut` 一致）。
 *
 * 输入**时间进度** `x`（0..1），输出**缓动进度** `y`（0..1，前段快、后段慢）。
 * 说明：需先由 x 反解贝塞尔参数 t（二分），再取 y(t) —— 与 CSS 对该曲线的语义一致。
 */
export function easeSmoothOut(x: number): number {
  const cx = clamp01(x);
  if (cx === 0 || cx === 1) {
    return cx;
  }
  const X1 = 0.22;
  const X2 = 0.36;
  const Y1 = 1;
  const Y2 = 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (bezierAt(mid, X1, X2) < cx) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const t = (lo + hi) / 2;
  return bezierAt(t, Y1, Y2);
}

/** 线性插值。 */
export function lerp(from: number, to: number, t: number): number {
  const k = clamp01(t);
  return from + (to - from) * k;
}

/**
 * 生成一次滚动的**逐帧 `scroll-top` 序列**（不含起点，含终点）。
 *
 * @param fromTop 起始 scroll-top（px）
 * @param toTop 目标 scroll-top（px）
 * @param durationMs 总时长（ms；≤0 时直接返回 `[toTop]`）
 * @param frameMs 帧间隔（ms；≥1）
 * @returns 每帧要写入的 scroll-top（整数，px）
 *
 * 帧数 ≈ `ceil(durationMs / frameMs)`（380ms / 24ms → **16 帧**）；末帧恒等于 `round(toTop)`。
 */
export function buildScrollFrames(
  fromTop: number,
  toTop: number,
  durationMs: number,
  frameMs: number,
): number[] {
  const from = Number.isFinite(fromTop) ? fromTop : 0;
  const to = Number.isFinite(toTop) ? toTop : 0;
  const dur = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const step = Number.isFinite(frameMs) && frameMs >= 1 ? frameMs : 16;

  if (dur <= 0) {
    return [Math.round(to)];
  }

  const frames: number[] = [];
  const total = Math.max(1, Math.ceil(dur / step));
  for (let i = 1; i <= total; i += 1) {
    const elapsed = i * step;
    const x = elapsed >= dur ? 1 : elapsed / dur;
    frames.push(Math.round(lerp(from, to, easeSmoothOut(x))));
  }
  // 保证末帧严格等于目标（避免取整误差留下 1px 偏差）。
  frames[frames.length - 1] = Math.round(to);
  return frames;
}

/**
 * 把 `scroll-top` 夹到合法区间（`[0, maxTop]`）。
 */
export function clampScrollTop(top: number, maxTop: number): number {
  const max = Number.isFinite(maxTop) && maxTop > 0 ? maxTop : 0;
  const v = Number.isFinite(top) ? top : 0;
  if (v < 0) {
    return 0;
  }
  return v > max ? max : v;
}

/**
 * Apple Podcasts 规范台词滚动计算输入。
 */
export interface PodcastScrollTargetOptions {
  /** 目标句子索引（0-based）。 */
  targetIndex: number;
  /** 台词总句数。 */
  totalCount: number;
  /** 目标句子在滚动容器中的绝对顶部偏移（px）。 */
  itemTop: number;
  /** 目标句子高度（px）。 */
  itemHeight: number;
  /** scroll-view 可视区高度（px）。 */
  viewportHeight: number;
  /** 台词总内容高度（px）。 */
  totalContentHeight: number;
  /** 当前已有的 scrollTop（px）。 */
  currentScrollTop: number;
}

/**
 * Apple Podcasts 规范台词滚动计算结果。
 */
export interface PodcastScrollTargetResult {
  /** 是否需要执行滚动（若已自然触底且句子完全可见，则为 false，0 像素位移）。 */
  shouldScroll: boolean;
  /** 目标 scrollTop（px）。 */
  targetScrollTop: number;
  /** 是否处于触底停靠状态。 */
  isDockedAtBottom: boolean;
  /** 黄金阅读线视口对齐比例（0.32 或尾部 0.85/0.65/0.50）。 */
  alignRatio: number;
}

/**
 * Apple Podcasts 级台词滚动与防抖目标计算（对齐 iOS _safeScrollTranscriptToIndex）。
 *
 * 1. 黄金阅读线（Sweet Spot）：常规播放收敛于视口 32% 位置；
 * 2. 自然物理触底停靠（Natural Bottom Docking）：末项触底且当前句完全在视口内时，
 *    完全休眠滚动，返回 shouldScroll=false，就地声波高亮，0 像素位移，彻底消除回弹抖动；
 * 3. 动态平滑滑行钳制（Dynamic Clamped Gliding）：接近底端时动态收敛目标位移，
 *    最后一句 100% 完整露出，无遮挡、不截断、0 额外人工留白。
 */
export function computePodcastScrollTarget(
  opts: PodcastScrollTargetOptions,
): PodcastScrollTargetResult {
  const totalCount = Math.max(1, opts.totalCount);
  const clampedIndex = Math.max(0, Math.min(totalCount - 1, opts.targetIndex));
  const viewportHeight = Math.max(1, opts.viewportHeight);
  const totalContentHeight = Math.max(viewportHeight, opts.totalContentHeight);
  const maxScrollTop = Math.max(0, totalContentHeight - viewportHeight);
  const currentScrollTop = clampScrollTop(opts.currentScrollTop, maxScrollTop);

  // 1. Apple Podcasts 触底停靠判据：
  // 列表已物理到达底端（误差 2px 内），且目标句在当前视口内完全可见。
  const isDockedAtBottom = currentScrollTop >= maxScrollTop - 2;
  const isTargetFullyVisible =
    opts.itemTop >= currentScrollTop - 4 &&
    opts.itemTop + opts.itemHeight <= currentScrollTop + viewportHeight + 4;

  if (isDockedAtBottom && isTargetFullyVisible) {
    return {
      shouldScroll: false,
      targetScrollTop: currentScrollTop,
      isDockedAtBottom: true,
      alignRatio: clampedIndex >= totalCount - 1 ? 0.85 : 0.32,
    };
  }

  // 2. 基础对齐比例（尾部自适应下沉，常规对齐 32% 黄金线）：
  const alignRatio = alignRatioFor(clampedIndex, totalCount);

  // 3. 动态滑行钳制（Dynamic Clamped Gliding）：
  let rawTargetScrollTop = opts.itemTop - viewportHeight * alignRatio;
  rawTargetScrollTop = Math.max(0, Math.min(rawTargetScrollTop, maxScrollTop));

  // 4. 若目标位移与当前偏移在 2px 以内，无需下发滚动指令：
  const shouldScroll = Math.abs(rawTargetScrollTop - currentScrollTop) >= 2;

  return {
    shouldScroll,
    targetScrollTop: Math.round(rawTargetScrollTop),
    isDockedAtBottom: false,
    alignRatio,
  };
}

/**
 * 计算下发 `scroll-top` 时要用的一到两步数值。
 *
 * scroll-view 的 `scroll-top` 是**属性值**：属性值没变，框架不会重新定位，
 * 哪怕用户已经手动把列表拖到了别处。于是「滑走台本 → 点找回」这种
 * 当前句没变、目标偏移与上次下发值相同的场景会静默失效（真机偶发）。
 * 这里在同值时先错 1px 再回位，强制属性发生变化，视觉上不可见。
 *
 * @param appliedTop 上一次通过 `setData` 下发的值（即当前 `data.playerScrollTop`）。
 * @param targetTop 本次要落到的偏移。
 * @returns 依次 `setData` 的偏移序列；长度 2 表示需要连做两步。
 */
export function scrollTopSequence(appliedTop: number, targetTop: number): number[] {
  const target = Math.max(0, Math.round(targetTop));
  const applied = Number.isFinite(appliedTop) ? Math.round(appliedTop) : 0;
  if (target !== applied) {
    return [target];
  }
  return [target > 0 ? target - 1 : 1, target];
}


/**
 * ============================================================================
 *  返回定位条判定（core/locateBar.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  「活跃句是否落在视口内」的**纯比例判定**，对齐 iOS
 *  `_isActiveSegmentVisibleInViewport`：
 *
 *      可见  ⟺  leadingEdge >= -0.08 && trailingEdge <= 1.08
 *
 *  其中 `leadingEdge` / `trailingEdge` 是活跃行相对滚动视口的归一化位置
 *  （`(row.top - viewport.top) / viewport.height` 等），**8% 容差**照抄 iOS。
 *
 *  平台层的量测（`createSelectorQuery`）留在 `packagePlayer/pages/player`；
 *  这里只保留可单测的比例判定，避免容差散落。
 * ============================================================================
 */

/** 视口容差（±8%），对齐 iOS。 */
export const ACTIVE_SEGMENT_VIEWPORT_TOLERANCE = 0.08;

/** 视口下界（归一化）。 */
export const VIEWPORT_UPPER_BOUND = 1 + ACTIVE_SEGMENT_VIEWPORT_TOLERANCE;
/** 视口上界（归一化，负值表示允许行顶部略微超出视口顶）。 */
export const VIEWPORT_LOWER_BOUND = -ACTIVE_SEGMENT_VIEWPORT_TOLERANCE;

/**
 * 活跃句是否落在视口内（含 8% 容差）。
 *
 * @param leadingEdge 活跃行顶部相对视口的归一化位置
 * @param trailingEdge 活跃行底部相对视口的归一化位置
 */
export function isWithinViewport(leadingEdge: number, trailingEdge: number): boolean {
  if (!Number.isFinite(leadingEdge) || !Number.isFinite(trailingEdge)) {
    return false;
  }
  return leadingEdge >= VIEWPORT_LOWER_BOUND && trailingEdge <= VIEWPORT_UPPER_BOUND;
}

/**
 * 活跃句是否落在视口舒适阅读焦点区（0.04 ~ 0.94）。
 *
 * 当用户上下滑动浏览其他台词时，发音句一旦触及视口顶部（<0.04）
 * 或底部坞栏（>0.94），即极其灵敏地判定为已离开当前阅读焦点，
 * 立即浮现找回条；无需硬拖到文字完全滚出屏幕外。
 */
export function isWithinFocusViewport(leadingEdge: number, trailingEdge: number): boolean {
  if (!Number.isFinite(leadingEdge) || !Number.isFinite(trailingEdge)) {
    return false;
  }
  return leadingEdge >= 0.04 && trailingEdge <= 0.94;
}

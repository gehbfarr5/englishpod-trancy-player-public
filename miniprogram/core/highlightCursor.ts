/**
 * ============================================================================
 *  高亮游标（core/highlightCursor.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  职责：把「当前播放位置（秒）」换算成**句级片段下标** `{ segIdx }`，**并且只在
 *        下标真正变化时才产出一次更新**（同一时间点连续调用只产出第一次）。
 *
 *  ⚠️ iOS 定稿**没有逐词高亮**：iOS 数据里虽含 `words[]` 逐词时间轴，但 UI 从不消费。
 *  因此本模块与整条渲染链路**收敛为句级**（原 `wordIdx` 已彻底移除）。
 *
 *  「变化才产出」的语义是高亮的性能命门：逻辑层据此决定是否 `setData`。
 *  句切换频率远低于词切换（≈ 0.2 次/秒量级），`setData` 因此被压到极低。
 *
 *  时间单位：秒（number, float）。
 * ============================================================================
 */

import { Segment } from './types';
import { findSegmentIndexAt } from './timelineEngine';

/** 高亮游标（可驱动句级高亮的最小 state）。 */
export interface HighlightCursor {
  /** 当前片段下标（无内容为 -1）。 */
  segIdx: number;
}

/** 供 `setData` 使用的最小 payload（字段名即页面 data 字段名）。 */
export interface HighlightPayload {
  activeSegIdx: number;
}

/**
 * 高亮游标追踪器。
 *
 * 用法：
 * ```ts
 * const tracker = new HighlightCursorTracker(segments);
 * const changed = tracker.update(positionSec); // null 表示无需 setData
 * if (changed) this.setData(tracker.toPayload());
 * ```
 */
export class HighlightCursorTracker {
  private segments: readonly Segment[] = [];
  private segIdx = -1;
  /** 是否已产出过首个游标（首个游标必须产出，即便恰好是 -1）。 */
  private initialized = false;

  constructor(segments: readonly Segment[] = []) {
    this.setSegments(segments);
  }

  /** 切换音轨/课程时重设片段集（会强制下一次 update 产出新游标）。 */
  setSegments(segments: readonly Segment[]): HighlightCursor {
    this.segments = segments;
    this.segIdx = -1;
    this.initialized = false;
    return { segIdx: this.segIdx };
  }

  /** 当前游标（只读快照）。 */
  current(): HighlightCursor {
    return { segIdx: this.segIdx };
  }

  /**
   * 用播放位置更新游标。
   *
   * @returns 下标发生变化时返回新游标；否则返回 `null`（调用方应跳过 `setData`）。
   */
  update(positionSec: number): HighlightCursor | null {
    if (this.segments.length === 0) {
      if (!this.initialized) {
        this.initialized = true;
        return { segIdx: -1 };
      }
      return null;
    }

    const segIdx = findSegmentIndexAt(this.segments, positionSec);
    if (this.initialized && segIdx === this.segIdx) {
      return null;
    }

    this.initialized = true;
    this.segIdx = segIdx;
    return { segIdx };
  }

  /** 当前游标转 `setData` payload（字段固定，体积 <100B）。 */
  toPayload(): HighlightPayload {
    return { activeSegIdx: this.segIdx };
  }
}

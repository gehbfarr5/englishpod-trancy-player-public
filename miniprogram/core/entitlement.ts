/**
 * ============================================================================
 *  课程解锁与权益规则引擎（core/entitlement.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  业务规则：
 *   1. 前 5 课（Lesson 01 ~ Lesson 05）完全免费试听，无论是否为 VIP 均解锁。
 *   2. 第 6 课及以后（Lesson 06 ~ Lesson 335）为付费锁定课。
 *   3. 终身通卡购买后（isVip: true），全套 335 课全部永久解锁。
 *   4. 未解锁课程在播放页展示前 6 句（segIdx <= 5）正文台本与音频试听，之后展示解锁引导。
 *   5. 商品定价：¥9.9 元（990分），终身买断制。
 * ============================================================================
 */

import { TranscriptBlockVM } from './transcriptView';

/** 免费试听课程数（前 5 课）。 */
export const FREE_TRIAL_LESSON_COUNT = 5;

/** 付费课程试听台本最大展示句数（前 6 句）。 */
export const PREVIEW_SENTENCE_LIMIT = 6;

/** 终身通卡定价（元）。 */
export const LIFETIME_UNLOCK_PRICE_YUAN = '9.9';

/** 终身通卡定价（分，微信支付与虚拟支付常用单位）。 */
export const LIFETIME_UNLOCK_PRICE_FEN = 990;

/** 虚拟支付道具 ID（微信公众平台道具管理中配置）。 */
export const LIFETIME_PRODUCT_ID = 'ep_unlock_all';

/** 虚拟支付道具展示名。 */
export const LIFETIME_PRODUCT_NAME = 'EnglishPod 335课终身精听通卡';

/**
 * 判断指定课程当前是否处于锁定状态。
 *
 * @param lessonId 课程 ID（如 "0001", "1", "0011", "11"）
 * @param isVip 用户是否已解锁/开通 VIP
 * @returns true = 锁定（需付费）；false = 解锁（可畅听）
 */
export function isLessonLocked(lessonId: string | number | undefined | null, isVip: boolean): boolean {
  if (isVip) {
    return false;
  }
  if (!lessonId) {
    return false;
  }
  const rawNum = typeof lessonId === 'number' ? lessonId : parseInt(String(lessonId).trim(), 10);
  if (!Number.isFinite(rawNum) || rawNum <= 0) {
    return false;
  }
  // 仅编号大于 10 的课程需要锁定
  return rawNum > FREE_TRIAL_LESSON_COUNT;
}

/** 试听台本过滤结果。 */
export interface PreviewBlocksResult {
  /** 截断后的区块数组。 */
  blocks: TranscriptBlockVM[];
  /** 是否被截断封顶（未解锁且台本句数超过限额）。 */
  isCapped: boolean;
  /** 允许播放/展示的最大 segIdx。 */
  maxAllowedSegIdx: number;
  /** 试听展示的实际总句数。 */
  previewSentenceCount: number;
}

/**
 * 针对未解锁课程，将完整台本区块截断至前 limit 句（默认 6 句）。
 *
 * @param blocks 原始完整区块数组
 * @param isLocked 当前课程是否锁定
 * @param limit 最大保留句数（默认 6 句）
 */
export function filterBlocksForPreview(
  blocks: readonly TranscriptBlockVM[],
  isLocked: boolean,
  limit: number = PREVIEW_SENTENCE_LIMIT,
): PreviewBlocksResult {
  if (!isLocked || !Array.isArray(blocks) || blocks.length === 0) {
    return {
      blocks: [...(blocks || [])],
      isCapped: false,
      maxAllowedSegIdx: Infinity,
      previewSentenceCount: 0,
    };
  }

  const result: TranscriptBlockVM[] = [];
  let collectedCount = 0;
  let maxSegIdx = -1;
  const maxLimit = Math.max(1, limit);

  for (const block of blocks) {
    if (collectedCount >= maxLimit) {
      break;
    }

    if (block.kind === 'host') {
      result.push(block);
      collectedCount += 1;
      if (block.line.segIdx > maxSegIdx) {
        maxSegIdx = block.line.segIdx;
      }
    } else if (block.kind === 'box') {
      const remainingQuota = maxLimit - collectedCount;
      if (block.lines.length <= remainingQuota) {
        result.push(block);
        collectedCount += block.lines.length;
        for (const ln of block.lines) {
          if (ln.segIdx > maxSegIdx) maxSegIdx = ln.segIdx;
        }
      } else {
        // 盒子内部跨越了截断边界：切取盒子内前 remainingQuota 句
        const slicedLines = block.lines.slice(0, remainingQuota);
        result.push({
          ...block,
          lines: slicedLines,
        });
        collectedCount += slicedLines.length;
        for (const ln of slicedLines) {
          if (ln.segIdx > maxSegIdx) maxSegIdx = ln.segIdx;
        }
      }
    }
  }

  return {
    blocks: result,
    isCapped: true,
    maxAllowedSegIdx: maxSegIdx,
    previewSentenceCount: collectedCount,
  };
}

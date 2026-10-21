/**
 * ============================================================================
 *  ⚠️ dev-only：离线数据适配器（mock/index.ts）
 * ============================================================================
 *  当 `config/env.ts` 的 {@link USE_MOCK_DATA} 为 `true` 时，课程库页改用本适配器，
 *  从 `mock/lessonIndex.ts`（第 1–30 课轻量索引）读取数据，**无需任何后端**即可预览。
 *
 *  设计与真实链路的关系：
 *   - 本适配器与 `WechatCloudAdapter` 实现同一个 `CloudAdapter` 端口，二者可无缝互换；
 *   - 索引同样经过 `core/lessonModel.ts` 的 `parseLessonIndex()` 强校验，
 *     确保 mock 数据与真实云端数据走**同一套解析契约**（一旦字段漂移立刻暴露）。
 *
 *  ⚠️ 上线前：把 `USE_MOCK_DATA` 置为 false，并**删除整个 `mock/` 目录**。
 * ============================================================================
 */

import { parseLessonDetail, parseLessonIndex } from '../core/lessonModel';
import { AudioTrackKey, CloudAdapter, LessonDetail, LessonIndexItem } from '../core/types';
import { MOCK_LESSON_DETAILS } from './lessonDetail';
import { MOCK_LESSON_INDEX } from './lessonIndex';

/** 离线云适配器：索引来自本地 mock，详情来自本地 mock 正文。 */
export class MockCloudAdapter implements CloudAdapter {
  /** 解析后的索引缓存（避免重复解析）。 */
  private cache: LessonIndexItem[] | null = null;

  /** 解析后的详情缓存（按 lessonId）。 */
  private readonly detailCache = new Map<string, LessonDetail>();

  /** 返回离线索引（经严格解析器校验）。 */
  async getLessonIndex(): Promise<LessonIndexItem[]> {
    if (this.cache === null) {
      this.cache = parseLessonIndex(MOCK_LESSON_INDEX);
    }
    return this.cache;
  }

  /**
   * 返回离线单课详情（经严格解析器校验，与真实云端走同一契约）。
   *
   * 目前 mock 只提供第 `0001` 课；其余课程抛错提示（便于及时发现越界使用）。
   */
  async getLessonDetail(lessonId: string): Promise<LessonDetail> {
    if (!lessonId) {
      throw new Error('[mock] getLessonDetail: lessonId 不能为空');
    }
    const cached = this.detailCache.get(lessonId);
    if (cached) {
      return cached;
    }
    const rawDetail = MOCK_LESSON_DETAILS[lessonId];
    if (!rawDetail) {
      throw new Error(
        `[mock] 离线模式仅提供以下课程的正文：${Object.keys(MOCK_LESSON_DETAILS).join(', ')}`,
      );
    }
    const detail = parseLessonDetail(rawDetail);
    this.detailCache.set(lessonId, detail);
    return detail;
  }

  /** 离线模式无云存储，恒返回空串。 */
  resolveAudioFileId(_lessonId: string, _track: AudioTrackKey): string {
    return '';
  }
}

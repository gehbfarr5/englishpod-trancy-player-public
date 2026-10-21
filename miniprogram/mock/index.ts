/**
 * ============================================================================
 *  ⚠️ dev-only：离线数据适配器（mock/index.ts）
 * ============================================================================
 *  生产课程数据保留在已授权的云存储中；公开仓库不包含课程正文。
 * ============================================================================
 */

import { parseLessonDetail, parseLessonIndex } from '../core/lessonModel';
import { AudioTrackKey, CloudAdapter, LessonDetail, LessonIndexItem } from '../core/types';
import { MOCK_LESSON_DETAILS } from './lessonDetail';
import { MOCK_LESSON_INDEX } from './lessonIndex';

export class MockCloudAdapter implements CloudAdapter {
  private cache: LessonIndexItem[] | null = null;
  private readonly detailCache = new Map<string, LessonDetail>();

  async getLessonIndex(): Promise<LessonIndexItem[]> {
    if (this.cache === null) {
      this.cache = parseLessonIndex(MOCK_LESSON_INDEX);
    }
    return this.cache;
  }

  async getLessonDetail(lessonId: string): Promise<LessonDetail> {
    if (!lessonId) {
      throw new Error('[mock] getLessonDetail: lessonId 不能为空');
    }
    const cached = this.detailCache.get(lessonId);
    if (cached) {
      return cached;
    }
    const rawDetail = MOCK_LESSON_DETAILS.find((item) => item.LessonId === lessonId);
    if (!rawDetail) {
      throw new Error(
        `[mock] 离线模式没有包含课程正文：${MOCK_LESSON_DETAILS.map((item) => item.LessonId).join(', ') || '无'}`,
      );
    }
    const detail = parseLessonDetail(rawDetail);
    this.detailCache.set(lessonId, detail);
    return detail;
  }

  resolveAudioFileId(_lessonId: string, _track: AudioTrackKey): string {
    return '';
  }
}

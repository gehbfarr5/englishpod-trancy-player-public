/**
 * ============================================================================
 *  ⚠️ dev-only 自动生成文件 —— 请勿手改；由 scripts/generate-mock-index.mjs 生成。
 * ============================================================================
 *  重新生成：`npm run mock:gen`
 *  作用：在后端（云函数 / 云数据库）尚未部署时，为课程库页提供 1–30 课离线索引。
 *  ⚠️ 上线前：把 config/env.ts 的 USE_MOCK_DATA 置为 false，并删除整个 mock/ 目录。
 *
 *  只含轻量索引字段，**不含任何 tracks / words 正文**。
 * ============================================================================
 */

/** 源索引项的原始结构（snake_case 键名，与 processed_lessons/index.json 一致）。 */
export interface RawLessonIndexItem {
  lesson_number: number;
  lesson_id: string;
  code: string;
  level: string;
  title: string;
  dg_count: number;
  pb_count: number;
  vocab_count: number;
  audio: { dg: string | null; pb: string | null; rv: string | null };
}

/** 离线索引：第 1–30 课（共 30 条）。 */
export const MOCK_LESSON_INDEX: RawLessonIndexItem[] = [];
export const MOCK_LESSON_COUNT = 0;

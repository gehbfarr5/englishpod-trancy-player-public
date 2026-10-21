/**
 * ============================================================================
 *  ⚠️ dev-only 自动生成文件 —— 请勿手改；由 scripts/generate-mock-detail.mjs 生成。
 * ============================================================================
 *  重新生成：`npm run mock:gen`
 *  作用：在后端尚未部署时，为播放器提供 1 课完整正文（字幕 + 逐词时间戳）。
 *  ⚠️ 上线前：把 config/env.ts 的 USE_MOCK_DATA 置为 false，并删除整个 mock/ 目录。
 *
 *  说明：pb 音轨为控制体积做了截断（仅前若干段）；dg 音轨为全量。
 *        源绝对音频路径已改写为相对逻辑路径，rv 恒为 null。
 * ============================================================================
 */

/** 源详情的原始结构（键名与 processed_lessons/lesson_XXXX.json 一致）。 */
export interface RawLessonDetail {
  lesson_number: number;
  LessonId: string;
  code: string;
  level: string;
  title: string;
  raw_title: string;
  audio: { dg: string | null; pb: string | null; rv: string | null };
  vocabulary: Array<{ type: string; word: string; pos: string; definition: string }>;
  tracks: {
    dg: RawSegment[];
    pb: RawSegment[];
  };
}

/** 源片段结构。 */
export interface RawSegment {
  id: number;
  speaker: string;
  text: string;
  is_section: boolean;
  in_dialogue_block: boolean;
  start: number;
  end: number;
  words: Array<{ word: string; start: number; end: number }>;
}

/** 离线单课详情（键 = lessonId）。 */
export const MOCK_LESSON_DETAILS: RawLessonDetail[] = [];

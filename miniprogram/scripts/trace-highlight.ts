/**
 * ============================================================================
 *  句级高亮序列追踪脚本（dev-only，可复现验证）
 * ============================================================================
 *  用 mock 单课正文（0001 课 pb 轨）驱动 `HighlightCursorTracker`，把前 30 秒里
 *  **每一次句级高亮变化**（时间点 → 片段下标 → 句文本）打印出来。
 *
 *  ⚠️ iOS 定稿无逐词高亮：Part 0 收敛后本脚本输出为**句级**（不再有 wordIdx）。
 *
 *  运行：`npm run trace:highlight`
 * ============================================================================
 */

import { HighlightCursorTracker } from '../core/highlightCursor';
import { parseLessonDetail } from '../core/lessonModel';
import { MOCK_LESSON_DETAILS } from '../mock/lessonDetail';

const TICK_MS = 250;
const SECONDS = 30;

const detail = parseLessonDetail(MOCK_LESSON_DETAILS['0001']);
const segments = detail.tracks.pb;
const tracker = new HighlightCursorTracker(segments);

let emissions = 0;

console.log(`课程：${detail.lessonId} · ${detail.title}`);
console.log(`pb 片段数：${segments.length}；模拟节拍：${TICK_MS}ms；窗口：${SECONDS}s`);
console.log('');
console.log('时间      segIdx  句文本（截断）');
console.log('----------------------------------------------------------------------------');

const ticks = (SECONDS * 1000) / TICK_MS;
for (let i = 0; i <= ticks; i += 1) {
  const t = (i * TICK_MS) / 1000;
  const changed = tracker.update(t);
  if (!changed) {
    continue;
  }
  emissions += 1;
  const seg = segments[changed.segIdx];
  const timeStr = t.toFixed(2).padStart(5, ' ');
  const lineText = seg ? seg.text.slice(0, 52) : '';
  console.log(`${timeStr}s  ${String(changed.segIdx).padStart(5, ' ')}  ${lineText}`);
}

console.log('----------------------------------------------------------------------------');
console.log(
  `${SECONDS}s 内共 ${emissions} 次高亮变化 → ${(emissions / SECONDS).toFixed(2)} 次/秒`,
);
console.log(`payload 示例：${JSON.stringify(tracker.toPayload())}`);

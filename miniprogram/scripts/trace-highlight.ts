/**
 * ============================================================================
 *  句级高亮序列追踪脚本（dev-only，可复现验证）
 * ============================================================================
 *  仅在仓库提供相应脱敏 mock 课程时运行。
 * ============================================================================
 */

import { HighlightCursorTracker } from '../core/highlightCursor';
import { parseLessonDetail } from '../core/lessonModel';
import { MOCK_LESSON_DETAILS } from '../mock/lessonDetail';

const TICK_MS = 250;
const SECONDS = 30;

const rawDetail = MOCK_LESSON_DETAILS.find((item) => item.LessonId === '0001');
if (!rawDetail) {
  throw new Error('课程 0001 的 mock 正文未包含在仓库中；请使用本地授权测试数据运行此脚本。');
}
const detail = parseLessonDetail(rawDetail);
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

import { TranscriptSegment } from '../models/LessonModels';

/**
 * Matches iOS TranscriptNavigation 0.5s pre-scroll & 20ms early seek target rules.
 */
export class TranscriptNavigation {
  static findActiveSegmentIndex(
    segments: TranscriptSegment[],
    seconds: number,
    fallbackIdx: number = 0
  ): number {
    if (segments.length === 0) {
      return 0;
    }

    let firstSpokenIdx = -1;
    let bestIdx = -1;
    let prevSpokenEnd = 0.0;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.isSection) {
        continue;
      }
      if (firstSpokenIdx < 0) {
        firstSpokenIdx = i;
      }
      const gap = seg.start - prevSpokenEnd;
      const triggerStart = gap >= 0.5 ? seg.start - 0.5 : seg.start;
      if (seconds >= triggerStart - 0.02) {
        bestIdx = i;
      } else {
        break;
      }
      if (seg.end > prevSpokenEnd) {
        prevSpokenEnd = seg.end;
      }
    }

    if (bestIdx >= 0) {
      return bestIdx;
    }
    if (firstSpokenIdx >= 0) {
      return firstSpokenIdx;
    }
    return Math.max(0, Math.min(segments.length - 1, fallbackIdx));
  }

  static sentenceSeekTargetSeconds(segment: TranscriptSegment): number {
    return Math.max(0.0, Math.min(99999.0, segment.start - 0.02));
  }

  static previousSegmentIndex(segments: TranscriptSegment[], activeIndex: number): number | null {
    if (segments.length === 0) {
      return null;
    }
    let target = Math.max(0, Math.min(segments.length - 1, activeIndex - 1));
    while (target > 0 && segments[target].isSection) {
      target--;
    }
    return target;
  }

  static nextSegmentIndex(segments: TranscriptSegment[], activeIndex: number): number | null {
    if (segments.length === 0) {
      return null;
    }
    let target = Math.max(0, Math.min(segments.length - 1, activeIndex + 1));
    while (target < segments.length - 1 && segments[target].isSection) {
      target++;
    }
    return target;
  }
}

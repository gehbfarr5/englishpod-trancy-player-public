import '../models/lesson_models.dart';

/// Match the player’s historical 0.5 s pre-scroll rule. Extracted from its
/// runtime path so tests exercise exactly the implementation the player calls.
int findActiveTranscriptSegmentIndex(
  List<TranscriptSegment> segments,
  double seconds, {
  int fallbackIdx = 0,
}) {
  if (segments.isEmpty) return 0;

  int firstSpokenIdx = -1;
  int bestIdx = -1;
  double prevSpokenEnd = 0.0;

  for (int i = 0; i < segments.length; i++) {
    final segment = segments[i];
    if (segment.isSection) continue;
    if (firstSpokenIdx < 0) {
      firstSpokenIdx = i;
    }
    final gap = segment.start - prevSpokenEnd;
    final triggerStart =
        (gap >= 0.5) ? (segment.start - 0.5) : segment.start;
    if (seconds >= triggerStart - 0.02) {
      bestIdx = i;
    } else {
      break;
    }
    if (segment.end > prevSpokenEnd) {
      prevSpokenEnd = segment.end;
    }
  }

  if (bestIdx >= 0) return bestIdx;
  if (firstSpokenIdx >= 0) return firstSpokenIdx;
  return fallbackIdx.clamp(0, segments.length - 1);
}

/// Preserve the player’s 20 ms early seek target and nonnegative clamp.
double sentenceSeekTargetSeconds(TranscriptSegment segment) =>
    (segment.start - 0.02).clamp(0.0, 99999.0);

/// Match current previous/next skip behavior, including first/last bounds.
/// A boundary section is not silently reinterpreted as a spoken segment.
int? previousTranscriptSegmentIndex(
  List<TranscriptSegment> segments,
  int activeIndex,
) {
  if (segments.isEmpty) return null;
  int target = (activeIndex - 1).clamp(0, segments.length - 1);
  while (target > 0 && segments[target].isSection) {
    target--;
  }
  return target;
}

int? nextTranscriptSegmentIndex(
  List<TranscriptSegment> segments,
  int activeIndex,
) {
  if (segments.isEmpty) return null;
  int target = (activeIndex + 1).clamp(0, segments.length - 1);
  while (target < segments.length - 1 && segments[target].isSection) {
    target++;
  }
  return target;
}

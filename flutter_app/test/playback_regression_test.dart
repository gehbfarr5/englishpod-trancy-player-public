import 'dart:convert';

import 'package:englishpod_trancy/main.dart';
import 'package:englishpod_trancy/models/lesson_models.dart';
import 'package:englishpod_trancy/services/transcript_navigation.dart';
import 'package:flutter_test/flutter_test.dart';

TranscriptSegment spoken(double start, double end, {int id = 0}) =>
    TranscriptSegment(
      id: id,
      speaker: 'A',
      text: 'Synthetic transcript segment',
      isSection: false,
      inDialogueBlock: false,
      start: start,
      end: end,
      words: const [],
    );

TranscriptSegment heading({int id = 0}) => TranscriptSegment(
      id: id,
      speaker: '',
      text: 'Synthetic section heading',
      isSection: true,
      inDialogueBlock: false,
      start: 0,
      end: 0,
      words: const [],
    );

LessonProgressRecord advance(
  LessonProgressRecord previous, {
  required String track,
  required double position,
  required int segment,
  required double duration,
  bool markComplete = false,
  int nowMs = 1234,
}) =>
    nextLessonProgressSnapshot(
      prev: previous,
      track: track,
      currentPositionSec: position,
      currentSegmentIndex: segment,
      durationSec: duration,
      playing: false,
      viewingPlayer: true,
      markPbComplete: markComplete,
      nowMs: nowMs,
    );

void main() {
  group('Transcript selection, timing, and section boundaries', () {
    final segments = [
      heading(),
      spoken(1.0, 1.2, id: 1),
      spoken(2.0, 2.3, id: 2),
      heading(id: 3),
      spoken(2.4, 3.1, id: 4),
    ];

    test('pre-scroll 0.5 seconds only for gaps at least 0.5 seconds', () {
      expect(findActiveTranscriptSegmentIndex(segments, 1.47), 1);
      expect(findActiveTranscriptSegmentIndex(segments, 1.48), 2);
      // The second gap is 0.1 s; it must not trigger 0.5 s early.
      expect(findActiveTranscriptSegmentIndex(segments, 2.37), 2);
      expect(findActiveTranscriptSegmentIndex(segments, 2.38), 4);
    });

    test('sections are skipped and empty/end boundaries are stable', () {
      expect(findActiveTranscriptSegmentIndex(segments, 0.0), 1);
      expect(findActiveTranscriptSegmentIndex(segments, 500.0), 4);
      expect(findActiveTranscriptSegmentIndex([], 0.0), 0);
      expect(findActiveTranscriptSegmentIndex([heading(), heading()], 0.0,
          fallbackIdx: 100), 1);
      expect(findActiveTranscriptSegmentIndex([heading()], 0.0,
          fallbackIdx: -10), 0);
    });
  });

  group('Seek and adjacent sentence navigation', () {
    final segments = [
      spoken(0.0, 0.5),
      heading(),
      spoken(2.0, 3.0),
      heading(),
      spoken(4.0, 5.0),
    ];

    test('next/previous bypass middle sections and clamp to boundaries', () {
      expect(previousTranscriptSegmentIndex(segments, 2), 0);
      expect(nextTranscriptSegmentIndex(segments, 0), 2);
      expect(previousTranscriptSegmentIndex(segments, 0), 0);
      expect(nextTranscriptSegmentIndex(segments, 4), 4);
      expect(previousTranscriptSegmentIndex([], 0), isNull);
      expect(nextTranscriptSegmentIndex([], 0), isNull);
    });

    test('seek targets retain 20 ms lead and nonnegative clamp', () {
      expect(sentenceSeekTargetSeconds(spoken(4.0, 5.0)),
          closeTo(3.98, 0.0001));
      expect(sentenceSeekTargetSeconds(spoken(0.0, 1.0)), 0.0);
    });
  });

  group('Podcast and Dialogue progress independence', () {
    test('PB starts at zero percent, then updates its own position', () {
      final initial = advance(const LessonProgressRecord(),
          track: 'pb', position: 2.0, segment: 0, duration: 100);
      expect(initial.progressPct, 0);
      expect(initial.hasStarted, isTrue);
      expect(initial.pbPosSec, 2.0);
      final later = advance(initial,
          track: 'pb', position: 36.8, segment: 4, duration: 100);
      expect(later.progressPct, 36);
      expect(later.pbSegIdx, 4);
      expect(later.isCompleted, isFalse);
    });

    test('Dialogue position never changes Podcast completion or percentage', () {
      final prior = advance(const LessonProgressRecord(),
          track: 'pb', position: 36.8, segment: 4, duration: 100);
      final dg = advance(prior,
          track: 'dg', position: 77.0, segment: 9, duration: 80);
      expect(dg.progressPct, 36);
      expect(dg.isCompleted, isFalse);
      expect(dg.pbPosSec, 36.8);
      expect(dg.pbSegIdx, 4);
      expect(dg.pbDurSec, 100);
      expect(dg.dgPosSec, 77);
      expect(dg.dgSegIdx, 9);
      expect(dg.dgDurSec, 80);
      final restored = LessonProgressRecord.fromJson(
          jsonDecode(jsonEncode(dg.toJson())) as Map<String, dynamic>);
      expect(restored.pbPosSec, dg.pbPosSec);
      expect(restored.dgPosSec, dg.dgPosSec);
      expect(restored.pbSegIdx, dg.pbSegIdx);
      expect(restored.dgSegIdx, dg.dgSegIdx);
      expect(restored.lastTrack, 'dg');
    });

    test('Podcast near-completion remains complete after Dialogue updates', () {
      final pb = advance(const LessonProgressRecord(),
          track: 'pb', position: 96, segment: 11, duration: 100);
      expect(pb.progressPct, 96);
      expect(pb.isCompleted, isTrue);
      final dg = advance(pb, track: 'dg',
          position: 0.2, segment: 0, duration: 30);
      expect(dg.isCompleted, isTrue);
      expect(dg.progressPct, 96);
    });

    test('Podcast completed flag sets 100 and invalid duration preserves percent', () {
      final prior = advance(const LessonProgressRecord(),
          track: 'pb', position: 23, segment: 2, duration: 100);
      final noDuration = advance(prior,
          track: 'pb', position: 0.0, segment: 0, duration: 0.0);
      expect(noDuration.progressPct, 23);
      final completed = advance(noDuration,
          track: 'pb', position: 100, segment: 10, duration: 100,
          markComplete: true);
      expect(completed.progressPct, 100);
      expect(completed.isCompleted, isTrue);
    });
  });
}

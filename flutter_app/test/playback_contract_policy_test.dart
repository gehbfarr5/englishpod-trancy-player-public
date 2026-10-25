import 'package:flutter_test/flutter_test.dart';
import 'package:englishpod_trancy/services/playback_contract_policy.dart';

void main() {
  group('EP-PBC-001 Course Entry and Navigation Transitions', () {
    final lessons = ['0001', '0002', '0003'];

    test('Library entry ALWAYS selects PB track', () {
      final decision = PlaybackContractPolicy.evaluateTransition(
        intent: CourseEntryIntent.library,
        currentLessonId: '0001',
        targetLessonId: '0002',
        currentTrack: 'dg',
        requestedTrack: null,
        lessonIdOrder: lessons,
        isCurrentlyPlaying: false,
        isTargetCompleted: false,
        savedPbSec: 45.0,
        savedDgSec: 15.0,
        pbDurationSec: 600.0,
        dgDurationSec: 120.0,
      );

      expect(decision.targetTrack, equals('pb'));
      expect(decision.targetPositionSec, equals(45.0));
      expect(decision.requestPlay, isTrue);
      expect(decision.updateLastOpened, isTrue);
    });

    test('Library entry on COMPLETED lesson resets position to 00:00', () {
      final decision = PlaybackContractPolicy.evaluateTransition(
        intent: CourseEntryIntent.library,
        currentLessonId: '0001',
        targetLessonId: '0002',
        currentTrack: 'pb',
        requestedTrack: null,
        lessonIdOrder: lessons,
        isCurrentlyPlaying: false,
        isTargetCompleted: true,
        savedPbSec: 580.0,
        savedDgSec: 100.0,
        pbDurationSec: 600.0,
        dgDurationSec: 120.0,
      );

      expect(decision.targetTrack, equals('pb'));
      expect(decision.targetPositionSec, equals(0.0));
      expect(decision.requestPlay, isTrue);
    });

    test('Continue Learning card targets PB and does not alter anchor', () {
      final decision = PlaybackContractPolicy.evaluateTransition(
        intent: CourseEntryIntent.continueListening,
        currentLessonId: '0001',
        targetLessonId: '0001',
        currentTrack: 'dg',
        requestedTrack: null,
        lessonIdOrder: lessons,
        isCurrentlyPlaying: false,
        isTargetCompleted: false,
        savedPbSec: 120.0,
        savedDgSec: 30.0,
        pbDurationSec: 600.0,
        dgDurationSec: 120.0,
      );

      expect(decision.targetTrack, equals('pb'));
      expect(decision.targetPositionSec, equals(120.0));
      expect(decision.requestPlay, isTrue);
      expect(decision.updateLastOpened, isFalse);
    });

    test('Same-lesson PB <-> DG switch preserves active playing state and restores target track breakpoint', () {
      final decision = PlaybackContractPolicy.evaluateTransition(
        intent: CourseEntryIntent.trackSwitch,
        currentLessonId: '0001',
        targetLessonId: '0001',
        currentTrack: 'pb',
        requestedTrack: 'dg',
        lessonIdOrder: lessons,
        isCurrentlyPlaying: true,
        isTargetCompleted: false,
        savedPbSec: 150.0,
        savedDgSec: 42.0,
        pbDurationSec: 600.0,
        dgDurationSec: 120.0,
      );

      expect(decision.targetTrack, equals('dg'));
      expect(decision.targetPositionSec, equals(42.0));
      expect(decision.requestPlay, isTrue);
    });

    test('Manual Prev from first episode is disabled / no-op (does not loop)', () {
      final decision = PlaybackContractPolicy.evaluateTransition(
        intent: CourseEntryIntent.manualPrev,
        currentLessonId: '0001',
        targetLessonId: '',
        currentTrack: 'pb',
        lessonIdOrder: lessons,
        isCurrentlyPlaying: true,
        isTargetCompleted: false,
        savedPbSec: 0,
        savedDgSec: 0,
        pbDurationSec: 600,
        dgDurationSec: 120,
      );

      expect(decision.isNoOp, isTrue);
      expect(decision.targetLessonId, equals('0001'));
    });

    test('Manual Next from last episode is disabled / no-op (does not loop)', () {
      final decision = PlaybackContractPolicy.evaluateTransition(
        intent: CourseEntryIntent.manualNext,
        currentLessonId: '0003',
        targetLessonId: '',
        currentTrack: 'pb',
        lessonIdOrder: lessons,
        isCurrentlyPlaying: true,
        isTargetCompleted: false,
        savedPbSec: 0,
        savedDgSec: 0,
        pbDurationSec: 600,
        dgDurationSec: 120,
      );

      expect(decision.isNoOp, isTrue);
      expect(decision.targetLessonId, equals('0003'));
    });

    test('Auto-next on PB natural end advances to next lesson PB 00:00', () {
      final decision = PlaybackContractPolicy.evaluateTransition(
        intent: CourseEntryIntent.autoNext,
        currentLessonId: '0001',
        targetLessonId: '',
        currentTrack: 'pb',
        lessonIdOrder: lessons,
        isCurrentlyPlaying: true,
        isTargetCompleted: false,
        savedPbSec: 0,
        savedDgSec: 0,
        pbDurationSec: 600,
        dgDurationSec: 120,
      );

      expect(decision.targetLessonId, equals('0002'));
      expect(decision.targetTrack, equals('pb'));
      expect(decision.targetPositionSec, equals(0.0));
      expect(decision.requestPlay, isTrue);
    });

    test('Auto-next on PB natural end from LAST lesson loops back to FIRST lesson PB 00:00', () {
      final decision = PlaybackContractPolicy.evaluateTransition(
        intent: CourseEntryIntent.autoNext,
        currentLessonId: '0003',
        targetLessonId: '',
        currentTrack: 'pb',
        lessonIdOrder: lessons,
        isCurrentlyPlaying: true,
        isTargetCompleted: false,
        savedPbSec: 0,
        savedDgSec: 0,
        pbDurationSec: 600,
        dgDurationSec: 120,
      );

      expect(decision.targetLessonId, equals('0001'));
      expect(decision.targetTrack, equals('pb'));
      expect(decision.targetPositionSec, equals(0.0));
      expect(decision.requestPlay, isTrue);
    });
  });

  group('EP-PBC-001 Natural End Decision Chain', () {
    test('Priority 1: Single sentence loop overrides everything', () {
      final action = PlaybackContractPolicy.evaluateNaturalEnd(
        track: 'pb',
        singleSentenceLoop: true,
        trackLoop: true,
        autoNextEnabled: true,
      );
      expect(action, equals(NaturalEndAction.loopSentence));
    });

    test('Priority 2: Track loop overrides auto-next', () {
      final action = PlaybackContractPolicy.evaluateNaturalEnd(
        track: 'pb',
        singleSentenceLoop: false,
        trackLoop: true,
        autoNextEnabled: true,
      );
      expect(action, equals(NaturalEndAction.loopCurrentTrack));
    });

    test('Priority 3: Auto-next triggers ONLY for PB when enabled', () {
      final pbAction = PlaybackContractPolicy.evaluateNaturalEnd(
        track: 'pb',
        singleSentenceLoop: false,
        trackLoop: false,
        autoNextEnabled: true,
      );
      expect(pbAction, equals(NaturalEndAction.advanceAutoNext));

      // Dialogue natural end NEVER auto-advances!
      final dgAction = PlaybackContractPolicy.evaluateNaturalEnd(
        track: 'dg',
        singleSentenceLoop: false,
        trackLoop: false,
        autoNextEnabled: true,
      );
      expect(dgAction, equals(NaturalEndAction.stopPlayback));
    });
  });

  group('EP-PBC-001 Completion and Progress Evaluation', () {
    test('Continuous playback crossing 95% on PB marks lesson completed', () {
      final res = PlaybackContractPolicy.evaluateProgress(
        wasPreviouslyCompleted: false,
        wasPreviouslyStarted: true,
        previousPct: 90,
        track: 'pb',
        currentPositionSec: 96.0,
        durationSec: 100.0,
        naturalEnded: false,
        isSeeking: false,
      );

      expect(res.isCompleted, isTrue);
      expect(res.progressPct, equals(96));
    });

    test('Seeking across 95% does NOT mark lesson completed', () {
      final res = PlaybackContractPolicy.evaluateProgress(
        wasPreviouslyCompleted: false,
        wasPreviouslyStarted: true,
        previousPct: 20,
        track: 'pb',
        currentPositionSec: 98.0,
        durationSec: 100.0,
        naturalEnded: false,
        isSeeking: true,
      );

      expect(res.isCompleted, isFalse);
    });

    test('Dialogue (DG) playback NEVER alters isCompleted', () {
      final res = PlaybackContractPolicy.evaluateProgress(
        wasPreviouslyCompleted: false,
        wasPreviouslyStarted: true,
        previousPct: 50,
        track: 'dg',
        currentPositionSec: 100.0,
        durationSec: 100.0,
        naturalEnded: true,
        isSeeking: false,
      );

      expect(res.isCompleted, isFalse);
    });

    test('Completion is monotonic: once true, never reverts', () {
      final res = PlaybackContractPolicy.evaluateProgress(
        wasPreviouslyCompleted: true,
        wasPreviouslyStarted: true,
        previousPct: 100,
        track: 'pb',
        currentPositionSec: 10.0,
        durationSec: 100.0,
        naturalEnded: false,
        isSeeking: false,
      );

      expect(res.isCompleted, isTrue);
      expect(res.progressPct, equals(10));
    });
  });
}

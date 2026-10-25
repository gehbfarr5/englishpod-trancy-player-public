import 'dart:math' as math;

/// EP-PBC-001 v1.4 multi-platform playback behavior and progress contract.
/// Standardizes course entry, track switching, progress persistence, completion,
/// and natural end navigation across Web, iOS, Android, and WeChat Mini Program.

enum CourseEntryIntent {
  /// User tapped a standard course item in the library list.
  library,

  /// User tapped the "Continue Learning" card body or play icon.
  continueListening,

  /// User toggled between Podcast ('pb') and Dialogue ('dg') within the active lesson.
  trackSwitch,

  /// User explicitly tapped Manual Previous Episode.
  manualPrev,

  /// User explicitly tapped Manual Next Episode.
  manualNext,

  /// Audio naturally ended and auto-advancing to the next episode.
  autoNext,

  /// App cold-start or initial restore (never auto-plays audio).
  coldStart,
}

/// Decision outcome for opening a course or transitioning tracks.
class PlaybackTransitionDecision {
  const PlaybackTransitionDecision({
    required this.targetLessonId,
    required this.targetTrack,
    required this.targetPositionSec,
    required this.requestPlay,
    required this.updateLastOpened,
    this.isNoOp = false,
  });

  final String targetLessonId;
  final String targetTrack;
  final double targetPositionSec;
  final bool requestPlay;
  final bool updateLastOpened;
  final bool isNoOp;
}

/// Natural end action decision.
enum NaturalEndAction {
  loopSentence,
  loopCurrentTrack,
  advanceAutoNext,
  stopPlayback,
}

class PlaybackContractPolicy {
  PlaybackContractPolicy._();

  /// Evaluates target course, track, seek position, and play state per EP-PBC-001 Section 2.
  static PlaybackTransitionDecision evaluateTransition({
    required CourseEntryIntent intent,
    required String currentLessonId,
    required String targetLessonId,
    required String currentTrack,
    String? requestedTrack,
    required List<String> lessonIdOrder,
    required bool isCurrentlyPlaying,
    required bool isTargetCompleted,
    required double savedPbSec,
    required double savedDgSec,
    required double pbDurationSec,
    required double dgDurationSec,
  }) {
    switch (intent) {
      case CourseEntryIntent.library:
        // EP-PBC-001: Course list entry ALWAYS opens Podcast ('pb').
        // If completed -> 00:00; if uncompleted -> restore saved PB breakpoint.
        // Explicitly requests playback. Updates lastOpenedLesson.
        final double pos = isTargetCompleted ? 0.0 : _sanitizeRestoreSec(savedPbSec, pbDurationSec);
        return PlaybackTransitionDecision(
          targetLessonId: targetLessonId,
          targetTrack: 'pb',
          targetPositionSec: pos,
          requestPlay: true,
          updateLastOpened: true,
        );

      case CourseEntryIntent.continueListening:
        // EP-PBC-001: Continue card ALWAYS targets PB.
        // If completed -> 00:00; if uncompleted -> restore saved PB breakpoint.
        // Explicitly requests playback. Does NOT change lastOpenedLesson anchor.
        final double pos = isTargetCompleted ? 0.0 : _sanitizeRestoreSec(savedPbSec, pbDurationSec);
        return PlaybackTransitionDecision(
          targetLessonId: targetLessonId,
          targetTrack: 'pb',
          targetPositionSec: pos,
          requestPlay: true,
          updateLastOpened: false,
        );

      case CourseEntryIntent.trackSwitch:
        // EP-PBC-001: Switching between PB and DG in the same lesson restores
        // the target track's own breakpoint. If already ended -> 00:00.
        // Preserves current playing/paused state. Keeps current lesson anchor.
        final targetT = (requestedTrack == 'dg') ? 'dg' : 'pb';
        final savedSec = (targetT == 'dg') ? savedDgSec : savedPbSec;
        final durSec = (targetT == 'dg') ? dgDurationSec : pbDurationSec;
        final pos = _sanitizeRestoreSec(savedSec, durSec);
        return PlaybackTransitionDecision(
          targetLessonId: currentLessonId,
          targetTrack: targetT,
          targetPositionSec: pos,
          requestPlay: isCurrentlyPlaying,
          updateLastOpened: true,
        );

      case CourseEntryIntent.manualPrev:
        // EP-PBC-001: Manual Prev button does NOT loop from first to last.
        // Bound check: first episode disabled / no-op.
        // If valid: target position 00:00, inherits active track & play state.
        final curIdx = lessonIdOrder.indexOf(currentLessonId);
        if (curIdx <= 0) {
          return PlaybackTransitionDecision(
            targetLessonId: currentLessonId,
            targetTrack: currentTrack,
            targetPositionSec: 0.0,
            requestPlay: isCurrentlyPlaying,
            updateLastOpened: false,
            isNoOp: true,
          );
        }
        final prevLessonId = lessonIdOrder[curIdx - 1];
        return PlaybackTransitionDecision(
          targetLessonId: prevLessonId,
          targetTrack: currentTrack,
          targetPositionSec: 0.0,
          requestPlay: isCurrentlyPlaying,
          updateLastOpened: true,
        );

      case CourseEntryIntent.manualNext:
        // EP-PBC-001: Manual Next button does NOT loop from last to first.
        // Bound check: last episode disabled / no-op.
        // If valid: target position 00:00, inherits active track & play state.
        final curIdx = lessonIdOrder.indexOf(currentLessonId);
        if (curIdx < 0 || curIdx >= lessonIdOrder.length - 1) {
          return PlaybackTransitionDecision(
            targetLessonId: currentLessonId,
            targetTrack: currentTrack,
            targetPositionSec: 0.0,
            requestPlay: isCurrentlyPlaying,
            updateLastOpened: false,
            isNoOp: true,
          );
        }
        final nextLessonId = lessonIdOrder[curIdx + 1];
        return PlaybackTransitionDecision(
          targetLessonId: nextLessonId,
          targetTrack: currentTrack,
          targetPositionSec: 0.0,
          requestPlay: isCurrentlyPlaying,
          updateLastOpened: true,
        );

      case CourseEntryIntent.autoNext:
        // EP-PBC-001: Natural end auto-next is ONLY valid for PB.
        // If at last lesson, loops back to first lesson PB at 00:00.
        // Always starts playing from 00:00.
        if (lessonIdOrder.isEmpty) {
          return PlaybackTransitionDecision(
            targetLessonId: currentLessonId,
            targetTrack: 'pb',
            targetPositionSec: 0.0,
            requestPlay: false,
            updateLastOpened: false,
            isNoOp: true,
          );
        }
        final curIdx = lessonIdOrder.indexOf(currentLessonId);
        final nextIdx = (curIdx >= 0 && curIdx < lessonIdOrder.length - 1) ? curIdx + 1 : 0;
        final nextLessonId = lessonIdOrder[nextIdx];
        return PlaybackTransitionDecision(
          targetLessonId: nextLessonId,
          targetTrack: 'pb',
          targetPositionSec: 0.0,
          requestPlay: true,
          updateLastOpened: true,
        );

      case CourseEntryIntent.coldStart:
        // Cold start shows library / continue card pointing to PB. Never auto-plays.
        final double pos = isTargetCompleted ? 0.0 : _sanitizeRestoreSec(savedPbSec, pbDurationSec);
        return PlaybackTransitionDecision(
          targetLessonId: targetLessonId,
          targetTrack: 'pb',
          targetPositionSec: pos,
          requestPlay: false,
          updateLastOpened: false,
        );
    }
  }

  /// Evaluates next action when natural playback ends per EP-PBC-001 Section 3.2.
  /// 1. Single sentence loop -> loop sentence.
  /// 2. Track loop -> loop current track from 00:00.
  /// 3. Auto-next (ONLY for PB) -> advance to next lesson (or loop back to first if last).
  /// 4. Otherwise -> stop playback. (DG natural end always stops unless track loop is active).
  static NaturalEndAction evaluateNaturalEnd({
    required String track,
    required bool singleSentenceLoop,
    required bool trackLoop,
    required bool autoNextEnabled,
  }) {
    if (singleSentenceLoop) {
      return NaturalEndAction.loopSentence;
    }
    if (trackLoop) {
      return NaturalEndAction.loopCurrentTrack;
    }
    if (track == 'pb' && autoNextEnabled) {
      return NaturalEndAction.advanceAutoNext;
    }
    return NaturalEndAction.stopPlayback;
  }

  /// Calculates updated lesson completion and progress percentage per EP-PBC-001 Section 3.1.
  /// - Only PB can trigger lessonCompleted (Dialogue NEVER modifies isCompleted).
  /// - Triggered by continuous playback crossing 95% or natural end of PB.
  /// - Monotonic: once true, never reverts to false.
  static ({bool isCompleted, int progressPct, bool hasStarted}) evaluateProgress({
    required bool wasPreviouslyCompleted,
    required bool wasPreviouslyStarted,
    required int previousPct,
    required String track,
    required double currentPositionSec,
    required double durationSec,
    required bool naturalEnded,
    required bool isSeeking,
  }) {
    int updatedPct = previousPct;
    bool isCompleted = wasPreviouslyCompleted;

    if (track == 'pb') {
      if (naturalEnded) {
        updatedPct = 100;
        isCompleted = true;
      } else if (durationSec > 1.0) {
        if (currentPositionSec < 3.0) {
          updatedPct = 0;
        } else {
          updatedPct = ((currentPositionSec / durationSec) * 100).floor().clamp(0, 100);
        }
        // Only active playing progression across 95% (not user seeking) marks completed!
        if (!isSeeking && updatedPct >= 95) {
          isCompleted = true;
        }
      }
    }

    final hasStarted = wasPreviouslyStarted ||
        isCompleted ||
        updatedPct > 0 ||
        currentPositionSec > 0.5;

    return (
      isCompleted: isCompleted,
      progressPct: updatedPct,
      hasStarted: hasStarted,
    );
  }

  /// Validates and sanitizes restore position against duration.
  static double _sanitizeRestoreSec(double savedSec, double durSec) {
    if (savedSec <= 0.2) return 0.0;
    if (durSec > 2.0 && savedSec >= durSec - 1.5) {
      // Replay from beginning if stopped at the very end
      return 0.0;
    }
    if (durSec > 0.0) {
      return savedSec.clamp(0.0, math.max(0.0, durSec - 0.5));
    }
    return math.max(0.0, savedSec);
  }
}

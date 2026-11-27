import { TrackType } from '../models/LessonModels';

/**
 * EP-PBC-001 v1.4 multi-platform playback behavior and progress contract.
 * 100% behavioral parity with iOS 1.0.2+3 (flutter_app/lib/services/playback_contract_policy.dart).
 */
export enum CourseEntryIntent {
  LIBRARY = 'library',
  CONTINUE_LISTENING = 'continueListening',
  TRACK_SWITCH = 'trackSwitch',
  MANUAL_PREV = 'manualPrev',
  MANUAL_NEXT = 'manualNext',
  AUTO_NEXT = 'autoNext',
  COLD_START = 'coldStart'
}

export enum NaturalEndAction {
  LOOP_SENTENCE = 'loopSentence',
  LOOP_CURRENT_TRACK = 'loopCurrentTrack',
  ADVANCE_AUTO_NEXT = 'advanceAutoNext',
  STOP_PLAYBACK = 'stopPlayback'
}

export interface PlaybackTransitionDecision {
  targetLessonId: string;
  targetTrack: TrackType;
  targetPositionSec: number;
  requestPlay: boolean;
  updateLastOpened: boolean;
  isNoOp: boolean;
}

export interface ProgressEvaluationResult {
  isCompleted: boolean;
  progressPct: number;
  hasStarted: boolean;
}

export interface TransitionParams {
  intent: CourseEntryIntent;
  currentLessonId: string;
  targetLessonId: string;
  currentTrack: TrackType;
  requestedTrack?: TrackType;
  lessonIdOrder: string[];
  isCurrentlyPlaying: boolean;
  playActionOnly?: boolean;
  isTargetCompleted: boolean;
  savedPbSec: number;
  savedDgSec: number;
  pbDurationSec: number;
  dgDurationSec: number;
}

export interface ProgressEvalParams {
  wasPreviouslyCompleted: boolean;
  wasPreviouslyStarted: boolean;
  previousPct: number;
  track: TrackType;
  currentPositionSec: number;
  durationSec: number;
  naturalEnded: boolean;
  isSeeking: boolean;
}

export class PlaybackContractPolicy {
  static evaluateTransition(params: TransitionParams): PlaybackTransitionDecision {
    switch (params.intent) {
      case CourseEntryIntent.LIBRARY: {
        const pos = params.isTargetCompleted
          ? 0.0
          : PlaybackContractPolicy.sanitizeRestoreSec(params.savedPbSec, params.pbDurationSec);
        return {
          targetLessonId: params.targetLessonId,
          targetTrack: 'pb',
          targetPositionSec: pos,
          requestPlay: true,
          updateLastOpened: true,
          isNoOp: false
        };
      }
      case CourseEntryIntent.CONTINUE_LISTENING: {
        const pos = params.isTargetCompleted
          ? 0.0
          : PlaybackContractPolicy.sanitizeRestoreSec(params.savedPbSec, params.pbDurationSec);
        const shouldPlay = params.playActionOnly === false ? params.isCurrentlyPlaying : true;
        return {
          targetLessonId: params.targetLessonId,
          targetTrack: 'pb',
          targetPositionSec: pos,
          requestPlay: shouldPlay,
          updateLastOpened: false,
          isNoOp: false
        };
      }
      case CourseEntryIntent.TRACK_SWITCH: {
        const targetT: TrackType = params.requestedTrack === 'dg' ? 'dg' : 'pb';
        const savedSec = targetT === 'dg' ? params.savedDgSec : params.savedPbSec;
        const durSec = targetT === 'dg' ? params.dgDurationSec : params.pbDurationSec;
        const pos = PlaybackContractPolicy.sanitizeRestoreSec(savedSec, durSec);
        return {
          targetLessonId: params.currentLessonId,
          targetTrack: targetT,
          targetPositionSec: pos,
          requestPlay: params.isCurrentlyPlaying,
          updateLastOpened: true,
          isNoOp: false
        };
      }
      case CourseEntryIntent.MANUAL_PREV: {
        const curIdx = params.lessonIdOrder.indexOf(params.currentLessonId);
        if (curIdx <= 0) {
          return {
            targetLessonId: params.currentLessonId,
            targetTrack: params.currentTrack,
            targetPositionSec: 0.0,
            requestPlay: params.isCurrentlyPlaying,
            updateLastOpened: false,
            isNoOp: true
          };
        }
        return {
          targetLessonId: params.lessonIdOrder[curIdx - 1],
          targetTrack: params.currentTrack,
          targetPositionSec: 0.0,
          requestPlay: params.isCurrentlyPlaying,
          updateLastOpened: true,
          isNoOp: false
        };
      }
      case CourseEntryIntent.MANUAL_NEXT: {
        const curIdx = params.lessonIdOrder.indexOf(params.currentLessonId);
        if (curIdx < 0 || curIdx >= params.lessonIdOrder.length - 1) {
          return {
            targetLessonId: params.currentLessonId,
            targetTrack: params.currentTrack,
            targetPositionSec: 0.0,
            requestPlay: params.isCurrentlyPlaying,
            updateLastOpened: false,
            isNoOp: true
          };
        }
        return {
          targetLessonId: params.lessonIdOrder[curIdx + 1],
          targetTrack: params.currentTrack,
          targetPositionSec: 0.0,
          requestPlay: params.isCurrentlyPlaying,
          updateLastOpened: true,
          isNoOp: false
        };
      }
      case CourseEntryIntent.AUTO_NEXT: {
        if (params.lessonIdOrder.length === 0) {
          return {
            targetLessonId: params.currentLessonId,
            targetTrack: 'pb',
            targetPositionSec: 0.0,
            requestPlay: false,
            updateLastOpened: false,
            isNoOp: true
          };
        }
        const curIdx = params.lessonIdOrder.indexOf(params.currentLessonId);
        const nextIdx = (curIdx >= 0 && curIdx < params.lessonIdOrder.length - 1) ? curIdx + 1 : 0;
        return {
          targetLessonId: params.lessonIdOrder[nextIdx],
          targetTrack: 'pb',
          targetPositionSec: 0.0,
          requestPlay: true,
          updateLastOpened: true,
          isNoOp: false
        };
      }
      case CourseEntryIntent.COLD_START: {
        const pos = params.isTargetCompleted
          ? 0.0
          : PlaybackContractPolicy.sanitizeRestoreSec(params.savedPbSec, params.pbDurationSec);
        return {
          targetLessonId: params.targetLessonId,
          targetTrack: 'pb',
          targetPositionSec: pos,
          requestPlay: false,
          updateLastOpened: false,
          isNoOp: false
        };
      }
    }
  }

  static evaluateNaturalEnd(
    track: TrackType,
    singleSentenceLoop: boolean,
    trackLoop: boolean,
    autoNextEnabled: boolean
  ): NaturalEndAction {
    if (singleSentenceLoop) {
      return NaturalEndAction.LOOP_SENTENCE;
    }
    if (trackLoop) {
      return NaturalEndAction.LOOP_CURRENT_TRACK;
    }
    if (track === 'pb' && autoNextEnabled) {
      return NaturalEndAction.ADVANCE_AUTO_NEXT;
    }
    return NaturalEndAction.STOP_PLAYBACK;
  }

  static evaluateProgress(params: ProgressEvalParams): ProgressEvaluationResult {
    let updatedPct = params.previousPct;
    let isCompleted = params.wasPreviouslyCompleted;

    if (params.track === 'pb') {
      if (params.naturalEnded) {
        updatedPct = 100;
        isCompleted = true;
      } else if (params.durationSec > 1.0) {
        if (params.currentPositionSec < 3.0) {
          updatedPct = 0;
        } else {
          updatedPct = Math.max(0, Math.min(100, Math.floor((params.currentPositionSec / params.durationSec) * 100)));
        }
        if (!params.isSeeking && updatedPct >= 95) {
          isCompleted = true;
        }
      }
    }

    const hasStarted =
      params.wasPreviouslyStarted ||
      isCompleted ||
      updatedPct > 0 ||
      params.currentPositionSec > 0.5;

    return {
      isCompleted,
      progressPct: updatedPct,
      hasStarted
    };
  }

  static sanitizeRestoreSec(savedSec: number, durSec: number): number {
    if (savedSec <= 0.2) {
      return 0.0;
    }
    if (durSec > 2.0 && savedSec >= durSec - 1.5) {
      return 0.0;
    }
    if (durSec > 0.0) {
      return Math.max(0.0, Math.min(Math.max(0.0, durSec - 0.5), savedSec));
    }
    return Math.max(0.0, savedSec);
  }
}

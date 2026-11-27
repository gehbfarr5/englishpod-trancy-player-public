import { Want } from '@kit.AbilityKit';
import { TrackType } from '@englishpod/ep_domain';

export interface ContinuityPayload {
  lessonId: string;
  track: TrackType;
  positionSec: number;
  playbackSpeed: number;
  loopSentence: boolean;
}

/**
 * Handles HarmonyOS Cross-Device Continuity (onContinue -> Tablet / HarmonyOS PC)
 * and Tap-to-Share (碰一碰精准分享) metadata serialization.
 */
export class ContinuityAndShareManager {
  static writeContinuityWant(wantParam: Record<string, Object>, payload: ContinuityPayload): void {
    wantParam['ep_lessonId'] = payload.lessonId;
    wantParam['ep_track'] = payload.track;
    wantParam['ep_positionSec'] = payload.positionSec;
    wantParam['ep_playbackSpeed'] = payload.playbackSpeed;
    wantParam['ep_loopSentence'] = payload.loopSentence;
  }

  static readContinuityWant(want: Want): ContinuityPayload | null {
    const params = want.parameters;
    if (!params || !params['ep_lessonId']) {
      return null;
    }
    const rawTrack = params['ep_track'] as string;
    return {
      lessonId: String(params['ep_lessonId']),
      track: rawTrack === 'dg' ? 'dg' : 'pb',
      positionSec: Number(params['ep_positionSec'] ?? 0),
      playbackSpeed: Number(params['ep_playbackSpeed'] ?? 1.0),
      loopSentence: Boolean(params['ep_loopSentence'] ?? false)
    };
  }

  static buildKnockShareSummary(lessonCode: string, lessonTitle: string, activeSentence: string): string {
    return `[EnglishPod ${lessonCode}] ${lessonTitle}\n"${activeSentence}"`;
  }
}

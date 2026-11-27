import { TranscriptSegment, TrackType } from '../models/LessonModels';

export interface StageGroupInfo {
  boxGroupId: number;
  kind: 'dialogue' | 'example';
  badgeText: string;
  subText: string;
  isFirstInBox: boolean;
  isLastInBox: boolean;
}

/**
 * 1:1 port of iOS _computeStageGroups & _resolveSpeakerDisplayName (main.dart:6172-6283, 8191-8212).
 * Groups Dialogue and Example blocks into Stage Container Boxes while leaving open host commentary bare.
 */
export class StageGroupCalculator {
  static computeStageGroups(
    segs: TranscriptSegment[],
    track: TrackType
  ): (StageGroupInfo | null)[] {
    const n = segs.length;
    if (n === 0) {
      return [];
    }

    if (track === 'dg') {
      const dgResult: (StageGroupInfo | null)[] = [];
      for (let i = 0; i < n; i++) {
        dgResult.push({
          boxGroupId: 0,
          kind: 'dialogue',
          badgeText: 'FULL DIALOGUE TRACK',
          subText: 'Original Scene',
          isFirstInBox: i === 0,
          isLastInBox: i === n - 1
        });
      }
      return dgResult;
    }

    const rawKind: ('dialogue' | 'example' | null)[] = new Array(n).fill(null);
    const customBadge: string[] = new Array(n).fill('');

    let i = 0;
    while (i < n) {
      const s = segs[i];
      const spk = s.speaker.trim();
      const txt = s.text.trim();

      if (s.isSection || s.inDialogueBlock) {
        rawKind[i] = 'dialogue';
        if (s.isSection) {
          customBadge[i] = txt.toUpperCase();
        }
        i++;
        continue;
      }

      if (spk.toLowerCase().startsWith('example')) {
        rawKind[i] = 'example';
        customBadge[i] = 'EXAMPLES · IN ACTION';
        i++;
        continue;
      }

      if (spk === 'Voice' && txt.toLowerCase().startsWith('example')) {
        rawKind[i] = 'example';
        customBadge[i] = 'EXAMPLES · IN ACTION';
        if (
          i + 1 < n &&
          !segs[i + 1].isSection &&
          segs[i + 1].speaker !== 'M' &&
          segs[i + 1].speaker !== 'Voice'
        ) {
          rawKind[i + 1] = 'example';
          const firstSpk = segs[i + 1].speaker;
          if (i + 2 < n && !segs[i + 2].isSection) {
            const secSpk = segs[i + 2].speaker;
            const secTxt = segs[i + 2].text.trim();
            const isPairedTurn =
              (firstSpk === 'A' && secSpk === 'B') ||
              (firstSpk === 'C' && secSpk === 'D') ||
              (firstSpk === 'E' && secSpk === 'F') ||
              (firstSpk === 'B' && secSpk === 'C' && !secTxt.startsWith('Alright'));
            if (isPairedTurn) {
              rawKind[i + 2] = 'example';
              i += 3;
              continue;
            }
          }
          i += 2;
          continue;
        }
        i++;
        continue;
      }

      i++;
    }

    const result: (StageGroupInfo | null)[] = new Array(n).fill(null);
    let currentBoxId = 0;
    for (let idx = 0; idx < n; idx++) {
      const k = rawKind[idx];
      if (k === null) {
        continue;
      }
      const isFirst = idx === 0 || rawKind[idx - 1] !== k;
      if (isFirst) {
        currentBoxId++;
      }
      const isLast = idx === n - 1 || rawKind[idx + 1] !== k;

      let badge = customBadge[idx];
      if (!badge) {
        badge = k === 'dialogue' ? 'DIALOGUE · SCENE' : 'EXAMPLES · IN ACTION';
      }
      const sub = k === 'dialogue' ? 'Scene Transcript' : 'Usage Examples';

      result[idx] = {
        boxGroupId: currentBoxId,
        kind: k,
        badgeText: badge,
        subText: sub,
        isFirstInBox: isFirst,
        isLastInBox: isLast
      };
    }
    return result;
  }

  static resolveSpeakerDisplayName(
    seg: TranscriptSegment,
    stageInfo: StageGroupInfo | null
  ): string {
    const spk = seg.speaker.trim();
    if (!spk) {
      return '•';
    }
    if (stageInfo === null) {
      if (spk === 'M') return 'MARCO';
      if (spk === 'E') return 'ERICA';
      if (spk === 'C') return 'CATHERINE';
      if (spk === 'A') return 'AMIRA';
      if (spk === 'S') return 'SARAH';
      if (spk === 'P') return 'PETER';
      if (spk === 'C,M' || spk === 'M,C') return 'MARCO & CATHERINE';
    } else if (spk === 'M') {
      return 'MARCO';
    }
    return spk.toUpperCase();
  }
}

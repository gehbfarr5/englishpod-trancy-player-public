export type TrackType = 'pb' | 'dg';

export enum AppThemePreference {
  SYSTEM = 'system',
  DARK = 'dark',
  PAPER = 'paper'
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  id: number;
  speaker: string;
  text: string;
  isSection: boolean;
  inDialogueBlock: boolean;
  start: number;
  end: number;
  words: WordTiming[];
}

export interface VocabEntry {
  type: 'key' | 'supplementary';
  word: string;
  pos: string;
  definition: string;
}

export interface LessonSummary {
  lessonNumber: number;
  lessonId: string;
  code: string;
  level: string;
  title: string;
  dgCount: number;
  pbCount: number;
  vocabCount: number;
  audio: Record<string, string>;
}

export interface LessonDetail {
  lessonNumber: number;
  lessonId: string;
  code: string;
  level: string;
  title: string;
  rawTitle: string;
  audio: Record<string, string>;
  vocabulary: VocabEntry[];
  dgSegments: TranscriptSegment[];
  pbSegments: TranscriptSegment[];
}

export interface LessonProgressRecord {
  lessonId: string;
  savedPbSec: number;
  savedDgSec: number;
  pbSegIdx: number;
  dgSegIdx: number;
  lastTrack: TrackType;
  pbDurationSec: number;
  dgDurationSec: number;
  progressPct: number;
  isCompleted: boolean;
  hasStarted: boolean;
  updatedAtMs: number;
}

export interface TextSpanToken {
  text: string;
  vocab?: VocabEntry;
}

export interface VocabContextExample {
  track: TrackType;
  segmentIndex: number;
  segment: TranscriptSegment;
}

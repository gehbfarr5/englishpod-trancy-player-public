import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import {
  LessonDetail,
  LessonSummary,
  TranscriptSegment,
  VocabEntry,
  WordTiming
} from '../models/LessonModels';

interface RawWordTiming {
  word?: string;
  start?: number;
  end?: number;
}

interface RawSegment {
  id?: number;
  speaker?: string;
  text?: string;
  is_section?: boolean;
  in_dialogue_block?: boolean;
  start?: number;
  end?: number;
  words?: RawWordTiming[];
}

interface RawVocab {
  type?: string;
  word?: string;
  pos?: string;
  definition?: string;
}

interface RawSummary {
  lesson_number?: number;
  lesson_id?: string;
  code?: string;
  level?: string;
  title?: string;
  dg_count?: number;
  pb_count?: number;
  vocab_count?: number;
  audio?: Record<string, string>;
}

interface RawDetailTracks {
  dg?: RawSegment[];
  pb?: RawSegment[];
}

interface RawDetail {
  lesson_number?: number;
  LessonId?: string;
  lesson_id?: string;
  code?: string;
  level?: string;
  title?: string;
  raw_title?: string;
  audio?: Record<string, string>;
  vocabulary?: RawVocab[];
  tracks?: RawDetailTracks;
}

export class LessonAssetLoader {
  private static decoder: util.TextDecoder = util.TextDecoder.create('utf-8');

  static async loadIndex(context: common.Context): Promise<LessonSummary[]> {
    const bytes = await context.resourceManager.getRawFileContent('lessons_safe/index.json');
    const jsonStr = LessonAssetLoader.decoder.decodeToString(bytes);
    const rawList = JSON.parse(jsonStr) as RawSummary[];
    return rawList.map((item, idx): LessonSummary => {
      const defaultAudio: Record<string, string> = {};
      defaultAudio['dg'] = 'dg.mp3';
      defaultAudio['pb'] = 'pb.mp3';
      return {
        lessonNumber: item.lesson_number ?? idx + 1,
        lessonId: item.lesson_id ?? String(idx + 1).padStart(4, '0'),
        code: item.code ?? `B${String(idx + 1).padStart(4, '0')}`,
        level: item.level ?? 'Elementary',
        title: item.title ?? '',
        dgCount: item.dg_count ?? 0,
        pbCount: item.pb_count ?? 0,
        vocabCount: item.vocab_count ?? 0,
        audio: item.audio ?? defaultAudio
      };
    });
  }

  static async loadLessonDetail(context: common.Context, lessonId: string): Promise<LessonDetail> {
    const padded = lessonId.padStart(4, '0');
    const bytes = await context.resourceManager.getRawFileContent(`lessons_safe/lesson_${padded}.json`);
    const jsonStr = LessonAssetLoader.decoder.decodeToString(bytes);
    const raw = JSON.parse(jsonStr) as RawDetail;

    const mapSeg = (s: RawSegment, i: number): TranscriptSegment => ({
      id: s.id ?? i,
      speaker: s.speaker ?? '',
      text: s.text ?? '',
      isSection: s.is_section ?? false,
      inDialogueBlock: s.in_dialogue_block ?? false,
      start: s.start ?? 0,
      end: s.end ?? 0,
      words: (s.words ?? []).map((w): WordTiming => ({
        word: w.word ?? '',
        start: w.start ?? 0,
        end: w.end ?? 0
      }))
    });

    const mapVocab = (v: RawVocab): VocabEntry => ({
      type: v.type === 'supplementary' ? 'supplementary' : 'key',
      word: v.word ?? '',
      pos: v.pos ?? '',
      definition: v.definition ?? ''
    });

    const defaultDetailAudio: Record<string, string> = {};
    defaultDetailAudio['dg'] = 'dg.mp3';
    defaultDetailAudio['pb'] = 'pb.mp3';
    return {
      lessonNumber: raw.lesson_number ?? 1,
      lessonId: raw.LessonId ?? raw.lesson_id ?? padded,
      code: raw.code ?? `B${padded}`,
      level: raw.level ?? 'Elementary',
      title: raw.title ?? '',
      rawTitle: raw.raw_title ?? '',
      audio: raw.audio ?? defaultDetailAudio,
      vocabulary: (raw.vocabulary ?? []).map(mapVocab),
      dgSegments: (raw.tracks?.dg ?? []).map(mapSeg),
      pbSegments: (raw.tracks?.pb ?? []).map(mapSeg)
    };
  }
}

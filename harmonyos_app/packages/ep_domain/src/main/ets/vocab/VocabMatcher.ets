import { LessonDetail, TextSpanToken, TranscriptSegment, VocabContextExample, VocabEntry } from '../models/LessonModels';

/**
 * Tokenizes a transcript sentence into plain text and interactive vocabulary spans,
 * plus finds contextual sentences per vocabulary entry (1:1 port of iOS _findContextualSentencesForWord).
 */
export class VocabMatcher {
  static tokenize(sentence: string, vocabulary: VocabEntry[]): TextSpanToken[] {
    if (!sentence || vocabulary.length === 0) {
      return [{ text: sentence }];
    }

    const sorted = [...vocabulary]
      .filter((v) => v.word.trim().length > 0)
      .sort((a, b) => b.word.length - a.word.length);

    if (sorted.length === 0) {
      return [{ text: sentence }];
    }

    const escaped = sorted.map((v) => VocabMatcher.escapeRegex(v.word.trim()));
    const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');

    const tokens: TextSpanToken[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(sentence);

    while (match !== null) {
      if (match.index > lastIndex) {
        tokens.push({ text: sentence.slice(lastIndex, match.index) });
      }
      const matchedText = match[0];
      const lower = matchedText.toLowerCase();
      const entry = sorted.find((v) => v.word.trim().toLowerCase() === lower);
      tokens.push({ text: matchedText, vocab: entry });
      lastIndex = pattern.lastIndex;
      match = pattern.exec(sentence);
    }

    if (lastIndex < sentence.length) {
      tokens.push({ text: sentence.slice(lastIndex) });
    }

    return tokens.length > 0 ? tokens : [{ text: sentence }];
  }

  static findContextualSentencesForWord(lesson: LessonDetail, word: string): VocabContextExample[] {
    const trimmed = word.trim();
    if (!trimmed) {
      return [];
    }
    const pattern = new RegExp(`\\b${VocabMatcher.escapeRegex(trimmed)}\\b`, 'i');
    const matches: VocabContextExample[] = [];

    for (let i = 0; i < lesson.pbSegments.length; i++) {
      const seg: TranscriptSegment = lesson.pbSegments[i];
      if (!seg.isSection && pattern.test(seg.text)) {
        matches.push({ track: 'pb', segmentIndex: i, segment: seg });
        if (matches.length >= 3) {
          return matches;
        }
      }
    }

    for (let i = 0; i < lesson.dgSegments.length; i++) {
      const seg: TranscriptSegment = lesson.dgSegments[i];
      if (!seg.isSection && pattern.test(seg.text)) {
        const duplicate = matches.some((m) => m.segment.text.trim() === seg.text.trim());
        if (!duplicate) {
          matches.push({ track: 'dg', segmentIndex: i, segment: seg });
          if (matches.length >= 3) {
            return matches;
          }
        }
      }
    }

    return matches;
  }

  private static escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

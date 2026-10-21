class WordTiming {
  final String word;
  final double start;
  final double end;

  const WordTiming({
    required this.word,
    required this.start,
    required this.end,
  });

  factory WordTiming.fromJson(Map<String, dynamic> json) {
    return WordTiming(
      word: (json['word'] as String?) ?? '',
      start: ((json['start'] as num?) ?? 0.0).toDouble(),
      end: ((json['end'] as num?) ?? 0.0).toDouble(),
    );
  }
}

class TranscriptSegment {
  final int id;
  final String speaker;
  final String text;
  final bool isSection;
  final bool inDialogueBlock;
  final double start;
  final double end;
  final List<WordTiming> words;

  const TranscriptSegment({
    required this.id,
    required this.speaker,
    required this.text,
    required this.isSection,
    required this.inDialogueBlock,
    required this.start,
    required this.end,
    required this.words,
  });

  factory TranscriptSegment.fromJson(Map<String, dynamic> json) {
    final rawWords = (json['words'] as List<dynamic>?) ?? const [];
    return TranscriptSegment(
      id: (json['id'] as num?)?.toInt() ?? 0,
      speaker: (json['speaker'] as String?) ?? '',
      text: (json['text'] as String?) ?? '',
      isSection: (json['is_section'] as bool?) ?? false,
      inDialogueBlock: (json['in_dialogue_block'] as bool?) ?? false,
      start: ((json['start'] as num?) ?? 0.0).toDouble(),
      end: ((json['end'] as num?) ?? 0.0).toDouble(),
      words: rawWords
          .map((w) => WordTiming.fromJson(w as Map<String, dynamic>))
          .toList(),
    );
  }
}

class VocabEntry {
  final String type; // 'key' or 'supplementary'
  final String word;
  final String pos;
  final String definition;

  const VocabEntry({
    required this.type,
    required this.word,
    required this.pos,
    required this.definition,
  });

  factory VocabEntry.fromJson(Map<String, dynamic> json) {
    return VocabEntry(
      type: (json['type'] as String?) ?? 'key',
      word: (json['word'] as String?) ?? '',
      pos: (json['pos'] as String?) ?? '',
      definition: (json['definition'] as String?) ?? '',
    );
  }
}

class LessonSummary {
  final int lessonNumber;
  final String lessonId;
  final String code;
  final String level;
  final String title;
  final int dgCount;
  final int pbCount;
  final int vocabCount;
  final Map<String, String> audio;

  const LessonSummary({
    required this.lessonNumber,
    required this.lessonId,
    required this.code,
    required this.level,
    required this.title,
    required this.dgCount,
    required this.pbCount,
    required this.vocabCount,
    required this.audio,
  });

  factory LessonSummary.fromJson(Map<String, dynamic> json) {
    final rawAudio = (json['audio'] as Map<String, dynamic>?) ?? const {};
    return LessonSummary(
      lessonNumber: (json['lesson_number'] as num?)?.toInt() ?? 1,
      lessonId: (json['lesson_id'] as String?) ?? '0001',
      code: (json['code'] as String?) ?? 'B0001',
      level: (json['level'] as String?) ?? 'Elementary',
      title: (json['title'] as String?) ?? '',
      dgCount: (json['dg_count'] as num?)?.toInt() ?? 0,
      pbCount: (json['pb_count'] as num?)?.toInt() ?? 0,
      vocabCount: (json['vocab_count'] as num?)?.toInt() ?? 0,
      audio: rawAudio.map((k, v) => MapEntry(k, v.toString())),
    );
  }
}

class LessonDetail {
  final int lessonNumber;
  final String lessonId;
  final String code;
  final String level;
  final String title;
  final String rawTitle;
  final Map<String, String> audio;
  final List<VocabEntry> vocabulary;
  final List<TranscriptSegment> dgSegments;
  final List<TranscriptSegment> pbSegments;

  const LessonDetail({
    required this.lessonNumber,
    required this.lessonId,
    required this.code,
    required this.level,
    required this.title,
    required this.rawTitle,
    required this.audio,
    required this.vocabulary,
    required this.dgSegments,
    required this.pbSegments,
  });

  List<TranscriptSegment> segmentsForTrack(String track) {
    return track == 'pb' ? pbSegments : dgSegments;
  }

  factory LessonDetail.fromJson(Map<String, dynamic> json) {
    final rawAudio = (json['audio'] as Map<String, dynamic>?) ?? const {};
    final rawVocab = (json['vocabulary'] as List<dynamic>?) ?? const [];
    final tracks = (json['tracks'] as Map<String, dynamic>?) ?? const {};
    final rawDg = (tracks['dg'] as List<dynamic>?) ?? const [];
    final rawPb = (tracks['pb'] as List<dynamic>?) ?? const [];

    return LessonDetail(
      lessonNumber: (json['lesson_number'] as num?)?.toInt() ?? 1,
      lessonId: (json['LessonId'] as String?) ?? '0001',
      code: (json['code'] as String?) ?? 'B0001',
      level: (json['level'] as String?) ?? 'Elementary',
      title: (json['title'] as String?) ?? '',
      rawTitle: (json['raw_title'] as String?) ?? '',
      audio: rawAudio.map((k, v) => MapEntry(k, v.toString())),
      vocabulary: rawVocab
          .map((e) => VocabEntry.fromJson(e as Map<String, dynamic>))
          .toList(),
      dgSegments: rawDg
          .map((e) => TranscriptSegment.fromJson(e as Map<String, dynamic>))
          .toList(),
      pbSegments: rawPb
          .map((e) => TranscriptSegment.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

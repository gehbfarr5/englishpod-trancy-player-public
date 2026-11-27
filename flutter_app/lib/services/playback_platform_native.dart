import 'dart:io';

import 'package:flutter/services.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';

bool get isIOS => Platform.isIOS;

const String _kDefaultSeoulAudioBase = 'https://43.155.232.185:8888/audio';

String get seoulAudioBaseUrl {
  const configured = String.fromEnvironment('EP_AUDIO_BASE', defaultValue: _kDefaultSeoulAudioBase);
  return configured.endsWith('/')
      ? configured.substring(0, configured.length - 1)
      : configured;
}

Future<(Uri, Uri)> prepareBrandArtwork() async {
  final dir = await getApplicationSupportDirectory();
  Future<Uri> materialize(String theme) async {
    final file = File('${dir.path}/brand_icon_${theme}_v1.png');
    if (!file.existsSync()) {
      final data = await rootBundle.load('assets/branding/brand_icon_$theme.png');
      await file.writeAsBytes(
        data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
        flush: true,
      );
    }
    return Uri.file(file.path);
  }
  return (await materialize('dark'), await materialize('light'));
}

Future<Duration?> loadLessonAudio(
  AudioPlayer player, String lessonId, String audioPath,
) async {
  final fileName = audioPath.split('/').last;
  final candidates = <String>[
    '/sdcard/Android/data/com.englishpod.trancy.englishpod_trancy/files/audio/$lessonId/$fileName',
    '/sdcard/Android/media/com.englishpod.trancy.englishpod_trancy/audio/$lessonId/$fileName',
    '/sdcard/Android/media/com.englishpod.trancy/audio/$lessonId/$fileName',
    if (audioPath.isNotEmpty && !audioPath.startsWith('http')) audioPath,
  ];
  for (final path in candidates) {
    if (File(path).existsSync()) return player.setFilePath(path);
  }

  // Fetch/stream audio from Seoul server
  final remoteUrl = '$seoulAudioBaseUrl/$lessonId/$fileName';
  try {
    return await player.setUrl(remoteUrl);
  } catch (_) {
    // Fallback to local asset if offline or remote unreachable
    try {
      return await player.setAsset('assets/audio/$lessonId/$fileName');
    } catch (_) {
      rethrow;
    }
  }
}

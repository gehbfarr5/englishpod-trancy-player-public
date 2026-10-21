import 'dart:io';

import 'package:flutter/services.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';

bool get isIOS => Platform.isIOS;

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
    if (audioPath.isNotEmpty) audioPath,
  ];
  for (final path in candidates) {
    if (File(path).existsSync()) return player.setFilePath(path);
  }
  return player.setAsset('assets/audio/$lessonId/$fileName');
}

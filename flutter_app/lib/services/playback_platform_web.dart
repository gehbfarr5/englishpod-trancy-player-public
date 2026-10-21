import 'package:just_audio/just_audio.dart';

import 'web_audio_uri.dart';

bool get isIOS => false;

Future<(Uri, Uri)> prepareBrandArtwork() async => (
  Uri.base.resolve('assets/assets/branding/brand_icon_dark.png'),
  Uri.base.resolve('assets/assets/branding/brand_icon_light.png'),
);

Future<Duration?> loadLessonAudio(
  AudioPlayer player, String lessonId, String audioPath,
) => player.setUrl(webAudioUri(Uri.base, lessonId, audioPath,
    audioRoot: const String.fromEnvironment('WEB_AUDIO_ROOT',
        defaultValue: '/audio/')).toString());

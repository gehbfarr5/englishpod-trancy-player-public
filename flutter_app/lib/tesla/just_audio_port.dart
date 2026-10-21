import 'dart:async';
import 'package:just_audio/just_audio.dart';
import '../models/lesson_models.dart';
import '../services/web_audio_uri.dart';
import 'playback_contract.dart';

class JustAudioPort implements ContractAudio {
  final _player = AudioPlayer();
  final _subscriptions = <StreamSubscription<dynamic>>[];
  void Function(double)? _position;
  void Function()? _ended;
  void Function(Object)? _error;
  JustAudioPort() {
    _subscriptions.add(_player.positionStream.listen((p) => _position?.call(p.inMilliseconds / 1000)));
    _subscriptions.add(_player.playerStateStream.listen((s) {
      if (s.processingState == ProcessingState.completed) _ended?.call();
    }));
    _subscriptions.add(_player.playbackEventStream.listen((_) {}, onError: (Object e) => _error?.call(e)));
  }
  @override
  set onPosition(void Function(double) callback) => _position = callback;
  @override
  set onEnded(void Function() callback) => _ended = callback;
  @override
  set onError(void Function(Object) callback) => _error = callback;
  @override
  Future<double> load(LessonDetail lesson, String track) async {
    final uri = webAudioUri(Uri.base, lesson.lessonId, lesson.audio[track] ?? '');
    final d = await _player.setUrl(uri.toString());
    return (d?.inMilliseconds ?? 0) / 1000;
  }
  @override
  Future<void> seek(double seconds) => _player.seek(Duration(milliseconds: (seconds * 1000).round()));
  @override
  Future<void> play() => _player.play();
  @override
  Future<void> pause() => _player.pause();
  @override
  Future<void> speed(double value) => _player.setSpeed(value);
  @override
  Future<void> dispose() async {
    _position = null; _ended = null; _error = null;
    for (final s in _subscriptions) { await s.cancel(); }
    await _player.dispose();
  }
}

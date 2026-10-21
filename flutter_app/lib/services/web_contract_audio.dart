import 'dart:async';
import 'package:just_audio/just_audio.dart';
import 'package:http/http.dart' as http;
import '../models/lesson_models.dart';
import 'web_audio_uri.dart';
import 'web_contract_player.dart';

class WebContractAudio implements ContractAudio {
  final _player = AudioPlayer();
  final _http = http.Client();
  bool _disposed = false;
  final _subscriptions = <StreamSubscription<dynamic>>[];
  void Function(double)? _position;
  void Function()? _ended;
  void Function(Object)? _error;
  WebContractAudio() {
    _subscriptions.add(_player.positionStream.listen((p) => _position?.call(_player.position.inMilliseconds / 1000)));
    _subscriptions.add(_player.playerStateStream.listen((s) {
      if (s.processingState == ProcessingState.completed && _player.processingState == ProcessingState.completed) {
        // Deliver the final media time before ended: a genuine short tail after
        // a seek must not depend on positionStream's sampling interval.
        _position?.call((_player.duration ?? _player.position).inMilliseconds / 1000);
        _ended?.call();
      }
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
    final uri = webAudioUri(Uri.base, lesson.lessonId, lesson.audio[track] ?? '',
      audioRoot: const String.fromEnvironment('WEB_AUDIO_ROOT', defaultValue: '/audio/'));
    try {
      final d = await _player.setUrl(uri.toString());
      return (d?.inMilliseconds ?? 0) / 1000;
    } catch (error) {
      // HTML media errors alone cannot distinguish HTTP 404 from a temporary
      // server failure. Probe status only after failure; never prefetch media.
      int? status;
      try { status = (await _http.head(uri).timeout(const Duration(seconds: 3))).statusCode; } catch (_) {}
      if (status == 404 || status == 410) throw StateError('404 audio not found');
      if (status == 408 || status == 429 || (status != null && status >= 500)) {
        throw TimeoutException('Temporary audio HTTP $status');
      }
      if (error is PlayerException && (error.code == 3 || error.code == 4)) {
        throw StateError('Unsupported audio format or decode failure');
      }
      rethrow;
    }
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
    if (_disposed) return;
    _disposed = true;
    final paused = _player.pause();
    _position = null; _ended = null; _error = null;
    _http.close();
    for (final s in _subscriptions) { await s.cancel(); }
    await paused;
    await _player.dispose();
  }
}

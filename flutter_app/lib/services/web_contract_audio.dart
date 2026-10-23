import 'dart:async';
import 'package:just_audio/just_audio.dart';
import 'package:http/http.dart' as http;
import '../models/lesson_models.dart';
import 'web_audio_uri.dart';
import 'web_contract_player.dart';

class WebContractAudio implements ContractAudio {
  static AudioPlayer? _sharedPlayer;
  static http.Client? _sharedHttp;

  final AudioPlayer _player;
  final http.Client _http;
  final bool _isShared;
  bool _disposed = false;
  bool _loaded = false;
  ProcessingState? _previousState;
  final _subscriptions = <StreamSubscription<dynamic>>[];
  void Function(double)? _position;
  void Function()? _ended;
  void Function(Object)? _error;

  WebContractAudio({AudioPlayer? player, http.Client? client, bool shared = true})
      : _player = player ?? (shared ? (_sharedPlayer ??= AudioPlayer()) : AudioPlayer()),
        _http = client ?? (shared ? (_sharedHttp ??= http.Client()) : http.Client()),
        _isShared = player == null && shared {
    _subscriptions.add(_player.positionStream.listen((p) {
      if (_loaded && !_disposed) {
        _position?.call(_player.position.inMilliseconds / 1000);
      }
    }));
    _subscriptions.add(_player.playerStateStream.listen((s) {
      final wasCompleted = _previousState == ProcessingState.completed;
      _previousState = s.processingState;
      if (_loaded && !_disposed && !wasCompleted && s.processingState == ProcessingState.completed) {
        // Deliver the final media time before ended: a genuine short tail after
        // a seek must not depend on positionStream's sampling interval.
        _position?.call((_player.duration ?? _player.position).inMilliseconds / 1000);
        _ended?.call();
      }
    }));
    _subscriptions.add(_player.playbackEventStream.listen((_) {}, onError: (Object e) {
      if (_loaded && !_disposed) _error?.call(e);
    }));
  }
  @override
  set onPosition(void Function(double) callback) => _position = callback;
  @override
  set onEnded(void Function() callback) => _ended = callback;
  @override
  set onError(void Function(Object) callback) => _error = callback;
  @override
  Future<double> load(LessonDetail lesson, String track) async {
    _loaded = false;
    final uri = webAudioUri(Uri.base, lesson.lessonId, lesson.audio[track] ?? '',
      audioRoot: const String.fromEnvironment('WEB_AUDIO_ROOT', defaultValue: '/audio/'));
    try {
      final d = await _player.setUrl(uri.toString());
      _loaded = true;
      _previousState = _player.playerState.processingState;
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
    _loaded = false;
    _position = null;
    _ended = null;
    _error = null;
    for (final s in _subscriptions) {
      await s.cancel();
    }
    _subscriptions.clear();
    if (!_isShared) {
      _http.close();
      final paused = _player.pause();
      await paused;
      await _player.dispose();
    }
  }

  static Future<void> disposeShared() async {
    final p = _sharedPlayer;
    _sharedPlayer = null;
    final h = _sharedHttp;
    _sharedHttp = null;
    h?.close();
    if (p != null) {
      try { await p.pause(); } catch (_) {}
      try { await p.dispose(); } catch (_) {}
    }
  }
}

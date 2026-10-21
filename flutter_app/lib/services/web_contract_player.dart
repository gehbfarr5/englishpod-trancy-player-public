import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import '../models/lesson_models.dart';
import 'transcript_navigation.dart';

enum EntryIntent { preload, library, manualNav, resume, trackSwitch, autoNext }

abstract class ContractAudio {
  Future<double> load(LessonDetail lesson, String track);
  Future<void> seek(double seconds);
  Future<void> play();
  Future<void> pause();
  Future<void> speed(double value);
  Future<void> dispose();
  set onPosition(void Function(double) callback);
  set onEnded(void Function() callback);
  set onError(void Function(Object) callback);
}

class TrackRecord {
  double position = 0;
  double duration = 0;
  bool ended = false;
  Map<String, dynamic> toJson() => {'position': position, 'duration': duration, 'ended': ended};
  static TrackRecord read(dynamic raw) {
    final r = TrackRecord();
    if (raw is! Map) return r;
    final p = raw['position'], d = raw['duration'];
    if (p is num && p.isFinite && p >= 0) r.position = p.toDouble();
    if (d is num && d.isFinite && d > 0) r.duration = d.toDouble();
    if (r.duration > 0) r.position = r.position.clamp(0, r.duration).toDouble();
    r.ended = raw['ended'] == true;
    return r;
  }
}
class LearningRecord {
  bool completed = false;
  final tracks = {'pb': TrackRecord(), 'dg': TrackRecord()};
  Map<String, dynamic> toJson() => {'completed': completed, for (final t in tracks.keys) t: tracks[t]!.toJson()};
}

/// Web-only EP-PBC-001 v1.3 state machine used by the original main.dart UI. Media callbacks are scoped to a load
/// generation; persistence snapshots are serialized in revision order.
class ContractPlayer extends ChangeNotifier {
  ContractPlayer({required this.audioFactory, required this.readLesson, required this.write,
    this.retryDelay = const Duration(milliseconds: 500), this.loadTimeout = const Duration(seconds: 20)});
  final ContractAudio Function() audioFactory;
  final Future<LessonDetail> Function(String) readLesson;
  final Future<void> Function(String) write;
  final Duration retryDelay, loadTimeout;
  List<LessonSummary> lessons = [];
  final records = <String, LearningRecord>{};
  LessonDetail? lesson;
  String track = 'pb', tab = 'pb';
  String? lastOpened;
  bool immersive = true, autoNext = true, sentenceLoop = false, trackLoop = false;
  bool loading = false, playing = false, ended = false, wantsPlay = false;
  bool pendingZero = false, manualZero = false, waitingGesture = false, saved = true;
  String? error;
  String? _retryId, _retryTrack;
  double position = 0, duration = 0, rate = 1;
  int generation = 0, revision = 0;
  int _loopIndex = 0, _playIntent = 0, _seekIntent = 0;
  ContractAudio? _audio;
  bool _disposed = false, _advanced = false, _seeking = false;
  double? _previous;
  DateTime _lastSave = DateTime.fromMillisecondsSinceEpoch(0);
  Future<void> _writes = Future.value();
  LearningRecord record(String id) => records.putIfAbsent(id, LearningRecord.new);
  TrackRecord get currentRecord => record(lesson!.lessonId).tracks[track]!;
  List<TranscriptSegment> get segments => lesson?.segmentsForTrack(track) ?? [];
  int get activeIndex => findActiveTranscriptSegmentIndex(segments, position);
  int get lessonIndex => lessons.indexWhere((x) => x.lessonId == lesson?.lessonId);
  bool canNavigate(int delta) => lessonIndex >= 0 && lessonIndex + delta >= 0 && lessonIndex + delta < lessons.length;
  void restore(String? raw) {
    if (raw == null) return;
    try {
      final data = jsonDecode(raw);
      if (data is! Map || data['schema'] != 1) return;
      immersive = data['immersive'] is bool ? data['immersive'] as bool : true;
      sentenceLoop = data['sentenceLoop'] == true;
      trackLoop = !sentenceLoop && data['trackLoop'] == true;
      autoNext = data['autoNext'] != false;
      final savedRate = data['rate'];
      if (savedRate is num && savedRate >= .5 && savedRate <= 2) rate = savedRate.toDouble();
      if (data['lastOpened'] is String) lastOpened = data['lastOpened'];
      if (data['records'] is Map) {
        (data['records'] as Map).forEach((id, value) {
          if (id is! String || value is! Map) return;
          final r = record(id);
          r.completed = value['completed'] == true;
          for (final t in ['pb', 'dg']) { r.tracks[t] = TrackRecord.read(value[t]); }
        });
      }
    } catch (_) { /* Corrupt container has no usable records. */ }
  }
  void _notify() { if (!_disposed) notifyListeners(); }
  Future<void> persist() {
    final snapshot = jsonEncode({'schema': 1, 'revision': ++revision,
      'immersive': immersive, 'autoNext': autoNext, 'sentenceLoop': sentenceLoop, 'trackLoop': trackLoop,
      'rate': rate, 'lastOpened': lastOpened,
      'records': records.map((id, r) => MapEntry(id, r.toJson()))});
    // A failed write must not poison the queue; the next snapshot retries all state.
    _writes = _writes.then((_) async {
      try { await write(snapshot); saved = true; }
      catch (_) { saved = false; }
      _notify();
    });
    return _writes;
  }
  Future<void> checkpoint() {
    if (lesson != null && !loading && !pendingZero) {
      final r = currentRecord;
      r.position = position; r.duration = duration; r.ended = ended;
    }
    _lastSave = DateTime.now();
    return persist();
  }
  double _resumePosition(String id, String target, {bool entry = false}) {
    final r = record(id), t = r.tracks[target]!;
    return (t.ended || (entry && target == 'pb' && r.completed)) ? 0 : t.position;
  }
  Future<void> open(String id, EntryIntent intent, {String? targetTrack, bool requestPlay = false, bool updateAnchor = true}) async {
    if (!lessons.any((x) => x.lessonId == id)) return;
    final target = (intent == EntryIntent.preload || intent == EntryIntent.library || intent == EntryIntent.resume || intent == EntryIntent.autoNext)
        ? 'pb' : targetTrack ?? track;
    if (intent == EntryIntent.resume && lesson?.lessonId == id && track == 'pb' && !loading && error == null) {
      final playIntent = _playIntent;
      if (manualZero || ended) {
        pendingZero = true;
        final my = generation;
        await seek(_resumePosition(id, 'pb', entry: true), user: false);
        if (my != generation) return;
        manualZero = false;
      }
      tab = 'pb';
      if (updateAnchor) { lastOpened = id; unawaited(persist()); }
      if (requestPlay && playIntent == _playIntent) await setPlaying(true);
      _notify(); return;
    }
    // Capture outgoing valid state before changing identity; do not await storage
    // before reserving the new generation (rapid A/B/C remains latest wins).
    unawaited(checkpoint());
    final my = ++generation;
    final deadline = DateTime.now().add(loadTimeout);
    Duration remaining() {
      final value = deadline.difference(DateTime.now());
      return value.isNegative ? Duration.zero : value;
    }
    _retryId = id; _retryTrack = target; _seeking = false;
    wantsPlay = requestPlay || (intent == EntryIntent.autoNext) || wantsPlay;
    final old = _audio; _audio = null;
    if (old != null) { unawaited(old.dispose()); }
    loading = true; playing = false; error = null; waitingGesture = false;
    if (intent != EntryIntent.preload && (lesson?.lessonId != id || track != target || intent == EntryIntent.manualNav || intent == EntryIntent.autoNext)) sentenceLoop = false;
    ended = false; _advanced = false; _previous = null;
    _notify();
    try {
      final detail = await readLesson(id).timeout(remaining());
      if (my != generation || _disposed) return;
      lesson = detail; track = target; tab = target; if (updateAnchor) lastOpened = id;
      manualZero = intent == EntryIntent.manualNav;
      final startZero = manualZero || intent == EntryIntent.autoNext;
      pendingZero = true;
      position = startZero ? 0 : _resumePosition(id, target, entry: intent != EntryIntent.trackSwitch);
      duration = 0; unawaited(persist()); _notify();
      for (var attempt = 0; attempt < 3; attempt++) {
        if (my != generation || _disposed) return;
        final audio = audioFactory(); _audio = audio;
        audio.onPosition = (p) { if (my == generation && identical(_audio, audio)) tick(p); };
        audio.onEnded = () { if (my == generation && identical(_audio, audio)) unawaited(naturalEnd()); };
        audio.onError = (e) {
          if (my == generation && identical(_audio, audio) && !loading) {
            error = 'Audio interrupted. Retry or return to library.';
            playing = false; wantsPlay = false; unawaited(audio.pause()); unawaited(checkpoint()); _notify();
          }
        };
        try {
          final loadedDuration = await audio.load(detail, target).timeout(remaining());
          if (my != generation || _disposed) { await audio.dispose(); return; }
          duration = loadedDuration;
          if (!duration.isFinite || duration <= 0) throw StateError('Invalid audio duration');
          position = position.clamp(0, duration).toDouble();
          if (position >= duration) position = 0;
          await audio.seek(position);
          if (my != generation || _disposed) return;
          await audio.speed(rate);
          if (my != generation || _disposed) return;
          loading = false; _previous = position; _loopIndex = activeIndex; _notify();
          if (wantsPlay) await setPlaying(true);
          return;
        } catch (e) {
          await audio.dispose();
          if (my != generation || _disposed) return;
          final permanent = RegExp(r'404|decode|format|unsupported|not found', caseSensitive: false).hasMatch(e.toString());
          if (permanent || attempt == 2 || !DateTime.now().isBefore(deadline)) rethrow;
          await Future<void>.delayed(retryDelay * (attempt + 1));
        }
      }
    } catch (_) {
      if (my != generation || _disposed) return;
      loading = false; playing = false; wantsPlay = false;
      error = 'Unable to load audio. Retry or return to library.'; _notify();
    }
  }
  Future<void> retry() async {
    final id = _retryId;
    if (id != null) await open(id, EntryIntent.trackSwitch, targetTrack: _retryTrack);
  }
  Future<void> navigate(int delta) async {
    if (canNavigate(delta)) await open(lessons[lessonIndex + delta].lessonId, EntryIntent.manualNav);
  }
  Future<void> switchTrack(String value) async {
    if (value == 'vocab') { tab = value; _notify(); return; }
    if (value == track) { tab = value; _notify(); return; }
    if (lesson != null) await open(lesson!.lessonId, EntryIntent.trackSwitch, targetTrack: value);
  }
  Future<void> setPlaying(bool value) async {
    ++_playIntent;
    wantsPlay = value;
    waitingGesture = false;
    if (loading || _audio == null) { _notify(); return; }
    final my = generation, audio = _audio!, intent = _playIntent;
    if (!value) {
      playing = false; await audio.pause(); unawaited(checkpoint()); _notify(); return;
    }
    if (ended) { pendingZero = true; await seek(0, user: false); }
    if (my != generation || intent != _playIntent || !wantsPlay) return;
    playing = true; _previous = position; _notify();
    // just_audio play future completes when playback stops; never await it here.
    unawaited(audio.play().catchError((Object e) {
      if (my != generation || intent != _playIntent || !identical(_audio, audio)) return;
      playing = false; wantsPlay = false;
      waitingGesture = RegExp(r'NotAllowed|not allowed|user gesture|autoplay', caseSensitive: false).hasMatch(e.toString());
      error = waitingGesture ? null : 'Playback failed. Retry or return to library.'; _notify();
    }));
  }
  Future<void> restart({bool requestPlay = true}) async {
    if (loading || _audio == null) return;
    final my = generation;
    pendingZero = true; manualZero = false;
    await seek(0, user: false);
    if (my != generation) return;
    _loopIndex = activeIndex;
    if (requestPlay) await setPlaying(true);
  }
  Future<void> seek(double value, {bool user = true}) async {
    if (loading || _audio == null || !value.isFinite) return;
    final my = generation, audio = _audio!, seekIntent = ++_seekIntent;
    _seeking = true; _advanced = false; _previous = null;
    position = value.clamp(0, duration).toDouble(); ended = position >= duration;
    if (user) {
      ++_playIntent;
      _loopIndex = activeIndex;
      pendingZero = false; manualZero = false;
      if (ended) { wantsPlay = false; playing = false; await audio.pause(); }
    }
    if (my != generation || seekIntent != _seekIntent) return;
    await audio.seek(position);
    if (my != generation || seekIntent != _seekIntent) return;
    _seeking = false; _previous = position;
    if (user) unawaited(checkpoint());
    _notify();
  }
  void tick(double value) {
    if (loading || _seeking || !value.isFinite || value < 0) return;
    final prior = _previous;
    position = value.clamp(0, duration).toDouble();
    if (playing && prior != null && position > prior) {
      _advanced = true; pendingZero = false; manualZero = false;
      if (track == 'pb' && prior < duration * .95 && position >= duration * .95) {
        record(lesson!.lessonId).completed = true; unawaited(checkpoint());
      }
      if (sentenceLoop && segments.isNotEmpty && position >= segments[_loopIndex.clamp(0, segments.length - 1)].end) {
        unawaited(seek(segments[_loopIndex.clamp(0, segments.length - 1)].start, user: false));
      }
    }
    _previous = position;
    if (playing && DateTime.now().difference(_lastSave).inMilliseconds >= 3000) unawaited(checkpoint());
    _notify();
  }
  Future<void> naturalEnd() async {
    if (loading || _seeking || ended || !playing || !_advanced) return;
    final my = generation, intent = _playIntent;
    if (sentenceLoop && segments.isNotEmpty) {
      await seek(segments[_loopIndex.clamp(0, segments.length - 1)].start, user: false);
      if (my == generation && intent == _playIntent && wantsPlay) await setPlaying(true);
      return;
    }
    position = duration; ended = true; playing = false;
    if (track == 'pb') record(lesson!.lessonId).completed = true;
    unawaited(checkpoint());
    if (trackLoop) {
      pendingZero = true;
      await seek(0, user: false);
      if (my == generation && intent == _playIntent && wantsPlay) await setPlaying(true);
    }
    else if (track == 'pb' && autoNext && lessons.isNotEmpty) { await navigateAuto(); }
    else { wantsPlay = false; _notify(); }
  }
  Future<void> navigateAuto() => open(lessons[(lessonIndex + 1) % lessons.length].lessonId, EntryIntent.autoNext);
  void toggleSentenceLoop() { sentenceLoop = !sentenceLoop; if (sentenceLoop) { trackLoop = false; _loopIndex = activeIndex; } unawaited(persist()); _notify(); }
  void toggleTrackLoop() { trackLoop = !trackLoop; if (trackLoop) sentenceLoop = false; unawaited(persist()); _notify(); }
  void toggleAutoNext() { autoNext = !autoNext; unawaited(persist()); _notify(); }
  void toggleImmersive() { immersive = !immersive; unawaited(persist()); _notify(); }
  Future<void> setRate(double value) async { rate = value; await _audio?.speed(value); unawaited(persist()); _notify(); }
  @override
  void dispose() { _disposed = true; ++generation; unawaited(checkpoint()); unawaited(_audio?.dispose() ?? Future.value()); super.dispose(); }
}


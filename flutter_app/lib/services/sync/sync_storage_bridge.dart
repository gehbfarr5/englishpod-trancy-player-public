import 'package:shared_preferences/shared_preferences.dart';

import '../web_contract_player.dart';
import 'sync_models.dart';

abstract class SyncKeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
}

class SharedPreferencesSyncKeyValueStore implements SyncKeyValueStore {
  final SharedPreferences? _prefs;

  SharedPreferencesSyncKeyValueStore({SharedPreferences? prefs})
      : _prefs = prefs;

  @override
  Future<String?> read(String key) async {
    try {
      final prefs = _prefs ?? await SharedPreferences.getInstance();
      return prefs.getString(key);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(String key, String value) async {
    try {
      final prefs = _prefs ?? await SharedPreferences.getInstance();
      await prefs.setString(key, value);
    } catch (_) {}
  }
}

class InMemorySyncKeyValueStore implements SyncKeyValueStore {
  final Map<String, String> _data = {};

  @override
  Future<String?> read(String key) async => _data[key];

  @override
  Future<void> write(String key, String value) async {
    _data[key] = value;
  }
}

class ActivePlaybackGuard {
  final String lessonId;
  final String track; // pb | dg
  final bool isActive;

  const ActivePlaybackGuard({
    required this.lessonId,
    required this.track,
    required this.isActive,
  });
}

abstract class SyncProgressBridge {
  Map<String, SyncLessonDelta> exportLocalSnapshot({int nowMs});
  String? exportLastOpenedLessonId();
  ActivePlaybackGuard? currentActivePlayback();
  Future<void> applyRemoteDelta({
    required List<SyncLessonDelta> lessons,
    SyncLastOpened? lastOpened,
  });
}

class WebContractSyncBridge implements SyncProgressBridge {
  final ContractPlayer player;
  final bool Function()? isViewingPlayer;
  final bool preloadRemoteLastOpened;

  WebContractSyncBridge(
    this.player, {
    this.isViewingPlayer,
    this.preloadRemoteLastOpened = true,
  });

  @override
  Map<String, SyncLessonDelta> exportLocalSnapshot({int? nowMs}) {
    final ts = nowMs ?? DateTime.now().millisecondsSinceEpoch;
    final out = <String, SyncLessonDelta>{};

    player.records.forEach((lessonId, record) {
      if (!isValidCanonicalLessonId(lessonId)) return;
      final pbRec = record.tracks['pb'];
      final dgRec = record.tracks['dg'];

      final pb = _toSyncTrack(pbRec, ts);
      final dg = _toSyncTrack(dgRec, ts);
      if (!record.completed && pb == null && dg == null) return;

      out[lessonId] = SyncLessonDelta(
        lessonId: lessonId,
        lessonCompleted: record.completed,
        completedAtMs: record.completed ? ts : 0,
        pb: pb,
        dg: dg,
      );
    });
    return out;
  }

  SyncTrackPoint? _toSyncTrack(TrackRecord? track, int ts) {
    if (track == null) return null;
    if (track.position <= 0 && !track.ended) return null;
    final posMs = (track.position * 1000).round().clamp(0, 7200000);
    final durMs = track.duration > 0
        ? (track.duration * 1000).round().clamp(0, 7200000)
        : null;
    return SyncTrackPoint(
      positionMs: posMs,
      durationMs: durMs,
      updatedAtMs: ts,
    );
  }

  @override
  String? exportLastOpenedLessonId() {
    final id = player.lastOpened;
    if (id == null || !isValidCanonicalLessonId(id)) return null;
    return id;
  }

  @override
  ActivePlaybackGuard? currentActivePlayback() {
    final lesson = player.lesson;
    if (lesson == null) return null;
    final active = player.playing || (isViewingPlayer?.call() ?? false);
    if (!active) return null;
    return ActivePlaybackGuard(
      lessonId: lesson.lessonId,
      track: player.track,
      isActive: true,
    );
  }

  @override
  Future<void> applyRemoteDelta({
    required List<SyncLessonDelta> lessons,
    SyncLastOpened? lastOpened,
  }) async {
    final guard = currentActivePlayback();
    final mapped = <String,
        ({
      bool completed,
      double? pbPos,
      double? pbDur,
      double? dgPos,
      double? dgDur,
    })>{};

    for (final item in lessons) {
      if (!isValidCanonicalLessonId(item.lessonId)) continue;
      final skipPb =
          guard != null && guard.lessonId == item.lessonId && guard.track == 'pb';
      final skipDg =
          guard != null && guard.lessonId == item.lessonId && guard.track == 'dg';

      mapped[item.lessonId] = (
        completed: item.lessonCompleted,
        pbPos: (!skipPb && item.pb != null) ? item.pb!.positionMs / 1000.0 : null,
        pbDur: (!skipPb && item.pb?.durationMs != null)
            ? item.pb!.durationMs! / 1000.0
            : null,
        dgPos: (!skipDg && item.dg != null) ? item.dg!.positionMs / 1000.0 : null,
        dgDur: (!skipDg && item.dg?.durationMs != null)
            ? item.dg!.durationMs! / 1000.0
            : null,
      );
    }

    final remoteAnchor =
        (guard == null && lastOpened != null && isValidCanonicalLessonId(lastOpened.lessonId))
            ? lastOpened.lessonId
            : null;

    await player.applyRemoteSync(
      updates: mapped,
      remoteLastOpened: remoteAnchor,
    );

    if (remoteAnchor != null &&
        preloadRemoteLastOpened &&
        remoteAnchor != player.lesson?.lessonId &&
        !player.playing &&
        !player.loading &&
        !player.wantsPlay &&
        !(isViewingPlayer?.call() ?? false)) {
      await player.open(remoteAnchor, EntryIntent.preload, updateAnchor: true);
    }
  }
}

class NativeProgressSyncBridge implements SyncProgressBridge {
  final Map<String, SyncLessonDelta> Function(int nowMs) onExportSnapshot;
  final String? Function() onExportLastOpened;
  final ActivePlaybackGuard? Function() onCurrentActivePlayback;
  final Future<void> Function(
      List<SyncLessonDelta> lessons, SyncLastOpened? lastOpened) onApplyRemote;

  NativeProgressSyncBridge({
    required this.onExportSnapshot,
    required this.onExportLastOpened,
    required this.onCurrentActivePlayback,
    required this.onApplyRemote,
  });

  @override
  Map<String, SyncLessonDelta> exportLocalSnapshot({int? nowMs}) =>
      onExportSnapshot(nowMs ?? DateTime.now().millisecondsSinceEpoch);

  @override
  String? exportLastOpenedLessonId() {
    final id = onExportLastOpened();
    if (id == null || !isValidCanonicalLessonId(id)) return null;
    return id;
  }

  @override
  ActivePlaybackGuard? currentActivePlayback() => onCurrentActivePlayback();

  @override
  Future<void> applyRemoteDelta({
    required List<SyncLessonDelta> lessons,
    SyncLastOpened? lastOpened,
  }) =>
      onApplyRemote(lessons, lastOpened);
}

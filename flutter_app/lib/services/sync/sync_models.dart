// Canonical EP-SYNC-001 v1.0 models, pairing code helpers, and lesson ID whitelist.

const String kSyncPairingAlphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const String kSyncStorageKey = 'ep_sync_state_v1';
const int kSyncMaxPushBatchLessons = 80;

enum SyncStatus {
  unlinked,
  synced,
  syncing,
  pendingOffline,
  error,
  revoked,
}

enum SyncCommitTrigger {
  periodic,
  pause,
  userSeek,
  completion,
  trackSwitch,
  lessonSwitch,
  returnToLibrary,
  appBackground,
}

/// Canonical 335-lesson whitelist: 0001..0120 and 0151..0365.
bool isValidCanonicalLessonId(String lessonId) {
  if (lessonId.length != 4) return false;
  final num? parsed = int.tryParse(lessonId);
  if (parsed == null) return false;
  final int n = parsed.toInt();
  if (lessonId != n.toString().padLeft(4, '0')) return false;
  return (n >= 1 && n <= 120) || (n >= 151 && n <= 365);
}

/// Normalizes a raw 8-char code, hyphenated code, or `epsync://v1/pair?c=...` URI.
/// Returns uppercase 8-char code or `null` if invalid.
String? normalizePairingCode(String raw) {
  var s = raw.trim();
  if (s.isEmpty) return null;

  if (s.toLowerCase().startsWith('epsync://')) {
    final uri = Uri.tryParse(s);
    if (uri == null ||
        uri.scheme.toLowerCase() != 'epsync' ||
        uri.host.toLowerCase() != 'v1' ||
        uri.path != '/pair') {
      return null;
    }
    s = (uri.queryParameters['c'] ?? '').trim();
  }

  final buf = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    final ch = s[i];
    if (ch == '-' || ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r') {
      continue;
    }
    final upper = ch.toUpperCase();
    if (!kSyncPairingAlphabet.contains(upper)) {
      return null;
    }
    buf.write(upper);
  }

  final normalized = buf.toString();
  if (normalized.length != 8) return null;
  return normalized;
}

String formatDisplayPairingCode(String code) {
  if (code.length != 8) return code;
  return '${code.substring(0, 4)}-${code.substring(4)}';
}

class SyncTrackPoint {
  final int positionMs;
  final int? segmentIndex;
  final int? durationMs;
  final int updatedAtMs;
  final int seq;
  final int baseSeq;

  const SyncTrackPoint({
    required this.positionMs,
    this.segmentIndex,
    this.durationMs,
    required this.updatedAtMs,
    this.seq = 0,
    this.baseSeq = 0,
  });

  SyncTrackPoint copyWith({
    int? positionMs,
    int? segmentIndex,
    int? durationMs,
    int? updatedAtMs,
    int? seq,
    int? baseSeq,
  }) {
    return SyncTrackPoint(
      positionMs: positionMs ?? this.positionMs,
      segmentIndex: segmentIndex ?? this.segmentIndex,
      durationMs: durationMs ?? this.durationMs,
      updatedAtMs: updatedAtMs ?? this.updatedAtMs,
      seq: seq ?? this.seq,
      baseSeq: baseSeq ?? this.baseSeq,
    );
  }

  Map<String, dynamic> toPushJson() => {
        'positionMs': positionMs,
        if (segmentIndex != null) 'segmentIndex': segmentIndex,
        if (durationMs != null) 'durationMs': durationMs,
        'updatedAtMs': updatedAtMs,
        'baseSeq': baseSeq,
      };

  Map<String, dynamic> toStorageJson() => {
        'positionMs': positionMs,
        if (segmentIndex != null) 'segmentIndex': segmentIndex,
        if (durationMs != null) 'durationMs': durationMs,
        'updatedAtMs': updatedAtMs,
        'seq': seq,
        'baseSeq': baseSeq,
      };

  factory SyncTrackPoint.fromJson(Map<String, dynamic> json) {
    return SyncTrackPoint(
      positionMs: (json['positionMs'] as num?)?.toInt() ?? 0,
      segmentIndex: (json['segmentIndex'] as num?)?.toInt(),
      durationMs: (json['durationMs'] as num?)?.toInt(),
      updatedAtMs: (json['updatedAtMs'] as num?)?.toInt() ?? 0,
      seq: (json['seq'] as num?)?.toInt() ?? 0,
      baseSeq: (json['baseSeq'] as num?)?.toInt() ?? 0,
    );
  }
}

class SyncLessonDelta {
  final String lessonId;
  final bool lessonCompleted;
  final int completedAtMs;
  final SyncTrackPoint? pb;
  final SyncTrackPoint? dg;
  final int seq;

  const SyncLessonDelta({
    required this.lessonId,
    required this.lessonCompleted,
    this.completedAtMs = 0,
    this.pb,
    this.dg,
    this.seq = 0,
  });

  SyncLessonDelta copyWith({
    bool? lessonCompleted,
    int? completedAtMs,
    SyncTrackPoint? pb,
    SyncTrackPoint? dg,
    int? seq,
  }) {
    return SyncLessonDelta(
      lessonId: lessonId,
      lessonCompleted: lessonCompleted ?? this.lessonCompleted,
      completedAtMs: completedAtMs ?? this.completedAtMs,
      pb: pb ?? this.pb,
      dg: dg ?? this.dg,
      seq: seq ?? this.seq,
    );
  }

  Map<String, dynamic> toPushJson() => {
        'lessonId': lessonId,
        'lessonCompleted': lessonCompleted,
        if (completedAtMs > 0) 'completedAtMs': completedAtMs,
        if (pb != null) 'pb': pb!.toPushJson(),
        if (dg != null) 'dg': dg!.toPushJson(),
      };

  Map<String, dynamic> toStorageJson() => {
        'lessonId': lessonId,
        'lessonCompleted': lessonCompleted,
        if (completedAtMs > 0) 'completedAtMs': completedAtMs,
        if (pb != null) 'pb': pb!.toStorageJson(),
        if (dg != null) 'dg': dg!.toStorageJson(),
        'seq': seq,
      };

  factory SyncLessonDelta.fromJson(Map<String, dynamic> json) {
    return SyncLessonDelta(
      lessonId: (json['lessonId'] as String?) ?? '',
      lessonCompleted: json['lessonCompleted'] == true,
      completedAtMs: (json['completedAtMs'] as num?)?.toInt() ?? 0,
      pb: json['pb'] is Map<String, dynamic>
          ? SyncTrackPoint.fromJson(json['pb'] as Map<String, dynamic>)
          : null,
      dg: json['dg'] is Map<String, dynamic>
          ? SyncTrackPoint.fromJson(json['dg'] as Map<String, dynamic>)
          : null,
      seq: (json['seq'] as num?)?.toInt() ?? 0,
    );
  }
}

class SyncLastOpened {
  final String lessonId;
  final int updatedAtMs;
  final int seq;
  final int baseSeq;

  const SyncLastOpened({
    required this.lessonId,
    required this.updatedAtMs,
    this.seq = 0,
    this.baseSeq = 0,
  });

  Map<String, dynamic> toPushJson() => {
        'lessonId': lessonId,
        'updatedAtMs': updatedAtMs,
        'baseSeq': baseSeq,
      };

  Map<String, dynamic> toStorageJson() => {
        'lessonId': lessonId,
        'updatedAtMs': updatedAtMs,
        'seq': seq,
        'baseSeq': baseSeq,
      };

  factory SyncLastOpened.fromJson(Map<String, dynamic> json) {
    return SyncLastOpened(
      lessonId: (json['lessonId'] as String?) ?? '',
      updatedAtMs: (json['updatedAtMs'] as num?)?.toInt() ?? 0,
      seq: (json['seq'] as num?)?.toInt() ?? 0,
      baseSeq: (json['baseSeq'] as num?)?.toInt() ?? 0,
    );
  }
}

class SyncDeviceSummary {
  final String deviceId;
  final String deviceName;
  final String platform;
  final int createdAtMs;
  final int lastSeenAtMs;
  final bool isCurrent;

  const SyncDeviceSummary({
    required this.deviceId,
    required this.deviceName,
    required this.platform,
    required this.createdAtMs,
    required this.lastSeenAtMs,
    required this.isCurrent,
  });

  Map<String, dynamic> toJson() => {
        'deviceId': deviceId,
        'deviceName': deviceName,
        'platform': platform,
        'createdAtMs': createdAtMs,
        'lastSeenAtMs': lastSeenAtMs,
        'isCurrent': isCurrent,
      };

  factory SyncDeviceSummary.fromJson(Map<String, dynamic> json) {
    return SyncDeviceSummary(
      deviceId: (json['deviceId'] as String?) ?? '',
      deviceName: (json['deviceName'] as String?) ?? '',
      platform: (json['platform'] as String?) ?? 'web',
      createdAtMs: (json['createdAtMs'] as num?)?.toInt() ?? 0,
      lastSeenAtMs: (json['lastSeenAtMs'] as num?)?.toInt() ?? 0,
      isCurrent: json['isCurrent'] == true,
    );
  }
}

class SyncPairingTicket {
  final String groupId;
  final String deviceId;
  final String? deviceToken;
  final String code;
  final String displayCode;
  final String qrPayload;
  final int expiresAtMs;
  final int serverTimeMs;

  const SyncPairingTicket({
    required this.groupId,
    required this.deviceId,
    this.deviceToken,
    required this.code,
    required this.displayCode,
    required this.qrPayload,
    required this.expiresAtMs,
    required this.serverTimeMs,
  });

  factory SyncPairingTicket.fromJson(Map<String, dynamic> json) {
    final code = (json['code'] as String?) ?? '';
    return SyncPairingTicket(
      groupId: (json['groupId'] as String?) ?? '',
      deviceId: (json['deviceId'] as String?) ?? '',
      deviceToken: json['deviceToken'] as String?,
      code: code,
      displayCode:
          (json['displayCode'] as String?) ?? formatDisplayPairingCode(code),
      qrPayload: (json['qrPayload'] as String?) ?? 'epsync://v1/pair?c=$code',
      expiresAtMs: (json['expiresAtMs'] as num?)?.toInt() ?? 0,
      serverTimeMs: (json['serverTimeMs'] as num?)?.toInt() ?? 0,
    );
  }
}

class SyncPairingStatus {
  final String code;
  final String displayCode;
  final String status; // pending | consumed | expired
  final int expiresAtMs;
  final int serverTimeMs;
  final String? claimedDeviceId;
  final String? claimedDeviceName;
  final String? claimedPlatform;

  const SyncPairingStatus({
    required this.code,
    required this.displayCode,
    required this.status,
    required this.expiresAtMs,
    required this.serverTimeMs,
    this.claimedDeviceId,
    this.claimedDeviceName,
    this.claimedPlatform,
  });

  factory SyncPairingStatus.fromJson(Map<String, dynamic> json) {
    final claimed = json['claimedDevice'] is Map<String, dynamic>
        ? json['claimedDevice'] as Map<String, dynamic>
        : null;
    final code = (json['code'] as String?) ?? '';
    return SyncPairingStatus(
      code: code,
      displayCode:
          (json['displayCode'] as String?) ?? formatDisplayPairingCode(code),
      status: (json['status'] as String?) ?? 'pending',
      expiresAtMs: (json['expiresAtMs'] as num?)?.toInt() ?? 0,
      serverTimeMs: (json['serverTimeMs'] as num?)?.toInt() ?? 0,
      claimedDeviceId: claimed?['deviceId'] as String?,
      claimedDeviceName: claimed?['deviceName'] as String?,
      claimedPlatform: claimed?['platform'] as String?,
    );
  }
}

class SyncClaimResult {
  final String groupId;
  final String deviceId;
  final String deviceToken;
  final int serverSeq;
  final int serverTimeMs;
  final List<SyncDeviceSummary> devices;

  const SyncClaimResult({
    required this.groupId,
    required this.deviceId,
    required this.deviceToken,
    required this.serverSeq,
    required this.serverTimeMs,
    required this.devices,
  });

  factory SyncClaimResult.fromJson(Map<String, dynamic> json) {
    final rawDevices = (json['devices'] as List<dynamic>?) ?? const [];
    return SyncClaimResult(
      groupId: (json['groupId'] as String?) ?? '',
      deviceId: (json['deviceId'] as String?) ?? '',
      deviceToken: (json['deviceToken'] as String?) ?? '',
      serverSeq: (json['serverSeq'] as num?)?.toInt() ?? 0,
      serverTimeMs: (json['serverTimeMs'] as num?)?.toInt() ?? 0,
      devices: rawDevices
          .whereType<Map<String, dynamic>>()
          .map(SyncDeviceSummary.fromJson)
          .toList(),
    );
  }
}

class SyncRejectedConflict {
  final String lessonId;
  final String track; // pb | dg
  final String reason;
  final SyncTrackPoint? serverTrack;

  const SyncRejectedConflict({
    required this.lessonId,
    required this.track,
    required this.reason,
    this.serverTrack,
  });

  factory SyncRejectedConflict.fromJson(Map<String, dynamic> json) {
    return SyncRejectedConflict(
      lessonId: (json['lessonId'] as String?) ?? '',
      track: (json['track'] as String?) ?? 'pb',
      reason: (json['reason'] as String?) ?? '',
      serverTrack: json['serverTrack'] is Map<String, dynamic>
          ? SyncTrackPoint.fromJson(json['serverTrack'] as Map<String, dynamic>)
          : null,
    );
  }
}

class SyncPushResponse {
  final int serverTimeMs;
  final int serverSeq;
  final List<String> acceptedLessons;
  final List<SyncRejectedConflict> rejectedConflicts;
  final SyncLastOpened? lastOpened;

  const SyncPushResponse({
    required this.serverTimeMs,
    required this.serverSeq,
    required this.acceptedLessons,
    required this.rejectedConflicts,
    this.lastOpened,
  });

  factory SyncPushResponse.fromJson(Map<String, dynamic> json) {
    final rawAccepted = (json['acceptedLessons'] as List<dynamic>?) ?? const [];
    final rawConflicts =
        (json['rejectedConflicts'] as List<dynamic>?) ?? const [];
    return SyncPushResponse(
      serverTimeMs: (json['serverTimeMs'] as num?)?.toInt() ?? 0,
      serverSeq: (json['serverSeq'] as num?)?.toInt() ?? 0,
      acceptedLessons: rawAccepted.whereType<String>().toList(),
      rejectedConflicts: rawConflicts
          .whereType<Map<String, dynamic>>()
          .map(SyncRejectedConflict.fromJson)
          .toList(),
      lastOpened: json['lastOpened'] is Map<String, dynamic>
          ? SyncLastOpened.fromJson(json['lastOpened'] as Map<String, dynamic>)
          : null,
    );
  }
}

class SyncPullResponse {
  final int serverTimeMs;
  final int serverSeq;
  final bool hasMore;
  final SyncLastOpened? lastOpened;
  final List<SyncLessonDelta> lessons;

  const SyncPullResponse({
    required this.serverTimeMs,
    required this.serverSeq,
    required this.hasMore,
    this.lastOpened,
    required this.lessons,
  });

  factory SyncPullResponse.fromJson(Map<String, dynamic> json) {
    final rawLessons = (json['lessons'] as List<dynamic>?) ?? const [];
    return SyncPullResponse(
      serverTimeMs: (json['serverTimeMs'] as num?)?.toInt() ?? 0,
      serverSeq: (json['serverSeq'] as num?)?.toInt() ?? 0,
      hasMore: json['hasMore'] == true,
      lastOpened: json['lastOpened'] is Map<String, dynamic>
          ? SyncLastOpened.fromJson(json['lastOpened'] as Map<String, dynamic>)
          : null,
      lessons: rawLessons
          .whereType<Map<String, dynamic>>()
          .map(SyncLessonDelta.fromJson)
          .toList(),
    );
  }
}

class SyncStateSnapshot {
  String groupId;
  String deviceId;
  String deviceToken;
  String deviceName;
  String platform;
  int lastServerSeq;
  int lastOpenedBaseSeq;
  int clockOffsetMs;
  int lastSyncedAtMs;
  Map<String, int> trackBaseSeq;
  Map<String, SyncLessonDelta> dirtyLessons;
  SyncLastOpened? dirtyLastOpened;
  List<SyncDeviceSummary> devices;

  SyncStateSnapshot({
    this.groupId = '',
    this.deviceId = '',
    this.deviceToken = '',
    this.deviceName = '',
    this.platform = 'web',
    this.lastServerSeq = 0,
    this.lastOpenedBaseSeq = 0,
    this.clockOffsetMs = 0,
    this.lastSyncedAtMs = 0,
    Map<String, int>? trackBaseSeq,
    Map<String, SyncLessonDelta>? dirtyLessons,
    this.dirtyLastOpened,
    List<SyncDeviceSummary>? devices,
  })  : trackBaseSeq = trackBaseSeq ?? {},
        dirtyLessons = dirtyLessons ?? {},
        devices = devices ?? [];

  bool get isLinked => groupId.isNotEmpty && deviceToken.isNotEmpty;

  Map<String, dynamic> toJson() => {
        'schema': 1,
        'groupId': groupId,
        'deviceId': deviceId,
        'deviceToken': deviceToken,
        'deviceName': deviceName,
        'platform': platform,
        'lastServerSeq': lastServerSeq,
        'lastOpenedBaseSeq': lastOpenedBaseSeq,
        'clockOffsetMs': clockOffsetMs,
        'lastSyncedAtMs': lastSyncedAtMs,
        'trackBaseSeq': trackBaseSeq,
        'dirtyLessons':
            dirtyLessons.map((k, v) => MapEntry(k, v.toStorageJson())),
        if (dirtyLastOpened != null)
          'dirtyLastOpened': dirtyLastOpened!.toStorageJson(),
        'devices': devices.map((d) => d.toJson()).toList(),
      };

  factory SyncStateSnapshot.fromJson(Map<String, dynamic> json) {
    final trackSeq = <String, int>{};
    if (json['trackBaseSeq'] is Map) {
      (json['trackBaseSeq'] as Map).forEach((k, v) {
        if (k is String && v is num) {
          trackSeq[k] = v.toInt();
        }
      });
    }

    final dirty = <String, SyncLessonDelta>{};
    if (json['dirtyLessons'] is Map) {
      (json['dirtyLessons'] as Map).forEach((k, v) {
        if (k is String && v is Map<String, dynamic>) {
          dirty[k] = SyncLessonDelta.fromJson(v);
        }
      });
    }

    final devices = <SyncDeviceSummary>[];
    if (json['devices'] is List) {
      for (final item in (json['devices'] as List)) {
        if (item is Map<String, dynamic>) {
          devices.add(SyncDeviceSummary.fromJson(item));
        }
      }
    }

    return SyncStateSnapshot(
      groupId: (json['groupId'] as String?) ?? '',
      deviceId: (json['deviceId'] as String?) ?? '',
      deviceToken: (json['deviceToken'] as String?) ?? '',
      deviceName: (json['deviceName'] as String?) ?? '',
      platform: (json['platform'] as String?) ?? 'web',
      lastServerSeq: (json['lastServerSeq'] as num?)?.toInt() ?? 0,
      lastOpenedBaseSeq: (json['lastOpenedBaseSeq'] as num?)?.toInt() ?? 0,
      clockOffsetMs: (json['clockOffsetMs'] as num?)?.toInt() ?? 0,
      lastSyncedAtMs: (json['lastSyncedAtMs'] as num?)?.toInt() ?? 0,
      trackBaseSeq: trackSeq,
      dirtyLessons: dirty,
      dirtyLastOpened: json['dirtyLastOpened'] is Map<String, dynamic>
          ? SyncLastOpened.fromJson(
              json['dirtyLastOpened'] as Map<String, dynamic>)
          : null,
      devices: devices,
    );
  }
}

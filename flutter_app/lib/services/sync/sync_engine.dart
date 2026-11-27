import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'sync_api_client.dart';
import 'sync_models.dart';
import 'sync_storage_bridge.dart';

class SyncEngine extends ChangeNotifier {
  final SyncApiClient apiClient;
  final SyncKeyValueStore kvStore;
  final SyncProgressBridge bridge;
  final String baseUrl;
  final String platform;
  final String defaultDeviceName;
  final DateTime Function() _clock;
  final Duration seekDebounce;
  final Duration heartbeatInterval;
  final Duration pollInterval;

  SyncStateSnapshot _state = SyncStateSnapshot();
  SyncStatus _status = SyncStatus.unlinked;
  SyncPairingTicket? _activeTicket;
  SyncPairingStatus? _lastPairingStatus;
  String? _statusMessage;
  String? _errorMessage;

  Timer? _seekDebounceTimer;
  Timer? _pairingPollTimer;
  Future<void>? _inFlightSync;
  bool _resyncRequested = false;
  int _lastPeriodicPushAttemptMs = 0;
  int _lastPullAttemptMs = 0;
  bool _disposed = false;
  bool _initialized = false;

  SyncEngine({
    required this.apiClient,
    required this.kvStore,
    required this.bridge,
    required this.baseUrl,
    required this.platform,
    required this.defaultDeviceName,
    DateTime Function()? clock,
    this.seekDebounce = const Duration(seconds: 2),
    this.heartbeatInterval = const Duration(seconds: 45),
    this.pollInterval = const Duration(seconds: 2),
  }) : _clock = clock ?? DateTime.now;

  bool get isInitialized => _initialized;
  bool get isConfigured => baseUrl.isNotEmpty;
  bool get isLinked => _state.isLinked;
  SyncStatus get status => _status;
  SyncPairingTicket? get activeTicket => _activeTicket;
  SyncPairingStatus? get lastPairingStatus => _lastPairingStatus;
  String? get statusMessage => _statusMessage;
  String? get errorMessage => _errorMessage;
  String get groupId => _state.groupId;
  String get deviceId => _state.deviceId;
  String get deviceName =>
      _state.deviceName.isNotEmpty ? _state.deviceName : defaultDeviceName;
  int get lastServerSeq => _state.lastServerSeq;
  int get lastSyncedAtMs => _state.lastSyncedAtMs;
  List<SyncDeviceSummary> get devices =>
      List.unmodifiable(_state.devices);

  int get _calibratedNowMs =>
      _clock().millisecondsSinceEpoch + _state.clockOffsetMs;

  void _safeNotify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> initialize() async {
    final raw = await kvStore.read(kSyncStorageKey);
    if (raw != null && raw.isNotEmpty) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is Map<String, dynamic>) {
          _state = SyncStateSnapshot.fromJson(decoded);
        }
      } catch (_) {
        _state = SyncStateSnapshot();
      }
    }
    if (_state.deviceName.isEmpty) {
      _state.deviceName = defaultDeviceName;
    }
    if (_state.platform.isEmpty) {
      _state.platform = platform;
    }
    _status = _state.isLinked
        ? ((_state.dirtyLessons.isNotEmpty || _state.dirtyLastOpened != null)
            ? SyncStatus.pendingOffline
            : SyncStatus.synced)
        : SyncStatus.unlinked;
    _initialized = true;
    _safeNotify();
  }

  Future<void> _persistState() async {
    await kvStore.write(kSyncStorageKey, jsonEncode(_state.toJson()));
  }

  void _updateClockOffset(int serverTimeMs) {
    if (serverTimeMs <= 0) return;
    _state.clockOffsetMs = serverTimeMs - _clock().millisecondsSinceEpoch;
  }

  /// Creates a 5-minute pairing ticket; creates a new sync group if unlinked.
  Future<SyncPairingTicket> generatePairingCode() async {
    _errorMessage = null;
    _lastPairingStatus = null;
    final devName = deviceName;

    final ticket = await apiClient.createPairingTicket(
      bearerToken: _state.isLinked ? _state.deviceToken : null,
      deviceName: devName,
      platform: platform,
    );
    _updateClockOffset(ticket.serverTimeMs);

    final isNewGroup = !_state.isLinked &&
        ticket.deviceToken != null &&
        ticket.deviceToken!.isNotEmpty;

    if (isNewGroup) {
      _state = SyncStateSnapshot(
        groupId: ticket.groupId,
        deviceId: ticket.deviceId,
        deviceToken: ticket.deviceToken!,
        deviceName: devName,
        platform: platform,
        clockOffsetMs: _state.clockOffsetMs,
        devices: [
          SyncDeviceSummary(
            deviceId: ticket.deviceId,
            deviceName: devName,
            platform: platform,
            createdAtMs: _calibratedNowMs,
            lastSeenAtMs: _calibratedNowMs,
            isCurrent: true,
          ),
        ],
      );
      _enqueueLocalBaseline();
      _status = SyncStatus.pendingOffline;
      await _persistState();
    }

    _activeTicket = ticket;
    startPairingPoll();
    _safeNotify();

    if (isNewGroup) {
      try {
        await flushPending();
      } catch (_) {}
    }
    return ticket;
  }

  void startPairingPoll() {
    _pairingPollTimer?.cancel();
    if (_activeTicket == null || !_state.isLinked) return;
    _pairingPollTimer = Timer.periodic(pollInterval, (_) {
      unawaited(_pollTicketOnce());
    });
  }

  void stopPairingPoll() {
    _pairingPollTimer?.cancel();
    _pairingPollTimer = null;
  }

  Future<void> _pollTicketOnce() async {
    final ticket = _activeTicket;
    if (ticket == null || !_state.isLinked || _disposed) {
      stopPairingPoll();
      return;
    }
    try {
      final st = await apiClient.getPairingStatus(
        bearerToken: _state.deviceToken,
        code: ticket.code,
      );
      _updateClockOffset(st.serverTimeMs);
      if (st.status == 'consumed') {
        stopPairingPoll();
        _activeTicket = null;
        _lastPairingStatus = st;
        _statusMessage = st.claimedDeviceName != null
            ? '已连接：${st.claimedDeviceName}，正在同步进度'
            : '新设备已加入，正在同步进度';
        _safeNotify();
        await syncNow(forcePull: true);
        await refreshDevices();
      } else if (st.status == 'expired') {
        stopPairingPoll();
        _lastPairingStatus = st;
        _safeNotify();
      }
    } on SyncApiException catch (e) {
      if (e.code == 'DEVICE_REVOKED') {
        await _handleRevoked();
      }
    } catch (_) {}
  }

  /// Joins an existing sync group using a scanned QR payload or 8-char code.
  Future<void> claimPairingCode(String rawInput) async {
    if (_state.isLinked) {
      throw StateError('ALREADY_LINKED');
    }
    final code = normalizePairingCode(rawInput);
    if (code == null) {
      throw const SyncApiException(
        statusCode: 400,
        code: 'INVALID_CODE',
        message: '请输入有效的 8 位设备码',
      );
    }

    _errorMessage = null;
    _status = SyncStatus.syncing;
    _safeNotify();

    try {
      final res = await apiClient.claimPairingTicket(
        code: code,
        deviceName: deviceName,
        platform: platform,
      );
      _updateClockOffset(res.serverTimeMs);

      _state = SyncStateSnapshot(
        groupId: res.groupId,
        deviceId: res.deviceId,
        deviceToken: res.deviceToken,
        deviceName: deviceName,
        platform: platform,
        lastServerSeq: 0, // Bootstrap pulls from 0 for complete merge.
        clockOffsetMs: _state.clockOffsetMs,
        devices: res.devices,
      );
      _enqueueLocalBaseline();
      await _persistState();

      await syncNow(forcePull: true);
      _statusMessage = '已加入同步组，多端进度已合并';
      _safeNotify();
    } catch (e) {
      if (!_state.isLinked) {
        _status = SyncStatus.unlinked;
      }
      _errorMessage = _friendlyError(e);
      _safeNotify();
      rethrow;
    }
  }

  void _enqueueLocalBaseline() {
    final nowMs = _calibratedNowMs;
    final snapshot = bridge.exportLocalSnapshot(nowMs: nowMs);
    snapshot.forEach((lessonId, delta) {
      _mergeDirtyLesson(
        lessonId: lessonId,
        lessonCompleted: delta.lessonCompleted,
        pb: delta.pb,
        dg: delta.dg,
      );
    });

    final anchor = bridge.exportLastOpenedLessonId();
    if (anchor != null && isValidCanonicalLessonId(anchor)) {
      _state.dirtyLastOpened = SyncLastOpened(
        lessonId: anchor,
        updatedAtMs: nowMs,
        baseSeq: _state.lastOpenedBaseSeq,
      );
    }
  }

  /// Records a committed local progress update (never uncommitted 00:00).
  void recordLocalCommit({
    required String lessonId,
    String? track,
    int? positionMs,
    int? segmentIndex,
    int? durationMs,
    bool lessonCompleted = false,
    required SyncCommitTrigger trigger,
  }) {
    if (!_state.isLinked || !isValidCanonicalLessonId(lessonId)) return;

    final nowMs = _calibratedNowMs;
    SyncTrackPoint? pb;
    SyncTrackPoint? dg;

    if (track == 'pb' && positionMs != null) {
      pb = SyncTrackPoint(
        positionMs: positionMs.clamp(0, 7200000),
        segmentIndex: segmentIndex,
        durationMs: durationMs?.clamp(0, 7200000),
        updatedAtMs: nowMs,
        baseSeq: _state.trackBaseSeq['$lessonId:pb'] ?? 0,
      );
    } else if (track == 'dg' && positionMs != null) {
      dg = SyncTrackPoint(
        positionMs: positionMs.clamp(0, 7200000),
        segmentIndex: segmentIndex,
        durationMs: durationMs?.clamp(0, 7200000),
        updatedAtMs: nowMs,
        baseSeq: _state.trackBaseSeq['$lessonId:dg'] ?? 0,
      );
    }

    _mergeDirtyLesson(
      lessonId: lessonId,
      lessonCompleted: lessonCompleted,
      pb: pb,
      dg: dg,
    );
    if (_status != SyncStatus.syncing) {
      _status = SyncStatus.pendingOffline;
    }
    unawaited(_persistState());
    _safeNotify();

    switch (trigger) {
      case SyncCommitTrigger.periodic:
        final wallMs = _clock().millisecondsSinceEpoch;
        if (wallMs - _lastPeriodicPushAttemptMs >=
            heartbeatInterval.inMilliseconds) {
          _lastPeriodicPushAttemptMs = wallMs;
          unawaited(flushPending());
        }
      case SyncCommitTrigger.userSeek:
        _seekDebounceTimer?.cancel();
        _seekDebounceTimer = Timer(seekDebounce, () {
          unawaited(flushPending());
        });
      case SyncCommitTrigger.completion:
      case SyncCommitTrigger.pause:
      case SyncCommitTrigger.trackSwitch:
      case SyncCommitTrigger.lessonSwitch:
      case SyncCommitTrigger.returnToLibrary:
      case SyncCommitTrigger.appBackground:
        _seekDebounceTimer?.cancel();
        unawaited(flushPending());
    }
  }

  void recordLocalLastOpened(String lessonId) {
    if (!_state.isLinked || !isValidCanonicalLessonId(lessonId)) return;
    _state.dirtyLastOpened = SyncLastOpened(
      lessonId: lessonId,
      updatedAtMs: _calibratedNowMs,
      baseSeq: _state.lastOpenedBaseSeq,
    );
    unawaited(_persistState());
  }

  void _mergeDirtyLesson({
    required String lessonId,
    required bool lessonCompleted,
    SyncTrackPoint? pb,
    SyncTrackPoint? dg,
  }) {
    final prev = _state.dirtyLessons[lessonId];
    final nextCompleted = (prev?.lessonCompleted ?? false) || lessonCompleted;
    final completedAtMs = nextCompleted
        ? ((prev?.completedAtMs ?? 0) > 0
            ? prev!.completedAtMs
            : _calibratedNowMs)
        : 0;
    _state.dirtyLessons[lessonId] = SyncLessonDelta(
      lessonId: lessonId,
      lessonCompleted: nextCompleted,
      completedAtMs: completedAtMs,
      pb: pb ?? prev?.pb,
      dg: dg ?? prev?.dg,
    );
  }

  Future<void> flushPending() => syncNow(forcePull: false);

  Future<void> pullIfDue({
    Duration minInterval = const Duration(seconds: 10),
  }) async {
    if (!_state.isLinked || !isConfigured) return;
    final nowWall = _clock().millisecondsSinceEpoch;
    if (nowWall - _lastPullAttemptMs < minInterval.inMilliseconds &&
        _state.dirtyLessons.isEmpty &&
        _state.dirtyLastOpened == null) {
      return;
    }
    await syncNow(forcePull: true);
  }

  Future<void> syncNow({bool forcePull = true}) async {
    if (!_state.isLinked || !isConfigured) return;
    if (_inFlightSync != null) {
      _resyncRequested = true;
      return _inFlightSync!;
    }

    final completer = Completer<void>();
    _inFlightSync = completer.future;

    try {
      do {
        _resyncRequested = false;
        await _executeSyncPass(forcePull: forcePull);
      } while (_resyncRequested && _state.isLinked && !_disposed);
      completer.complete();
    } catch (e, st) {
      completer.completeError(e, st);
      rethrow;
    } finally {
      _inFlightSync = null;
    }
  }

  Future<void> _executeSyncPass({required bool forcePull}) async {
    _errorMessage = null;
    _status = SyncStatus.syncing;
    _safeNotify();

    try {
      // 1. Push dirty lessons in bounded batches (<= 80 lessons to stay well under 64 KB).
      final dirtyKeys = _state.dirtyLessons.keys.toList()..sort();
      var anchorPending = _state.dirtyLastOpened;

      if (dirtyKeys.isEmpty && anchorPending != null) {
        final res = await apiClient.push(
          bearerToken: _state.deviceToken,
          lessons: const [],
          lastOpened: anchorPending,
        );
        await _handlePushResponse(res, sentLastOpened: anchorPending);
      } else {
        for (var i = 0; i < dirtyKeys.length; i += kSyncMaxPushBatchLessons) {
          final end = (i + kSyncMaxPushBatchLessons > dirtyKeys.length)
              ? dirtyKeys.length
              : i + kSyncMaxPushBatchLessons;
          final chunkKeys = dirtyKeys.sublist(i, end);
          final chunk = [
            for (final id in chunkKeys)
              if (_state.dirtyLessons[id] != null) _state.dirtyLessons[id]!,
          ];
          final includeAnchor = end == dirtyKeys.length ? anchorPending : null;
          final res = await apiClient.push(
            bearerToken: _state.deviceToken,
            lessons: chunk,
            lastOpened: includeAnchor,
          );
          await _handlePushResponse(
            res,
            sentLessons: chunk,
            sentLastOpened: includeAnchor,
          );
        }
      }

      // 2. Pull remote delta if requested or on initial link.
      if (forcePull) {
        _lastPullAttemptMs = _clock().millisecondsSinceEpoch;
        final pullRes = await apiClient.pull(
          bearerToken: _state.deviceToken,
          sinceSeq: _state.lastServerSeq,
        );
        _updateClockOffset(pullRes.serverTimeMs);

        final remoteLessonsToApply = <SyncLessonDelta>[];
        for (final item in pullRes.lessons) {
          if (item.pb != null) {
            _state.trackBaseSeq['${item.lessonId}:pb'] = item.pb!.seq;
          }
          if (item.dg != null) {
            _state.trackBaseSeq['${item.lessonId}:dg'] = item.dg!.seq;
          }
          // Skip overwriting a dirty track still queued locally.
          final localDirty = _state.dirtyLessons[item.lessonId];
          if (localDirty != null) {
            remoteLessonsToApply.add(SyncLessonDelta(
              lessonId: item.lessonId,
              lessonCompleted: item.lessonCompleted,
              completedAtMs: item.completedAtMs,
              pb: localDirty.pb == null ? item.pb : null,
              dg: localDirty.dg == null ? item.dg : null,
              seq: item.seq,
            ));
          } else {
            remoteLessonsToApply.add(item);
          }
        }

        if (pullRes.lastOpened != null) {
          _state.lastOpenedBaseSeq = pullRes.lastOpened!.seq;
        }
        final remoteAnchor =
            _state.dirtyLastOpened == null ? pullRes.lastOpened : null;

        if (remoteLessonsToApply.isNotEmpty || remoteAnchor != null) {
          await bridge.applyRemoteDelta(
            lessons: remoteLessonsToApply,
            lastOpened: remoteAnchor,
          );
        }
        if (pullRes.serverSeq > _state.lastServerSeq) {
          _state.lastServerSeq = pullRes.serverSeq;
        }
      }

      _state.lastSyncedAtMs = _clock().millisecondsSinceEpoch;
      _status = (_state.dirtyLessons.isNotEmpty || _state.dirtyLastOpened != null)
          ? SyncStatus.pendingOffline
          : SyncStatus.synced;
      await _persistState();
      _safeNotify();
    } on SyncApiException catch (e) {
      if (e.code == 'DEVICE_REVOKED' || e.code == 'UNAUTHORIZED') {
        await _handleRevoked();
        return;
      }
      _updateClockOffset(e.serverTimeMs);
      _status = e.code == 'NETWORK_ERROR'
          ? SyncStatus.pendingOffline
          : SyncStatus.error;
      _errorMessage = _friendlyError(e);
      await _persistState();
      _safeNotify();
      rethrow;
    } catch (e) {
      _status = SyncStatus.pendingOffline;
      _errorMessage = _friendlyError(e);
      await _persistState();
      _safeNotify();
      rethrow;
    }
  }

  Future<void> _handlePushResponse(
    SyncPushResponse res, {
    List<SyncLessonDelta> sentLessons = const [],
    SyncLastOpened? sentLastOpened,
  }) async {
    _updateClockOffset(res.serverTimeMs);

    final acceptedSet = res.acceptedLessons.toSet();
    final sentById = {for (final l in sentLessons) l.lessonId: l};

    for (final id in acceptedSet) {
      final sent = sentById[id];
      final currentDirty = _state.dirtyLessons[id];
      // Clear only if no newer local edits landed while push was in flight.
      if (sent != null &&
          currentDirty != null &&
          currentDirty.pb?.updatedAtMs == sent.pb?.updatedAtMs &&
          currentDirty.dg?.updatedAtMs == sent.dg?.updatedAtMs &&
          currentDirty.lessonCompleted == sent.lessonCompleted) {
        _state.dirtyLessons.remove(id);
      }
      if (sent?.pb != null) {
        _state.trackBaseSeq['$id:pb'] = res.serverSeq;
      }
      if (sent?.dg != null) {
        _state.trackBaseSeq['$id:dg'] = res.serverSeq;
      }
    }

    if (res.rejectedConflicts.isNotEmpty) {
      final conflictResolutions = <String, SyncLessonDelta>{};
      for (final conflict in res.rejectedConflicts) {
        if (conflict.serverTrack == null) continue;
        _state.trackBaseSeq['${conflict.lessonId}:${conflict.track}'] =
            conflict.serverTrack!.seq;

        final prev = conflictResolutions[conflict.lessonId];
        conflictResolutions[conflict.lessonId] = SyncLessonDelta(
          lessonId: conflict.lessonId,
          lessonCompleted: prev?.lessonCompleted ?? false,
          pb: conflict.track == 'pb' ? conflict.serverTrack : prev?.pb,
          dg: conflict.track == 'dg' ? conflict.serverTrack : prev?.dg,
          seq: conflict.serverTrack!.seq,
        );
        // Remove stale conflicting track from dirty map so it isn't retried endlessly.
        final dirty = _state.dirtyLessons[conflict.lessonId];
        if (dirty != null) {
          final remainingPb = conflict.track == 'pb' ? null : dirty.pb;
          final remainingDg = conflict.track == 'dg' ? null : dirty.dg;
          if (remainingPb == null && remainingDg == null && !dirty.lessonCompleted) {
            _state.dirtyLessons.remove(conflict.lessonId);
          } else {
            _state.dirtyLessons[conflict.lessonId] = SyncLessonDelta(
              lessonId: dirty.lessonId,
              lessonCompleted: dirty.lessonCompleted,
              completedAtMs: dirty.completedAtMs,
              pb: remainingPb,
              dg: remainingDg,
            );
          }
        }
      }
      if (conflictResolutions.isNotEmpty) {
        await bridge.applyRemoteDelta(
          lessons: conflictResolutions.values.toList(),
        );
      }
    }

    if (sentLastOpened != null &&
        _state.dirtyLastOpened?.updatedAtMs == sentLastOpened.updatedAtMs) {
      _state.dirtyLastOpened = null;
    }
    if (res.lastOpened != null) {
      _state.lastOpenedBaseSeq = res.lastOpened!.seq;
    }
  }

  Future<void> refreshDevices() async {
    if (!_state.isLinked) return;
    try {
      final (serverTimeMs, list) =
          await apiClient.listDevices(bearerToken: _state.deviceToken);
      _updateClockOffset(serverTimeMs);
      _state.devices = list;
      await _persistState();
      _safeNotify();
    } on SyncApiException catch (e) {
      if (e.code == 'DEVICE_REVOKED' || e.code == 'UNAUTHORIZED') {
        await _handleRevoked();
        return;
      }
      rethrow;
    }
  }

  Future<void> renameCurrentDevice(String newName) async {
    if (!_state.isLinked) return;
    final (serverTimeMs, updated) = await apiClient.renameDevice(
      bearerToken: _state.deviceToken,
      deviceName: newName,
    );
    _updateClockOffset(serverTimeMs);
    _state.deviceName = updated.deviceName;
    _state.devices = [
      for (final d in _state.devices)
        d.deviceId == updated.deviceId ? updated : d,
    ];
    await _persistState();
    _safeNotify();
  }

  Future<void> revokeDevice(String targetDeviceId) async {
    if (!_state.isLinked) return;
    try {
      final serverTimeMs = await apiClient.revokeDevice(
        bearerToken: _state.deviceToken,
        deviceId: targetDeviceId,
      );
      _updateClockOffset(serverTimeMs);
      if (targetDeviceId == _state.deviceId || targetDeviceId == 'me') {
        await _clearCredentials(
          nextStatus: SyncStatus.unlinked,
          message: '已退出同步组，本地学习进度完整保留',
        );
      } else {
        _state.devices = _state.devices
            .where((d) => d.deviceId != targetDeviceId)
            .toList();
        await _persistState();
        _safeNotify();
      }
    } on SyncApiException catch (e) {
      if (e.code == 'DEVICE_REVOKED' || e.code == 'UNAUTHORIZED') {
        await _handleRevoked();
        return;
      }
      rethrow;
    }
  }

  Future<void> leaveGroup() async {
    if (!_state.isLinked) return;
    try {
      await revokeDevice(_state.deviceId);
    } on SyncApiException {
      await _clearCredentials(
        nextStatus: SyncStatus.unlinked,
        message: '已从本机断开同步，本地学习进度完整保留',
      );
    }
  }

  Future<void> _handleRevoked() async {
    await _clearCredentials(
      nextStatus: SyncStatus.revoked,
      message: '同步连接已断开，本地学习进度已保留',
    );
  }

  Future<void> _clearCredentials({
    required SyncStatus nextStatus,
    String? message,
  }) async {
    stopPairingPoll();
    _seekDebounceTimer?.cancel();
    _activeTicket = null;
    _lastPairingStatus = null;
    _errorMessage = null;
    _statusMessage = message;
    _state = SyncStateSnapshot(
      deviceName: deviceName,
      platform: platform,
    );
    _status = nextStatus;
    await _persistState();
    _safeNotify();
  }

  String _friendlyError(Object err) {
    if (err is SyncApiException) {
      switch (err.code) {
        case 'INVALID_CODE':
          return '设备码格式不正确，请核对 8 位字符';
        case 'CODE_NOT_FOUND':
          return '设备码不存在，请检查是否输入有误';
        case 'CODE_USED':
          return '该设备码已被使用，请在原设备重新生成';
        case 'CODE_EXPIRED':
          return '设备码已过期（超过 5 分钟），请重新生成';
        case 'GROUP_FULL':
          return '当前同步组已达 10 台设备上限，请先移除闲置设备';
        case 'RATE_LIMITED':
          return err.retryAfterSec > 0
              ? '操作过于频繁，请 ${err.retryAfterSec} 秒后再试'
              : '操作过于频繁，请稍后再试';
        case 'SYNC_NOT_CONFIGURED':
          return '当前构建未配置同步服务端地址';
        case 'NETWORK_ERROR':
          return '网络不可用，变更已暂存本地，联网后自动同步';
      }
      return err.message;
    }
    return '同步暂不可用，稍后自动重试';
  }

  @override
  void dispose() {
    _disposed = true;
    _seekDebounceTimer?.cancel();
    _pairingPollTimer?.cancel();
    super.dispose();
  }
}

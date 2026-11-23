import 'package:englishpod_trancy/models/lesson_models.dart';
import 'package:englishpod_trancy/services/sync/sync_api_client.dart';
import 'package:englishpod_trancy/services/sync/sync_engine.dart';
import 'package:englishpod_trancy/services/sync/sync_models.dart';
import 'package:englishpod_trancy/services/sync/sync_storage_bridge.dart';
import 'package:englishpod_trancy/services/web_contract_player.dart';
import 'package:flutter_test/flutter_test.dart';

import 'tesla_contract_test.dart' show make;

class FakeSyncApiClient implements SyncApiClient {
  int serverTimeMs = 1795400000000;
  int serverSeq = 0;

  SyncPairingTicket? nextCreateResult;
  SyncPairingStatus? nextStatusResult;
  SyncClaimResult? nextClaimResult;
  SyncPullResponse? nextPullResult;
  List<SyncDeviceSummary> serverDevices = [];
  List<SyncRejectedConflict> nextPushConflicts = [];
  SyncApiException? nextError;

  int createCalls = 0;
  int claimCalls = 0;
  int pushCalls = 0;
  int pullCalls = 0;
  int revokeCalls = 0;
  final List<int> pushBatchSizes = [];
  final List<List<SyncLessonDelta>> pushedPayloads = [];

  @override
  Future<SyncPairingTicket> createPairingTicket({
    String? bearerToken,
    required String deviceName,
    required String platform,
  }) async {
    createCalls++;
    if (nextError != null) throw nextError!;
    return nextCreateResult ??
        SyncPairingTicket(
          groupId: 'grp-1',
          deviceId: 'dev-a',
          deviceToken: bearerToken == null ? 'tok-a' : null,
          code: 'K7M9P2XR',
          displayCode: 'K7M9-P2XR',
          qrPayload: 'epsync://v1/pair?c=K7M9P2XR',
          expiresAtMs: serverTimeMs + 300000,
          serverTimeMs: serverTimeMs,
        );
  }

  @override
  Future<SyncPairingStatus> getPairingStatus({
    required String bearerToken,
    required String code,
  }) async {
    if (nextError != null) throw nextError!;
    return nextStatusResult ??
        SyncPairingStatus(
          code: code,
          displayCode: formatDisplayPairingCode(code),
          status: 'pending',
          expiresAtMs: serverTimeMs + 300000,
          serverTimeMs: serverTimeMs,
        );
  }

  @override
  Future<SyncClaimResult> claimPairingTicket({
    required String code,
    required String deviceName,
    required String platform,
  }) async {
    claimCalls++;
    if (nextError != null) throw nextError!;
    return nextClaimResult ??
        SyncClaimResult(
          groupId: 'grp-1',
          deviceId: 'dev-b',
          deviceToken: 'tok-b',
          serverSeq: serverSeq,
          serverTimeMs: serverTimeMs,
          devices: serverDevices.isNotEmpty
              ? serverDevices
              : [
                  SyncDeviceSummary(
                    deviceId: 'dev-a',
                    deviceName: 'iPhone 17',
                    platform: 'ios',
                    createdAtMs: serverTimeMs - 10000,
                    lastSeenAtMs: serverTimeMs - 5000,
                    isCurrent: false,
                  ),
                  SyncDeviceSummary(
                    deviceId: 'dev-b',
                    deviceName: deviceName,
                    platform: platform,
                    createdAtMs: serverTimeMs,
                    lastSeenAtMs: serverTimeMs,
                    isCurrent: true,
                  ),
                ],
        );
  }

  @override
  Future<SyncPushResponse> push({
    required String bearerToken,
    required List<SyncLessonDelta> lessons,
    SyncLastOpened? lastOpened,
  }) async {
    pushCalls++;
    if (nextError != null) throw nextError!;
    pushBatchSizes.add(lessons.length);
    pushedPayloads.add(lessons);
    serverSeq++;
    final conflicts = List<SyncRejectedConflict>.from(nextPushConflicts);
    nextPushConflicts.clear();
    final conflictIds = conflicts.map((c) => c.lessonId).toSet();
    return SyncPushResponse(
      serverTimeMs: serverTimeMs,
      serverSeq: serverSeq,
      acceptedLessons: [
        for (final l in lessons)
          if (!conflictIds.contains(l.lessonId)) l.lessonId,
      ],
      rejectedConflicts: conflicts,
      lastOpened: lastOpened != null
          ? SyncLastOpened(
              lessonId: lastOpened.lessonId,
              updatedAtMs: lastOpened.updatedAtMs,
              seq: serverSeq,
            )
          : null,
    );
  }

  @override
  Future<SyncPullResponse> pull({
    required String bearerToken,
    required int sinceSeq,
  }) async {
    pullCalls++;
    if (nextError != null) throw nextError!;
    return nextPullResult ??
        SyncPullResponse(
          serverTimeMs: serverTimeMs,
          serverSeq: serverSeq,
          hasMore: false,
          lessons: const [],
        );
  }

  @override
  Future<(int, List<SyncDeviceSummary>)> listDevices({
    required String bearerToken,
  }) async {
    if (nextError != null) throw nextError!;
    return (serverTimeMs, serverDevices);
  }

  @override
  Future<(int, SyncDeviceSummary)> renameDevice({
    required String bearerToken,
    required String deviceName,
  }) async {
    if (nextError != null) throw nextError!;
    final updated = SyncDeviceSummary(
      deviceId: 'dev-b',
      deviceName: deviceName,
      platform: 'web',
      createdAtMs: serverTimeMs - 1000,
      lastSeenAtMs: serverTimeMs,
      isCurrent: true,
    );
    serverDevices = [
      for (final d in serverDevices) d.isCurrent ? updated : d,
    ];
    return (serverTimeMs, updated);
  }

  @override
  Future<int> revokeDevice({
    required String bearerToken,
    required String deviceId,
  }) async {
    revokeCalls++;
    if (nextError != null) throw nextError!;
    serverDevices =
        serverDevices.where((d) => d.deviceId != deviceId).toList();
    return serverTimeMs;
  }
}

void main() {
  test('pairing code normalization, formatting, and 335-lesson whitelist', () {
    var validCount = 0;
    for (var i = 1; i <= 365; i++) {
      final id = i.toString().padLeft(4, '0');
      if (isValidCanonicalLessonId(id)) validCount++;
    }
    expect(validCount, 335);
    expect(isValidCanonicalLessonId('0001'), isTrue);
    expect(isValidCanonicalLessonId('0120'), isTrue);
    expect(isValidCanonicalLessonId('0121'), isFalse);
    expect(isValidCanonicalLessonId('0150'), isFalse);
    expect(isValidCanonicalLessonId('0151'), isTrue);
    expect(isValidCanonicalLessonId('0365'), isTrue);
    expect(isValidCanonicalLessonId('0366'), isFalse);

    expect(normalizePairingCode('k7m9-p2xr'), 'K7M9P2XR');
    expect(
      normalizePairingCode('epsync://v1/pair?c=K7M9P2XR'),
      'K7M9P2XR',
    );
    expect(normalizePairingCode('K7M0P2XR'), isNull); // forbidden '0'
    expect(normalizePairingCode('K7MOP2XR'), isNull); // forbidden 'O'
    expect(normalizePairingCode('K7M1P2XR'), isNull); // forbidden '1'
    expect(normalizePairingCode('K7MIP2XR'), isNull); // forbidden 'I'
    expect(normalizePairingCode('K7MLP2XR'), isNull); // forbidden 'L'
    expect(formatDisplayPairingCode('K7M9P2XR'), 'K7M9-P2XR');
  });

  test('claimPairingCode batches >80 lessons, merges pull, and blocks double-join', () async {
    final player = make();
    player.lessons = [
      for (var i = 1; i <= 120; i++)
        LessonSummary.fromJson({'lesson_id': i.toString().padLeft(4, '0')}),
    ];
    for (var i = 1; i <= 95; i++) {
      final id = i.toString().padLeft(4, '0');
      player.record(id).tracks['pb']!.position = 42.0;
      player.record(id).tracks['pb']!.duration = 100.0;
    }
    player.record('0001').completed = true;
    player.lastOpened = '0050';

    final api = FakeSyncApiClient();
    api.nextPullResult = SyncPullResponse(
      serverTimeMs: api.serverTimeMs,
      serverSeq: 5,
      hasMore: false,
      lastOpened: const SyncLastOpened(
        lessonId: '0110',
        updatedAtMs: 1795400001000,
        seq: 5,
      ),
      lessons: [
        const SyncLessonDelta(
          lessonId: '0110',
          lessonCompleted: true,
          pb: SyncTrackPoint(
            positionMs: 88000,
            durationMs: 100000,
            updatedAtMs: 1795400001000,
            seq: 5,
          ),
          seq: 5,
        ),
        // Remote says lessonCompleted=false for 0001; local monotonic true must survive!
        const SyncLessonDelta(
          lessonId: '0001',
          lessonCompleted: false,
          pb: SyncTrackPoint(
            positionMs: 15000,
            durationMs: 100000,
            updatedAtMs: 1795400002000,
            seq: 5,
          ),
          seq: 5,
        ),
      ],
    );

    final engine = SyncEngine(
      apiClient: api,
      kvStore: InMemorySyncKeyValueStore(),
      bridge: WebContractSyncBridge(player, preloadRemoteLastOpened: false),
      baseUrl: 'https://sync.example.test/api/sync/v1',
      platform: 'web',
      defaultDeviceName: 'Tesla Web',
    );
    await engine.initialize();
    expect(engine.isLinked, isFalse);

    await engine.claimPairingCode('K7M9-P2XR');
    expect(engine.isLinked, isTrue);
    expect(engine.status, SyncStatus.synced);
    expect(api.pushBatchSizes, [80, 15]);
    expect(api.pullCalls, 1);

    // Monotonic completion preserved & remote 0110 merged.
    expect(player.record('0001').completed, isTrue);
    expect(player.record('0001').tracks['pb']!.position, 15.0);
    expect(player.record('0110').completed, isTrue);
    expect(player.record('0110').tracks['pb']!.position, 88.0);
    expect(player.lastOpened, '0110');

    // Cross-group guard rejects joining another group while linked.
    await expectLater(
      engine.claimPairingCode('ABCD-EFGH'),
      throwsStateError,
    );

    engine.dispose();
    player.dispose();
  });

  test('active playback guard, uncommitted 00:00 protection, 45s heartbeat, and revocation preserve local data', () async {
    var clockNow = DateTime.fromMillisecondsSinceEpoch(1795400000000);
    final player = make();
    player.record('0001').tracks['pb']!.position = 30.0;
    player.record('0001').tracks['pb']!.duration = 100.0;

    final api = FakeSyncApiClient();
    final kv = InMemorySyncKeyValueStore();
    final engine = SyncEngine(
      apiClient: api,
      kvStore: kv,
      bridge: WebContractSyncBridge(player, preloadRemoteLastOpened: false),
      baseUrl: 'https://sync.example.test/api/sync/v1',
      platform: 'web',
      defaultDeviceName: 'Web',
      clock: () => clockNow,
    );
    player.onSyncCommit =
        (lessonId, track, posSec, durSec, completed, trigger) {
      engine.recordLocalCommit(
        lessonId: lessonId,
        track: track,
        positionMs: (posSec * 1000).round(),
        durationMs: durSec > 0 ? (durSec * 1000).round() : null,
        lessonCompleted: completed,
        trigger: switch (trigger) {
          'pause' => SyncCommitTrigger.pause,
          'seek' => SyncCommitTrigger.userSeek,
          'complete' => SyncCommitTrigger.completion,
          'switch' => SyncCommitTrigger.lessonSwitch,
          'background' => SyncCommitTrigger.appBackground,
          _ => SyncCommitTrigger.periodic,
        },
      );
    };

    await engine.initialize();
    await engine.generatePairingCode();
    engine.stopPairingPoll();

    final baselinePushes = api.pushCalls;

    // Open 0001 & play; periodic tick throttled for 45s.
    await player.open('0001', EntryIntent.library, requestPlay: true);
    player.tick(34.0); // clears pendingZero
    expect(api.pushCalls, baselinePushes); // <45s, not pushed yet

    // While actively playing (0001, pb), remote pull tries to jump 0001 pb to 90s and 0002 pb to 55s.
    api.nextPullResult = SyncPullResponse(
      serverTimeMs: clockNow.millisecondsSinceEpoch,
      serverSeq: 9,
      hasMore: false,
      lessons: const [
        SyncLessonDelta(
          lessonId: '0001',
          lessonCompleted: false,
          pb: SyncTrackPoint(
            positionMs: 90000,
            durationMs: 100000,
            updatedAtMs: 1795400005000,
            seq: 9,
          ),
          seq: 9,
        ),
        SyncLessonDelta(
          lessonId: '0002',
          lessonCompleted: false,
          pb: SyncTrackPoint(
            positionMs: 55000,
            durationMs: 100000,
            updatedAtMs: 1795400005000,
            seq: 9,
          ),
          seq: 9,
        ),
      ],
    );
    await engine.syncNow(forcePull: true);
    // 0001 pb live position must NOT be disrupted, while 0002 pb updates silently.
    expect(player.position, 34.0);
    expect(player.record('0002').tracks['pb']!.position, 55.0);

    // Manual nav to 0002 sets pendingZero=true; exiting without playing must NOT push 00:00!
    final pushesBeforeManualNav = api.pushCalls;
    await player.navigate(1); // 0002 at 00:00 (uncommitted)
    await player.navigate(-1); // switch away without playing 0002
    await Future<void>.delayed(Duration.zero);
    // Any push from switch only contains 0001, never 0002=0.
    for (final batch in api.pushedPayloads.skip(pushesBeforeManualNav)) {
      for (final item in batch) {
        if (item.lessonId == '0002') {
          expect(item.pb?.positionMs ?? 55000, isNot(0));
        }
      }
    }

    // Advance clock past 45s -> periodic tick triggers heartbeat push.
    clockNow = clockNow.add(const Duration(seconds: 50));
    player.tick(38.0);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(api.pushCalls, greaterThan(pushesBeforeManualNav));

    // Server returns 401 DEVICE_REVOKED -> credentials cleared, local progress kept intact!
    api.nextError = const SyncApiException(
      statusCode: 401,
      code: 'DEVICE_REVOKED',
      message: 'revoked',
    );
    await engine.syncNow(forcePull: true);
    expect(engine.isLinked, isFalse);
    expect(engine.status, SyncStatus.revoked);
    expect(player.record('0002').tracks['pb']!.position, 55.0);

    engine.dispose();
    player.dispose();
  });

  test('pairing poll transitions to consumed and pulls remote data', () async {
    final player = make();
    final api = FakeSyncApiClient();
    final engine = SyncEngine(
      apiClient: api,
      kvStore: InMemorySyncKeyValueStore(),
      bridge: WebContractSyncBridge(player, preloadRemoteLastOpened: false),
      baseUrl: 'https://sync.example.test/api/sync/v1',
      platform: 'ios',
      defaultDeviceName: 'iPhone',
      pollInterval: const Duration(milliseconds: 20),
    );
    await engine.initialize();

    api.nextStatusResult = SyncPairingStatus(
      code: 'K7M9P2XR',
      displayCode: 'K7M9-P2XR',
      status: 'consumed',
      expiresAtMs: api.serverTimeMs + 300000,
      serverTimeMs: api.serverTimeMs,
      claimedDeviceId: 'dev-b',
      claimedDeviceName: 'Tesla Web',
      claimedPlatform: 'web',
    );
    await engine.generatePairingCode();
    await Future<void>.delayed(const Duration(milliseconds: 60));

    expect(engine.lastPairingStatus?.status, 'consumed');
    expect(engine.statusMessage, contains('Tesla Web'));
    expect(api.pullCalls, greaterThanOrEqualTo(1));

    engine.dispose();
    player.dispose();
  });
}

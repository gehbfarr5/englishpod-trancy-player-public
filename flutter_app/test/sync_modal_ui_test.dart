import 'package:englishpod_trancy/main.dart';
import 'package:englishpod_trancy/services/sync/sync_engine.dart';
import 'package:englishpod_trancy/services/sync/sync_models.dart';
import 'package:englishpod_trancy/services/sync/sync_storage_bridge.dart';
import 'package:englishpod_trancy/services/web_contract_player.dart';
import 'package:englishpod_trancy/widgets/player_transport_icons.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'sync_engine_test.dart' show FakeSyncApiClient;
import 'tesla_contract_test.dart' show FakeAudio, make;

void main() {
  for (final pref in [AppThemePreference.dark, AppThemePreference.light]) {
    testWidgets('top-right Done pill opens compact sync modal & solo QR does not lock out pairing (${pref.name})', (tester) async {
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(430, 880);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final player = make();
      final api = FakeSyncApiClient();
      final engine = SyncEngine(
        apiClient: api,
        kvStore: InMemorySyncKeyValueStore(),
        bridge: WebContractSyncBridge(player, preloadRemoteLastOpened: false),
        baseUrl: 'https://sync.example.test/api/sync/v1',
        platform: 'web',
        defaultDeviceName: 'Test Browser',
      );
      await engine.initialize();

      await tester.pumpWidget(
        MaterialApp(
          home: ImmersivePlayerScreen(
            webPlayer: player,
            initialPreference: pref,
            syncEngine: engine,
          ),
        ),
      );
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();

      final pill = find.byKey(const ValueKey('top_right_progress_sync_pill'));
      expect(pill, findsOneWidget);
      await tester.tap(pill);
      await tester.pumpAndSettle();

      expect(find.text('多端进度同步'), findsOneWidget);
      expect(find.text('展示二维码'), findsOneWidget);
      expect(find.text('输入配对码'), findsOneWidget);

      // Generate pairing code -> verifies QR widget has light quiet zone (#FAF8F5) and XXXX-XXXX code.
      await tester.tap(find.byKey(const ValueKey('sync_generate_code_btn')));
      await tester.pump(const Duration(milliseconds: 250));
      expect(find.byKey(const ValueKey('sync_pairing_qr_widget')), findsOneWidget);
      expect(find.byKey(const ValueKey('sync_display_pairing_code')), findsOneWidget);

      final qrContainer = tester.widget<Container>(
        find.descendant(
          of: find.byKey(const ValueKey('sync_pairing_qr_widget')),
          matching: find.byType(Container),
        ).first,
      );
      final deco = qrContainer.decoration as BoxDecoration;
      expect(deco.color, const Color(0xFFFAF8F5));

      // Returning from solo QR (1 device, no peer scanned) must STILL show the 2-direction unlinked view.
      await tester.tap(find.byKey(const ValueKey('sync_modal_back_btn')));
      await tester.pumpAndSettle();
      expect(engine.hasLinkedPeers, isFalse);
      expect(find.byKey(const ValueKey('sync_enter_code_btn')), findsOneWidget);
      expect(find.byKey(const ValueKey('sync_generate_code_btn')), findsOneWidget);

      // Web modal keeps top-right close button.
      await tester.tap(find.byKey(const ValueKey('sync_modal_close_btn')));
      await tester.pumpAndSettle();
      expect(find.text('多端进度同步'), findsNothing);

      engine.dispose();
    });
  }

  testWidgets('8-char claim flow, Plan A linked merge entry, device revoke, leave group, and reduced motion', (tester) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(430, 880);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final player = make();
    final api = FakeSyncApiClient();
    final engine = SyncEngine(
      apiClient: api,
      kvStore: InMemorySyncKeyValueStore(),
      bridge: WebContractSyncBridge(player, preloadRemoteLastOpened: false),
      baseUrl: 'https://sync.example.test/api/sync/v1',
      platform: 'web',
      defaultDeviceName: 'Tesla Web',
    );
    await engine.initialize();

    await tester.pumpWidget(
      MaterialApp(
        builder: (ctx, child) => MediaQuery(
          data: MediaQuery.of(ctx).copyWith(disableAnimations: true),
          child: child!,
        ),
        home: ImmersivePlayerScreen(
          webPlayer: player,
          initialPreference: AppThemePreference.dark,
          syncEngine: engine,
        ),
      ),
    );
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('top_right_progress_sync_pill')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('sync_enter_code_btn')));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('sync_code_text_field')),
      'k7m9p2xr',
    );
    await tester.pump();
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('sync_code_text_field')))
          .controller
          ?.text,
      'K7M9-P2XR',
    );

    await tester.tap(find.byKey(const ValueKey('sync_submit_claim_btn')));
    await tester.pumpAndSettle();

    expect(engine.hasLinkedPeers, isTrue);
    expect(find.text('我的设备 (2)'), findsOneWidget);
    expect(find.text('iPhone 17'), findsOneWidget);
    expect(find.text('查看二维码'), findsOneWidget);
    // Already-linked Web view STILL provides manual code association CTA.
    expect(find.byKey(const ValueKey('sync_linked_enter_code_btn')), findsOneWidget);

    // Revoke other device (dev-a) via menu confirmation.
    await tester.tap(find.byKey(const ValueKey('sync_revoke_dev-a')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('sync_confirm_revoke_btn')));
    await tester.pumpAndSettle();
    expect(api.revokeCalls, 1);

    // Re-add peer to test self-menu leave group flow.
    api.serverDevices = [
      SyncDeviceSummary(
        deviceId: 'dev-a',
        deviceName: 'iPhone 17',
        platform: 'ios',
        createdAtMs: api.serverTimeMs - 5000,
        lastSeenAtMs: api.serverTimeMs - 1000,
        isCurrent: false,
      ),
      SyncDeviceSummary(
        deviceId: 'dev-b',
        deviceName: 'Tesla Web',
        platform: 'web',
        createdAtMs: api.serverTimeMs,
        lastSeenAtMs: api.serverTimeMs,
        isCurrent: true,
      ),
    ];
    await engine.refreshDevices();
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('sync_self_more_btn')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('sync_leave_group_btn')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('确认退出'));
    await tester.pumpAndSettle();
    expect(engine.isLinked, isFalse);

    engine.dispose();
  });

  testWidgets('SYNC-18: Tesla dual-viewport modal open & resize never interrupts active playback', (tester) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(1256, 706);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    var loads = 0;
    final player = make(factory: () {
      loads++;
      return FakeAudio();
    });
    final api = FakeSyncApiClient();
    final engine = SyncEngine(
      apiClient: api,
      kvStore: InMemorySyncKeyValueStore(),
      bridge: WebContractSyncBridge(player, preloadRemoteLastOpened: false),
      baseUrl: 'https://sync.example.test/api/sync/v1',
      platform: 'web',
      defaultDeviceName: 'Tesla Web',
    );
    await engine.initialize();

    await tester.pumpWidget(
      MaterialApp(
        home: ImmersivePlayerScreen(
          webPlayer: player,
          initialPreference: AppThemePreference.dark,
          syncEngine: engine,
        ),
      ),
    );
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();

    await player.open('0002', EntryIntent.library, requestPlay: true);
    await tester.pump();
    expect(player.playing, isTrue);
    final loadsBeforeModal = loads;

    // Open sync modal from top-right pill at 1256x706, resize to 773x601, then close.
    await tester.tap(find.byKey(const ValueKey('top_right_progress_sync_pill')));
    await tester.pumpAndSettle();

    tester.view.physicalSize = const Size(773, 601);
    await tester.pump(const Duration(milliseconds: 250));

    expect(player.playing, isTrue);
    expect(loads, loadsBeforeModal);

    await tester.tap(find.byKey(const ValueKey('sync_modal_close_btn')));
    await tester.pumpAndSettle();
    expect(player.playing, isTrue);
    expect(loads, loadsBeforeModal);

    engine.dispose();
  });

  testWidgets('mobile bottom sheet omits close button, supports direct scan & Plan A linked scan merge', (tester) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(430, 880);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final player = make();
    final api = FakeSyncApiClient();
    final engine = SyncEngine(
      apiClient: api,
      kvStore: InMemorySyncKeyValueStore(),
      bridge: WebContractSyncBridge(player, preloadRemoteLastOpened: false),
      baseUrl: 'https://sync.example.test/api/sync/v1',
      platform: 'ios',
      defaultDeviceName: 'iPhone',
    );
    await engine.initialize();

    await tester.pumpWidget(
      MaterialApp(
        home: ImmersivePlayerScreen(
          webPlayer: player,
          initialPreference: AppThemePreference.light,
          syncEngine: engine,
          qrScanner: (_) async => 'epsync://v1/pair?c=K7M9P2XR',
        ),
      ),
    );
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('top_right_progress_sync_pill')));
    await tester.pumpAndSettle();

    // Mobile sheet has NO top-right close button (dismiss via backdrop tap or drag-down).
    expect(find.byKey(const ValueKey('sync_modal_close_btn')), findsNothing);
    expect(find.text('扫码连接'), findsOneWidget);
    expect(find.text('展示二维码'), findsOneWidget);

    // 1-tap direct QR scan from unlinked home.
    await tester.tap(find.byKey(const ValueKey('sync_scan_qr_btn')));
    await tester.pumpAndSettle();

    expect(engine.hasLinkedPeers, isTrue);
    expect(api.claimCalls, 1);
    expect(find.byKey(const ValueKey('sync_linked_scan_btn')), findsOneWidget);
    expect(find.byKey(const ValueKey('sync_add_device_btn')), findsOneWidget);
    expect(find.byKey(const ValueKey('sync_modal_close_btn')), findsNothing);

    // Already-linked mobile device can still tap bottom CTA to scan & smart-merge (Plan A).
    api.serverDevices = [
      SyncDeviceSummary(
        deviceId: 'dev-a',
        deviceName: 'iPhone 17',
        platform: 'ios',
        createdAtMs: api.serverTimeMs - 10000,
        lastSeenAtMs: api.serverTimeMs - 5000,
        isCurrent: false,
      ),
      SyncDeviceSummary(
        deviceId: 'dev-b',
        deviceName: 'iPhone',
        platform: 'ios',
        createdAtMs: api.serverTimeMs,
        lastSeenAtMs: api.serverTimeMs,
        isCurrent: true,
      ),
      SyncDeviceSummary(
        deviceId: 'dev-c',
        deviceName: 'iPad 10',
        platform: 'ipad',
        createdAtMs: api.serverTimeMs + 1000,
        lastSeenAtMs: api.serverTimeMs + 1000,
        isCurrent: false,
      ),
    ];
    await tester.tap(find.byKey(const ValueKey('sync_linked_scan_btn')));
    await tester.pumpAndSettle();
    expect(api.claimCalls, 2);
    expect(api.lastClaimBearerToken, 'tok-b');
    expect(find.text('我的设备 (3)'), findsOneWidget);

    // Dismiss mobile sheet by tapping blank backdrop above it.
    await tester.tapAt(const Offset(200, 120));
    await tester.pumpAndSettle();
    expect(find.text('多端进度同步'), findsNothing);

    engine.dispose();
  });

  testWidgets('harmonized player transport icons (Replay / General & Harmony Loading) render cleanly', (tester) async {
    for (final disableAnim in [false, true]) {
      await tester.pumpWidget(
        MaterialApp(
          builder: (ctx, child) => MediaQuery(
            data: MediaQuery.of(ctx).copyWith(disableAnimations: disableAnim),
            child: child!,
          ),
          home: const Scaffold(
            body: Row(
              children: [
                EpReplayIcon(color: Colors.white),
                EpGeneralLoadingIcon(color: Colors.white),
                EpHarmonyLoadingIcon(color: Colors.white),
                EpHeroLoadingIcon(color: Colors.white, useHarmonyOverride: true),
                EpHeroLoadingIcon(color: Colors.white, useHarmonyOverride: false),
              ],
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 300));
      expect(tester.takeException(), isNull);
    }
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('mobile safe-area top & bottom insets clear header and WebPlayer bars cleanly', (tester) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(430, 880);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final player = make();
    await tester.pumpWidget(
      MaterialApp(
        builder: (ctx, child) => MediaQuery(
          data: MediaQuery.of(ctx).copyWith(
            padding: const EdgeInsets.only(top: 44, bottom: 24),
            viewPadding: const EdgeInsets.only(top: 44, bottom: 24),
          ),
          child: child!,
        ),
        home: ImmersivePlayerScreen(
          webPlayer: player,
          initialPreference: AppThemePreference.dark,
        ),
      ),
    );
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();

    // Library title must sit strictly below top status bar inset (y >= 44).
    final titleRect = tester.getRect(find.text('EnglishPod').first);
    expect(titleRect.top, greaterThanOrEqualTo(44.0));
    expect(tester.takeException(), isNull);

    // Enter player -> _buildWebPlayer top bar & reading area must respect top & bottom insets without overflow.
    await tester.tap(find.text('START LISTENING').first);
    await tester.pumpAndSettle();

    final readRect = tester.getRect(find.byKey(const ValueKey('web_reading_area')));
    expect(readRect.top, greaterThanOrEqualTo(104.0)); // 60 + 44
    expect(readRect.bottom, lessThanOrEqualTo(880.0 - 90.0)); // 66 + 24
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}

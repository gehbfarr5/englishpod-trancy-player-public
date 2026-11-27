import 'package:englishpod_trancy/main.dart';
import 'package:englishpod_trancy/services/sync/sync_engine.dart';
import 'package:englishpod_trancy/services/sync/sync_storage_bridge.dart';
import 'package:englishpod_trancy/services/web_contract_player.dart';
import 'package:englishpod_trancy/widgets/sync/sync_beam_hero.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'sync_engine_test.dart' show FakeSyncApiClient;
import 'tesla_contract_test.dart' show FakeAudio, make;

void main() {
  for (final pref in [AppThemePreference.dark, AppThemePreference.light]) {
    testWidgets('top-right Done pill opens animated beam sync modal (${pref.name})', (tester) async {
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
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();

      expect(find.text('多端进度同步'), findsOneWidget);
      expect(find.byType(SyncBeamHero), findsOneWidget);

      // Tap beam hero to replay pulse sweep without breaking settle.
      await tester.tap(find.byKey(const ValueKey('sync_beam_hero_tap')));
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();

      // Generate pairing code -> verifies QR widget has light quiet zone (#FAF8F5) and XXXX-XXXX code.
      final genBtn = find.byKey(const ValueKey('sync_generate_code_btn'));
      await tester.ensureVisible(genBtn);
      await tester.tap(genBtn);
      await tester.pump(const Duration(milliseconds: 100));
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

      await tester.tap(find.byKey(const ValueKey('sync_modal_close_btn')));
      await tester.pumpAndSettle();
      expect(find.text('多端进度同步'), findsNothing);

      engine.dispose();
    });
  }

  testWidgets('8-char claim flow, device rename/revoke, leave group, and reduced motion', (tester) async {
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

    final enterCodeBtn = find.byKey(const ValueKey('sync_enter_code_btn'));
    await tester.ensureVisible(enterCodeBtn);
    await tester.tap(enterCodeBtn);
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

    final submitBtn = find.byKey(const ValueKey('sync_submit_claim_btn'));
    await tester.ensureVisible(submitBtn);
    await tester.tap(submitBtn);
    await tester.pumpAndSettle();

    expect(engine.isLinked, isTrue);
    expect(find.text('已连接设备 (2)'), findsOneWidget);
    expect(find.text('iPhone 17'), findsNWidgets(2));

    // Revoke other device (dev-a).
    final revokeBtn = find.byKey(const ValueKey('sync_revoke_dev-a'));
    await tester.ensureVisible(revokeBtn);
    await tester.tap(revokeBtn);
    await tester.pumpAndSettle();
    expect(api.revokeCalls, 1);

    // Leave group with confirmation dialog.
    final leaveBtn = find.byKey(const ValueKey('sync_leave_group_btn'));
    await tester.ensureVisible(leaveBtn);
    await tester.tap(leaveBtn);
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
    await tester.pump(const Duration(milliseconds: 350));
    await tester.pumpAndSettle();

    tester.view.physicalSize = const Size(773, 601);
    await tester.pumpAndSettle();

    expect(player.playing, isTrue);
    expect(loads, loadsBeforeModal);

    await tester.tap(find.byKey(const ValueKey('sync_modal_close_btn')));
    await tester.pumpAndSettle();
    expect(player.playing, isTrue);
    expect(loads, loadsBeforeModal);

    engine.dispose();
  });

  testWidgets('qrScanner callback branch scans QR URI and links group', (tester) async {
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

    final scanBtn = find.byKey(const ValueKey('sync_scan_qr_btn'));
    await tester.ensureVisible(scanBtn);
    await tester.tap(scanBtn);
    await tester.pumpAndSettle();

    expect(engine.isLinked, isTrue);
    expect(api.claimCalls, 1);

    await tester.tap(find.byKey(const ValueKey('sync_modal_close_btn')));
    await tester.pumpAndSettle();
    engine.dispose();
  });
}

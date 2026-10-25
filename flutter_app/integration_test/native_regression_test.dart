import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:audio_session/audio_session.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:just_audio/just_audio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:englishpod_trancy/main.dart' as app;
import 'package:englishpod_trancy/services/playback_platform_native.dart' as native;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final results = <Map<String, Object>>[];
  // Isolate fixture progress from the user's application keys even on a device.
  SharedPreferences.setPrefix('ep_native_regression.');

  Future<void> until(WidgetTester tester, bool Function() predicate) async {
    final deadline = DateTime.now().add(const Duration(seconds: 20));
    while (!predicate()) {
      if (DateTime.now().isAfter(deadline)) fail('Native condition timed out');
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> scenario(String id, Future<void> Function() body) async {
    final clock = Stopwatch()..start();
    var status = 'FAIL';
    try {
      await body();
      status = 'PASS';
    } finally {
      results.add({'id': id, 'status': status, 'elapsedMs': clock.elapsedMilliseconds});
      binding.reportData = {'nativeScenarios': results};
    }
  }

  testWidgets('N01 native audio adapter advances, pauses and seeks', (tester) async {
    await scenario('N01', () async {
      // The driver and screenshot channel require an actual first Flutter frame.
      await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Text('Native audio adapter regression'))));
      final session = await AudioSession.instance;
      await session.configure(const AudioSessionConfiguration.music());
      final player = AudioPlayer();
      try {
        final duration = await native.loadLessonAudio(player, '0001', 'pb.wav');
        expect(duration?.inSeconds, closeTo(60, 1));
        unawaited(player.play());
        await until(tester, () => player.position.inMilliseconds >= 900);
        await player.pause();
        final paused = player.position;
        await tester.pump(const Duration(seconds: 1));
        expect((player.position - paused).inMilliseconds.abs(), lessThan(350));
        await player.seek(const Duration(seconds: 12));
        expect(player.position.inMilliseconds, closeTo(12000, 500));
        await player.setSpeed(1.25);
        unawaited(player.play());
        await until(tester, () => player.position.inMilliseconds >= 13000);
        await player.pause();
      } finally {
        await player.dispose();
      }
    });
  }, timeout: const Timeout(Duration(minutes: 3)));

  testWidgets('N02 original app preserves separate track checkpoints', (tester) async {
    await scenario('N02', () async {
      final prefs = await SharedPreferences.getInstance();
      // Only the isolated test prefix is touched; no production progress is removed.
      await prefs.remove('ep_study_progress_v1');
      await prefs.remove('ep_last_lesson_id');
      await prefs.setString('user_theme_preference', 'dark');
      await app.main();
      final card = find.byKey(const ValueKey('course_card_0001')).hitTestable();
      await until(tester, () => card.evaluate().isNotEmpty);
      expect(find.text('Native regression fixture'), findsWidgets);
      await tester.tap(card.first);

      Finder hero(bool playing) => find.byKey(ValueKey('hero_icon_${playing}_false')).hitTestable();
      Future<void> playing(bool value) async {
        await until(tester, () => hero(value).evaluate().isNotEmpty);
        await tester.pump(const Duration(milliseconds: 400));
      }
      Future<void> toggle(bool from) async {
        await tester.tap(hero(from).first);
        await playing(!from);
      }
      Future<Map<String, dynamic>> checkpoint() async {
        await prefs.reload();
        final all = jsonDecode(prefs.getString('ep_study_progress_v1') ?? '{}') as Map<String, dynamic>;
        return (all['0001'] as Map?)?.cast<String, dynamic>() ?? {};
      }

      await playing(true);
      await tester.pump(const Duration(seconds: 3));
      if (Platform.isAndroid) {
        await binding.convertFlutterSurfaceToImage();
        await tester.pump();
      }
      await binding.takeScreenshot('N02-pb-playing');
      await toggle(true);
      final pb = (await checkpoint())['pbPosSec'] as num?;
      expect(pb, isNotNull);
      final pbSeconds = pb!.toDouble();
      expect(pbSeconds, greaterThan(2));

      await toggle(false);
      await tester.tap(find.text('Dialogue').hitTestable().first);
      await until(tester, () => find.byKey(const ValueKey('tab_transcript_0001_dg')).evaluate().isNotEmpty);
      await playing(true);
      await tester.pump(const Duration(seconds: 2));
      await toggle(true);
      final dg = await checkpoint();
      expect((dg['dgPosSec'] as num).toDouble(), greaterThan(1));
      expect((dg['pbPosSec'] as num).toDouble(), greaterThanOrEqualTo(pbSeconds - 0.5));
      await binding.takeScreenshot('N02-dg-paused');

      await toggle(false);
      await tester.tap(find.text('Podcast').hitTestable().first);
      await until(tester, () => find.byKey(const ValueKey('tab_transcript_0001_pb')).evaluate().isNotEmpty);
      await playing(true);
      await toggle(true);
      final restored = await checkpoint();
      expect((restored['pbPosSec'] as num).toDouble(), greaterThanOrEqualTo(pbSeconds - 0.5));
      expect((restored['dgPosSec'] as num).toDouble(), greaterThan(1));
      await binding.takeScreenshot('N02-pb-restored');
      expect(tester.takeException(), isNull);
    });
  }, timeout: const Timeout(Duration(minutes: 3)));

  testWidgets('N03 completed lesson re-enters PB at 00:00 while preserving completion', (tester) async {
    await scenario('N03', () async {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('user_theme_preference', 'dark');
      // Seed a completed checkpoint for lesson 0001
      final seeded = {
        '0001': {
          'isCompleted': true,
          'hasStarted': true,
          'progressPct': 100,
          'lastTrack': 'pb',
          'pbPosSec': 45.0,
          'pbSegIdx': 2,
          'dgPosSec': 10.0,
          'dgSegIdx': 1,
        }
      };
      await prefs.setString('ep_study_progress_v1', jsonEncode(seeded));
      await prefs.setString('ep_last_lesson_id', '0001');

      await app.main();
      final card = find.byKey(const ValueKey('course_card_0001')).hitTestable();
      await until(tester, () => card.evaluate().isNotEmpty);
      await tester.tap(card.first);

      Finder hero(bool playing) => find.byKey(ValueKey('hero_icon_${playing}_false')).hitTestable();
      Future<void> playing(bool value) async {
        await until(tester, () => hero(value).evaluate().isNotEmpty);
        await tester.pump(const Duration(milliseconds: 400));
      }

      await playing(true);
      await binding.takeScreenshot('N03-completed-reenter-pb-playing');

      // Checkpoint must retain isCompleted=true and position started from 00:00
      await prefs.reload();
      final all = jsonDecode(prefs.getString('ep_study_progress_v1') ?? '{}') as Map<String, dynamic>;
      final rec = (all['0001'] as Map?)?.cast<String, dynamic>() ?? {};
      expect(rec['isCompleted'], isTrue);
      expect((rec['pbPosSec'] as num?)?.toDouble(), lessThan(5.0));
      expect(tester.takeException(), isNull);
    });
  }, timeout: const Timeout(Duration(minutes: 3)));
}

import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scrollable_positioned_list/scrollable_positioned_list.dart';
import 'package:englishpod_trancy/main.dart';
import 'package:englishpod_trancy/models/lesson_models.dart';
import 'tesla_contract_test.dart' show make, detail, FakeAudio;
import 'package:englishpod_trancy/services/web_contract_player.dart';

void main() {
  for (final dark in [true, false]) {
    testWidgets('Web controls: home-only appearance, delayed loading, cancel intent and errors (${dark ? "dark" : "paper"})', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(1256,706);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      Completer<double>? gate;
      var fail = false, loads = 0;
      final p = make(factory: () {
        loads++;
        return FakeAudio()..loading = gate..failure = fail ? StateError('404') : null;
      });
      await tester.pumpWidget(MaterialApp(home: ImmersivePlayerScreen(webPlayer: p,
        initialPreference: dark ? AppThemePreference.dark : AppThemePreference.light)));
      await tester.pump(const Duration(seconds: 3)); await tester.pumpAndSettle();
      expect(find.bySemanticsLabel('Change appearance'), findsOneWidget);
      await tester.tap(find.text('START LISTENING').first); await tester.pumpAndSettle();
      final player = find.byKey(const ValueKey('web_player'));
      expect(find.descendant(of: player, matching: find.text(dark ? 'Dark' : 'Light')), findsNothing);
      final slowGate = Completer<double>();
      gate = slowGate;
      final pending = p.switchTrack('dg');
      await tester.pump();
      expect(p.loading, true);
      expect(find.text('Loading audio…'), findsNothing);
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.byKey(const ValueKey('hero_audio_loading')), findsNothing);
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.byKey(const ValueKey('hero_audio_loading')), findsOneWidget);
      tester.view.physicalSize = const Size(773,601); await tester.pump();
      expect(find.byKey(const ValueKey('hero_audio_loading')), findsOneWidget);
      expect(find.descendant(of: player, matching: find.text(dark ? 'Dark' : 'Light')), findsNothing);
      expect(loads,2);
      await p.setPlaying(true); await tester.pump();
      await tester.tap(find.byKey(const ValueKey('web_audio_hero'))); await tester.pump();
      expect(p.wantsPlay,false);
      slowGate.complete(100); await pending; await tester.pumpAndSettle();
      expect(p.playing,false);
      expect(find.byKey(const ValueKey('hero_audio_loading')), findsNothing);
      final fastGate = Completer<double>();
      gate = fastGate;
      final fast = p.switchTrack('pb'); await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));
      fastGate.complete(100); await fast;
      await tester.pump(const Duration(milliseconds: 600)); await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('hero_audio_loading')), findsNothing);
      expect(find.text('Loading audio…'), findsNothing);
      gate = null; fail = true;
      await p.switchTrack('dg'); await tester.pumpAndSettle();
      expect(find.text('Unable to load audio. Retry or return to library.'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      expect(tester.takeException(),isNull);
      await tester.pumpWidget(const SizedBox());
    });
  }
  for (final dark in [true, false]) {
    testWidgets('Original ${dark ? "dark" : "paper"} UI: S09 S10 actual player preserves media and reading anchor', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(1256,706);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var loads = 0;
      String? saved;
      final p = make(write: (value) async { saved = value; }, factory: () { loads++; return FakeAudio(); });
      await tester.pumpWidget(MaterialApp(home: ImmersivePlayerScreen(webPlayer: p,
        initialPreference: dark ? AppThemePreference.dark : AppThemePreference.light)));
      await tester.pump(const Duration(seconds: 3)); await tester.pumpAndSettle();
      // The original live card is the entry, not TeslaApp's replacement list.
      await tester.tap(find.text('START LISTENING').first);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await p.setPlaying(true); p.tick(12); p.toggleTrackLoop(); await p.setRate(1.25);
      await tester.pumpAndSettle();
      final transcript = find.byType(ScrollablePositionedList).first;
      await tester.drag(transcript, const Offset(0,-300)); await tester.pumpAndSettle();
      final visibleSentences = find.textContaining('Sentence', findRichText: true).evaluate().where((e) {
        final rect = tester.getRect(find.byWidget(e.widget));
        return rect.top >= 60 && rect.bottom < 706;
      }).toList();
      final anchorWidget = visibleSentences.first.widget;
      final String anchor;
      if (anchorWidget is RichText) {
        anchor = anchorWidget.text.toPlainText();
      } else {
        final text = anchorWidget as Text;
        anchor = text.data ?? text.textSpan!.toPlainText();
      }
      for (final immersive in [false,true]) {
        if (p.immersive != immersive) p.toggleImmersive();
        for (final size in [const Size(773,601), const Size(1256,706)]) {
          tester.view.physicalSize = size; await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(p.playing, true); expect(p.position,12); expect(p.track,'pb');
          expect(p.trackLoop,true); expect(p.rate,1.25); expect(p.immersive,immersive);
          expect(loads,1);
          final anchorRect = tester.getRect(find.text(anchor, findRichText: true).first);
          expect(anchorRect.bottom > 60 && anchorRect.top < size.height - (size.width < 1000 ? 66 : 0), true);
          expect(find.byTooltip('More'), size.width < 1000 ? findsOneWidget : findsNothing);
          if (size.width >= 1000) expect(find.text('Immersive mode'), findsNothing);
        }
      }
      await p.switchTrack('vocab'); await tester.pumpAndSettle();
      for (final size in [const Size(773,601), const Size(1256,706)]) {
        tester.view.physicalSize = size; await tester.pumpAndSettle();
        expect(p.tab, 'vocab'); expect(p.playing, true); expect(loads,1);
        expect(tester.takeException(), isNull);
      }
      await p.switchTrack('pb'); await tester.pumpAndSettle();
      p.tick(13);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      await tester.pumpAndSettle();
      expect(jsonDecode(saved!)['records']['0001']['pb']['position'],13);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await p.switchTrack('dg'); p.tick(99); await p.naturalEnd();
      // Disable preserved track loop before checking ended UI.
      if(p.trackLoop)p.toggleTrackLoop();
      await p.setPlaying(true);p.tick(99);await p.naturalEnd();await tester.pumpAndSettle();
      expect(find.text('Replay'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });
  }
  testWidgets('S10 long paragraphs retain negative reading offsets beyond one viewport', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1256,706);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var loads = 0;
    final p = make(factory: () { loads++; return FakeAudio(); }, read: (id) async {
      final value = detail(id);
      value.pbSegments[0] = TranscriptSegment(id: 0, speaker: 'A',
        text: List.filled(200,'Long context').join(' '), start: 0, end: 100,
        isSection: false, inDialogueBlock: false, words: const []);
      return value;
    });
    p.immersive = false;
    await tester.pumpWidget(MaterialApp(home: ImmersivePlayerScreen(webPlayer: p,
      initialPreference: AppThemePreference.dark)));
    await tester.pump(const Duration(seconds: 3)); await tester.pumpAndSettle();
    await tester.tap(find.text('START LISTENING').first); await tester.pumpAndSettle();
    final transcript = find.byType(ScrollablePositionedList).first;
    await tester.drag(transcript, const Offset(0,-1400)); await tester.pumpAndSettle();
    final paragraph = find.descendant(of: transcript,
      matching: find.textContaining('Long context',findRichText:true)).first;
    final alignment = (tester.getRect(paragraph).top - 60) / 646;
    expect(alignment, lessThan(-1));
    for (final size in [const Size(773,601), const Size(1256,706)]) {
      tester.view.physicalSize = size; await tester.pumpAndSettle();
      final nextAlignment = (tester.getRect(paragraph).top - 60) / (size.height - 60 - (size.width < 1000 ? 66 : 0));
      expect(nextAlignment, closeTo(alignment,.25));
      expect(loads,1); expect(p.position,0); expect(p.playing,true);
      expect(tester.takeException(),isNull);
    }
    await tester.pumpWidget(const SizedBox());
  });
  for (final dark in [true, false]) {
    testWidgets('v1.4 S20 wide sidebar only, both playback states and stored preferences ${dark ? "dark" : "paper"}', (tester) async {
      tester.view.devicePixelRatio = 1; tester.view.physicalSize = const Size(1256,706);
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      var loads = 0;
      final p = make(factory: () { loads++; return FakeAudio(); });
      await tester.pumpWidget(MaterialApp(home: ImmersivePlayerScreen(webPlayer: p,
        initialPreference: dark ? AppThemePreference.dark : AppThemePreference.light)));
      await tester.pump(const Duration(seconds:3));await tester.pumpAndSettle();
      await tester.tap(find.text('START LISTENING').first);await tester.pumpAndSettle();
      final reading = find.byKey(const ValueKey('web_reading_area'));
      final area = tester.getRect(reading);
      expect(area,const Rect.fromLTWH(0,60,980,646));
      for (final playing in [true,false]) {
        await p.setPlaying(playing);await tester.pump(const Duration(seconds:6));await tester.pumpAndSettle();
        expect(tester.getRect(reading),area);
        expect(find.byTooltip('More'),findsNothing);
        expect(find.text('Immersive mode'),findsNothing);
        expect(find.byKey(const ValueKey('web_reveal_controls')),findsNothing);
        for (final label in ['Sentence loop','Track loop','Auto-next Podcast','Current sentence']) {
          expect(find.text(label),findsOneWidget);
        }
        final nav = ['Previous sentence','Previous lesson','Next lesson','Next sentence']
          .map((label) => tester.getRect(find.byTooltip(label))).toList();
        expect(nav.every((r)=>r.left>=980 && (r.top-nav.first.top).abs()<1),true);
      }
      // A saved compact preference survives wide mode; pause never hides either.
      expect(p.immersive,true);
      tester.view.physicalSize = const Size(773,601);await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds:6));await tester.pumpAndSettle();
      expect(find.byTooltip('More'),findsOneWidget);
      expect(find.byKey(const ValueKey('web_reveal_controls')),findsNothing);
      await tester.tap(find.byTooltip('More'));await tester.pumpAndSettle();
      expect(find.text('Immersive mode'),findsOneWidget);
      tester.view.physicalSize = const Size(1256,706);await tester.pumpAndSettle();
      expect(find.byType(BottomSheet),findsNothing);
      expect(find.text('Immersive mode'),findsNothing);
      expect(find.text('Sentence loop'),findsOneWidget);
      tester.view.physicalSize = const Size(773,601);await tester.pumpAndSettle();
      await p.setPlaying(true);await tester.pump(const Duration(seconds:5));await tester.pumpAndSettle();
      expect(find.byTooltip('More'),findsNothing);
      expect(find.byKey(const ValueKey('web_reveal_controls')),findsOneWidget);
      tester.view.physicalSize = const Size(1256,706);await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds:5));await tester.pumpAndSettle();
      expect(tester.getRect(reading),area);expect(p.immersive,true);expect(p.playing,true);expect(loads,1);
      expect(find.text('Library'),findsOneWidget);expect(find.byTooltip('More'),findsNothing);
      tester.view.physicalSize = const Size(773,601);await tester.pumpAndSettle();
      await p.switchTrack('dg');await tester.pump(const Duration(seconds:5));await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('web_reveal_controls')),findsOneWidget);
      p.tick(99);await p.naturalEnd();await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds:5));await tester.pumpAndSettle();
      expect(p.ended,true);expect(find.text('Replay'),findsOneWidget);
      expect(find.byTooltip('More'),findsOneWidget);
      expect(find.byKey(const ValueKey('web_reveal_controls')),findsNothing);
      expect(tester.takeException(),isNull);
      await tester.pumpWidget(const SizedBox());
    });
    for (final size in [const Size(773,601)]) {
      testWidgets('v1.4 E16 E17 S13-S19 S21 entry, compact immersion only while playing ${dark ? "dark" : "paper"} ${size.width}', (tester) async {
        tester.view.devicePixelRatio = 1; tester.view.physicalSize = size;
        addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
        String? disk;
        var loads = 0;
        final p = make(write: (value) async { disk = value; }, factory: () { loads++; return FakeAudio(); });
        p.record('0001').tracks['pb']!.position = 45;
        p.record('0001').tracks['dg']!.position = 23;
        p.record('0002').completed = true;
        p.record('0002').tracks['pb']!.position = 97;
        await tester.pumpWidget(MaterialApp(theme: ThemeData(platform: TargetPlatform.linux), home: ImmersivePlayerScreen(webPlayer: p,
          initialPreference: dark ? AppThemePreference.dark : AppThemePreference.light)));
        await tester.pump(const Duration(seconds: 3)); await tester.pumpAndSettle();
        expect(p.playing, false); expect(p.immersive, true);
        await tester.tap(find.byKey(const ValueKey('course_card_0001')));
        await tester.pumpAndSettle();
        expect(p.playing, true); expect(p.position,45); expect(p.track,'pb');
        expect(p.record('0001').tracks['dg']!.position,23);
        await p.setPlaying(false);
        await tester.tap(find.text('Library').first); await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('course_card_0002')));
        await tester.pumpAndSettle();
        expect(p.playing,true); expect(p.position,0); expect(p.record('0002').completed,true);
        final count = loads;
        // Set a known idle deadline before approaching it; pumpAndSettle above
        // also advances the page animation's clock.
        await tester.tap(find.byKey(const ValueKey('web_audio_hero')));
        await p.setPlaying(true);await tester.pump();
        final beforeIdle = tester.getRect(find.byKey(const ValueKey('web_reading_area')));
        await tester.pump(const Duration(milliseconds:3800));
        final held = await tester.startGesture(tester.getCenter(find.byKey(const ValueKey('web_audio_hero'))));
        await tester.pump(const Duration(milliseconds:400));
        expect(tester.getRect(find.byKey(const ValueKey('web_reading_area'))),beforeIdle);
        await held.up();await tester.pumpAndSettle();
        expect(p.playing,true);
        await tester.pump(const Duration(milliseconds: 4100)); await tester.pumpAndSettle();
        final reading = find.byKey(const ValueKey('web_reading_area'));
        final full = Rect.fromLTWH(0,0,size.width,size.height);
        expect(tester.getRect(reading), full);
        expect(find.descendant(of: reading,matching: find.byType(Scrollbar)),findsNothing);
        expect(find.byKey(const ValueKey('web_reveal_controls')),findsOneWidget);
        expect(find.byTooltip('More'),findsNothing);
        final hero = find.byKey(const ValueKey('web_audio_hero'));
        final heroRect = tester.getRect(hero);
        final gesture = await tester.startGesture(tester.getCenter(hero));
        await tester.pump(const Duration(milliseconds: 50));
        expect(tester.getRect(reading),full);
        await gesture.up(); await tester.pumpAndSettle();
        expect(p.playing,false); expect(tester.getRect(reading),beforeIdle);
        expect(tester.getRect(hero),heroRect);
        expect(find.text('Library'), findsOneWidget);
        expect(find.byTooltip('More'),findsOneWidget);
        await tester.pump(const Duration(seconds:6));await tester.pumpAndSettle();
        expect(tester.getRect(reading),beforeIdle);
        expect(find.byKey(const ValueKey('web_reveal_controls')),findsNothing);
        await p.seek(42);
        final replay = await tester.startGesture(tester.getCenter(hero));
        await tester.pump(const Duration(milliseconds:200));
        await tester.pump(const Duration(milliseconds:1000));
        await replay.up();await tester.pumpAndSettle();
        expect(p.position,0);expect(p.playing,true);
        expect(tester.getRect(reading),beforeIdle);expect(loads,count);
        await tester.pump(const Duration(seconds:5));await tester.pumpAndSettle();
        expect(tester.getRect(reading),full);
        final before = p.position;
        await tester.tapAt(const Offset(200,200)); await tester.pumpAndSettle();
        expect(p.position,before);
        expect(find.text('Library'),findsOneWidget);
        expect(find.byKey(const ValueKey('web_reveal_controls')),findsNothing);
        await tester.tap(find.text('Sentence 1',findRichText:true).first); await tester.pumpAndSettle();
        expect(p.position,closeTo(10,.3));
        // S18: manual reading survives chrome expansion as well as viewport resize.
        final list = find.byType(ScrollablePositionedList).first;
        await tester.drag(list,const Offset(0,-250)); await tester.pumpAndSettle();
        final visible = find.textContaining('Sentence',findRichText:true).evaluate().where((e) {
          final r = tester.getRect(find.byWidget(e.widget));
          final area = tester.getRect(reading);
          return r.bottom>area.top&&r.top<area.bottom;
        }).toList();
        final anchorWidget = visible.first.widget;
        final anchorText = anchorWidget is RichText ? anchorWidget.text.toPlainText()
          : (anchorWidget as Text).data ?? anchorWidget.textSpan!.toPlainText();
        final anchor = find.text(anchorText,findRichText:true).first;
        double alignment() => (tester.getRect(anchor).top-tester.getRect(reading).top)/tester.getRect(reading).height;
        final beforeAlignment = alignment();
        final mediaPosition = p.position;
        await tester.pump(const Duration(milliseconds:4100)); await tester.pumpAndSettle();
        expect(tester.getRect(reading),full);
        expect(alignment(),closeTo(beforeAlignment,.08));
        expect(p.position,mediaPosition);expect(loads,count);
        await tester.tapAt(const Offset(200,200));await tester.pumpAndSettle();
        expect(alignment(),closeTo(beforeAlignment,.08));
        expect(p.position,mediaPosition);
        if (size.width < 1000) {
          expect(find.byTooltip('Previous sentence'),findsNothing);
          expect(find.byTooltip('Next sentence'),findsNothing);
        }
        await tester.tap(find.byTooltip('More')); await tester.pumpAndSettle();
        final nav = ['Previous sentence','Previous lesson','Next lesson','Next sentence']
          .map((label) => tester.getRect(find.byTooltip(label).last)).toList();
        expect(nav.every((r) => (r.top - nav.first.top).abs() < 1),true);
        await tester.tap(find.text('Sentence loop').last); await tester.pumpAndSettle();
        await tester.tap(find.text('Auto-next Podcast').last); await tester.pumpAndSettle();
        await tester.tap(find.text('Immersive mode').last); await tester.pumpAndSettle();
        await tester.pump(const Duration(seconds: 5)); await tester.pumpAndSettle();
        expect(p.sentenceLoop,true); expect(p.trackLoop,false); expect(p.autoNext,false); expect(p.immersive,false);
        await p.checkpoint();
        final restored = make()..restore(disk);
        await restored.open('0002',EntryIntent.preload,updateAnchor:false);
        expect(restored.sentenceLoop,true); expect(restored.trackLoop,false);
        expect(restored.autoNext,false); expect(restored.immersive,false); expect(restored.playing,false);
        expect(loads,count); expect(tester.takeException(),isNull);
        restored.dispose();
        await tester.pumpWidget(const SizedBox()); await tester.pumpAndSettle();
      });
    }
  }
  test('Original palette remains byte-for-byte brand colors', () {
    expect(AppPalette.dark.bgWell, const Color(0xff070709));
    expect(AppPalette.dark.accent, const Color(0xff1ed760));
    expect(AppPalette.paper.bgWell, const Color(0xfff2ede2));
    expect(AppPalette.paper.accent, const Color(0xffcc785c));
  });
}


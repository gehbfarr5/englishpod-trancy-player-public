import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:englishpod_trancy/services/web_contract_player.dart';
import 'tesla_contract_test.dart' show make, detail, FakeAudio;

void main() {
  test('F09 F14: last PB wraps to first at zero without erasing history', () async {
    final p = make();
    p.record('0001').tracks['pb']!.position = 50;
    await p.open('0003', EntryIntent.library, requestPlay: true);
    p.tick(99); await p.naturalEnd();
    expect(p.lesson!.lessonId, '0001'); expect(p.lastOpened, '0001');
    expect(p.position, 0); expect(p.playing, true);
    expect(p.record('0003').completed, true);
    await p.checkpoint(); expect(p.record('0001').tracks['pb']!.position, 50);
    p.tick(1); await p.checkpoint(); expect(p.record('0001').tracks['pb']!.position, 1);
    expect(p.canNavigate(-1), false); p.dispose();
  });
  test('F13: one lesson repeats PB at zero', () async {
    final p = make(); p.lessons = [p.lessons.first];
    await p.open('0001', EntryIntent.library, requestPlay: true);
    p.tick(99); await p.naturalEnd();
    expect(p.lesson!.lessonId, '0001'); expect(p.position, 0); expect(p.playing, true);
    expect(p.canNavigate(1), false); p.dispose();
  });
  test('F15: pause during wrap metadata load defeats autoplay', () async {
    final gate = Completer<dynamic>();
    final p = make(read: (id) async => id == '0001' ? await gate.future : detail(id));
    await p.open('0003', EntryIntent.library, requestPlay: true);
    p.tick(99); final wrap = p.naturalEnd();
    await Future<void>.delayed(Duration.zero); await p.setPlaying(false);
    gate.complete(detail('0001')); await wrap;
    expect(p.lesson!.lessonId, '0001'); expect(p.playing, false); expect(p.wantsPlay, false); p.dispose();
  });
  test('F16: sentence loop wins; disabling permits last-to-first wrap', () async {
    final p = make(); await p.open('0003', EntryIntent.library, requestPlay: true);
    await p.seek(92); p.toggleSentenceLoop(); p.tick(99);
    await Future<void>.delayed(Duration.zero);
    expect(p.lesson!.lessonId, '0003'); expect(p.position, 90);
    p.toggleSentenceLoop(); p.tick(99); await p.naturalEnd();
    expect(p.lesson!.lessonId, '0001'); expect(p.sentenceLoop, false); p.dispose();
  });
  test('Cold preload does not fabricate a visit or erase a checkpoint', () async {
    final p = make(); await p.open('0001', EntryIntent.resume, updateAnchor: false);
    expect(p.lastOpened, isNull); expect(p.playing, false);
    await p.open('0001', EntryIntent.resume); expect(p.lastOpened, '0001'); p.dispose();
  });
  test('Late callbacks from superseded media are inert', () async {
    final media = <FakeAudio>[];
    final p = make(factory: () { final a = FakeAudio(); media.add(a); return a; });
    await p.open('0001', EntryIntent.library, requestPlay: true);
    await p.open('0003', EntryIntent.library);
    media.first.onPosition(99); media.first.onEnded();
    await Future<void>.delayed(Duration.zero);
    expect(p.lesson!.lessonId, '0003'); expect(p.position, 0);
    expect(p.record('0001').completed, false); p.dispose();
  });
  test('Stopped PB resume displays zero without overwriting the completed checkpoint', () async {
    final p = make(); p.autoNext = false;
    await p.open('0001', EntryIntent.library, requestPlay: true);
    p.tick(99); await p.naturalEnd();
    await p.open('0001', EntryIntent.resume);
    expect(p.position, 0); expect(p.playing, false);
    await p.checkpoint();
    expect(p.record('0001').tracks['pb']!.position, 100);
    expect(p.record('0001').completed, true); p.dispose();
  });

  test('An invalid breakpoint beyond a changed duration starts safely at zero', () async {
    final p = make(); p.record('0001').tracks['pb']!.position = 150;
    await p.open('0001', EntryIntent.library);
    expect(p.position, 0); expect(p.playing, false);
    expect(p.record('0001').completed, false); p.dispose();
  });

  test('Original timed pre-scroll remains on the actual Web state machine', () async {
    final p = make(); await p.open('0001', EntryIntent.library);
    await p.seek(9.6);
    expect(p.activeIndex, 1); // Prior sentence ends at 9; next starts at 10.
    p.toggleSentenceLoop(); await p.setPlaying(true); p.tick(19);
    await Future<void>.delayed(Duration.zero);
    expect(p.position, 10); expect(p.record('0001').completed, false);
    p.dispose();
  });

  test('First audio course after web entry: natural PB end advances to next lesson at zero and continues playing without Replay button', () async {
    final p = make();
    // Cold start loads first lesson via EntryIntent.preload (no auto-play)
    await p.open('0001', EntryIntent.preload);
    expect(p.lesson!.lessonId, '0001');
    expect(p.playing, false);
    expect(p.ended, false);

    // User taps play on the hero button
    await p.setPlaying(true);
    expect(p.playing, true);

    // Natural playback progresses and reaches completion
    p.tick(50);
    p.tick(99);
    expect(p.record('0001').completed, true);

    await p.naturalEnd();

    // Must advance to lesson 0002, position 0, playing true, ended false (no Replay button)
    expect(p.lesson!.lessonId, '0002');
    expect(p.position, 0);
    expect(p.playing, true);
    expect(p.wantsPlay, true);
    expect(p.ended, false);
    expect(p.record('0001').completed, true);
    p.dispose();
  });
}

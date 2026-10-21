import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:englishpod_trancy/services/web_contract_player.dart';
import 'tesla_contract_test.dart' show make;

void main() {
  test('v1.3 preferences: absent defaults immersive; explicit standard and every switch survive', () async {
    final fresh = make()..restore(jsonEncode({'schema':1,'records':{}}));
    expect(fresh.immersive,true);
    String? disk;
    final p = make(write:(value) async { disk=value; });
    await p.open('0001',EntryIntent.preload);
    p.toggleImmersive(); p.toggleAutoNext(); p.toggleSentenceLoop(); await p.setRate(1.5);
    await p.checkpoint();
    String? restoredDisk;
    final q=make(write:(value) async {restoredDisk=value;})..restore(disk);
    await q.open('0001',EntryIntent.preload,updateAnchor:false);
    expect(q.immersive,false);expect(q.autoNext,false);expect(q.sentenceLoop,true);expect(q.trackLoop,false);
    expect(q.rate,1.5);expect(q.playing,false);
    // Clicking the resumed same PB requests playback, without clearing the restored sentence switch.
    await q.open('0001',EntryIntent.resume,requestPlay:true);
    expect(q.sentenceLoop,true);expect(q.playing,true);
    q.toggleTrackLoop();await q.checkpoint();
    final r=make()..restore(restoredDisk);
    expect(r.trackLoop,true);expect(r.sentenceLoop,false);
    fresh.dispose();p.dispose();q.dispose();r.dispose();
  });
  test('v1.3 navigation clears sentence loop durably, not initial preloading', () async {
    String? disk;
    final p=make(write:(value) async {disk=value;});
    await p.open('0001',EntryIntent.preload);
    p.toggleSentenceLoop();await p.checkpoint();
    final restored=make()..restore(disk);
    await restored.open('0001',EntryIntent.preload,updateAnchor:false);
    expect(restored.sentenceLoop,true);
    await p.navigate(1);await p.checkpoint();
    final q=make()..restore(disk);
    expect(q.sentenceLoop,false);expect(q.immersive,true);
    p.dispose();q.dispose();restored.dispose();
  });
}


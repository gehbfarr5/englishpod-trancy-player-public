import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:englishpod_trancy/models/lesson_models.dart';
import 'package:englishpod_trancy/tesla/playback_contract.dart';

class FakeAudio implements ContractAudio {
  @override
  late void Function(double) onPosition;
  @override
  late void Function() onEnded;
  @override
  late void Function(Object) onError;
  double pos = 0;
  bool audible = false, disposed = false;
  Completer<double>? loading;
  Object? failure;
  Object? playFailure;
  Completer<void>? playGate;
  @override
  Future<double> load(LessonDetail l, String t) async {
    if (failure != null) throw failure!;
    return loading == null ? 100 : loading!.future;
  }
  @override
  Future<void> seek(double p) async { pos = p; }
  @override
  Future<void> play() async { final gate=playGate;playGate=null;if(gate!=null)await gate.future; if (playFailure != null) throw playFailure!; audible = true; }
  @override
  Future<void> pause() async { audible = false; }
  @override
  Future<void> speed(double v) async {}
  @override
  Future<void> dispose() async { disposed = true; audible = false; }
}
LessonDetail detail(String id) => LessonDetail.fromJson({'LessonId': id, 'title': 'Test lesson', 'audio': {'pb': 'pb.mp3', 'dg': 'dg.mp3'}, 'tracks': {
  for (final t in ['pb','dg']) t: [for (var i=0;i<10;i++) {'id':i, 'text':'Sentence $i', 'start':i*10, 'end':i*10+9}]
}});
ContractPlayer make({Future<LessonDetail> Function(String)? read, Future<void> Function(String)? write, FakeAudio Function()? factory}) {
  return ContractPlayer(audioFactory: factory ?? FakeAudio.new, readLesson: read ?? (id) async => detail(id), write: write ?? (_) async {}, retryDelay: Duration.zero)
    ..lessons = ['0001','0002','0003'].map((id) => LessonSummary.fromJson({'lesson_id':id})).toList();
}
void main() {
  test('E01 E07 E13: library and resume PB; track checkpoints independent', () async {
    final p=make();
    p.record('0001').tracks['pb']!.position=45;
    p.record('0001').tracks['dg']!.position=20;
    await p.open('0001',EntryIntent.library); expect(p.position,45);
    await p.switchTrack('dg'); expect(p.position,20);
    await p.seek(25); await p.switchTrack('pb'); expect(p.position,45);
    expect(p.record('0001').tracks['dg']!.position,25);
    p.dispose();
  });
  test('E02 E03 E04: manual nav inherits track/state, zero, no wrap', () async {
    final p=make(); await p.open('0002',EntryIntent.library);
    await p.switchTrack('dg'); p.toggleTrackLoop(); p.toggleSentenceLoop();
    await p.setPlaying(true); await p.navigate(1);
    expect(p.track,'dg'); expect(p.position,0); expect(p.playing,true); expect(p.sentenceLoop,false);
    expect(p.canNavigate(1),false); await p.navigate(1); expect(p.lesson!.lessonId,'0003');
    await p.setPlaying(false); p.toggleTrackLoop(); await p.navigate(-1);
    expect(p.trackLoop,true); expect(p.playing,false); p.dispose();
  });
  test('E05 E06 E15: untouched manual zero cannot erase breakpoint; resume no reload', () async {
    var loads=0; final p=make(factory: () { loads++; return FakeAudio(); });
    p.record('0002').tracks['pb']!.position=80;
    await p.open('0001',EntryIntent.library); await p.navigate(1);
    await p.checkpoint(); expect(p.record('0002').tracks['pb']!.position,80);
    expect(p.lastOpened,'0002'); expect(p.position,0);
    await p.open('0002',EntryIntent.resume); expect(p.position,80); expect(loads,2); p.dispose();
  });
  test('E08 E09 E10 E11 E14: completed/list, cold silent, PB resume without rewind or toggle', () async {
    final p=make(); p.record('0001').completed=true; p.record('0001').tracks['pb']!.position=90;
    await p.open('0001',EntryIntent.library); expect(p.position,0); expect(p.playing,false);
    await p.checkpoint(); expect(p.record('0001').tracks['pb']!.position,90);
    await p.setPlaying(true); p.tick(10); await p.open('0001',EntryIntent.resume,requestPlay:true);
    expect(p.position,10); expect(p.playing,true);
    await p.switchTrack('dg'); await p.open('0001',EntryIntent.resume); expect(p.track,'pb'); expect(p.playing,true); p.dispose();
  });
  test('E12: vocab does not switch or pause media', () async {
    final p=make(); await p.open('0001',EntryIntent.library); await p.setPlaying(true); p.tick(12);
    await p.switchTrack('vocab'); expect(p.track,'pb'); expect(p.position,12); expect(p.playing,true); p.dispose();
  });
  test('F01 F02 F03 F04 F12: completion only genuine progression, sticky', () async {
    final p=make(); await p.open('0001',EntryIntent.library); await p.seek(98);
    expect(p.record('0001').completed,false);
    await p.seek(100); await p.naturalEnd(); expect(p.record('0001').completed,false); expect(p.lesson!.lessonId,'0001');
    await p.seek(94); await p.setPlaying(true); p.tick(96); expect(p.record('0001').completed,true);
    await p.seek(20); expect(p.record('0001').completed,true); p.dispose();
    final q=make(); q.autoNext=false; await q.open('0001',EntryIntent.library); await q.seek(98); await q.setPlaying(true); q.tick(99); await q.naturalEnd(); expect(q.record('0001').completed,true); q.dispose();
  });
  test('F05 F06: DG ends/replays same track; loop wins, never completes PB', () async {
    final p=make(); await p.open('0001',EntryIntent.library); await p.switchTrack('dg'); await p.setPlaying(true); p.tick(99); await p.naturalEnd();
    expect(p.ended,true); expect(p.playing,false); expect(p.track,'dg'); expect(p.record('0001').completed,false);
    await p.setPlaying(true); expect(p.position,0); expect(p.playing,true);
    p.toggleTrackLoop(); p.tick(99); await p.naturalEnd(); expect(p.position,0); expect(p.track,'dg'); expect(p.playing,true); p.dispose();
  });
  test('F07 F08 F09: PB auto-next, disabled and final boundary', () async {
    final p=make(); await p.open('0001',EntryIntent.library); await p.setPlaying(true); p.tick(99); await p.naturalEnd();
    expect(p.lesson!.lessonId,'0002'); expect(p.position,0); expect(p.playing,true);
    p.autoNext=false; p.tick(99); await p.naturalEnd(); expect(p.lesson!.lessonId,'0002'); expect(p.ended,true);
    p.autoNext=true; await p.open('0003',EntryIntent.library,requestPlay:true); p.tick(99); await p.naturalEnd();
    expect(p.lesson!.lessonId,'0001'); expect(p.position,0); expect(p.playing,true); p.dispose();
  });
  test('F10 F11: sentence/track exclusion, fixed sentence loop, auto-next retained', () async {
    final p=make(); await p.open('0001',EntryIntent.library); await p.setPlaying(true); p.tick(12);
    p.toggleTrackLoop(); p.toggleSentenceLoop(); expect(p.trackLoop,false); expect(p.autoNext,true);
    p.tick(20); await Future<void>.delayed(Duration.zero); expect(p.position,10); expect(p.lesson!.lessonId,'0001');
    await p.seek(32); p.tick(40); await Future<void>.delayed(Duration.zero);
    expect(p.position,30); p.dispose();
  });
  test('S03: async writes serialized immutable snapshots', () async {
    final gate=Completer<void>(); final seen=<String>[];
    final p=make(write:(s) async { if(seen.isEmpty) await gate.future; seen.add(s); });
    p.lastOpened='0001'; final a=p.persist(); p.lastOpened='0002'; final b=p.persist();
    gate.complete(); await a; await b;
    expect(jsonDecode(seen.last)['lastOpened'],'0002'); expect(jsonDecode(seen.last)['revision'],2); p.dispose();
  });
  test('S04: stale metadata cannot change active lesson or start audio', () async {
    final b=Completer<LessonDetail>(); final p=make(read:(id) => id=='0002' ? b.future : Future.value(detail(id)));
    await p.open('0001',EntryIntent.library); final pending=p.open('0002',EntryIntent.library);
    await p.open('0003',EntryIntent.library); b.complete(detail('0002')); await pending;
    expect(p.lesson!.lessonId,'0003'); expect(p.lastOpened,'0003'); p.dispose();
  });
  test('S05: pause during pending load overrides captured autoplay', () async {
    final gate=Completer<double>(); final audio=FakeAudio()..loading=gate; final p=make(factory:()=>audio);
    final pending=p.open('0001',EntryIntent.autoNext); await Future<void>.delayed(Duration.zero);
    await p.setPlaying(false); gate.complete(100); await pending; expect(p.playing,false); expect(audio.audible,false); p.dispose();
  });
  test('S06 S07: permanent failure stops; transient bounded retry', () async {
    var n=0; final p=make(factory:() { n++; return FakeAudio()..failure=StateError('404'); });
    await p.open('0001',EntryIntent.library); expect(n,1); expect(p.error,isNotNull); expect(p.lesson!.lessonId,'0001'); p.dispose();
    n=0; final q=make(factory:() { n++; return FakeAudio()..failure=n<3 ? TimeoutException('network') : null; });
    await q.open('0001',EntryIntent.library); expect(n,3); expect(q.error,isNull); q.dispose();
  });
  test('S08: autoplay denial waits for gesture without retry storm', () async {
    var created=0; final a=FakeAudio()..playFailure=StateError('NotAllowedError: autoplay');
    final p=make(factory:(){created++;return a;});
    await p.open('0001',EntryIntent.library,requestPlay:true);
    await Future<void>.delayed(Duration.zero);
    expect(p.waitingGesture,true); expect(p.playing,false); expect(created,1);
    a.playFailure=null; await p.setPlaying(true); expect(p.playing,true); p.dispose();
  });
  test('S01 S02: playback checkpoint, explicit seek and failed storage recovery', () async {
    final seen=<String>[]; var failing=true;
    final p=make(write:(s) async {if(failing) throw StateError('quota');seen.add(s);});
    await p.open('0001',EntryIntent.library); await p.setPlaying(true); p.tick(15);
    await p.checkpoint(); expect(p.saved,false);
    failing=false; await p.setPlaying(false); await p.checkpoint();
    expect(p.saved,true); final restored=make()..restore(seen.last);
    expect(restored.record('0001').tracks['pb']!.position,15);
    expect(restored.playing,false); p.dispose(); restored.dispose();
  });
  test('Exact E01 E13: ordinary entry from DG to another DG-only lesson selects fresh PB', () async {
    final p=make(); await p.open('0001',EntryIntent.library); await p.switchTrack('dg');
    p.record('0002').tracks['dg']!.position=30;
    await p.open('0002',EntryIntent.library);
    expect(p.track,'pb'); expect(p.position,0); expect(p.record('0002').tracks['dg']!.position,30);p.dispose();
  });
  test('Exact E05 E09 E10 E14: last opened without playing, cold PB resume, no live rewind', () async {
    String? disk; final p=make(write:(s) async {disk=s;});
    p.record('0002').tracks['pb']!.position=61;
    await p.open('0001',EntryIntent.library); await p.seek(48);
    await p.switchTrack('dg'); await p.navigate(1); await p.checkpoint();
    expect(p.lastOpened,'0002');expect(p.record('0001').tracks['pb']!.position,48);
    final q=make()..restore(disk); await q.open(q.lastOpened!,EntryIntent.resume);
    expect(q.track,'pb');expect(q.position,61);expect(q.playing,false);
    await q.open(q.lastOpened!,EntryIntent.resume,requestPlay:true);expect(q.playing,true);
    q.tick(70);q.record('0002').tracks['pb']!.position=67;
    await q.open('0002',EntryIntent.resume);expect(q.position,70);expect(q.playing,true);
    p.dispose();q.dispose();
  });
  test('Latest play intent ignores a late rejection from an earlier play', () async {
    final gate=Completer<void>(),a=FakeAudio()..playGate=gate;final p=make(factory:()=>a);
    await p.open('0001',EntryIntent.library);await p.setPlaying(true);await p.setPlaying(false);await p.setPlaying(true);
    gate.completeError(StateError('NotAllowedError'));await Future<void>.delayed(Duration.zero);
    expect(p.playing,true);expect(p.wantsPlay,true);expect(p.waitingGesture,false);p.dispose();
  });
  test('Exact S04: late audio load duration cannot overwrite current lesson', () async {
    final gate=Completer<double>();var n=0;
    final p=make(factory:(){n++;return FakeAudio()..loading=n==1?gate:null;});
    final a=p.open('0001',EntryIntent.library,requestPlay:true);
    await Future<void>.delayed(Duration.zero);
    await p.open('0003',EntryIntent.library);gate.complete(999);await a;
    expect(p.lesson!.lessonId,'0003');expect(p.duration,100);expect(p.playing,true);p.dispose();
  });
  test('Exact S12: completed fact and checkpoint survive immediate replay load failure', () async {
    String? disk;var n=0;final p=make(write:(s) async {disk=s;},factory:(){n++;return FakeAudio()..failure=n>1?StateError('404'):null;});
    p.autoNext=false;await p.open('0001',EntryIntent.library);await p.setPlaying(true);p.tick(99);await p.naturalEnd();await p.checkpoint();
    await p.open('0001',EntryIntent.library);await p.checkpoint();
    expect(p.error,isNotNull);expect(p.record('0001').completed,true);
    expect(p.record('0001').tracks['pb']!.position,100);
    final q=make()..restore(disk);expect(q.record('0001').completed,true);p.dispose();q.dispose();
  });
  test('S11 S12: restore silent on library, corrupt track isolated, complete sticky', () async {
    final p=make(); p.restore(jsonEncode({'schema':1,'lastOpened':'0002','autoNext':false,'records':{'0002':{'completed':true,'pb':{'position':double.maxFinite},'dg':{'position':-5}}}}));
    expect(p.lesson,isNull); expect(p.playing,false); expect(p.lastOpened,'0002'); expect(p.autoNext,false);
    expect(p.record('0002').tracks['dg']!.position,0); expect(p.record('0002').completed,true); p.dispose();
  });
}

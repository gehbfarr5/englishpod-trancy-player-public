import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';
import 'package:scrollable_positioned_list/scrollable_positioned_list.dart';
import 'playback_contract.dart';

class TeslaApp extends StatelessWidget {
  const TeslaApp({super.key, required this.player});
  final ContractPlayer player;
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: ThemeData(brightness: Brightness.dark, useMaterial3: true,
      scaffoldBackgroundColor: const Color(0xff0b1014),
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff71dda6), brightness: Brightness.dark)),
    home: TeslaHome(player: player));
}

class TeslaHome extends StatefulWidget {
  const TeslaHome({super.key, required this.player});
  final ContractPlayer player;
  @override
  State<TeslaHome> createState() => _TeslaHomeState();
}
class _TeslaHomeState extends State<TeslaHome> with WidgetsBindingObserver {
  ContractPlayer get p => widget.player;
  bool library = true, follow = true, secondary = true;
  final itemController = ItemScrollController();
  final positions = ItemPositionsListener.create();
  Timer? hideTimer;
  int lastIndex = -1;
  String identity = '';
  double? previousWidth;
  int? readIndex;
  double readAlignment = 0;
  bool programmatic = false;
  @override
  void initState() { super.initState(); WidgetsBinding.instance.addObserver(this); p.addListener(changed); }
  @override
  void dispose() { hideTimer?.cancel(); p.removeListener(changed); WidgetsBinding.instance.removeObserver(this); super.dispose(); }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) { if (state != AppLifecycleState.resumed) unawaited(p.checkpoint()); }
  void changed() {
    if (!mounted) return;
    final nextIdentity = '${p.lesson?.lessonId}/${p.track}';
    if (nextIdentity != identity) { identity = nextIdentity; follow = true; lastIndex = -1; }
    setState(() {});
    if (follow && p.activeIndex != lastIndex) {
      lastIndex = p.activeIndex;
      WidgetsBinding.instance.addPostFrameCallback((_) => align(p.activeIndex, .28));
    }
  }
  void align(int index, double alignment) {
    if (!mounted || !itemController.isAttached || p.segments.isEmpty) return;
    programmatic = true;
    itemController.jumpTo(index: index.clamp(0, p.segments.length - 1), alignment: alignment.clamp(-1, 1));
    programmatic = false;
  }
  void captureReading() {
    final visible = positions.itemPositions.value.where((x) => x.itemTrailingEdge > 0 && x.itemLeadingEdge < 1).toList()
      ..sort((a,b) => a.itemLeadingEdge.compareTo(b.itemLeadingEdge));
    if (visible.isNotEmpty) { readIndex = visible.first.index; readAlignment = visible.first.itemLeadingEdge; }
  }
  void touch() {
    if (!secondary) setState(() => secondary = true);
    hideTimer?.cancel();
    hideTimer = Timer(const Duration(seconds: 4), () { if (mounted && p.immersive) setState(() => secondary = false); });
  }
  Future<void> open(String id, EntryIntent intent, {bool play = false}) async {
    setState(() { library = false; follow = true; secondary = true; });
    touch(); await p.open(id, intent, requestPlay: play);
  }
  void back() { unawaited(p.checkpoint()); setState(() => library = true); }
  Widget button(String label, IconData icon, VoidCallback? action, {bool selected = false}) => IconButton(
    tooltip: label, onPressed: action, isSelected: selected,
    style: IconButton.styleFrom(minimumSize: const Size(48, 48), foregroundColor: selected ? const Color(0xff71dda6) : null),
    icon: Icon(icon));
  String time(double seconds) { final s = seconds.isFinite ? seconds.toInt() : 0; return '${s ~/ 60}:${(s % 60).toString().padLeft(2,'0')}'; }
  @override
  Widget build(BuildContext context) => Scaffold(body: SafeArea(child: LayoutBuilder(builder: (context, box) {
    if (previousWidth != null && previousWidth != box.maxWidth && !library) {
      final index = follow ? p.activeIndex : readIndex;
      final alignment = follow ? .28 : readAlignment;
      WidgetsBinding.instance.addPostFrameCallback((_) { if (index != null) align(index, alignment); });
    }
    previousWidth = box.maxWidth;
    return library ? buildLibrary() : Listener(onPointerDown: (_) => touch(), onPointerSignal: (_) => touch(), child: buildPlayer(box.maxWidth >= 1000));
  })));
  Widget buildLibrary() {
    final id = p.lessons.any((x) => x.lessonId == p.lastOpened) ? p.lastOpened : p.lessons.firstOrNull?.lessonId;
    final summary = p.lessons.where((x) => x.lessonId == id).firstOrNull;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Padding(padding: EdgeInsets.fromLTRB(28, 20, 28, 8), child: Text('EnglishPod', style: TextStyle(fontSize: 30, fontWeight: FontWeight.w700))),
      if (summary != null) Padding(padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12), child: Card(child: ListTile(
        title: Text(p.lastOpened == null ? 'Start listening · Podcast' : 'Continue listening · Podcast'),
        subtitle: Text('${summary.lessonNumber.toString().padLeft(3,'0')}  ${summary.title}'),
        onTap: () => open(id!, EntryIntent.resume),
        trailing: button('Play continue listening', Icons.play_arrow_rounded, () => open(id!, EntryIntent.resume, play: true))))),
      if (!p.saved) const Padding(padding: EdgeInsets.all(12), child: Text('Progress could not be saved. It remains available in this session.')),
      Expanded(child: ListView.builder(padding: const EdgeInsets.symmetric(horizontal: 24), itemCount: p.lessons.length, itemBuilder: (context,i) {
        final s = p.lessons[i], r = p.records[s.lessonId];
        return ListTile(minVerticalPadding: 16, leading: Text(s.lessonNumber.toString().padLeft(3,'0')),
          title: Text(s.title), subtitle: Text(s.level),
          trailing: Text(r?.completed == true ? 'Completed' : time(r?.tracks['pb']?.position ?? 0)),
          onTap: () => open(s.lessonId, EntryIntent.library));
      }))]);
  }
  Widget buildPlayer(bool wide) => Column(children: [
    SizedBox(height: 60, child: Row(children: [button('Library', Icons.arrow_back_rounded, back),
      Expanded(child: Text(p.lesson == null ? 'Loading lesson…' : '${p.lesson!.lessonNumber.toString().padLeft(3,'0')} · ${p.lesson!.title}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 18))),
      if (!p.immersive || secondary) ...[
        for (final t in ['pb','dg','vocab']) TextButton(onPressed: () => p.switchTrack(t), child: Text(t == 'pb' ? 'Podcast' : t == 'dg' ? 'Dialogue' : 'Vocab', style: TextStyle(color: p.tab == t ? const Color(0xff71dda6) : Colors.grey)))],
      button(p.immersive ? 'Standard mode' : 'Immersive mode', p.immersive ? Icons.fullscreen_exit : Icons.fullscreen, () { p.toggleImmersive(); touch(); }),
    ])),
    if (p.error != null || p.waitingGesture || !p.saved) Material(color: const Color(0xff352b20), child: Row(children: [
      Expanded(child: Padding(padding: const EdgeInsets.all(8), child: Text(p.error ?? (p.waitingGesture ? 'Click Play to allow browser audio.' : 'Progress not saved; storage will retry.')))),
      if (p.error != null) TextButton(onPressed: p.retry, child: const Text('Retry')),
      TextButton(onPressed: back, child: const Text('Library'))])),
    Expanded(child: Row(children: [Expanded(child: transcript()), if (wide) SizedBox(width: 276, child: sideControls())])),
    if (!wide) bottomControls(),
  ]);
  Widget transcript() {
    if (p.lesson == null) return const Center(child: CircularProgressIndicator());
    if (p.tab == 'vocab') return ListView(padding: const EdgeInsets.all(32), children: [for (final v in p.lesson!.vocabulary) ListTile(title: Text(v.word, style: const TextStyle(fontSize: 26)), subtitle: Text('${v.pos} · ${v.definition}', style: const TextStyle(fontSize: 20)))]);
    return LayoutBuilder(builder: (context, box) {
      final font = (box.maxWidth / (p.immersive ? 25 : 30)).clamp(22.0, 38.0);
      return Stack(children: [NotificationListener<ScrollNotification>(onNotification: (n) {
        if (n is ScrollStartNotification && n.dragDetails != null && !programmatic) { setState(() => follow = false); }
        if (!follow && (n is ScrollUpdateNotification || n is ScrollEndNotification)) captureReading();
        return false;
      }, child: Listener(onPointerSignal: (event) {
        if (event is PointerScrollEvent) { setState(() => follow = false); WidgetsBinding.instance.addPostFrameCallback((_) => captureReading()); }
      }, child: ScrollablePositionedList.builder(key: const ValueKey('tesla-transcript'),
        itemScrollController: itemController, itemPositionsListener: positions,
        initialScrollIndex: (follow ? p.activeIndex : readIndex ?? p.activeIndex).clamp(0, p.segments.isEmpty ? 0 : p.segments.length - 1),
        initialAlignment: follow ? .28 : readAlignment.clamp(0, 1),
        padding: const EdgeInsets.fromLTRB(32, 24, 32, 80), itemCount: p.segments.length,
        itemBuilder: (context, i) { final s = p.segments[i], active = i == p.activeIndex;
          return Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: InkWell(
            onTap: p.loading ? null : () => p.seek(s.start),
            child: Text(s.text, style: TextStyle(fontSize: s.isSection ? font * .7 : font,
              height: 1.5, fontWeight: active ? FontWeight.w600 : FontWeight.w400,
              color: active ? Colors.white : const Color(0xff7f8993)))));
        }))),
        if (!follow) Positioned(bottom: 16, right: 24, child: FilledButton.icon(onPressed: () { setState(() => follow = true); align(p.activeIndex, .28); }, icon: const Icon(Icons.my_location), label: const Text('Current sentence'))),
      ]);
    });
  }
  Widget playButton() => button(p.ended ? 'Replay' : p.wantsPlay ? 'Pause' : 'Play', p.ended ? Icons.replay_rounded : p.wantsPlay ? Icons.pause_rounded : Icons.play_arrow_rounded,
    p.error != null ? null : () => p.setPlaying(!p.wantsPlay || p.ended));
  Widget progress() => Column(mainAxisSize: MainAxisSize.min, children: [
    Slider(value: p.position.clamp(0, p.duration > 0 ? p.duration : 1).toDouble(), max: p.duration > 0 ? p.duration : 1,
      onChanged: p.loading ? null : (value) => p.seek(value)),
    Text('${time(p.position)} / ${time(p.duration)}', style: const TextStyle(color: Color(0xff9daab4))),
  ]);
  Widget navigation() => Row(mainAxisAlignment: MainAxisAlignment.center, children: [
    button('Previous lesson', Icons.skip_previous_rounded, p.canNavigate(-1) ? () => p.navigate(-1) : null),
    playButton(), button('Next lesson', Icons.skip_next_rounded, p.canNavigate(1) ? () => p.navigate(1) : null)]);
  List<Widget> options() => [
    SwitchListTile(title: const Text('Sentence loop'), value: p.sentenceLoop, onChanged: (_) => p.toggleSentenceLoop()),
    SwitchListTile(title: const Text('Track loop'), value: p.trackLoop, onChanged: (_) => p.toggleTrackLoop()),
    SwitchListTile(title: const Text('Auto-next Podcast'), value: p.autoNext, onChanged: (_) => p.toggleAutoNext()),
    ListTile(title: const Text('Speed'), trailing: DropdownButton<double>(value: p.rate, items: [0.75,1.0,1.25,1.5,2.0].map((x) => DropdownMenuItem(value: x, child: Text('${x}x'))).toList(), onChanged: (v) { if (v != null) p.setRate(v); })),
  ];
  Widget sideControls() => Material(color: const Color(0xff131c23), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
    if (p.loading) const LinearProgressIndicator(),
    Text(p.track == 'pb' ? 'PODCAST' : 'DIALOGUE', style: const TextStyle(letterSpacing: 3, color: Color(0xff71dda6))),
    const SizedBox(height: 20), navigation(), progress(),
    if (!p.immersive || secondary) ...options(),
  ]));
  Widget bottomControls() => Material(color: const Color(0xff131c23), child: SizedBox(height: 66, child: Row(children: [
    navigation(), Expanded(child: Slider(value: p.position.clamp(0, p.duration > 0 ? p.duration : 1).toDouble(), max: p.duration > 0 ? p.duration : 1, onChanged: p.loading ? null : (v) => p.seek(v))),
    Text('${time(p.position)} / ${time(p.duration)}'),
    if (p.loading) const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))),
    button('More', Icons.more_horiz, () => showModalBottomSheet<void>(context: context, builder: (context) => ListenableBuilder(listenable: p, builder: (context, _) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: options()))))),
  ])));
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scrollable_positioned_list/scrollable_positioned_list.dart';
import 'package:englishpod_trancy/tesla/tesla_app.dart';
import 'tesla_contract_test.dart' show make, FakeAudio;

void main() {
  testWidgets('S09 S10: both Tesla windows preserve media and manual follow in both modes', (tester) async {
    tester.view.devicePixelRatio=1;
    tester.view.physicalSize=const Size(1256,706);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var loads=0;
    final p=make(factory:(){loads++;return FakeAudio();});
    await tester.pumpWidget(TeslaApp(player:p));
    await tester.tap(find.text('Start listening · Podcast'));
    await tester.pumpAndSettle();
    expect(tester.takeException(),isNull);
    await p.setPlaying(true); p.tick(12); p.toggleTrackLoop(); await p.setRate(1.25);
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ScrollablePositionedList),const Offset(0,-220));
    await tester.pumpAndSettle();
    expect(find.text('Current sentence'),findsOneWidget);
    for (final immersive in [false,true]) {
      if(p.immersive!=immersive)p.toggleImmersive();
      for(final size in [const Size(773,601),const Size(1256,706)]) {
        tester.view.physicalSize=size; await tester.pumpAndSettle();
        expect(tester.takeException(),isNull);
        expect(p.playing,true); expect(p.position,12); expect(p.track,'pb');
        expect(p.trackLoop,true); expect(p.rate,1.25); expect(p.immersive,immersive);
        expect(loads,1); expect(find.text('Current sentence'),findsOneWidget);
        if(size.width==773)expect(find.byTooltip('More'),findsOneWidget);
      }
    }
    await tester.pumpWidget(const SizedBox());p.dispose();
  });
}

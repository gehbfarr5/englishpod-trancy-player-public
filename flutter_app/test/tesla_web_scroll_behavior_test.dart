import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:englishpod_trancy/main.dart';

void main() {
  group('TeslaWebScrollBehavior Tests', () {
    const behavior = TeslaWebScrollBehavior();

    testWidgets('Scroll physics returns BouncingScrollPhysics on TargetPlatform.linux (Tesla)', (tester) async {
      late BuildContext capturedContext;
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(platform: TargetPlatform.linux),
          home: Builder(
            builder: (context) {
              capturedContext = context;
              return const SizedBox();
            },
          ),
        ),
      );

      final physics = behavior.getScrollPhysics(capturedContext);
      expect(physics, isA<BouncingScrollPhysics>());
    });

    testWidgets('buildScrollbar returns child directly on TargetPlatform.linux to avoid double scrollbars', (tester) async {
      late BuildContext capturedContext;
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(platform: TargetPlatform.linux),
          home: Builder(
            builder: (context) {
              capturedContext = context;
              return const SizedBox();
            },
          ),
        ),
      );

      const testChild = Text('Child Content');
      final scrollableDetails = ScrollableDetails(
        direction: AxisDirection.down,
        controller: ScrollController(),
      );

      final result = behavior.buildScrollbar(capturedContext, testChild, scrollableDetails);
      // Directly returns child without wrapping in a redundant Scrollbar
      expect(result, same(testChild));
      expect(result, isNot(isA<Scrollbar>()));
    });

    test('dragDevices contains touch, mouse, stylus, and trackpad for in-car touchscreen and wheel events', () {
      expect(behavior.dragDevices, containsAll(<PointerDeviceKind>[
        PointerDeviceKind.touch,
        PointerDeviceKind.mouse,
        PointerDeviceKind.stylus,
        PointerDeviceKind.trackpad,
      ]));
    });

    testWidgets('MaterialApp with TeslaWebScrollBehavior applies BouncingScrollPhysics to ListView on Linux', (tester) async {
      final controller = ScrollController();
      await tester.pumpWidget(
        MaterialApp(
          scrollBehavior: const TeslaWebScrollBehavior(),
          theme: ThemeData(platform: TargetPlatform.linux),
          home: Scaffold(
            body: ListView.builder(
              controller: controller,
              itemCount: 20,
              itemBuilder: (context, index) => Text('Item $index'),
            ),
          ),
        ),
      );

      final scrollableState = tester.state<ScrollableState>(find.byType(Scrollable));
      expect(scrollableState.position.physics, isA<BouncingScrollPhysics>());

      // Ensure no system Scrollbar was auto-injected above or inside the Scrollable
      expect(find.byType(Scrollbar), findsNothing);
    });
  });
}

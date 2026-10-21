import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:englishpod_trancy/main.dart';
import 'package:englishpod_trancy/models/lesson_models.dart';

void main() {
  test('Parses WordTiming and TranscriptSegment properly', () {
    final seg = TranscriptSegment.fromJson({
      'id': 1,
      'speaker': 'A',
      'text': 'Good evening.',
      'is_section': false,
      'in_dialogue_block': false,
      'start': 7.6,
      'end': 10.66,
      'words': [
        {'word': 'Good', 'start': 7.6, 'end': 7.7},
        {'word': 'evening.', 'start': 7.7, 'end': 10.66},
      ],
    });
    expect(seg.speaker, 'A');
    expect(seg.words.length, 2);
    expect(seg.words.first.word, 'Good');
  });

  test('SmoothSquircleBorder computes valid continuous squircle path and lerps cleanly', () {
    const heroPauseBorder = SmoothSquircleBorder(radius: 18.0, cornerSmoothing: 0.6);
    const heroPlayBorder = SmoothSquircleBorder(radius: 30.0, cornerSmoothing: 0.6);

    const testRect = Rect.fromLTWH(0, 0, 360, 60);
    final pausePath = heroPauseBorder.getOuterPath(testRect);
    expect(pausePath.getBounds().isEmpty, false);
    expect(pausePath.getBounds().width, closeTo(360.0, 0.5));
    expect(pausePath.getBounds().height, closeTo(60.0, 0.5));

    final playPath = heroPlayBorder.getOuterPath(testRect);
    expect(playPath.getBounds().isEmpty, false);

    // Test morph interpolation
    final lerped = heroPauseBorder.lerpTo(heroPlayBorder, 0.5) as SmoothSquircleBorder;
    expect(lerped.radius, closeTo(24.0, 0.001));
    expect(lerped.cornerSmoothing, closeTo(0.6, 0.001));
    final lerpedPath = lerped.getOuterPath(testRect);
    expect(lerpedPath.getBounds().isEmpty, false);
  });
}

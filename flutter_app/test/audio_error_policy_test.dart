import 'dart:async';

import 'package:flutter_test/flutter_test.dart';

import 'package:englishpod_trancy/services/audio_error_policy.dart';

void main() {
  group('isPermanentAudioError', () {
    test('missing asset is permanent', () {
      expect(isPermanentAudioError(Exception('HTTP 404 for /audio/0001.mp3')), isTrue);
      expect(isPermanentAudioError(Exception('Asset not found')), isTrue);
    });

    test('undecodable payload is permanent', () {
      expect(isPermanentAudioError(StateError('decode failed')), isTrue);
      expect(isPermanentAudioError(Exception('Unsupported format')), isTrue);
    });

    test('transient transport failures stay retryable', () {
      expect(isPermanentAudioError(Exception('Connection closed')), isFalse);
      expect(isPermanentAudioError(TimeoutException('load timeout')), isFalse);
      expect(isPermanentAudioError(Exception('aborted')), isFalse);
    });
  });

  group('isAutoplayBlocked', () {
    test('browser gesture refusal is recognised', () {
      expect(
        isAutoplayBlocked(
          Exception("play() failed because the user didn't interact with "
              'the document first'),
        ),
        isTrue,
      );
      expect(isAutoplayBlocked(Exception('NotAllowedError')), isTrue);
    });

    test('real playback faults are not treated as gesture refusals', () {
      expect(isAutoplayBlocked(StateError('decoder error')), isFalse);
      expect(isAutoplayBlocked(Exception('HTTP 500')), isFalse);
    });
  });
}

/// Failure classification for the playback contract (EP-PBC-001).
///
/// Loading audio can fail for two very different reasons, and only one of them
/// is worth retrying:
///
/// * transient (network hiccup, aborted request, decoder still busy) — retry
///   with a short backoff;
/// * permanent (missing file, undecodable payload, unsupported container) —
///   retrying only delays the error the user has to see.
library;

final RegExp _permanentErrorPattern = RegExp(
  r'404|410|decode|format|unsupported|not found',
  caseSensitive: false,
);

final RegExp _blockedByGesturePattern = RegExp(
  r'NotAllowed|not allowed|user gesture|autoplay|play\(\) failed',
  caseSensitive: false,
);

/// Whether [error] means the asset itself is unusable, so a retry cannot help.
bool isPermanentAudioError(Object error) =>
    _permanentErrorPattern.hasMatch(error.toString());

/// Whether [error] from `play()` is the browser refusing to start audio
/// without a user gesture. That is an expected state on the Web, not a fault:
/// the UI stays paused until the user taps play.
bool isAutoplayBlocked(Object error) =>
    _blockedByGesturePattern.hasMatch(error.toString());

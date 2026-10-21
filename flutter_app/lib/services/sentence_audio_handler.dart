import 'package:audio_service/audio_service.dart';
import 'package:just_audio/just_audio.dart';

/// Custom AudioHandler that intercepts lock-screen / Bluetooth headphone
/// "Previous Track" and "Next Track" buttons and routes them directly to
/// "Previous Sentence" and "Next Sentence" in the active EnglishPod transcript.
class SentenceAudioHandler extends BaseAudioHandler with SeekHandler {
  final AudioPlayer player;
  void Function()? onSkipToPreviousSentence;
  void Function()? onSkipToNextSentence;
  Uri? _defaultArtUri;

  SentenceAudioHandler(this.player) {
    player.playbackEventStream.map(_transformEvent).pipe(playbackState);
  }

  void setDefaultArtUri(Uri? artUri) {
    if (_defaultArtUri == artUri) return;
    _defaultArtUri = artUri;
    final current = mediaItem.valueOrNull;
    if (current != null && current.artUri != artUri) {
      mediaItem.add(current.copyWith(artUri: artUri));
    }
  }

  void updateCurrentMediaItem({
    required String title,
    required String subtitle,
    Duration? duration,
    Uri? artUri,
  }) {
    final effectiveArt = artUri ?? _defaultArtUri;
    if (artUri != null) {
      _defaultArtUri = artUri;
    }
    mediaItem.add(
      MediaItem(
        id: title,
        album: 'EnglishPod',
        title: title,
        artist: subtitle,
        duration: duration,
        artUri: effectiveArt,
      ),
    );
  }

  @override
  Future<void> play() => player.play();

  @override
  Future<void> pause() => player.pause();

  @override
  Future<void> seek(Duration position) => player.seek(position);

  @override
  Future<void> stop() => player.stop();

  @override
  Future<void> skipToPrevious() async {
    onSkipToPreviousSentence?.call();
  }

  @override
  Future<void> skipToNext() async {
    onSkipToNextSentence?.call();
  }

  PlaybackState _transformEvent(PlaybackEvent event) {
    return PlaybackState(
      controls: [
        MediaControl.skipToPrevious,
        if (player.playing) MediaControl.pause else MediaControl.play,
        MediaControl.skipToNext,
      ],
      systemActions: const {
        MediaAction.seek,
        MediaAction.skipToPrevious,
        MediaAction.skipToNext,
      },
      androidCompactActionIndices: const [0, 1, 2],
      processingState: const {
        ProcessingState.idle: AudioProcessingState.idle,
        ProcessingState.loading: AudioProcessingState.loading,
        ProcessingState.buffering: AudioProcessingState.buffering,
        ProcessingState.ready: AudioProcessingState.ready,
        ProcessingState.completed: AudioProcessingState.completed,
      }[player.processingState]!,
      playing: player.playing,
      updatePosition: player.position,
      bufferedPosition: player.bufferedPosition,
      speed: player.speed,
      queueIndex: event.currentIndex,
    );
  }
}

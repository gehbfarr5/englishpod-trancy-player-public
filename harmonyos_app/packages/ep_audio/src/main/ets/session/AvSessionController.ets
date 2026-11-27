import { common } from '@kit.AbilityKit';
import { avSession } from '@kit.AVSessionKit';
import { image } from '@kit.ImageKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const LOG_DOMAIN = 0xE001;
const LOG_TAG = 'EpFlutterHost';

export interface SessionRemoteHandler {
  onPlay: () => void;
  onPause: () => void;
  onPlayNext: () => void;
  onPlayPrevious: () => void;
  onSeek: (positionSec: number) => void;
}

/**
 * Bridges EnglishPod playback to HarmonyOS AVSession (Control Center, Lockscreen,
 * Watch/Earbuds media keys, dynamic Dark/Paper brand artwork, and live sentence lyrics).
 */
export class AvSessionController {
  private session?: avSession.AVSession;
  private darkArtwork?: image.PixelMap;
  private lightArtwork?: image.PixelMap;

  async init(context: common.Context, handler: SessionRemoteHandler): Promise<void> {
    if (this.session) {
      return;
    }
    try {
      this.session = await avSession.createAVSession(context, 'EnglishPodSession', 'audio');
      await this.loadBrandArtworks(context);

      this.session.on('play', () => handler.onPlay());
      this.session.on('pause', () => handler.onPause());
      this.session.on('playNext', () => handler.onPlayNext());
      this.session.on('playPrevious', () => handler.onPlayPrevious());
      this.session.on('seek', (timeMs: number) => handler.onSeek(timeMs / 1000.0));

      await this.session.activate();
      hilog.info(LOG_DOMAIN, LOG_TAG, '[EP_AVSESSION] Activated (darkArt=%{public}s, lightArt=%{public}s)',
        String(!!this.darkArtwork), String(!!this.lightArtwork));
    } catch (e) {
      hilog.error(LOG_DOMAIN, LOG_TAG, '[EP_AVSESSION] Init failed: %{public}s', String(e));
    }
  }

  private async decodeBrandArtwork(context: common.Context, rawPath: string): Promise<image.PixelMap | undefined> {
    const rawBytes = await context.resourceManager.getRawFileContent(rawPath);
    const slicedBuf = rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength);
    const imgSource = image.createImageSource(slicedBuf);
    try {
      return await imgSource.createPixelMap({
        desiredSize: { width: 384, height: 384 }
      });
    } finally {
      await imgSource.release();
    }
  }

  private async loadBrandArtworks(context: common.Context): Promise<void> {
    try {
      this.darkArtwork = await this.decodeBrandArtwork(context, 'branding/brand_icon_dark.png');
      this.lightArtwork = await this.decodeBrandArtwork(context, 'branding/brand_icon_light.png');
    } catch (e) {
      hilog.error(LOG_DOMAIN, LOG_TAG, '[EP_AVSESSION] Artwork decode failed: %{public}s', String(e));
    }
  }

  async updateMetadata(
    assetId: string,
    title: string,
    subtitle: string,
    durationSec: number,
    lyricLine: string,
    isDarkTheme: boolean
  ): Promise<void> {
    if (!this.session) {
      return;
    }
    try {
      const artwork = isDarkTheme ? this.darkArtwork : this.lightArtwork;
      await this.session.setAVMetadata({
        assetId,
        title,
        artist: subtitle,
        album: 'EnglishPod · Trancy Player',
        duration: Math.max(0, Math.round(durationSec * 1000)),
        lyric: lyricLine,
        mediaImage: artwork
      });
      hilog.info(LOG_DOMAIN, LOG_TAG, '[EP_AVSESSION] Metadata updated: %{public}s | dark=%{public}s | hasImg=%{public}s',
        title, String(isDarkTheme), String(!!artwork));
    } catch (e) {
      hilog.error(LOG_DOMAIN, LOG_TAG, '[EP_AVSESSION] setAVMetadata failed: %{public}s', String(e));
    }
  }

  async updatePlaybackState(isPlaying: boolean, positionSec: number, speed: number): Promise<void> {
    if (!this.session) {
      return;
    }
    try {
      if (isPlaying) {
        await this.session.activate();
      }
      await this.session.setAVPlaybackState({
        state: isPlaying ? avSession.PlaybackState.PLAYBACK_STATE_PLAY : avSession.PlaybackState.PLAYBACK_STATE_PAUSE,
        position: {
          elapsedTime: Math.max(0, Math.round(positionSec * 1000)),
          updateTime: Date.now()
        },
        speed: speed > 0 ? speed : 1.0
      });
    } catch (e) {
      hilog.error(LOG_DOMAIN, LOG_TAG, '[EP_AVSESSION] setAVPlaybackState failed: %{public}s', String(e));
    }
  }

  async release(): Promise<void> {
    if (this.session) {
      try {
        await this.session.deactivate();
        await this.session.destroy();
      } catch {
        // Ignore teardown errors
      }
      this.session = undefined;
    }
  }
}

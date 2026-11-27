import { audio } from '@kit.AudioKit';

/**
 * HarmonyOS 7.0 Spatial Audio (HRTF) adapter for dual-host Podcast immersion.
 * Queries AudioSpatializationManager for current-device spatial rendering status
 * and tracks app-level spatial preference.
 */
export class SpatialAudioManager {
  private spatialMgr?: audio.AudioSpatializationManager;
  private preferredEnabled: boolean = true;

  init(): void {
    try {
      const audioMgr = audio.getAudioManager();
      this.spatialMgr = audioMgr.getSpatializationManager();
    } catch {
      this.spatialMgr = undefined;
    }
  }

  isSpatialSupported(): boolean {
    if (!this.spatialMgr) {
      return false;
    }
    try {
      return this.spatialMgr.isSpatializationEnabledForCurrentDevice();
    } catch {
      return false;
    }
  }

  setSpatialEnabled(enabled: boolean): void {
    this.preferredEnabled = enabled;
  }

  isPreferredEnabled(): boolean {
    return this.preferredEnabled;
  }
}

import { vibrator } from '@kit.SensorServiceKit';

/**
 * Linear motor haptic wrapper for Hold-to-Replay progressive pulses,
 * segment step ticks, and speed gear transitions at 120Hz.
 */
export class HapticEngine {
  static pulseTick(): void {
    try {
      vibrator.startVibration(
        { type: 'preset', effectId: 'haptic.effect.soft', count: 1 },
        { usage: 'touch' }
      );
    } catch {
      // Simulator or device without vibrator support
    }
  }

  static pulseConfirm(): void {
    try {
      vibrator.startVibration(
        { type: 'preset', effectId: 'haptic.effect.sharp', count: 1 },
        { usage: 'touch' }
      );
    } catch {
      // Ignore on unsupported targets
    }
  }

  static pulseProgressMilestone(pct: number): void {
    if (pct === 25 || pct === 50 || pct === 75) {
      HapticEngine.pulseTick();
    } else if (pct >= 100) {
      HapticEngine.pulseConfirm();
    }
  }
}

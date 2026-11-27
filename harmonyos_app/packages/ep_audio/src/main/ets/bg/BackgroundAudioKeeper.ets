import { common, wantAgent } from '@kit.AbilityKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';

/**
 * Manages HarmonyOS AUDIO_PLAYBACK continuous background task for screen-off
 * playback and auto-next episode transitions.
 */
export class BackgroundAudioKeeper {
  private isRunning: boolean = false;

  async start(context: common.UIAbilityContext): Promise<void> {
    if (this.isRunning) {
      return;
    }
    try {
      const wantAgentInfo: wantAgent.WantAgentInfo = {
        wants: [
          {
            bundleName: context.abilityInfo.bundleName,
            abilityName: context.abilityInfo.name
          }
        ],
        actionType: wantAgent.OperationType.START_ABILITY,
        requestCode: 0,
        actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
      };
      const agent = await wantAgent.getWantAgent(wantAgentInfo);
      await backgroundTaskManager.startBackgroundRunning(
        context,
        backgroundTaskManager.BackgroundMode.AUDIO_PLAYBACK,
        agent
      );
      this.isRunning = true;
    } catch {
      // Simulator or missing background permission fallback
    }
  }

  async stop(context: common.UIAbilityContext): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    try {
      await backgroundTaskManager.stopBackgroundRunning(context);
    } catch {
      // Ignore
    } finally {
      this.isRunning = false;
    }
  }
}

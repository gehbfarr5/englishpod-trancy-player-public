import { liveViewManager } from '@kit.LiveViewKit';
import { common, wantAgent } from '@kit.AbilityKit';

export interface LiveViewSnapshot {
  lessonCode: string;
  lessonTitle: string;
  activeSentence: string;
  progressPct: number;
  isPlaying: boolean;
  isDarkTheme: boolean;
}

/**
 * Manages HarmonyOS Live View capsule (status bar) and lockscreen/notification
 * real-time English sentence card.
 */
export class StudyLiveViewManager {
  private readonly liveViewId: number = 26001;
  private isStarted: boolean = false;

  async startOrUpdate(context: common.UIAbilityContext, snapshot: LiveViewSnapshot): Promise<void> {
    try {
      const enabled = await liveViewManager.isLiveViewEnabled();
      if (!enabled) {
        return;
      }
      const clickWantAgent = await wantAgent.getWantAgent({
        wants: [{ bundleName: context.abilityInfo.bundleName, abilityName: context.abilityInfo.name }],
        actionType: wantAgent.OperationType.START_ABILITY,
        requestCode: 101,
        actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
      });

      const liveView: liveViewManager.LiveView = {
        id: this.liveViewId,
        event: 'AUDIO_PLAYBACK',
        liveViewData: {
          primary: {
            title: `${snapshot.lessonCode} · ${snapshot.lessonTitle}`,
            content: [{ text: snapshot.activeSentence || 'Ready to listen', textColor: '#FFFFFFFF' }],
            keepTime: 15,
            clickAction: clickWantAgent,
            layoutData: {
              layoutType: liveViewManager.LayoutType.LAYOUT_TYPE_PROGRESS,
              progress: snapshot.progressPct,
              color: snapshot.isDarkTheme ? '#FF1ED760' : '#FFCC785C',
              backgroundColor: '#33FFFFFF',
              indicatorType: liveViewManager.IndicatorType.INDICATOR_TYPE_OVERLAY
            }
          },
          capsule: {
            type: liveViewManager.CapsuleType.CAPSULE_TYPE_TEXT,
            status: 1,
            title: snapshot.lessonCode,
            content: snapshot.isPlaying ? '▶' : '⏸',
            backgroundColor: '#FF0B0C10'
          }
        }
      };

      if (!this.isStarted) {
        await liveViewManager.startLiveView(liveView);
        this.isStarted = true;
      } else {
        await liveViewManager.updateLiveView(liveView);
      }
    } catch {
      // Gracefully skip on simulator or when Live View permission is toggled off by user
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }
    try {
      await liveViewManager.stopLiveView({ id: this.liveViewId, event: 'AUDIO_PLAYBACK', liveViewData: { primary: { title: '', content: [], keepTime: 0 } } });
    } catch {
      // Ignore
    } finally {
      this.isStarted = false;
    }
  }
}

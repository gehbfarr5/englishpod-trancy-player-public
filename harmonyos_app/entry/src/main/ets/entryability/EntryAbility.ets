import { AbilityConstant, Configuration, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { PlayerStore } from '../state/PlayerStore';

export default class EntryAbility extends UIAbility {
  private mainWindow?: window.Window;
  private pendingOrientation?: string;
  private keepScreenOnRequested: boolean = false;

  private applyOrientationParam(ori: string): void {
    if (!this.mainWindow) {
      this.pendingOrientation = ori;
      return;
    }
    if (ori === 'landscape') {
      void this.mainWindow.setPreferredOrientation(window.Orientation.LANDSCAPE);
    } else if (ori === 'portrait') {
      void this.mainWindow.setPreferredOrientation(window.Orientation.PORTRAIT);
    } else {
      void this.mainWindow.setPreferredOrientation(window.Orientation.AUTO_ROTATION_RESTRICTED);
    }
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const store = PlayerStore.getInstance();
    store.attachAbilityContext(this.context);
    const isDark = this.context.config.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
    store.updateSystemColorMode(isDark);

    if (want.parameters && want.parameters['ep_orientation']) {
      this.pendingOrientation = String(want.parameters['ep_orientation']);
    }
    if (want.parameters && String(want.parameters['ep_keep_screen_on']) === 'true') {
      this.keepScreenOnRequested = true;
      store.setTestKeepScreenOn(true);
    }
  }

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const store = PlayerStore.getInstance();
    if (want.parameters && want.parameters['ep_orientation']) {
      this.applyOrientationParam(String(want.parameters['ep_orientation']));
    }
    if (want.parameters && String(want.parameters['ep_keep_screen_on']) === 'true') {
      this.keepScreenOnRequested = true;
      store.setTestKeepScreenOn(true);
    }
    if (want.parameters && want.parameters['ep_eval_js']) {
      store.evalJsForTest(String(want.parameters['ep_eval_js']));
    }
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    const store = PlayerStore.getInstance();
    try {
      this.mainWindow = windowStage.getMainWindowSync();
      store.attachMainWindow(this.mainWindow);
      void this.mainWindow.setWindowLayoutFullScreen(true);
      this.syncAvoidAreas(this.mainWindow);
    } catch {
      // Fallback inside loadContent callback
    }

    windowStage.loadContent('pages/MainShellPage', (err) => {
      if (err.code) {
        return;
      }
      try {
        this.mainWindow = windowStage.getMainWindowSync();
        store.attachMainWindow(this.mainWindow);
        void this.mainWindow.setWindowLayoutFullScreen(true);
        if (this.keepScreenOnRequested) {
          store.setTestKeepScreenOn(true);
        }
        if (this.pendingOrientation) {
          const ori = this.pendingOrientation;
          this.pendingOrientation = undefined;
          this.applyOrientationParam(ori);
        }

        this.syncAvoidAreas(this.mainWindow);
        this.mainWindow.on('avoidAreaChange', () => {
          if (this.mainWindow) {
            this.syncAvoidAreas(this.mainWindow);
          }
        });
      } catch {
        // Fallback safely if window properties are unavailable
      }
    });
  }

  private syncAvoidAreas(win: window.Window): void {
    try {
      const uiCtx = win.getUIContext();
      const sysArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
      const cutoutArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_CUTOUT);
      const navArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
      const cutoutBottomPx = cutoutArea.topRect.height > 0
        ? cutoutArea.topRect.top + cutoutArea.topRect.height
        : 0;
      const topPx = Math.max(sysArea.topRect.height, cutoutBottomPx);
      PlayerStore.getInstance().updateSafeInsets(
        uiCtx.px2vp(topPx),
        uiCtx.px2vp(navArea.bottomRect.height)
      );
    } catch {
      // Ignore on unsupported window states
    }
  }

  onConfigurationUpdate(newConfig: Configuration): void {
    const isDark = newConfig.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
    PlayerStore.getInstance().updateSystemColorMode(isDark);
  }

  onDestroy(): void {
    PlayerStore.getInstance().dispose();
  }
}

import { window } from '@kit.ArkUI';

/**
 * HarmonyOS 7.0 Flash Control Window (闪控窗) & Flash Ball (闪控球) controller.
 * Manages an interactive floating subwindow (320x84 vp) that collapses into a
 * 48x48 vp edge-docked sphere for listening + repeating while using other apps.
 */
export class FlashWindowController {
  private subWindow?: window.Window;
  private isCollapsedBall: boolean = false;
  private isShowing: boolean = false;

  async toggleFlashWindow(windowStage: window.WindowStage): Promise<boolean> {
    if (this.isShowing) {
      await this.close();
      return false;
    }
    try {
      const win = await windowStage.createSubWindow('EnglishPodFlashWindow');
      this.subWindow = win;
      this.isCollapsedBall = false;
      await win.resize(960, 252); // ~320x84 vp at 3x density on Pura X View
      await win.moveWindowTo(180, 240);
      await win.setUIContent('widgets/FlashSubWindowPage');
      await win.showWindow();
      win.setWindowBackgroundColor('#00000000');
      this.isShowing = true;
      return true;
    } catch {
      return false;
    }
  }

  async toggleBallCollapse(): Promise<boolean> {
    if (!this.subWindow) {
      return false;
    }
    this.isCollapsedBall = !this.isCollapsedBall;
    if (this.isCollapsedBall) {
      await this.subWindow.resize(144, 144); // ~48x48 vp Flash Ball
      await this.subWindow.moveWindowTo(1160, 420);
    } else {
      await this.subWindow.resize(960, 252);
      await this.subWindow.moveWindowTo(180, 240);
    }
    return this.isCollapsedBall;
  }

  async close(): Promise<void> {
    if (this.subWindow) {
      try {
        await this.subWindow.destroyWindow();
      } catch {
        // Ignore
      }
      this.subWindow = undefined;
    }
    this.isShowing = false;
    this.isCollapsedBall = false;
  }
}

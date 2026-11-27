import { webview } from '@kit.ArkWeb';
import { NativeSmileySplash } from '../components/NativeSmileySplash';
import { PlayerStore } from '../state/PlayerStore';

@Entry
@ComponentV2
struct MainShellPage {
  @Local store: PlayerStore = PlayerStore.getInstance();

  onBackPress(): boolean {
    if (this.store.activeScreen === 'player') {
      this.store.navigateBackInWeb();
      return true;
    }
    return false;
  }

  build() {
    Stack() {
      Web({
        src: this.store.buildInitialWebUrl(),
        controller: this.store.webController
      })
        .width('100%')
        .height('100%')
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .imageAccess(true)
        .mediaPlayGestureAccess(false)
        .zoomAccess(false)
        .horizontalScrollBarAccess(false)
        .verticalScrollBarAccess(false)
        .overScrollMode(OverScrollMode.NEVER)
        .darkMode(WebDarkMode.Auto)
        .forceDarkAccess(false)
        .backgroundColor(this.store.isDark ? '#070709' : '#F2EDE2')
        .onInterceptRequest((event) => {
          return this.store.handleWebIntercept(event ? event.request : undefined);
        })
        .onConsole((event) => {
          if (event && event.message) {
            this.store.handleWebConsole(event.message.getMessage());
          }
          return false;
        })
        .onPageEnd(() => {
          this.store.pushSafeInsetsToWeb();
        })

      if (!this.store.splashDismissed) {
        NativeSmileySplash()
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.store.isDark ? '#070709' : '#F2EDE2')
  }
}

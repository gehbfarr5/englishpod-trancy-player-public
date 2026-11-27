import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { window } from '@kit.ArkUI';
import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import { AvSessionController, BackgroundAudioKeeper } from '@englishpod/ep_audio';

const LOG_DOMAIN = 0xE001;
const LOG_TAG = 'EpFlutterHost';
const LOCAL_ORIGIN = 'https://app.englishpod.local/';

interface BridgePayload {
  action?: string;
  screen?: string;
  ready?: boolean;
  isDark?: boolean;
  themePref?: string;
  isPlaying?: boolean;
  tab?: string;
  track?: string;
  lesson?: string;
  filter?: string;
  title?: string;
  subtitle?: string;
  sentence?: string;
  pos?: number;
  dur?: number;
  speed?: number;
}

interface AudioTickPayload {
  src?: string;
  time?: number;
  dur?: number;
  rate?: number;
  paused?: boolean;
}

interface ScanErrShape {
  code?: number;
  message?: string;
}

@ObservedV2
export class PlayerStore {
  private static instance: PlayerStore;

  static getInstance(): PlayerStore {
    if (!PlayerStore.instance) {
      PlayerStore.instance = new PlayerStore();
    }
    return PlayerStore.instance;
  }

  @Trace isDark: boolean = true;
  @Trace activeScreen: string = 'library';
  @Trace isPlaying: boolean = false;
  @Trace topSafeInsetVp: number = 38;
  @Trace bottomSafeInsetVp: number = 18;
  @Trace insetsReady: boolean = false;
  @Trace flutterReady: boolean = false;
  @Trace splashDismissed: boolean = false;

  readonly webController: webview.WebviewController = new webview.WebviewController();

  private abilityContext?: common.UIAbilityContext;
  private mainWindow?: window.Window;
  private systemIsDark: boolean = true;
  private themePref: string = 'system';
  private hostPrefs?: preferences.Preferences;
  private bgKeeper: BackgroundAudioKeeper = new BackgroundAudioKeeper();
  private avSession: AvSessionController = new AvSessionController();
  private avSessionInitPromise?: Promise<void>;
  private lastAvMetaKey: string = '';
  private lastLessonId: string = '0001';
  private lastTrack: string = 'pb';
  private lastTitle: string = 'EnglishPod';
  private lastSubtitle: string = 'Elementary (Podcast)';
  private lastSentence: string = '';
  private lastDurationSec: number = 0;
  private lastSpeed: number = 1.0;
  private lastPosSec: number = 0;
  private testKeepScreenOn: boolean = false;
  private cachedAudioPath: string = '';
  private cachedAudioBuf?: ArrayBuffer;

  attachAbilityContext(context: common.UIAbilityContext): void {
    this.abilityContext = context;
    if (!this.hostPrefs) {
      try {
        this.hostPrefs = preferences.getPreferencesSync(context, { name: 'ep_host_prefs' });
        const savedPref = String(this.hostPrefs.getSync('theme_pref', 'system'));
        if (savedPref === 'dark' || savedPref === 'light' || savedPref === 'system') {
          this.themePref = savedPref;
        }
      } catch {
        // Fallback safely if preferences are unavailable
      }
      this.recomputeEffectiveTheme();
    }
    if (!this.avSessionInitPromise) {
      this.avSessionInitPromise = this.avSession.init(context, {
        onPlay: () => this.sendCommandToWeb('play'),
        onPause: () => this.sendCommandToWeb('pause'),
        onPlayNext: () => this.sendCommandToWeb('next'),
        onPlayPrevious: () => this.sendCommandToWeb('prev'),
        onSeek: (positionSec: number) => this.sendCommandToWeb(`seek:${positionSec.toFixed(2)}`)
      });
    }
  }

  attachMainWindow(win: window.Window): void {
    this.mainWindow = win;
    this.updateSystemBarStyle();
    this.syncKeepScreenOn();
  }

  setTestKeepScreenOn(enable: boolean): void {
    this.testKeepScreenOn = enable;
    this.syncKeepScreenOn();
  }

  private recomputeEffectiveTheme(): void {
    const nextDark = this.themePref === 'dark'
      ? true
      : (this.themePref === 'light' ? false : this.systemIsDark);
    this.isDark = nextDark;
    this.updateSystemBarStyle();
  }

  updateSystemColorMode(systemIsDark: boolean): void {
    this.systemIsDark = systemIsDark;
    this.recomputeEffectiveTheme();
  }

  markSplashDismissed(): void {
    this.splashDismissed = true;
  }

  updateSafeInsets(topVp: number, bottomVp: number): void {
    this.topSafeInsetVp = Math.max(24, Math.round(topVp));
    this.bottomSafeInsetVp = Math.max(12, Math.round(bottomVp));
    this.insetsReady = true;
    this.pushSafeInsetsToWeb();
  }

  pushSafeInsetsToWeb(): void {
    try {
      this.webController.runJavaScript(
        `window.__epUpdateSafeInsets && window.__epUpdateSafeInsets(${this.topSafeInsetVp}, ${this.bottomSafeInsetVp});`
      );
    } catch {
      // Ignore before WebView controller attaches
    }
  }

  buildInitialWebUrl(): string {
    return `${LOCAL_ORIGIN}index.html?topInset=${this.topSafeInsetVp}&bottomInset=${this.bottomSafeInsetVp}&theme=${this.isDark ? 'dark' : 'light'}&epHost=harmonyos`;
  }

  private updateSystemBarStyle(): void {
    if (!this.mainWindow) {
      return;
    }
    try {
      this.mainWindow.setWindowBackgroundColor(this.isDark ? '#070709' : '#F2EDE2');
      const contentColor = this.isDark ? '#FFFFFF' : '#141413';
      void this.mainWindow.setWindowSystemBarProperties({
        statusBarContentColor: contentColor,
        navigationBarContentColor: contentColor
      });
    } catch {
      // Ignore on unsupported window states
    }
  }

  private syncKeepScreenOn(): void {
    if (!this.mainWindow) {
      return;
    }
    try {
      void this.mainWindow.setWindowKeepScreenOn(this.isPlaying || this.testKeepScreenOn);
    } catch {
      // Ignore on unsupported window states
    }
  }

  handleWebConsole(msg: string): void {
    if (msg.startsWith('[EP_BRIDGE]')) {
      const rawJson = msg.substring('[EP_BRIDGE]'.length);
      hilog.info(LOG_DOMAIN, LOG_TAG, '[EP_BRIDGE]%{public}s', rawJson);
      try {
        const parsed = JSON.parse(rawJson) as BridgePayload;
        if (parsed.action === 'scanQr') {
          void this.handleScanQrFromWeb();
          return;
        }
        if (parsed.ready === true && !this.flutterReady) {
          this.flutterReady = true;
          this.pushSafeInsetsToWeb();
        }
        if (typeof parsed.themePref === 'string' && parsed.themePref !== this.themePref) {
          if (parsed.themePref === 'dark' || parsed.themePref === 'light' || parsed.themePref === 'system') {
            this.themePref = parsed.themePref;
            if (this.hostPrefs) {
              try {
                this.hostPrefs.putSync('theme_pref', this.themePref);
                void this.hostPrefs.flush();
              } catch {
                // Ignore persistence errors
              }
            }
          }
        }
        if (typeof parsed.screen === 'string') {
          this.activeScreen = parsed.screen;
        }
        if (typeof parsed.isDark === 'boolean' && parsed.isDark !== this.isDark) {
          this.isDark = parsed.isDark;
          this.updateSystemBarStyle();
        }
        if (typeof parsed.lesson === 'string' && parsed.lesson.length > 0) {
          this.lastLessonId = parsed.lesson;
        }
        if (typeof parsed.track === 'string' && parsed.track.length > 0) {
          this.lastTrack = parsed.track;
        }
        if (typeof parsed.title === 'string' && parsed.title.length > 0) {
          this.lastTitle = parsed.title;
        }
        if (typeof parsed.subtitle === 'string' && parsed.subtitle.length > 0) {
          this.lastSubtitle = parsed.subtitle;
        }
        if (typeof parsed.sentence === 'string') {
          this.lastSentence = parsed.sentence;
        }
        if (typeof parsed.dur === 'number' && parsed.dur > 0) {
          this.lastDurationSec = parsed.dur;
        }
        if (typeof parsed.pos === 'number' && parsed.pos >= 0) {
          this.lastPosSec = parsed.pos;
        }
        if (typeof parsed.speed === 'number' && parsed.speed > 0) {
          this.lastSpeed = parsed.speed;
        }
        const playingChanged = typeof parsed.isPlaying === 'boolean' && parsed.isPlaying !== this.isPlaying;
        if (playingChanged && typeof parsed.isPlaying === 'boolean') {
          this.isPlaying = parsed.isPlaying;
          this.syncKeepScreenOn();
          if (this.abilityContext) {
            if (this.isPlaying) {
              void this.bgKeeper.start(this.abilityContext);
            } else {
              void this.bgKeeper.stop(this.abilityContext);
            }
          }
        }
        void this.syncAvSessionFromBridge(playingChanged);
      } catch (e) {
        hilog.warn(LOG_DOMAIN, LOG_TAG, 'Bridge JSON parse failed: %{public}s', String(e));
      }
      return;
    }
    if (msg.startsWith('[EP_AUDIO_TICK]')) {
      hilog.info(LOG_DOMAIN, LOG_TAG, '%{public}s', msg);
      try {
        const tick = JSON.parse(msg.substring('[EP_AUDIO_TICK]'.length)) as AudioTickPayload;
        if (typeof tick.time === 'number' && tick.time >= 0) {
          this.lastPosSec = tick.time;
        }
        if (typeof tick.dur === 'number' && tick.dur > 0) {
          this.lastDurationSec = tick.dur;
        }
        if (typeof tick.rate === 'number' && tick.rate > 0) {
          this.lastSpeed = tick.rate;
        }
        const playingNow = typeof tick.paused === 'boolean' ? !tick.paused : this.isPlaying;
        void this.syncAvPlaybackState(playingNow, this.lastPosSec, this.lastSpeed);
      } catch {
        // Ignore malformed audio tick
      }
      return;
    }
    if (msg.startsWith('[EP_TEST_STATE]') || msg.startsWith('[EP_STATE_CHUNK:')) {
      hilog.info(LOG_DOMAIN, LOG_TAG, '%{public}s', msg);
      return;
    }
    if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('exception')) {
      hilog.error(LOG_DOMAIN, LOG_TAG, 'WebConsole: %{public}s', msg);
    } else {
      hilog.info(LOG_DOMAIN, LOG_TAG, 'WebConsole: %{public}s', msg);
    }
  }

  private async syncAvSessionFromBridge(forceStateUpdate: boolean): Promise<void> {
    if (this.avSessionInitPromise) {
      await this.avSessionInitPromise;
    }
    const metaKey = `${this.lastLessonId}|${this.lastTrack}|${this.isDark}|${this.lastTitle}|${this.lastSubtitle}|${this.lastSentence}|${this.lastDurationSec}`;
    if (metaKey !== this.lastAvMetaKey) {
      this.lastAvMetaKey = metaKey;
      await this.avSession.updateMetadata(
        `${this.lastLessonId}_${this.lastTrack}`,
        this.lastTitle,
        this.lastSubtitle,
        this.lastDurationSec,
        this.lastSentence,
        this.isDark
      );
      forceStateUpdate = true;
    }
    if (forceStateUpdate) {
      await this.avSession.updatePlaybackState(this.isPlaying, this.lastPosSec, this.lastSpeed);
    }
  }

  private async syncAvPlaybackState(isPlaying: boolean, posSec: number, speed: number): Promise<void> {
    if (this.avSessionInitPromise) {
      await this.avSessionInitPromise;
    }
    await this.avSession.updatePlaybackState(isPlaying, posSec, speed);
  }

  sendCommandToWeb(cmd: string): void {
    try {
      const escaped = cmd.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      this.webController.runJavaScript(`window.epSendCommand && window.epSendCommand('${escaped}');`);
    } catch {
      // Ignore
    }
  }

  evalJsForTest(script: string): void {
    try {
      this.webController.runJavaScript(script, (err, result) => {
        if (err) {
          hilog.error(LOG_DOMAIN, LOG_TAG, '[EP_EVAL_ERR]%{public}s', String(err.message));
        } else {
          hilog.info(LOG_DOMAIN, LOG_TAG, '[EP_EVAL_RES]%{public}s', String(result ?? ''));
        }
      });
    } catch (e) {
      hilog.error(LOG_DOMAIN, LOG_TAG, 'runJavaScript failed: %{public}s', String(e));
    }
  }

  navigateBackInWeb(): void {
    this.sendCommandToWeb('back');
  }

  private notifyWebQrScanResult(status: string, payload: string): void {
    try {
      const sJson = JSON.stringify(status);
      const pJson = JSON.stringify(payload);
      this.webController.runJavaScript(`window.__epOnQrScanResult && window.__epOnQrScanResult(${sJson}, ${pJson});`);
    } catch {
      // Ignore
    }
  }

  private async handleScanQrFromWeb(): Promise<void> {
    if (!this.abilityContext) {
      this.notifyWebQrScanResult('error', 'Ability context unavailable');
      return;
    }
    try {
      const options: scanBarcode.ScanOptions = {
        scanTypes: [scanCore.ScanType.QR_CODE],
        enableMultiMode: false,
        enableAlbum: true
      };
      const res: scanBarcode.ScanResult = await new Promise<scanBarcode.ScanResult>((resolve, reject) => {
        scanBarcode.startScanForResult(this.abilityContext!, options, (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        });
      });
      const val = res && typeof res.originalValue === 'string' ? res.originalValue.trim() : '';
      if (val.length > 0) {
        this.notifyWebQrScanResult('success', val);
      } else {
        this.notifyWebQrScanResult('cancelled', '');
      }
    } catch (err) {
      const bizErr = err as ScanErrShape;
      const code = typeof bizErr?.code === 'number' ? bizErr.code : -1;
      if (code === 1000500002) {
        this.notifyWebQrScanResult('cancelled', '');
      } else if (code === 201) {
        this.notifyWebQrScanResult('permission_denied', '');
      } else {
        this.notifyWebQrScanResult('error', String(bizErr?.message ?? err ?? 'Scan failed'));
      }
    }
  }

  handleWebIntercept(request?: WebResourceRequest): WebResourceResponse | null {
    if (!request || !this.abilityContext) {
      return null;
    }
    const url = request.getRequestUrl();
    if (!url.startsWith(LOCAL_ORIGIN)) {
      return null;
    }

    let relPath = url.substring(LOCAL_ORIGIN.length);
    const qIdx = relPath.indexOf('?');
    if (qIdx >= 0) {
      relPath = relPath.substring(0, qIdx);
    }
    const hIdx = relPath.indexOf('#');
    if (hIdx >= 0) {
      relPath = relPath.substring(0, hIdx);
    }
    try {
      relPath = decodeURIComponent(relPath);
    } catch {
      // Keep original if malformed
    }
    while (relPath.startsWith('/')) {
      relPath = relPath.substring(1);
    }
    if (relPath.length === 0) {
      relPath = 'index.html';
    }

    const rawPath = relPath.startsWith('audio/') ? relPath : `flutter_web/${relPath}`;
    const fullBuf = this.readRawBuffer(rawPath);
    if (!fullBuf) {
      if (relPath.startsWith('audio/')) {
        hilog.info(LOG_DOMAIN, LOG_TAG, 'Redirecting unbundled audio %{public}s to Seoul server', relPath);
        const redirect = new WebResourceResponse();
        redirect.setResponseCode(307);
        redirect.setReasonMessage('Temporary Redirect');
        redirect.setResponseHeader([
          { headerKey: 'Location', headerValue: `https://43.155.232.185:8888/${relPath}` },
          { headerKey: 'Access-Control-Allow-Origin', headerValue: '*' }
        ]);
        redirect.setResponseIsReady(true);
        return redirect;
      }
      hilog.warn(LOG_DOMAIN, LOG_TAG, 'Missing rawfile for %{public}s -> %{public}s', url, rawPath);
      const notFound = new WebResourceResponse();
      notFound.setResponseCode(404);
      notFound.setReasonMessage('Not Found');
      notFound.setResponseMimeType('text/plain');
      notFound.setResponseEncoding('utf-8');
      notFound.setResponseData('Not Found');
      notFound.setResponseHeader([
        { headerKey: 'Access-Control-Allow-Origin', headerValue: '*' }
      ]);
      notFound.setResponseIsReady(true);
      return notFound;
    }

    const mime = this.resolveMimeType(rawPath);
    const encoding = this.isTextMime(mime) ? 'utf-8' : '';
    const rangeHeader = this.findHeader(request.getRequestHeader(), 'range');

    const response = new WebResourceResponse();
    response.setResponseMimeType(mime);
    response.setResponseEncoding(encoding);

    if (rangeHeader && rangeHeader.toLowerCase().startsWith('bytes=')) {
      const rangeSpec = rangeHeader.substring('bytes='.length).split(',')[0].trim();
      const dashIdx = rangeSpec.indexOf('-');
      const total = fullBuf.byteLength;
      if (dashIdx >= 0 && total > 0) {
        const startStr = rangeSpec.substring(0, dashIdx).trim();
        const endStr = rangeSpec.substring(dashIdx + 1).trim();
        let start = startStr.length > 0 ? parseInt(startStr, 10) : 0;
        let end = endStr.length > 0 ? parseInt(endStr, 10) : total - 1;
        if (isNaN(start) || start < 0) start = 0;
        if (isNaN(end) || end >= total) end = total - 1;
        if (start > end) start = Math.max(0, end);

        const slice = fullBuf.slice(start, end + 1);
        response.setResponseCode(206);
        response.setReasonMessage('Partial Content');
        response.setResponseData(slice);
        response.setResponseHeader([
          { headerKey: 'Accept-Ranges', headerValue: 'bytes' },
          { headerKey: 'Content-Range', headerValue: `bytes ${start}-${end}/${total}` },
          { headerKey: 'Content-Length', headerValue: `${slice.byteLength}` },
          { headerKey: 'Access-Control-Allow-Origin', headerValue: '*' },
          { headerKey: 'Cache-Control', headerValue: 'no-cache' }
        ]);
        response.setResponseIsReady(true);
        return response;
      }
    }

    response.setResponseCode(200);
    response.setReasonMessage('OK');
    response.setResponseData(fullBuf);
    response.setResponseHeader([
      { headerKey: 'Accept-Ranges', headerValue: 'bytes' },
      { headerKey: 'Content-Length', headerValue: `${fullBuf.byteLength}` },
      { headerKey: 'Access-Control-Allow-Origin', headerValue: '*' }
    ]);
    response.setResponseIsReady(true);
    return response;
  }

  private readRawBuffer(rawPath: string): ArrayBuffer | undefined {
    if (!this.abilityContext) {
      return undefined;
    }
    if (rawPath.startsWith('audio/') && rawPath === this.cachedAudioPath && this.cachedAudioBuf) {
      return this.cachedAudioBuf;
    }
    try {
      const bytes = this.abilityContext.resourceManager.getRawFileContentSync(rawPath);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      if (rawPath.startsWith('audio/')) {
        this.cachedAudioPath = rawPath;
        this.cachedAudioBuf = buf;
      }
      return buf;
    } catch {
      return undefined;
    }
  }

  private findHeader(headers: Array<Header>, keyLower: string): string | undefined {
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].headerKey.toLowerCase() === keyLower) {
        return headers[i].headerValue;
      }
    }
    return undefined;
  }

  private resolveMimeType(path: string): string {
    const lower = path.toLowerCase();
    if (lower.endsWith('.html')) return 'text/html';
    if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'application/javascript';
    if (lower.endsWith('.wasm')) return 'application/wasm';
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.css')) return 'text/css';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.otf')) return 'font/otf';
    if (lower.endsWith('.ttf')) return 'font/ttf';
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.m4a')) return 'audio/mp4';
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.frag') || lower.endsWith('notices')) return 'text/plain';
    return 'application/octet-stream';
  }

  private isTextMime(mime: string): boolean {
    return mime.startsWith('text/') || mime === 'application/javascript' || mime === 'application/json';
  }

  dispose(): void {
    this.cachedAudioPath = '';
    this.cachedAudioBuf = undefined;
    void this.avSession.release();
    if (this.abilityContext) {
      void this.bgKeeper.stop(this.abilityContext);
    }
  }
}

import { HapticEngine } from '@englishpod/ep_design';

/**
 * 1:1 port of iOS _HandDrawnSmileyPainter & _EnglishPodAnimatedSplashOverlay (main.dart:3885-4221).
 * 4 canonical 108x108 Bezier paths drawn sequentially:
 *  - Head loop CCW (0.00..0.44 of draw phase)
 *  - Left eye top-to-bottom (0.44..0.58)
 *  - Right eye top-to-bottom (0.58..0.72)
 *  - Smile curve left-to-right (0.72..1.00)
 * Then pulse + zoom (1.0 -> 3.8) + fade dissolve reveal.
 */
@ComponentV2
export struct HandDrawnSplashOverlay {
  @Param accentColor: string = '#1ED760';
  @Param bgWellColor: string = '#070709';
  @Param onProgressChanged: (progress: number) => void = () => {};
  @Param onFinished: () => void = () => {};

  @Local progress: number = 0.0;
  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);
  private timerId: number = -1;
  private startMs: number = 0;
  private readonly totalDurationMs: number = 2000;
  private hapticFired: boolean = false;
  private finishedSent: boolean = false;
  private skipping: boolean = false;

  private static headPath?: Path2D;
  private static leftEyePath?: Path2D;
  private static rightEyePath?: Path2D;
  private static smilePath?: Path2D;

  private static ensurePaths(): void {
    if (HandDrawnSplashOverlay.headPath) {
      return;
    }
    const head = new Path2D();
    head.moveTo(47.21, 27.11);
    head.bezierCurveTo(48.52, 26.86, 49.60, 27.00, 50.59, 27.41);
    head.bezierCurveTo(51.59, 27.81, 52.21, 29.30, 53.18, 29.54);
    head.bezierCurveTo(54.15, 29.77, 55.18, 28.88, 56.41, 28.81);
    head.bezierCurveTo(57.64, 28.74, 58.93, 28.68, 60.56, 29.14);
    head.bezierCurveTo(62.19, 29.61, 64.62, 30.63, 66.19, 31.61);
    head.bezierCurveTo(67.76, 32.59, 68.82, 33.73, 69.97, 35.03);
    head.bezierCurveTo(71.12, 36.33, 72.01, 37.29, 73.09, 39.41);
    head.bezierCurveTo(74.17, 41.53, 75.74, 45.46, 76.46, 47.74);
    head.bezierCurveTo(77.17, 50.03, 77.23, 51.52, 77.39, 53.11);
    head.bezierCurveTo(77.54, 54.70, 77.54, 55.75, 77.39, 57.29);
    head.bezierCurveTo(77.23, 58.83, 76.96, 60.61, 76.46, 62.36);
    head.bezierCurveTo(75.96, 64.11, 75.23, 66.13, 74.40, 67.80);
    head.bezierCurveTo(73.57, 69.47, 72.55, 71.00, 71.47, 72.37);
    head.bezierCurveTo(70.38, 73.73, 69.71, 74.71, 67.87, 75.97);
    head.bezierCurveTo(66.02, 77.22, 63.02, 79.07, 60.41, 79.91);
    head.bezierCurveTo(57.80, 80.75, 54.61, 81.03, 52.21, 80.99);
    head.bezierCurveTo(49.81, 80.95, 47.79, 80.26, 46.01, 79.69);
    head.bezierCurveTo(44.23, 79.12, 42.61, 78.19, 41.51, 77.59);
    head.bezierCurveTo(40.40, 77.00, 40.48, 77.17, 39.38, 76.12);
    head.bezierCurveTo(38.28, 75.07, 36.10, 72.95, 34.91, 71.29);
    head.bezierCurveTo(33.71, 69.64, 32.82, 67.58, 32.21, 66.19);
    head.bezierCurveTo(31.60, 64.80, 31.56, 64.39, 31.24, 62.96);
    head.bezierCurveTo(30.93, 61.52, 30.47, 59.23, 30.31, 57.59);
    head.bezierCurveTo(30.16, 55.95, 30.21, 54.60, 30.31, 53.11);
    head.bezierCurveTo(30.42, 51.62, 30.48, 50.63, 30.94, 48.64);
    head.bezierCurveTo(31.41, 46.66, 32.25, 43.40, 33.11, 41.21);
    head.bezierCurveTo(33.97, 39.02, 35.19, 36.99, 36.11, 35.51);
    head.bezierCurveTo(37.03, 34.03, 37.52, 33.42, 38.62, 32.32);
    head.bezierCurveTo(39.73, 31.22, 41.28, 29.78, 42.71, 28.91);
    head.bezierCurveTo(44.14, 28.04, 45.90, 27.36, 47.21, 27.11);
    head.closePath();
    head.moveTo(50.57, 30.50);
    head.bezierCurveTo(50.42, 30.30, 47.82, 31.03, 46.31, 31.91);
    head.bezierCurveTo(44.79, 32.79, 42.78, 34.48, 41.48, 35.78);
    head.bezierCurveTo(40.18, 37.08, 39.50, 38.00, 38.51, 39.71);
    head.bezierCurveTo(37.51, 41.41, 36.27, 43.97, 35.51, 46.01);
    head.bezierCurveTo(34.75, 48.05, 34.31, 49.96, 33.94, 51.94);
    head.bezierCurveTo(33.58, 53.93, 33.32, 55.96, 33.32, 57.90);
    head.bezierCurveTo(33.32, 59.84, 33.50, 61.66, 33.94, 63.56);
    head.bezierCurveTo(34.39, 65.46, 35.10, 67.65, 36.00, 69.30);
    head.bezierCurveTo(36.91, 70.94, 38.19, 72.36, 39.38, 73.42);
    head.bezierCurveTo(40.56, 74.49, 41.46, 75.04, 43.10, 75.70);
    head.bezierCurveTo(44.75, 76.35, 47.48, 77.07, 49.24, 77.36);
    head.bezierCurveTo(51.01, 77.64, 51.95, 77.64, 53.69, 77.39);
    head.bezierCurveTo(55.43, 77.14, 58.13, 76.38, 59.67, 75.87);
    head.bezierCurveTo(61.20, 75.35, 61.55, 75.25, 62.89, 74.29);
    head.bezierCurveTo(64.23, 73.33, 66.51, 71.41, 67.72, 70.12);
    head.bezierCurveTo(68.94, 68.84, 69.25, 68.45, 70.20, 66.60);
    head.bezierCurveTo(71.16, 64.76, 72.81, 60.86, 73.46, 59.06);
    head.bezierCurveTo(74.10, 57.25, 73.98, 57.43, 74.09, 55.79);
    head.bezierCurveTo(74.19, 54.15, 74.44, 51.56, 74.09, 49.21);
    head.bezierCurveTo(73.74, 46.86, 72.69, 43.56, 72.00, 41.70);
    head.bezierCurveTo(71.31, 39.84, 70.78, 39.17, 69.97, 38.03);
    head.bezierCurveTo(69.15, 36.90, 67.97, 35.68, 67.09, 34.91);
    head.bezierCurveTo(66.21, 34.14, 65.68, 33.82, 64.69, 33.41);
    head.bezierCurveTo(63.70, 33.00, 62.67, 32.49, 61.16, 32.44);
    head.bezierCurveTo(59.64, 32.39, 57.46, 32.48, 55.61, 33.11);
    head.bezierCurveTo(53.76, 33.74, 52.52, 34.22, 50.03, 36.23);
    head.bezierCurveTo(47.55, 38.25, 42.40, 43.72, 40.72, 45.22);
    head.bezierCurveTo(39.04, 46.73, 39.92, 45.91, 39.95, 45.24);
    head.bezierCurveTo(39.98, 44.57, 40.43, 42.46, 40.91, 41.21);
    head.bezierCurveTo(41.39, 39.96, 41.79, 39.09, 42.83, 37.73);
    head.bezierCurveTo(43.88, 36.38, 45.89, 34.28, 47.18, 33.08);
    head.bezierCurveTo(48.47, 31.87, 50.71, 30.69, 50.57, 30.50);
    head.closePath();

    const le = new Path2D();
    le.moveTo(46.36, 47.86);
    le.bezierCurveTo(46.53, 47.65, 46.88, 47.58, 47.28, 47.82);
    le.bezierCurveTo(47.68, 48.06, 48.00, 47.71, 48.79, 49.31);
    le.bezierCurveTo(49.58, 50.91, 51.75, 56.12, 52.04, 57.44);
    le.bezierCurveTo(52.32, 58.75, 50.96, 57.48, 50.51, 57.19);
    le.bezierCurveTo(50.05, 56.90, 50.01, 57.04, 49.31, 55.69);
    le.bezierCurveTo(48.61, 54.34, 46.80, 50.39, 46.31, 49.09);
    le.bezierCurveTo(45.82, 47.79, 46.20, 48.08, 46.36, 47.86);
    le.closePath();

    const re = new Path2D();
    re.moveTo(51.77, 45.16);
    re.bezierCurveTo(51.56, 43.92, 52.91, 45.09, 53.47, 45.53);
    re.bezierCurveTo(54.02, 45.98, 54.39, 46.24, 55.09, 47.81);
    re.bezierCurveTo(55.79, 49.38, 57.47, 53.79, 57.65, 54.96);
    re.bezierCurveTo(57.84, 56.12, 56.70, 55.12, 56.21, 54.79);
    re.bezierCurveTo(55.72, 54.46, 55.46, 54.59, 54.72, 52.98);
    re.bezierCurveTo(53.98, 51.38, 51.97, 46.40, 51.77, 45.16);
    re.closePath();

    const sm = new Path2D();
    sm.moveTo(66.75, 51.17);
    sm.bezierCurveTo(67.12, 50.52, 68.00, 51.56, 68.47, 52.13);
    sm.bezierCurveTo(68.93, 52.71, 69.49, 53.30, 69.56, 54.64);
    sm.bezierCurveTo(69.63, 55.99, 69.55, 58.36, 68.89, 60.19);
    sm.bezierCurveTo(68.24, 62.02, 66.69, 64.24, 65.62, 65.62);
    sm.bezierCurveTo(64.55, 67.00, 63.57, 67.67, 62.47, 68.47);
    sm.bezierCurveTo(61.36, 69.26, 60.55, 69.85, 58.99, 70.39);
    sm.bezierCurveTo(57.43, 70.93, 55.00, 71.71, 53.10, 71.70);
    sm.bezierCurveTo(51.20, 71.68, 49.21, 71.14, 47.60, 70.30);
    sm.bezierCurveTo(45.99, 69.46, 44.57, 68.08, 43.43, 66.67);
    sm.bezierCurveTo(42.30, 65.25, 41.39, 63.16, 40.80, 61.80);
    sm.bezierCurveTo(40.21, 60.44, 39.98, 59.42, 39.91, 58.49);
    sm.bezierCurveTo(39.84, 57.56, 40.13, 56.40, 40.39, 56.23);
    sm.bezierCurveTo(40.66, 56.07, 40.88, 56.12, 41.50, 57.50);
    sm.bezierCurveTo(42.12, 58.88, 43.30, 62.95, 44.10, 64.50);
    sm.bezierCurveTo(44.90, 66.05, 45.31, 66.19, 46.31, 66.79);
    sm.bezierCurveTo(47.31, 67.39, 48.98, 67.89, 50.10, 68.10);
    sm.bezierCurveTo(51.23, 68.31, 52.02, 68.22, 53.06, 68.06);
    sm.bezierCurveTo(54.09, 67.89, 54.97, 67.72, 56.29, 67.09);
    sm.bezierCurveTo(57.61, 66.46, 59.67, 65.32, 60.97, 64.27);
    sm.bezierCurveTo(62.27, 63.22, 63.21, 62.16, 64.09, 60.79);
    sm.bezierCurveTo(64.97, 59.42, 65.81, 57.66, 66.26, 56.06);
    sm.bezierCurveTo(66.70, 54.46, 66.39, 51.83, 66.75, 51.17);
    sm.closePath();

    HandDrawnSplashOverlay.headPath = head;
    HandDrawnSplashOverlay.leftEyePath = le;
    HandDrawnSplashOverlay.rightEyePath = re;
    HandDrawnSplashOverlay.smilePath = sm;
  }

  private easeOutCubic(t: number): number {
    const inv = 1.0 - t;
    return 1.0 - inv * inv * inv;
  }

  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  aboutToAppear(): void {
    HandDrawnSplashOverlay.ensurePaths();
    this.startMs = Date.now();
    this.timerId = setInterval(() => {
      const elapsed = Date.now() - this.startMs;
      let nextV = Math.min(1.0, elapsed / this.totalDurationMs);
      if (this.skipping) {
        nextV = Math.min(1.0, this.progress + 0.08);
      }
      this.progress = nextV;
      this.onProgressChanged(nextV);
      if (nextV >= 0.80 && !this.hapticFired) {
        this.hapticFired = true;
        HapticEngine.pulseTick();
      }
      this.drawSmiley();
      if (nextV >= 1.0 && !this.finishedSent) {
        this.finishedSent = true;
        clearInterval(this.timerId);
        this.timerId = -1;
        this.onFinished();
      }
    }, 12);
  }

  aboutToDisappear(): void {
    if (this.timerId !== -1) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
  }

  private drawSmiley(): void {
    const c = this.ctx;
    const w = c.width;
    const h = c.height;
    if (w <= 0 || h <= 0) {
      return;
    }
    HandDrawnSplashOverlay.ensurePaths();
    c.clearRect(0, 0, w, h);

    const drawProg = Math.max(0.0, Math.min(1.0, this.progress / 0.80));
    const scale = w / 108.0;

    c.save();
    c.scale(scale, scale);
    c.fillStyle = this.accentColor;

    // 1. Head CCW (0.00..0.44)
    const tHead = Math.max(0.0, Math.min(1.0, drawProg / 0.44));
    const pHead = Math.max(0.025, this.easeOutCubic(tHead));
    c.save();
    c.clip(this.createHeadClip(pHead));
    if (HandDrawnSplashOverlay.headPath) {
      c.fill(HandDrawnSplashOverlay.headPath, 'evenodd');
    }
    c.restore();

    // 2. Left eye (0.44..0.58)
    const tLE = Math.max(0.0, Math.min(1.0, (drawProg - 0.44) / 0.14));
    if (tLE > 0) {
      const pLE = this.easeOutCubic(tLE);
      c.save();
      const clip = new Path2D();
      clip.rect(40.0, 46.0, 16.0, 1.0 + pLE * 12.0);
      c.clip(clip);
      if (HandDrawnSplashOverlay.leftEyePath) {
        c.fill(HandDrawnSplashOverlay.leftEyePath);
      }
      c.restore();
    }

    // 3. Right eye (0.58..0.72)
    const tRE = Math.max(0.0, Math.min(1.0, (drawProg - 0.58) / 0.14));
    if (tRE > 0) {
      const pRE = this.easeOutCubic(tRE);
      c.save();
      const clip = new Path2D();
      clip.rect(50.0, 42.0, 12.0, 1.0 + pRE * 14.0);
      c.clip(clip);
      if (HandDrawnSplashOverlay.rightEyePath) {
        c.fill(HandDrawnSplashOverlay.rightEyePath);
      }
      c.restore();
    }

    // 4. Smile (0.72..1.00)
    const tSmile = Math.max(0.0, Math.min(1.0, (drawProg - 0.72) / 0.28));
    if (tSmile > 0) {
      const pSmile = this.easeOutCubic(tSmile);
      c.save();
      c.clip(this.createSmileClip(pSmile));
      if (HandDrawnSplashOverlay.smilePath) {
        c.fill(HandDrawnSplashOverlay.smilePath);
      }
      c.restore();
    }

    // Bloom glow
    const bloom = Math.max(0.0, Math.min(1.0, (this.progress - 0.80) / 0.05));
    if (bloom > 0.01) {
      c.save();
      c.globalAlpha = 0.28 * bloom;
      c.shadowColor = this.accentColor;
      c.shadowBlur = 10;
      if (HandDrawnSplashOverlay.headPath) c.fill(HandDrawnSplashOverlay.headPath, 'evenodd');
      if (HandDrawnSplashOverlay.leftEyePath) c.fill(HandDrawnSplashOverlay.leftEyePath);
      if (HandDrawnSplashOverlay.rightEyePath) c.fill(HandDrawnSplashOverlay.rightEyePath);
      if (HandDrawnSplashOverlay.smilePath) c.fill(HandDrawnSplashOverlay.smilePath);
      c.restore();
    }

    c.restore();
  }

  private createHeadClip(t: number): Path2D {
    const p = new Path2D();
    if (t >= 1.0) {
      p.rect(0, 0, 108, 108);
      return p;
    }
    const cx = 53.5;
    const cy = 54.0;
    const r = 45.0;
    const startAngle = -Math.PI / 2;
    const sweep = t * (2 * Math.PI + 0.18);
    p.moveTo(cx, cy);
    const steps = Math.max(4, Math.round(36 * t));
    for (let i = 0; i <= steps; i++) {
      const a = startAngle - (sweep * i) / steps;
      p.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    p.closePath();
    return p;
  }

  private createSmileClip(t: number): Path2D {
    const p = new Path2D();
    if (t >= 1.0) {
      p.rect(0, 0, 108, 108);
      return p;
    }
    const cx = 53.5;
    const cy = 45.0;
    const r = 38.0;
    const startAngle = 2.53;
    const endAngle = 0.35;
    p.moveTo(cx, cy);
    const steps = Math.max(3, Math.round(24 * t));
    for (let i = 0; i <= steps; i++) {
      const a = startAngle - (t * (startAngle - endAngle) * i) / steps;
      p.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    p.closePath();
    return p;
  }

  private computedZoomScale(): number {
    const pulseT = Math.max(0.0, Math.min(1.0, (this.progress - 0.80) / 0.05));
    const pulseScale = 1.0 + 0.045 * Math.sin(Math.PI * pulseT);
    const zoomT = Math.max(0.0, Math.min(1.0, (this.progress - 0.85) / 0.15));
    const curvedZoom = this.easeInOutCubic(zoomT);
    return pulseScale * (1.0 + 2.8 * curvedZoom);
  }

  private computedOpacity(): number {
    const zoomT = Math.max(0.0, Math.min(1.0, (this.progress - 0.85) / 0.15));
    const curvedZoom = this.easeInOutCubic(zoomT);
    return Math.max(0.0, Math.min(1.0, 1.0 - 1.25 * curvedZoom));
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      Canvas(this.ctx)
        .width(160)
        .height(160)
        .scale({ x: this.computedZoomScale(), y: this.computedZoomScale() })
        .opacity(this.computedOpacity())
        .onReady(() => {
          this.drawSmiley();
        })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.bgWellColor)
    .opacity(this.computedOpacity())
    .onClick(() => {
      if (this.progress < 0.85) {
        this.skipping = true;
        this.progress = 0.85;
      }
    })
  }
}

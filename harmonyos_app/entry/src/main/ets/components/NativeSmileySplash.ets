import { displaySync } from '@kit.ArkGraphics2D';
import { PlayerStore } from '../state/PlayerStore';

function clamp01(v: number): number {
  if (v < 0) {
    return 0;
  }
  if (v > 1) {
    return 1;
  }
  return v;
}

function easeOutCubic(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x * x;
}

function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  if (x < 0.5) {
    return 4 * x * x * x;
  }
  const u = -2 * x + 2;
  return 1 - (u * u * u) / 2;
}

function buildCanonicalHead(): Path2D {
  const p = new Path2D();
  p.moveTo(47.21, 27.11);
  p.bezierCurveTo(48.52, 26.86, 49.60, 27.00, 50.59, 27.41);
  p.bezierCurveTo(51.59, 27.81, 52.21, 29.30, 53.18, 29.54);
  p.bezierCurveTo(54.15, 29.77, 55.18, 28.88, 56.41, 28.81);
  p.bezierCurveTo(57.64, 28.74, 58.93, 28.68, 60.56, 29.14);
  p.bezierCurveTo(62.19, 29.61, 64.62, 30.63, 66.19, 31.61);
  p.bezierCurveTo(67.76, 32.59, 68.82, 33.73, 69.97, 35.03);
  p.bezierCurveTo(71.12, 36.33, 72.01, 37.29, 73.09, 39.41);
  p.bezierCurveTo(74.17, 41.53, 75.74, 45.46, 76.46, 47.74);
  p.bezierCurveTo(77.17, 50.03, 77.23, 51.52, 77.39, 53.11);
  p.bezierCurveTo(77.54, 54.70, 77.54, 55.75, 77.39, 57.29);
  p.bezierCurveTo(77.23, 58.83, 76.96, 60.61, 76.46, 62.36);
  p.bezierCurveTo(75.96, 64.11, 75.23, 66.13, 74.40, 67.80);
  p.bezierCurveTo(73.57, 69.47, 72.55, 71.00, 71.47, 72.37);
  p.bezierCurveTo(70.38, 73.73, 69.71, 74.71, 67.87, 75.97);
  p.bezierCurveTo(66.02, 77.22, 63.02, 79.07, 60.41, 79.91);
  p.bezierCurveTo(57.80, 80.75, 54.61, 81.03, 52.21, 80.99);
  p.bezierCurveTo(49.81, 80.95, 47.79, 80.26, 46.01, 79.69);
  p.bezierCurveTo(44.23, 79.12, 42.61, 78.19, 41.51, 77.59);
  p.bezierCurveTo(40.40, 77.00, 40.48, 77.17, 39.38, 76.12);
  p.bezierCurveTo(38.28, 75.07, 36.10, 72.95, 34.91, 71.29);
  p.bezierCurveTo(33.71, 69.64, 32.82, 67.58, 32.21, 66.19);
  p.bezierCurveTo(31.60, 64.80, 31.56, 64.39, 31.24, 62.96);
  p.bezierCurveTo(30.93, 61.52, 30.47, 59.23, 30.31, 57.59);
  p.bezierCurveTo(30.16, 55.95, 30.21, 54.60, 30.31, 53.11);
  p.bezierCurveTo(30.42, 51.62, 30.48, 50.63, 30.94, 48.64);
  p.bezierCurveTo(31.41, 46.66, 32.25, 43.40, 33.11, 41.21);
  p.bezierCurveTo(33.97, 39.02, 35.19, 36.99, 36.11, 35.51);
  p.bezierCurveTo(37.03, 34.03, 37.52, 33.42, 38.62, 32.32);
  p.bezierCurveTo(39.73, 31.22, 41.28, 29.78, 42.71, 28.91);
  p.bezierCurveTo(44.14, 28.04, 45.90, 27.36, 47.21, 27.11);
  p.closePath();
  p.moveTo(50.57, 30.50);
  p.bezierCurveTo(50.42, 30.30, 47.82, 31.03, 46.31, 31.91);
  p.bezierCurveTo(44.79, 32.79, 42.78, 34.48, 41.48, 35.78);
  p.bezierCurveTo(40.18, 37.08, 39.50, 38.00, 38.51, 39.71);
  p.bezierCurveTo(37.51, 41.41, 36.27, 43.97, 35.51, 46.01);
  p.bezierCurveTo(34.75, 48.05, 34.31, 49.96, 33.94, 51.94);
  p.bezierCurveTo(33.58, 53.93, 33.32, 55.96, 33.32, 57.90);
  p.bezierCurveTo(33.32, 59.84, 33.50, 61.66, 33.94, 63.56);
  p.bezierCurveTo(34.39, 65.46, 35.10, 67.65, 36.00, 69.30);
  p.bezierCurveTo(36.91, 70.94, 38.19, 72.36, 39.38, 73.42);
  p.bezierCurveTo(40.56, 74.49, 41.46, 75.04, 43.10, 75.70);
  p.bezierCurveTo(44.75, 76.35, 47.48, 77.07, 49.24, 77.36);
  p.bezierCurveTo(51.01, 77.64, 51.95, 77.64, 53.69, 77.39);
  p.bezierCurveTo(55.43, 77.14, 58.13, 76.38, 59.67, 75.87);
  p.bezierCurveTo(61.20, 75.35, 61.55, 75.25, 62.89, 74.29);
  p.bezierCurveTo(64.23, 73.33, 66.51, 71.41, 67.72, 70.12);
  p.bezierCurveTo(68.94, 68.84, 69.25, 68.45, 70.20, 66.60);
  p.bezierCurveTo(71.16, 64.76, 72.81, 60.86, 73.46, 59.06);
  p.bezierCurveTo(74.10, 57.25, 73.98, 57.43, 74.09, 55.79);
  p.bezierCurveTo(74.19, 54.15, 74.44, 51.56, 74.09, 49.21);
  p.bezierCurveTo(73.74, 46.86, 72.69, 43.56, 72.00, 41.70);
  p.bezierCurveTo(71.31, 39.84, 70.78, 39.17, 69.97, 38.03);
  p.bezierCurveTo(69.15, 36.90, 67.97, 35.68, 67.09, 34.91);
  p.bezierCurveTo(66.21, 34.14, 65.68, 33.82, 64.69, 33.41);
  p.bezierCurveTo(63.70, 33.00, 62.67, 32.49, 61.16, 32.44);
  p.bezierCurveTo(59.64, 32.39, 57.46, 32.48, 55.61, 33.11);
  p.bezierCurveTo(53.76, 33.74, 52.52, 34.22, 50.03, 36.23);
  p.bezierCurveTo(47.55, 38.25, 42.40, 43.72, 40.72, 45.22);
  p.bezierCurveTo(39.04, 46.73, 39.92, 45.91, 39.95, 45.24);
  p.bezierCurveTo(39.98, 44.57, 40.43, 42.46, 40.91, 41.21);
  p.bezierCurveTo(41.39, 39.96, 41.79, 39.09, 42.83, 37.73);
  p.bezierCurveTo(43.88, 36.38, 45.89, 34.28, 47.18, 33.08);
  p.bezierCurveTo(48.47, 31.87, 50.71, 30.69, 50.57, 30.50);
  p.closePath();
  return p;
}

function buildCanonicalLeftEye(): Path2D {
  const p = new Path2D();
  p.moveTo(46.36, 47.86);
  p.bezierCurveTo(46.53, 47.65, 46.88, 47.58, 47.28, 47.82);
  p.bezierCurveTo(47.68, 48.06, 48.00, 47.71, 48.79, 49.31);
  p.bezierCurveTo(49.58, 50.91, 51.75, 56.12, 52.04, 57.44);
  p.bezierCurveTo(52.32, 58.75, 50.96, 57.48, 50.51, 57.19);
  p.bezierCurveTo(50.05, 56.90, 50.01, 57.04, 49.31, 55.69);
  p.bezierCurveTo(48.61, 54.34, 46.80, 50.39, 46.31, 49.09);
  p.bezierCurveTo(45.82, 47.79, 46.20, 48.08, 46.36, 47.86);
  p.closePath();
  return p;
}

function buildCanonicalRightEye(): Path2D {
  const p = new Path2D();
  p.moveTo(51.77, 45.16);
  p.bezierCurveTo(51.56, 43.92, 52.91, 45.09, 53.47, 45.53);
  p.bezierCurveTo(54.02, 45.98, 54.39, 46.24, 55.09, 47.81);
  p.bezierCurveTo(55.79, 49.38, 57.47, 53.79, 57.65, 54.96);
  p.bezierCurveTo(57.84, 56.12, 56.70, 55.12, 56.21, 54.79);
  p.bezierCurveTo(55.72, 54.46, 55.46, 54.59, 54.72, 52.98);
  p.bezierCurveTo(53.98, 51.38, 51.97, 46.40, 51.77, 45.16);
  p.closePath();
  return p;
}

function buildCanonicalSmile(): Path2D {
  const p = new Path2D();
  p.moveTo(66.75, 51.17);
  p.bezierCurveTo(67.12, 50.52, 68.00, 51.56, 68.47, 52.13);
  p.bezierCurveTo(68.93, 52.71, 69.49, 53.30, 69.56, 54.64);
  p.bezierCurveTo(69.63, 55.99, 69.55, 58.36, 68.89, 60.19);
  p.bezierCurveTo(68.24, 62.02, 66.69, 64.24, 65.62, 65.62);
  p.bezierCurveTo(64.55, 67.00, 63.57, 67.67, 62.47, 68.47);
  p.bezierCurveTo(61.36, 69.26, 60.55, 69.85, 58.99, 70.39);
  p.bezierCurveTo(57.43, 70.93, 55.00, 71.71, 53.10, 71.70);
  p.bezierCurveTo(51.20, 71.68, 49.21, 71.14, 47.60, 70.30);
  p.bezierCurveTo(45.99, 69.46, 44.57, 68.08, 43.43, 66.67);
  p.bezierCurveTo(42.30, 65.25, 41.39, 63.16, 40.80, 61.80);
  p.bezierCurveTo(40.21, 60.44, 39.98, 59.42, 39.91, 58.49);
  p.bezierCurveTo(39.84, 57.56, 40.13, 56.40, 40.39, 56.23);
  p.bezierCurveTo(40.66, 56.07, 40.88, 56.12, 41.50, 57.50);
  p.bezierCurveTo(42.12, 58.88, 43.30, 62.95, 44.10, 64.50);
  p.bezierCurveTo(44.90, 66.05, 45.31, 66.19, 46.31, 66.79);
  p.bezierCurveTo(47.31, 67.39, 48.98, 67.89, 50.10, 68.10);
  p.bezierCurveTo(51.23, 68.31, 52.02, 68.22, 53.06, 68.06);
  p.bezierCurveTo(54.09, 67.89, 54.97, 67.72, 56.29, 67.09);
  p.bezierCurveTo(57.61, 66.46, 59.67, 65.32, 60.97, 64.27);
  p.bezierCurveTo(62.27, 63.22, 63.21, 62.16, 64.09, 60.79);
  p.bezierCurveTo(64.97, 59.42, 65.81, 57.66, 66.26, 56.06);
  p.bezierCurveTo(66.70, 54.46, 66.39, 51.83, 66.75, 51.17);
  p.closePath();
  return p;
}

const CANONICAL_HEAD: Path2D = buildCanonicalHead();
const CANONICAL_LEFT_EYE: Path2D = buildCanonicalLeftEye();
const CANONICAL_RIGHT_EYE: Path2D = buildCanonicalRightEye();
const CANONICAL_SMILE: Path2D = buildCanonicalSmile();

const CANVAS_BOX_VP = 192;
const SMILEY_SIZE_VP = 160;
const CANVAS_PAD_VP = (CANVAS_BOX_VP - SMILEY_SIZE_VP) / 2;

const PHASE12_DURATION_MS = 1530;
const PHASE3_DURATION_MS = 270;
const SAFETY_TIMEOUT_MS = 4500;

@ComponentV2
export struct NativeSmileySplash {
  @Local store: PlayerStore = PlayerStore.getInstance();
  @Local zoomScale: number = 1.0;
  @Local contentOpacity: number = 1.0;
  @Local bgOpacity: number = 1.0;

  private readonly ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private ds?: displaySync.DisplaySync;
  private dsCallback?: (info: displaySync.IntervalInfo) => void;
  private canvasReady: boolean = false;
  private startMs: number = 0;
  private zoomStartMs: number = 0;
  private skipRequested: boolean = false;
  private lastDrawProgress: number = -1;
  private lastBloom: number = -1;
  private lastDark: boolean | undefined = undefined;
  private finished: boolean = false;

  private applyHeadClip(t: number): void {
    this.ctx.beginPath();
    if (t >= 1.0) {
      this.ctx.rect(0, 0, 108, 108);
      this.ctx.clip();
      return;
    }
    const cx = 53.5;
    const cy = 54.0;
    const r = 45.0;
    const startAngle = -Math.PI / 2;
    const sweep = t * (2 * Math.PI + 0.18);
    this.ctx.moveTo(cx, cy);
    const steps = Math.max(4, Math.round(36 * t));
    for (let i = 0; i <= steps; i++) {
      const a = startAngle - (sweep * i) / steps;
      this.ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    this.ctx.closePath();
    this.ctx.clip();
  }

  private applyLeftEyeClip(t: number): void {
    this.ctx.beginPath();
    if (t >= 1.0) {
      this.ctx.rect(0, 0, 108, 108);
    } else {
      const h = 47.0 + t * (59.0 - 47.0) - 46.0;
      this.ctx.rect(40.0, 46.0, 16.0, Math.max(0, h));
    }
    this.ctx.clip();
  }

  private applyRightEyeClip(t: number): void {
    this.ctx.beginPath();
    if (t >= 1.0) {
      this.ctx.rect(0, 0, 108, 108);
    } else {
      const h = 43.0 + t * (57.0 - 43.0) - 42.0;
      this.ctx.rect(50.0, 42.0, 12.0, Math.max(0, h));
    }
    this.ctx.clip();
  }

  private applySmileClip(t: number): void {
    this.ctx.beginPath();
    if (t >= 1.0) {
      this.ctx.rect(0, 0, 108, 108);
      this.ctx.clip();
      return;
    }
    const cx = 53.5;
    const cy = 45.0;
    const r = 38.0;
    const startAngle = 2.53;
    const endAngle = 0.35;
    this.ctx.moveTo(cx, cy);
    const steps = Math.max(3, Math.round(24 * t));
    for (let i = 0; i <= steps; i++) {
      const a = startAngle - (t * (startAngle - endAngle) * i) / steps;
      this.ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    this.ctx.closePath();
    this.ctx.clip();
  }

  private drawCanvasFrame(drawProgress: number, bloom: number): void {
    if (!this.canvasReady) {
      return;
    }
    const isDark = this.store.isDark;
    const eps = 0.0005;
    if (
      this.lastDark === isDark &&
      Math.abs(drawProgress - this.lastDrawProgress) < eps &&
      Math.abs(bloom - this.lastBloom) < eps
    ) {
      return;
    }
    this.lastDark = isDark;
    this.lastDrawProgress = drawProgress;
    this.lastBloom = bloom;

    const fgColor = isDark ? '#1ED760' : '#CC785C';
    const scale = SMILEY_SIZE_VP / 108.0;

    this.ctx.clearRect(0, 0, CANVAS_BOX_VP, CANVAS_BOX_VP);
    this.ctx.save();
    this.ctx.translate(CANVAS_PAD_VP, CANVAS_PAD_VP);
    this.ctx.scale(scale, scale);

    this.ctx.fillStyle = fgColor;
    this.ctx.globalAlpha = 1.0;
    this.ctx.shadowBlur = 0;
    this.ctx.shadowColor = 'transparent';

    const tHead = clamp01(drawProgress / 0.44);
    const drawPHead = Math.max(0.025, easeOutCubic(tHead));
    const tLE = clamp01((drawProgress - 0.44) / 0.14);
    const pLE = easeOutCubic(tLE);
    const tRE = clamp01((drawProgress - 0.58) / 0.14);
    const pRE = easeOutCubic(tRE);
    const tSmile = clamp01((drawProgress - 0.72) / 0.28);
    const pSmile = easeOutCubic(tSmile);

    // 1. Head loop counter-clockwise
    this.ctx.save();
    this.applyHeadClip(drawPHead);
    this.ctx.fill(CANONICAL_HEAD, 'evenodd');
    this.ctx.restore();

    // 2. Left eye top-to-bottom
    if (tLE > 0.0) {
      this.ctx.save();
      this.applyLeftEyeClip(pLE);
      this.ctx.fill(CANONICAL_LEFT_EYE);
      this.ctx.restore();
    }

    // 3. Right eye top-to-bottom
    if (tRE > 0.0) {
      this.ctx.save();
      this.applyRightEyeClip(pRE);
      this.ctx.fill(CANONICAL_RIGHT_EYE);
      this.ctx.restore();
    }

    // 4. Smile curve left-to-right
    if (tSmile > 0.0) {
      this.ctx.save();
      this.applySmileClip(pSmile);
      this.ctx.fill(CANONICAL_SMILE);
      this.ctx.restore();
    }

    // 5. Bloom glow underneath when drawing finishes
    if (bloom > 0.01) {
      this.ctx.save();
      this.ctx.globalAlpha = clamp01(0.35 * bloom);
      this.ctx.shadowBlur = 12;
      this.ctx.shadowColor = fgColor;
      this.ctx.fill(CANONICAL_HEAD, 'evenodd');
      this.ctx.fill(CANONICAL_LEFT_EYE);
      this.ctx.fill(CANONICAL_RIGHT_EYE);
      this.ctx.fill(CANONICAL_SMILE);
      this.ctx.restore();
    }

    this.ctx.restore();
  }

  private onFrame(nowMs: number): void {
    if (this.finished) {
      return;
    }
    if (this.startMs === 0) {
      this.startMs = nowMs;
    }
    const elapsedMs = Math.max(0, nowMs - this.startMs);

    if (this.skipRequested && this.zoomStartMs === 0) {
      this.skipRequested = false;
      this.zoomStartMs = nowMs;
    }

    let v = 0.0;
    if (this.zoomStartMs > 0) {
      const zElapsed = Math.max(0, nowMs - this.zoomStartMs);
      v = Math.min(1.0, 0.85 + 0.15 * (zElapsed / PHASE3_DURATION_MS));
    } else if (elapsedMs < PHASE12_DURATION_MS) {
      v = 0.85 * (elapsedMs / PHASE12_DURATION_MS);
    } else {
      v = 0.85;
      if (this.store.flutterReady || elapsedMs >= SAFETY_TIMEOUT_MS) {
        this.zoomStartMs = nowMs;
      }
    }

    const drawProgress = clamp01(v / 0.80);
    const pulseT = clamp01((v - 0.80) / 0.05);
    const pulseScale = 1.0 + 0.045 * Math.sin(Math.PI * pulseT);
    const bloom = pulseT;

    const zoomT = clamp01((v - 0.85) / 0.15);
    const curvedZoom = easeInOutCubic(zoomT);
    const nextScale = pulseScale * (1.0 + 2.8 * curvedZoom);
    const nextOpacity = clamp01(1.0 - 1.25 * curvedZoom);

    if (drawProgress < 1.0 || bloom < 1.0 || this.lastDrawProgress < 1.0 || this.lastBloom < 1.0 || this.lastDark !== this.store.isDark) {
      this.drawCanvasFrame(drawProgress, bloom);
    }

    this.zoomScale = nextScale;
    this.contentOpacity = nextOpacity;
    this.bgOpacity = nextOpacity;

    if (v >= 1.0) {
      this.finished = true;
      this.stopDisplaySync();
      this.store.markSplashDismissed();
    }
  }

  private startDisplaySync(): void {
    if (this.ds || this.finished) {
      return;
    }
    try {
      const sync = displaySync.create();
      sync.setExpectedFrameRateRange({ expected: 120, min: 60, max: 120 });
      const cb = (info: displaySync.IntervalInfo): void => {
        const nowMs = info.timestamp > 0 ? info.timestamp / 1_000_000 : Date.now();
        this.onFrame(nowMs);
      };
      this.dsCallback = cb;
      sync.on('frame', cb);
      sync.start();
      this.ds = sync;
    } catch {
      this.finished = true;
      this.store.markSplashDismissed();
    }
  }

  private stopDisplaySync(): void {
    if (!this.ds) {
      return;
    }
    try {
      if (this.dsCallback) {
        this.ds.off('frame', this.dsCallback);
      }
      this.ds.stop();
    } catch {
      // Ignore cleanup errors
    }
    this.dsCallback = undefined;
    this.ds = undefined;
  }

  aboutToDisappear(): void {
    this.stopDisplaySync();
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      Canvas(this.ctx)
        .width(CANVAS_BOX_VP)
        .height(CANVAS_BOX_VP)
        .scale({ x: this.zoomScale, y: this.zoomScale })
        .opacity(this.contentOpacity)
        .onReady(() => {
          this.canvasReady = true;
          this.drawCanvasFrame(0.0, 0.0);
          this.startDisplaySync();
        })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.store.isDark ? '#070709' : '#F2EDE2')
    .opacity(this.bgOpacity)
    .onClick(() => {
      if (this.store.flutterReady && this.zoomStartMs === 0 && !this.finished) {
        this.skipRequested = true;
      }
    })
  }
}

import { image } from '@kit.ImageKit';

/**
 * 1:1 port of iOS _ThemeRevealPainter (main.dart:9240-9301):
 * Draws the previous theme snapshot over the new live theme with an expanding
 * evenOdd circular cutout centered on the theme toggle button.
 */
@ComponentV2
export struct ThemeRevealOverlay {
  @Param snapshot?: image.PixelMap = undefined;
  @Param centerX: number = 300;
  @Param centerY: number = 64;
  @Param maxRadius: number = 900;
  @Param isForward: boolean = true;
  @Param onCompleted: () => void = () => {};

  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);
  private timerId: number = -1;
  private startMs: number = 0;
  private readonly durationMs: number = 420;

  private easeSmoothOut(t: number): number {
    const inv = 1.0 - t;
    return 1.0 - inv * inv * inv;
  }

  aboutToAppear(): void {
    this.startMs = Date.now();
    this.timerId = setInterval(() => {
      const raw = Math.min(1.0, (Date.now() - this.startMs) / this.durationMs);
      const t = this.easeSmoothOut(raw);
      const progress = this.isForward ? t : 1.0 - t;
      this.drawFrame(progress);
      if (raw >= 1.0) {
        clearInterval(this.timerId);
        this.timerId = -1;
        this.onCompleted();
      }
    }, 12);
  }

  aboutToDisappear(): void {
    if (this.timerId !== -1) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
  }

  private drawFrame(progress: number): void {
    const snap = this.snapshot;
    if (!snap) {
      return;
    }
    const c = this.ctx;
    const w = c.width;
    const h = c.height;
    if (w <= 0 || h <= 0) {
      return;
    }
    c.clearRect(0, 0, w, h);
    const radius = Math.max(0.0, Math.min(this.maxRadius, progress * this.maxRadius));

    c.save();
    const clipPath = new Path2D();
    if (this.isForward) {
      clipPath.rect(0, 0, w, h);
      clipPath.arc(this.centerX, this.centerY, radius, 0, Math.PI * 2, false);
      c.clip(clipPath, 'evenodd');
    } else {
      clipPath.arc(this.centerX, this.centerY, radius, 0, Math.PI * 2, false);
      c.clip(clipPath);
    }
    c.drawImage(snap, 0, 0, w, h);
    c.restore();
  }

  build() {
    Canvas(this.ctx)
      .width('100%')
      .height('100%')
      .hitTestBehavior(HitTestMode.None)
      .onReady(() => {
        this.drawFrame(this.isForward ? 0.0 : 1.0);
      })
  }
}

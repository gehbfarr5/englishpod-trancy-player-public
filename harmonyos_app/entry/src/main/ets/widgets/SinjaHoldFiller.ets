/**
 * 1:1 port of iOS _SinjaHoldFillerPainter (main.dart:674-740):
 * Asymmetric sweep filler with 2vp overbleed at bounds and 1.5vp leading edge line
 * that smoothly dissolves from 95.5% -> 99.5%.
 */
@ComponentV2
export struct SinjaHoldFiller {
  @Param fillProgress: number = 0.0;    // 0.0 .. 1.0
  @Param confirmProgress: number = 0.0; // 0.0 .. 1.0
  @Param fillerBg: string = '#291ED760';
  @Param fillerEdge: string = '#8C1ED760';

  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);
  private ready: boolean = false;

  @Monitor('fillProgress', 'confirmProgress', 'fillerBg', 'fillerEdge')
  onValChanged(): void {
    if (this.ready) {
      this.drawFiller();
    }
  }

  private drawFiller(): void {
    const c = this.ctx;
    const w = c.width;
    const h = c.height;
    if (w <= 0 || h <= 0) {
      return;
    }
    c.clearRect(0, 0, w, h);

    const prog = Math.max(0.0, Math.min(1.0, this.fillProgress));
    if (prog <= 0.001) {
      return;
    }
    const conf = Math.max(0.0, Math.min(1.0, this.confirmProgress));
    const leftX = conf * w;
    const rightX = prog * w;
    if (rightX - leftX <= 0.1) {
      return;
    }

    const drawLeft = conf <= 0.001 ? -2.0 : leftX;
    const drawRight = prog >= 0.999 ? w + 2.0 : rightX;
    c.fillStyle = this.fillerBg;
    c.fillRect(drawLeft, -2.0, drawRight - drawLeft, h + 4.0);

    if (prog < 0.995) {
      const edgeFade = prog <= 0.955 ? 1.0 : Math.max(0.0, Math.min(1.0, (0.995 - prog) / 0.04));
      const edgeLeft = Math.max(drawLeft, rightX - 1.5);
      if (rightX > edgeLeft && edgeFade > 0.01) {
        c.save();
        c.globalAlpha = edgeFade;
        c.fillStyle = this.fillerEdge;
        c.fillRect(edgeLeft, -2.0, rightX - edgeLeft, h + 4.0);
        c.restore();
      }
    }
  }

  build() {
    Canvas(this.ctx)
      .width('100%')
      .height('100%')
      .hitTestBehavior(HitTestMode.None)
      .onReady(() => {
        this.ready = true;
        this.drawFiller();
      })
  }
}

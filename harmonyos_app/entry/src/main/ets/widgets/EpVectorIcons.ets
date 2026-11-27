export type EpIconKind =
  | 'play'
  | 'pause'
  | 'replay'
  | 'chunkyReplay'
  | 'chunkyPlay'
  | 'skipPrev'
  | 'skipNext'
  | 'fastRewind'
  | 'fastForward'
  | 'repeatOne'
  | 'repeat'
  | 'speed'
  | 'arrowBack'
  | 'chevronDown'
  | 'moon'
  | 'sun'
  | 'locate'
  | 'check'
  | 'playCircleFill'
  | 'harmonySpark';

/**
 * Pure Canvas-drawn vector icons matching iOS Material Rounded & custom Painters 1:1
 * (zero Unicode/Emoji UI placeholders).
 */
@ComponentV2
export struct EpVectorIcon {
  @Param kind: EpIconKind = 'play';
  @Param iconSize: number = 22;
  @Param iconColor: string = '#FFFFFF';
  @Param iconRotationDeg: number = 0;

  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);
  private canvasReady: boolean = false;
  private canvasW: number = 22;
  private canvasH: number = 22;

  @Monitor('kind', 'iconColor', 'iconSize')
  onPropsChanged(): void {
    if (this.canvasReady) {
      this.drawIcon();
    }
  }

  private drawIcon(): void {
    const c = this.ctx;
    const w = this.canvasW || this.iconSize;
    const h = this.canvasH || this.iconSize;
    c.clearRect(0, 0, w, h);
    c.save();
    c.scale(w / 24.0, h / 24.0);
    c.fillStyle = this.iconColor;
    c.strokeStyle = this.iconColor;
    c.lineCap = 'round';
    c.lineJoin = 'round';

    switch (this.kind) {
      case 'play': {
        c.beginPath();
        c.moveTo(8.0, 5.5);
        c.lineTo(8.0, 18.5);
        c.lineTo(18.5, 12.0);
        c.closePath();
        c.lineWidth = 2.0;
        c.fill();
        c.stroke();
        break;
      }
      case 'chunkyPlay': {
        // 1:1 _ChunkyPlayTrianglePainter (main.dart:434-472)
        c.beginPath();
        c.moveTo(7.4, 5.5);
        c.lineTo(7.4, 18.5);
        c.lineTo(18.2, 12.0);
        c.closePath();
        c.lineWidth = 2.6;
        c.fill();
        c.stroke();
        break;
      }
      case 'pause': {
        this.fillRoundRect(c, 6.2, 5.2, 4.2, 13.6, 1.8);
        this.fillRoundRect(c, 13.6, 5.2, 4.2, 13.6, 1.8);
        break;
      }
      case 'replay':
      case 'chunkyReplay': {
        // 1:1 _ChunkyReplayIconPainter (main.dart:378-430)
        c.beginPath();
        c.arc(12.0, 12.0, 6.75, -Math.PI / 2, -Math.PI / 2 + 1.62 * Math.PI, false);
        c.lineWidth = 2.85;
        c.stroke();
        c.beginPath();
        c.moveTo(12.4, 1.8);
        c.lineTo(7.6, 5.25);
        c.lineTo(12.4, 8.7);
        c.closePath();
        c.lineWidth = 1.6;
        c.fill();
        c.stroke();
        break;
      }
      case 'skipPrev': {
        this.fillRoundRect(c, 5.8, 6.2, 2.5, 11.6, 1.2);
        c.beginPath();
        c.moveTo(17.5, 6.4);
        c.lineTo(17.5, 17.6);
        c.lineTo(9.8, 12.0);
        c.closePath();
        c.lineWidth = 1.8;
        c.fill();
        c.stroke();
        break;
      }
      case 'skipNext': {
        c.beginPath();
        c.moveTo(6.5, 6.4);
        c.lineTo(6.5, 17.6);
        c.lineTo(14.2, 12.0);
        c.closePath();
        c.lineWidth = 1.8;
        c.fill();
        c.stroke();
        this.fillRoundRect(c, 15.7, 6.2, 2.5, 11.6, 1.2);
        break;
      }
      case 'fastRewind': {
        c.beginPath();
        c.moveTo(11.6, 6.8);
        c.lineTo(11.6, 17.2);
        c.lineTo(4.2, 12.0);
        c.closePath();
        c.lineWidth = 1.6;
        c.fill();
        c.stroke();
        c.beginPath();
        c.moveTo(19.6, 6.8);
        c.lineTo(19.6, 17.2);
        c.lineTo(12.2, 12.0);
        c.closePath();
        c.fill();
        c.stroke();
        break;
      }
      case 'fastForward': {
        c.beginPath();
        c.moveTo(4.4, 6.8);
        c.lineTo(4.4, 17.2);
        c.lineTo(11.8, 12.0);
        c.closePath();
        c.lineWidth = 1.6;
        c.fill();
        c.stroke();
        c.beginPath();
        c.moveTo(12.4, 6.8);
        c.lineTo(12.4, 17.2);
        c.lineTo(19.8, 12.0);
        c.closePath();
        c.fill();
        c.stroke();
        break;
      }
      case 'repeat': {
        c.lineWidth = 2.1;
        c.beginPath();
        c.moveTo(5.0, 9.5);
        c.lineTo(5.0, 8.2);
        c.quadraticCurveTo(5.0, 6.5, 6.8, 6.5);
        c.lineTo(17.5, 6.5);
        c.stroke();
        c.beginPath();
        c.moveTo(15.2, 4.2);
        c.lineTo(18.5, 6.5);
        c.lineTo(15.2, 8.8);
        c.closePath();
        c.fill();

        c.beginPath();
        c.moveTo(19.0, 14.5);
        c.lineTo(19.0, 15.8);
        c.quadraticCurveTo(19.0, 17.5, 17.2, 17.5);
        c.lineTo(6.5, 17.5);
        c.stroke();
        c.beginPath();
        c.moveTo(8.8, 15.2);
        c.lineTo(5.5, 17.5);
        c.lineTo(8.8, 19.8);
        c.closePath();
        c.fill();
        break;
      }
      case 'repeatOne': {
        c.lineWidth = 2.1;
        c.beginPath();
        c.moveTo(5.0, 9.5);
        c.lineTo(5.0, 8.2);
        c.quadraticCurveTo(5.0, 6.5, 6.8, 6.5);
        c.lineTo(17.5, 6.5);
        c.stroke();
        c.beginPath();
        c.moveTo(15.2, 4.2);
        c.lineTo(18.5, 6.5);
        c.lineTo(15.2, 8.8);
        c.closePath();
        c.fill();

        c.beginPath();
        c.moveTo(19.0, 14.5);
        c.lineTo(19.0, 15.8);
        c.quadraticCurveTo(19.0, 17.5, 17.2, 17.5);
        c.lineTo(6.5, 17.5);
        c.stroke();
        c.beginPath();
        c.moveTo(8.8, 15.2);
        c.lineTo(5.5, 17.5);
        c.lineTo(8.8, 19.8);
        c.closePath();
        c.fill();

        // Crisp "1" in center
        c.lineWidth = 2.0;
        c.beginPath();
        c.moveTo(10.8, 10.1);
        c.lineTo(12.2, 9.1);
        c.lineTo(12.2, 14.8);
        c.stroke();
        break;
      }
      case 'speed': {
        c.lineWidth = 2.1;
        c.beginPath();
        c.arc(12.0, 13.2, 7.6, Math.PI * 0.88, Math.PI * 2.12, false);
        c.stroke();
        c.beginPath();
        c.moveTo(12.0, 13.5);
        c.lineTo(16.0, 9.2);
        c.lineWidth = 2.2;
        c.stroke();
        c.beginPath();
        c.arc(12.0, 13.6, 1.5, 0, Math.PI * 2, false);
        c.fill();
        break;
      }
      case 'arrowBack': {
        c.lineWidth = 2.4;
        c.beginPath();
        c.moveTo(19.0, 12.0);
        c.lineTo(5.5, 12.0);
        c.stroke();
        c.beginPath();
        c.moveTo(11.2, 6.2);
        c.lineTo(5.2, 12.0);
        c.lineTo(11.2, 17.8);
        c.stroke();
        break;
      }
      case 'chevronDown': {
        c.lineWidth = 2.4;
        c.beginPath();
        c.moveTo(6.5, 9.2);
        c.lineTo(12.0, 14.8);
        c.lineTo(17.5, 9.2);
        c.stroke();
        break;
      }
      case 'moon': {
        c.beginPath();
        c.moveTo(15.2, 4.4);
        c.bezierCurveTo(10.8, 5.2, 8.2, 9.3, 9.0, 13.7);
        c.bezierCurveTo(9.8, 17.6, 13.2, 20.1, 17.0, 19.6);
        c.bezierCurveTo(13.5, 21.3, 8.8, 20.4, 6.4, 16.9);
        c.bezierCurveTo(3.8, 13.1, 4.9, 7.8, 8.9, 5.4);
        c.bezierCurveTo(10.8, 4.2, 13.1, 3.9, 15.2, 4.4);
        c.closePath();
        c.fill();
        break;
      }
      case 'sun': {
        c.beginPath();
        c.arc(12.0, 12.0, 4.4, 0, Math.PI * 2, false);
        c.fill();
        c.lineWidth = 2.0;
        for (let k = 0; k < 8; k++) {
          const ang = (k * Math.PI) / 4;
          c.beginPath();
          c.moveTo(12.0 + Math.cos(ang) * 6.8, 12.0 + Math.sin(ang) * 6.8);
          c.lineTo(12.0 + Math.cos(ang) * 9.2, 12.0 + Math.sin(ang) * 9.2);
          c.stroke();
        }
        break;
      }
      case 'locate': {
        c.lineWidth = 2.0;
        c.beginPath();
        c.arc(12.0, 12.0, 5.8, 0, Math.PI * 2, false);
        c.stroke();
        c.beginPath();
        c.arc(12.0, 12.0, 2.3, 0, Math.PI * 2, false);
        c.fill();
        for (let k = 0; k < 4; k++) {
          const ang = (k * Math.PI) / 2;
          c.beginPath();
          c.moveTo(12.0 + Math.cos(ang) * 6.2, 12.0 + Math.sin(ang) * 6.2);
          c.lineTo(12.0 + Math.cos(ang) * 9.5, 12.0 + Math.sin(ang) * 9.5);
          c.stroke();
        }
        break;
      }
      case 'check': {
        c.lineWidth = 2.6;
        c.beginPath();
        c.moveTo(5.2, 12.4);
        c.lineTo(10.0, 17.0);
        c.lineTo(18.8, 7.4);
        c.stroke();
        break;
      }
      case 'playCircleFill': {
        c.beginPath();
        c.arc(12.0, 12.0, 9.2, 0, Math.PI * 2, false);
        c.fill();
        c.globalCompositeOperation = 'destination-out';
        c.beginPath();
        c.moveTo(9.8, 7.8);
        c.lineTo(9.8, 16.2);
        c.lineTo(16.6, 12.0);
        c.closePath();
        c.fill();
        c.globalCompositeOperation = 'source-over';
        break;
      }
      case 'harmonySpark': {
        c.lineWidth = 2.0;
        c.beginPath();
        c.moveTo(12.0, 3.6);
        c.quadraticCurveTo(12.4, 11.6, 20.4, 12.0);
        c.quadraticCurveTo(12.4, 12.4, 12.0, 20.4);
        c.quadraticCurveTo(11.6, 12.4, 3.6, 12.0);
        c.quadraticCurveTo(11.6, 11.6, 12.0, 3.6);
        c.closePath();
        c.fill();
        break;
      }
    }

    c.restore();
  }

  private fillRoundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
    c.fill();
  }

  build() {
    Canvas(this.ctx)
      .width(this.iconSize)
      .height(this.iconSize)
      .rotate({ angle: this.iconRotationDeg })
      .onReady(() => {
        this.canvasReady = true;
        this.canvasW = this.ctx.width;
        this.canvasH = this.ctx.height;
        this.drawIcon();
      })
  }
}

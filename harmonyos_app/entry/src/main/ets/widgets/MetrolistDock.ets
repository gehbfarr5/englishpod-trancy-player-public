import { HapticEngine } from '@englishpod/ep_design';
import { PlayerStore } from '../state/PlayerStore';
import { EpVectorIcon } from './EpVectorIcons';
import { HoldToReplayHeroButton } from './HoldToReplayHeroButton';

function formatClock(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Custom Metrolist Scrubber with 7vp track height and 4x18vp vertical pill thumb
 * outlined in bottomBg (1:1 port of _MetrolistVerticalThumbShape, main.dart:214-259).
 */
@ComponentV2
struct MetrolistScrubber {
  @Param store: PlayerStore = PlayerStore.getInstance();
  @Local draggingRatio: number = -1;
  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);
  private ready: boolean = false;
  private canvasW: number = 320;

  @Monitor('store.currentPositionSec', 'store.durationSec', 'store.palette', 'draggingRatio')
  onValChanged(): void {
    if (this.ready) {
      this.drawScrubber();
    }
  }

  private drawScrubber(): void {
    const c = this.ctx;
    const w = c.width;
    const h = c.height;
    if (w <= 0 || h <= 0) return;
    this.canvasW = w;
    c.clearRect(0, 0, w, h);

    const ratio =
      this.draggingRatio >= 0
        ? this.draggingRatio
        : (this.store.durationSec > 0
          ? Math.max(0.0, Math.min(1.0, this.store.currentPositionSec / this.store.durationSec))
          : 0.0);

    const trackH = 7.0;
    const trackY = (h - trackH) / 2.0;
    const padX = 4.0;
    const usableW = Math.max(10.0, w - padX * 2);
    const thumbX = padX + ratio * usableW;

    // Inactive track
    c.fillStyle = this.store.palette.surface2;
    this.fillPill(c, padX, trackY, usableW, trackH, trackH / 2);

    // Active track
    if (thumbX > padX) {
      c.fillStyle = this.store.palette.accent;
      this.fillPill(c, padX, trackY, thumbX - padX, trackH, trackH / 2);
    }

    // Vertical pill cutout border
    c.fillStyle = this.store.palette.bottomBg;
    this.fillPill(c, thumbX - 4.0, h / 2.0 - 11.0, 8.0, 22.0, 4.0);

    // Vertical pill thumb (4 x 18 vp)
    c.fillStyle = this.store.palette.accent;
    this.fillPill(c, thumbX - 2.0, h / 2.0 - 9.0, 4.0, 18.0, 2.0);
  }

  private fillPill(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rad = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rad, y);
    c.lineTo(x + w - rad, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rad);
    c.lineTo(x + w, y + h - rad);
    c.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    c.lineTo(x + rad, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rad);
    c.lineTo(x, y + rad);
    c.quadraticCurveTo(x, y, x + rad, y);
    c.closePath();
    c.fill();
  }

  private ratioFromX(x: number): number {
    const padX = 4.0;
    const usableW = Math.max(10.0, this.canvasW - padX * 2);
    return Math.max(0.0, Math.min(1.0, (x - padX) / usableW));
  }

  build() {
    Canvas(this.ctx)
      .width('100%')
      .height(22)
      .onReady(() => {
        this.ready = true;
        this.drawScrubber();
      })
      .onTouch((event: TouchEvent) => {
        const t = event.touches[0];
        if (!t) return;
        if (event.type === TouchType.Down || event.type === TouchType.Move) {
          this.draggingRatio = this.ratioFromX(t.x);
        } else if (event.type === TouchType.Up) {
          const targetRatio = this.draggingRatio >= 0 ? this.draggingRatio : this.ratioFromX(t.x);
          this.draggingRatio = -1;
          this.store.seekTo(targetRatio * this.store.durationSec);
        } else if (event.type === TouchType.Cancel) {
          this.draggingRatio = -1;
        }
      })
  }
}

/**
 * 1:1 port of iOS _buildMetrolistBottomDock (main.dart:8794-9133):
 * - Row 1: Metrolist Scrubber + Timestamps
 * - Row 2: Prev Sentence (58x58) | Giant HoldToReplayHeroButton (60vp) | Next Sentence (58x58)
 * - Row 3: 5-button Segmented Utility Bar (Prev Ep, Next Ep, Sentence Loop, Repeat Ep, Speed)
 */
@ComponentV2
export struct MetrolistDock {
  @Param store: PlayerStore = PlayerStore.getInstance();
  @Param isLandscapeConsole: boolean = false;

  private isCustomSpeed(): boolean {
    return Math.abs(this.store.playbackSpeed - 1.0) > 0.01;
  }

  private formatSpeedBadge(): string {
    const s = this.store.playbackSpeed;
    return `${s.toFixed(2).replace(/0$/, '').replace(/\.$/, '.0')}x`;
  }

  @Builder
  SegmentedBtn(
    icon: 'fastRewind' | 'fastForward' | 'repeatOne' | 'repeat' | 'speed',
    active: boolean,
    radii: BorderRadiuses,
    badge: string,
    btnId: string,
    action: () => void
  ) {
    Row({ space: 3 }) {
      EpVectorIcon({
        kind: icon,
        iconSize: badge.length > 0 ? 16 : 20,
        iconColor: active ? this.store.palette.accent : this.store.palette.textPassed
      })
      if (badge.length > 0) {
        Text(badge)
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.store.palette.accent)
          .maxLines(1)
      }
    }
    .id(btnId)
    .layoutWeight(1)
    .height(this.isLandscapeConsole ? 36 : 38)
    .justifyContent(FlexAlign.Center)
    .backgroundColor(active ? this.store.palette.accentSoft : this.store.palette.metroBtnBg)
    .borderRadius(radii)
    .border({
      width: 1,
      color: active ? this.store.palette.accent : this.store.palette.metroOutline
    })
    .animation({ duration: 220, curve: Curve.FastOutSlowIn })
    .onClick(() => {
      HapticEngine.pulseTick();
      action();
    })
  }

  build() {
    Column({ space: 0 }) {
      // Row 1: Metrolist Scrubber + Timestamps
      Column({ space: 2 }) {
        MetrolistScrubber({ store: this.store })
        Row() {
          Text(formatClock(this.store.currentPositionSec))
            .fontSize(11)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.store.palette.textPassed)
          Blank()
          Text(formatClock(this.store.durationSec))
            .fontSize(11)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.store.palette.textPassed)
        }
        .width('100%')
      }
      .width('100%')

      // Row 2: Hero Transport Row
      Row({ space: this.isLandscapeConsole ? 10 : 14 }) {
        Stack({ alignContent: Alignment.Center }) {
          EpVectorIcon({
            kind: 'skipPrev',
            iconSize: this.isLandscapeConsole ? 24 : 28,
            iconColor: this.store.palette.textPrimary
          })
        }
        .width(this.isLandscapeConsole ? 48 : 58)
        .height(this.isLandscapeConsole ? 48 : 58)
        .backgroundColor(this.store.palette.surface2)
        .borderRadius(9999)
        .border({ width: 1, color: this.store.palette.border })
        .onClick(() => this.store.stepSegment(-1))

        Column() {
          HoldToReplayHeroButton({
            palette: this.store.palette,
            isPlaying: this.store.isPlaying,
            isEnded: this.store.isEnded,
            isLoading: this.store.isAudioLoading,
            buttonHeight: this.isLandscapeConsole ? 52 : 60,
            onTap: () => void this.store.togglePlayPause(),
            onConfirmReplay: () => void this.store.restartCurrentTrackFromBeginning()
          })
        }
        .layoutWeight(1)

        Stack({ alignContent: Alignment.Center }) {
          EpVectorIcon({
            kind: 'skipNext',
            iconSize: this.isLandscapeConsole ? 24 : 28,
            iconColor: this.store.palette.textPrimary
          })
        }
        .width(this.isLandscapeConsole ? 48 : 58)
        .height(this.isLandscapeConsole ? 48 : 58)
        .backgroundColor(this.store.palette.surface2)
        .borderRadius(9999)
        .border({ width: 1, color: this.store.palette.border })
        .onClick(() => this.store.stepSegment(1))
      }
      .width('100%')
      .margin({ top: this.isLandscapeConsole ? 8 : 10, bottom: this.isLandscapeConsole ? 10 : 12 })

      // Row 3: Metrolist 5-Segment Utility Bar
      Row({ space: 5 }) {
        this.SegmentedBtn(
          'fastRewind',
          false,
          { topLeft: 20, bottomLeft: 20, topRight: 6, bottomRight: 6 },
          '',
          'ep_prev_ep_btn',
          () => void this.store.manualPrevEpisode()
        )
        this.SegmentedBtn(
          'fastForward',
          false,
          { topLeft: 6, bottomLeft: 6, topRight: 6, bottomRight: 6 },
          '',
          'ep_next_ep_btn',
          () => void this.store.manualNextEpisode()
        )
        this.SegmentedBtn(
          'repeatOne',
          this.store.singleSentenceLoop,
          {
            topLeft: this.store.singleSentenceLoop ? 14 : 6,
            bottomLeft: this.store.singleSentenceLoop ? 14 : 6,
            topRight: this.store.singleSentenceLoop ? 14 : 6,
            bottomRight: this.store.singleSentenceLoop ? 14 : 6
          },
          '',
          'ep_loop_one_btn',
          () => this.store.toggleSingleSentenceLoop()
        )
        this.SegmentedBtn(
          'repeat',
          this.store.repeatCurrentEpisode,
          {
            topLeft: this.store.repeatCurrentEpisode ? 14 : 6,
            bottomLeft: this.store.repeatCurrentEpisode ? 14 : 6,
            topRight: this.store.repeatCurrentEpisode ? 14 : 6,
            bottomRight: this.store.repeatCurrentEpisode ? 14 : 6
          },
          '',
          'ep_repeat_ep_btn',
          () => this.store.toggleRepeatEpisode()
        )
        this.SegmentedBtn(
          'speed',
          this.isCustomSpeed(),
          {
            topLeft: this.isCustomSpeed() ? 14 : 6,
            bottomLeft: this.isCustomSpeed() ? 14 : 6,
            topRight: 20,
            bottomRight: 20
          },
          this.isCustomSpeed() ? this.formatSpeedBadge() : '',
          'ep_speed_btn',
          () => {
            this.store.speedSheetOpen = true;
          }
        )
      }
      .width('100%')
    }
    .width('100%')
    .padding(
      this.isLandscapeConsole
        ? { left: 0, right: 0, top: 4, bottom: 0 }
        : { left: 20, right: 20, top: 10, bottom: Math.max(14, this.store.bottomSafeInsetVp) }
    )
    .backgroundColor(this.isLandscapeConsole ? Color.Transparent : this.store.palette.bottomBg)
    .border(this.isLandscapeConsole ? { width: 0 } : { width: { top: 1 }, color: this.store.palette.deckBorder })
  }
}

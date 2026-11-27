import { AppPalette, DARK_PALETTE, HapticEngine } from '@englishpod/ep_design';
import { EpVectorIcon } from './EpVectorIcons';
import { KobraStaggeredPhrase } from './KobraStaggeredText';
import { SinjaHoldFiller } from './SinjaHoldFiller';

enum HoldStage {
  IDLE = 0,
  PENDING_TAP = 1,
  IN_PROGRESS = 2,
  COMPLETE = 3,
  CONFIRMING = 4
}

/**
 * 1:1 port of iOS _HoldToReplayHeroButton (main.dart:1112-1709):
 * - 60vp height squircle (radius 18vp playing / 30vp paused)
 * - Short tap (<150ms): Play / Pause / Replay toggle
 * - Long hold (>150ms): 900ms Sinja sweep fill + Kobra 3D flip ("Hold to replay" -> "Release to replay")
 *   + 360deg CCW chunky replay icon spin & medium haptic at 100% (zero haptic on release!)
 */
@ComponentV2
export struct HoldToReplayHeroButton {
  @Param palette: AppPalette = DARK_PALETTE;
  @Param isPlaying: boolean = false;
  @Param isEnded: boolean = false;
  @Param isLoading: boolean = false;
  @Param buttonHeight: number = 60;
  @Param onTap: () => void = () => {};
  @Param onConfirmReplay: () => void = () => {};

  @Local stage: HoldStage = HoldStage.IDLE;
  @Local isPressing: boolean = false;
  @Local fillProgress: number = 0.0;
  @Local confirmProgress: number = 0.0;
  @Local holdEntryEpoch: number = 0;
  @Local iconRotationDeg: number = 0;

  private tapThresholdTimer: number = -1;
  private animTimer: number = -1;
  private fillStartMs: number = 0;
  private downX: number = 0;
  private downY: number = 0;
  private btnWidth: number = 220;
  private btnHeight: number = 60;

  aboutToDisappear(): void {
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.tapThresholdTimer !== -1) {
      clearTimeout(this.tapThresholdTimer);
      this.tapThresholdTimer = -1;
    }
    if (this.animTimer !== -1) {
      clearInterval(this.animTimer);
      this.animTimer = -1;
    }
  }

  private startHoldCountdown(): void {
    if (this.stage !== HoldStage.PENDING_TAP) {
      return;
    }
    this.stage = HoldStage.IN_PROGRESS;
    this.holdEntryEpoch++;
    this.confirmProgress = 0.0;
    this.iconRotationDeg = 0;
    this.fillStartMs = Date.now();

    if (this.animTimer !== -1) {
      clearInterval(this.animTimer);
    }
    this.animTimer = setInterval(() => {
      if (this.stage !== HoldStage.IN_PROGRESS) {
        clearInterval(this.animTimer);
        this.animTimer = -1;
        return;
      }
      const next = Math.min(1.0, (Date.now() - this.fillStartMs) / 900.0);
      this.fillProgress = next;
      if (next >= 1.0) {
        clearInterval(this.animTimer);
        this.animTimer = -1;
        this.onHoldReachedComplete();
      }
    }, 12);
  }

  private onHoldReachedComplete(): void {
    if (this.stage !== HoldStage.IN_PROGRESS) {
      return;
    }
    HapticEngine.pulseConfirm();
    this.stage = HoldStage.COMPLETE;
    this.iconRotationDeg = -360;
  }

  private cancelHold(): void {
    this.clearTimers();
    this.isPressing = false;
    this.stage = HoldStage.IDLE;
    const startVal = this.fillProgress;
    if (startVal <= 0.001) {
      this.fillProgress = 0.0;
      return;
    }
    const retractStart = Date.now();
    this.animTimer = setInterval(() => {
      const t = Math.min(1.0, (Date.now() - retractStart) / 220.0);
      this.fillProgress = startVal * (1.0 - t);
      if (t >= 1.0) {
        clearInterval(this.animTimer);
        this.animTimer = -1;
        this.fillProgress = 0.0;
      }
    }, 12);
  }

  private confirmHold(): void {
    this.clearTimers();
    this.stage = HoldStage.CONFIRMING;
    this.isPressing = false;
    this.onConfirmReplay();

    const sweepStart = Date.now();
    this.animTimer = setInterval(() => {
      const t = Math.min(1.0, (Date.now() - sweepStart) / 260.0);
      this.confirmProgress = t;
      if (t >= 1.0) {
        clearInterval(this.animTimer);
        this.animTimer = -1;
        this.fillProgress = 0.0;
        this.confirmProgress = 0.0;
        this.iconRotationDeg = 0;
        this.stage = HoldStage.IDLE;
      }
    }, 12);
  }

  private showingHoldContent(): boolean {
    return this.stage === HoldStage.IN_PROGRESS || this.stage === HoldStage.COMPLETE;
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      SinjaHoldFiller({
        fillProgress: this.fillProgress,
        confirmProgress: this.confirmProgress,
        fillerBg: this.palette.isDark ? '#38060608' : '#33141413',
        fillerEdge: this.palette.isDark ? '#61060608' : '#52141413'
      })

      if (this.showingHoldContent()) {
        Row({ space: 8 }) {
          EpVectorIcon({
            kind: 'chunkyReplay',
            iconSize: 21,
            iconColor: this.palette.accentFg,
            iconRotationDeg: this.iconRotationDeg
          })
            .animation({ duration: 420, curve: Curve.FastOutSlowIn })

          KobraStaggeredPhrase({
            prefixWord: this.stage === HoldStage.COMPLETE ? 'Release' : 'Hold',
            middleWord: 'to',
            actionWord: 'replay',
            entryEpoch: this.holdEntryEpoch,
            fontSize: 14.5,
            fontColor: this.palette.accentFg,
            fontWeight: FontWeight.Bold,
            wordGap: 4.5
          })
        }
        .padding({ left: 10, right: 10 })
      } else {
        Row({ space: 8 }) {
          if (this.isLoading) {
            LoadingProgress()
              .width(26)
              .height(26)
              .color(this.palette.accentFg)
          } else {
            EpVectorIcon({
              kind: this.isEnded ? 'replay' : (this.isPlaying ? 'pause' : 'play'),
              iconSize: 26,
              iconColor: this.palette.accentFg
            })
          }

          Text(this.isEnded ? 'Replay' : (this.isPlaying ? 'Pause' : 'Play'))
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.palette.accentFg)
        }
      }
    }
    .width('100%')
    .height(this.buttonHeight)
    .backgroundColor(this.palette.accent)
    .borderRadius(this.isPlaying ? 18 : 30)
    .clip(true)
    .shadow({
      radius: this.isPlaying ? 20 : 14,
      color: this.palette.accentSoft,
      offsetX: 0,
      offsetY: 5
    })
    .scale({ x: this.isPressing ? 0.975 : 1.0, y: this.isPressing ? 0.975 : 1.0 })
    .animation({ duration: 240, curve: Curve.FastOutSlowIn })
    .onAreaChange((_, newArea) => {
      this.btnWidth = Number(newArea.width);
      this.btnHeight = Number(newArea.height);
    })
    .onTouch((event: TouchEvent) => {
      const t = event.touches[0];
      if (!t) return;
      if (event.type === TouchType.Down) {
        if (this.tapThresholdTimer !== -1) clearTimeout(this.tapThresholdTimer);
        this.isPressing = true;
        this.stage = HoldStage.PENDING_TAP;
        this.downX = t.x;
        this.downY = t.y;
        this.tapThresholdTimer = setTimeout(() => {
          this.tapThresholdTimer = -1;
          this.startHoldCountdown();
        }, 150);
      } else if (event.type === TouchType.Move) {
        const inside = t.x >= 0 && t.x <= this.btnWidth && t.y >= 0 && t.y <= this.btnHeight;
        if (!inside || (this.stage === HoldStage.PENDING_TAP && Math.hypot(t.x - this.downX, t.y - this.downY) > 12)) {
          this.cancelHold();
        }
      } else if (event.type === TouchType.Up) {
        if (this.stage === HoldStage.PENDING_TAP) {
          this.clearTimers();
          this.isPressing = false;
          this.stage = HoldStage.IDLE;
          HapticEngine.pulseTick();
          this.onTap();
        } else if (this.stage === HoldStage.IN_PROGRESS) {
          this.cancelHold();
        } else if (this.stage === HoldStage.COMPLETE) {
          this.confirmHold();
        } else {
          this.isPressing = false;
        }
      } else if (event.type === TouchType.Cancel) {
        this.cancelHold();
      }
    })
  }
}

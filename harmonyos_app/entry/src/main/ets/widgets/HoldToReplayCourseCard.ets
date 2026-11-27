import { AppPalette, DARK_PALETTE, HapticEngine } from '@englishpod/ep_design';
import { LessonSummary } from '@englishpod/ep_domain';
import { EpVectorIcon } from './EpVectorIcons';
import { KobraStaggeredPhrase } from './KobraStaggeredText';
import { SinjaHoldFiller } from './SinjaHoldFiller';

enum CardHoldStage {
  IDLE = 0,
  PENDING_TAP = 1,
  IN_PROGRESS = 2,
  COMPLETE = 3
}

/**
 * 1:1 port of iOS _HoldToReplayCourseCard (main.dart:1720-2467):
 * - Stride 88vp (79vp body + 9vp bottom margin)
 * - Left 36x36 badge: '01'/'✓' <-> 3D flip to ChunkyReplayIcon / ChunkyPlayTriangle
 * - Center: Title (14.5fp bold) + Subtitle '${level} · ${code}' + LinearProgressIndicator (3.5vp)
 * - Right Status Pill: 'New' / 'Resume X%' / 'Done 100%' / 'Replay X%' <-> 'Hold/Release to replay/start'
 */
@ComponentV2
export struct HoldToReplayCourseCard {
  @Param item: LessonSummary = {
    lessonNumber: 1,
    lessonId: '0001',
    code: 'B0001',
    level: 'Elementary',
    title: '',
    dgCount: 0,
    pbCount: 0,
    vocabCount: 0,
    audio: {}
  };
  @Param palette: AppPalette = DARK_PALETTE;
  @Param isDone: boolean = false;
  @Param isCurrent: boolean = false;
  @Param highlightStatusPill: boolean = false;
  @Param statusLabel: string = 'New';
  @Param displayBarValue: number = 0.0;
  @Param onTap: () => void = () => {};
  @Param onConfirmReplay: () => void = () => {};

  @Local stage: CardHoldStage = CardHoldStage.IDLE;
  @Local fillProgress: number = 0.0;
  @Local holdEntryEpoch: number = 0;
  @Local iconRotationDeg: number = 0;
  @Local holdPlayedSnapshot: boolean = false;

  private tapThresholdTimer: number = -1;
  private animTimer: number = -1;
  private fillStartMs: number = 0;
  private downX: number = 0;
  private downY: number = 0;
  private cardW: number = 360;
  private cardH: number = 79;

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

  private isCurrentlyPlayed(): boolean {
    return this.isDone || this.displayBarValue > 0.001;
  }

  private showingHold(): boolean {
    return this.stage === CardHoldStage.IN_PROGRESS || this.stage === CardHoldStage.COMPLETE;
  }

  private startHoldCountdown(): void {
    if (this.stage !== CardHoldStage.PENDING_TAP) {
      return;
    }
    this.holdPlayedSnapshot = this.isCurrentlyPlayed();
    this.stage = CardHoldStage.IN_PROGRESS;
    this.holdEntryEpoch++;
    this.iconRotationDeg = 0;
    this.fillStartMs = Date.now();
    this.animTimer = setInterval(() => {
      if (this.stage !== CardHoldStage.IN_PROGRESS) {
        clearInterval(this.animTimer);
        this.animTimer = -1;
        return;
      }
      const next = Math.min(1.0, (Date.now() - this.fillStartMs) / 900.0);
      this.fillProgress = next;
      if (next >= 1.0) {
        clearInterval(this.animTimer);
        this.animTimer = -1;
        HapticEngine.pulseConfirm();
        this.stage = CardHoldStage.COMPLETE;
        this.iconRotationDeg = this.holdPlayedSnapshot ? -360 : 0;
      }
    }, 12);
  }

  private cancelHold(): void {
    this.clearTimers();
    this.stage = CardHoldStage.IDLE;
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
    this.fillProgress = 0.0;
    this.iconRotationDeg = 0;
    this.stage = CardHoldStage.IDLE;
    this.onConfirmReplay();
  }

  build() {
    Column() {
      Stack({ alignContent: Alignment.Center }) {
        SinjaHoldFiller({
          fillProgress: this.fillProgress,
          confirmProgress: 0.0,
          fillerBg: this.stage === CardHoldStage.COMPLETE ? '#3D1ED760' : this.palette.accentSoft,
          fillerEdge: this.palette.accent
        })

        Row({ space: 12 }) {
          // Left 36x36 Index Squircle
          Stack({ alignContent: Alignment.Center }) {
            if (this.showingHold()) {
              EpVectorIcon({
                kind: this.holdPlayedSnapshot ? 'chunkyReplay' : 'chunkyPlay',
                iconSize: this.holdPlayedSnapshot ? 17.5 : 16.5,
                iconColor: this.stage === CardHoldStage.COMPLETE ? this.palette.accentFg : this.palette.accent,
                iconRotationDeg: this.iconRotationDeg
              })
                .animation({ duration: 420, curve: Curve.FastOutSlowIn })
            } else {
              Text(this.isDone ? '✓' : String(this.item.lessonNumber).padStart(2, '0'))
                .fontSize(this.item.lessonNumber >= 100 ? 11.5 : 13)
                .fontWeight(FontWeight.Bold)
                .fontColor(
                  this.isDone || this.isCurrent
                    ? this.palette.accent
                    : this.palette.textPassed
                )
            }
          }
          .width(36)
          .height(36)
          .backgroundColor(
            this.stage === CardHoldStage.COMPLETE
              ? this.palette.accent
              : (this.showingHold() || this.isDone || this.isCurrent
                ? this.palette.accentSoft
                : this.palette.surface2)
          )
          .borderRadius(this.isCurrent ? 12 : 10)
          .animation({ duration: 220, curve: Curve.FastOutSlowIn })

          // Center Content + Right Status Pill
          Column({ space: 0 }) {
            Text(this.item.title)
              .fontSize(14.5)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.palette.textPrimary)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .width('100%')

            Row() {
              Text(`${this.item.level} · ${this.item.code}`)
                .fontSize(11)
                .fontWeight(FontWeight.Regular)
                .fontColor(this.palette.textPassed)
                .maxLines(1)
                .layoutWeight(1)

              // Right Status Pill
              Stack({ alignContent: Alignment.Center }) {
                if (this.showingHold()) {
                  KobraStaggeredPhrase({
                    prefixWord: this.stage === CardHoldStage.COMPLETE ? 'Release' : 'Hold',
                    middleWord: 'to',
                    actionWord: this.holdPlayedSnapshot ? 'replay' : 'start',
                    entryEpoch: this.holdEntryEpoch,
                    fontSize: 10,
                    fontColor: this.stage === CardHoldStage.COMPLETE ? this.palette.accentFg : this.palette.accent,
                    fontWeight: FontWeight.Bold,
                    wordGap: 3.5
                  })
                } else {
                  Text(this.statusLabel)
                    .fontSize(10)
                    .fontWeight(FontWeight.Bold)
                    .fontColor(this.highlightStatusPill ? this.palette.accent : this.palette.textPassed)
                }
              }
              .padding({ left: 7, right: 7, top: 2, bottom: 2 })
              .backgroundColor(
                this.stage === CardHoldStage.COMPLETE
                  ? this.palette.accent
                  : (this.showingHold() || this.highlightStatusPill
                    ? this.palette.accentSoft
                    : this.palette.surface2)
              )
              .borderRadius(9999)
              .animation({ duration: 220, curve: Curve.FastOutSlowIn })
            }
            .width('100%')
            .margin({ top: 3, bottom: 6 })

            Stack({ alignContent: Alignment.Start }) {
              Row()
                .width('100%')
                .height(3.5)
                .backgroundColor(this.palette.surface2)
                .borderRadius(9999)
              Row()
                .width(`${Math.round(Math.max(0.0, Math.min(1.0, this.displayBarValue)) * 100)}%`)
                .height(3.5)
                .backgroundColor(this.palette.accent)
                .borderRadius(9999)
            }
            .width('100%')
            .height(3.5)
            .clip(true)
            .borderRadius(9999)
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%')
        .padding({ left: 14, right: 14, top: 11, bottom: 11 })
      }
      .width('100%')
      .height(79)
      .backgroundColor(this.palette.surface1)
      .borderRadius(this.isCurrent ? 18 : 15)
      .border({
        width: 1,
        color: this.isCurrent || this.showingHold() ? this.palette.accent : this.palette.border
      })
      .clip(true)
      .shadow(
        this.stage === CardHoldStage.COMPLETE
          ? { radius: 16, color: this.palette.accentSoft, offsetX: 0, offsetY: 4 }
          : { radius: 0, color: Color.Transparent }
      )
      .onAreaChange((_, area) => {
        this.cardW = Number(area.width);
        this.cardH = Number(area.height);
      })
      .onTouch((event: TouchEvent) => {
        const t = event.touches[0];
        if (!t) return;
        if (event.type === TouchType.Down) {
          if (this.tapThresholdTimer !== -1) clearTimeout(this.tapThresholdTimer);
          this.stage = CardHoldStage.PENDING_TAP;
          this.downX = t.x;
          this.downY = t.y;
          this.tapThresholdTimer = setTimeout(() => {
            this.tapThresholdTimer = -1;
            this.startHoldCountdown();
          }, 150);
        } else if (event.type === TouchType.Move) {
          const moveDist = Math.hypot(t.x - this.downX, t.y - this.downY);
          const verticalSlop = Math.abs(t.y - this.downY);
          const inside = t.x >= -8 && t.x <= this.cardW + 8 && t.y >= -8 && t.y <= this.cardH + 8;
          if ((this.stage === CardHoldStage.PENDING_TAP && moveDist > 8) || verticalSlop > 14 || !inside) {
            this.cancelHold();
          }
        } else if (event.type === TouchType.Up) {
          if (this.stage === CardHoldStage.PENDING_TAP) {
            this.clearTimers();
            this.stage = CardHoldStage.IDLE;
            HapticEngine.pulseTick();
            this.onTap();
          } else if (this.stage === CardHoldStage.IN_PROGRESS) {
            this.cancelHold();
          } else if (this.stage === CardHoldStage.COMPLETE) {
            this.confirmHold();
          }
        } else if (event.type === TouchType.Cancel) {
          this.cancelHold();
        }
      })
    }
    .width('100%')
    .padding({ bottom: 9 })
  }
}

import { AppPalette, DARK_PALETTE, HapticEngine } from '@englishpod/ep_design';
import { EpVectorIcon } from './EpVectorIcons';
import { KobraStaggeredPhrase } from './KobraStaggeredText';
import { SinjaHoldFiller } from './SinjaHoldFiller';

enum LiveHoldStage {
  IDLE = 0,
  PENDING_TAP = 1,
  IN_PROGRESS = 2,
  COMPLETE = 3
}

/**
 * 1:1 port of iOS _HoldToReplayTopLiveCard (main.dart:2719-3572):
 * - Top Row (20vp): Left Pill ('START LISTENING' / 'CONTINUE LISTENING' / 'REPLAYING LESSON' / 'LESSON COMPLETED')
 *   <-> Kobra Full Phrase ('Hold to replay' / 'Release to replay'), Right Label 'PODCAST · 04:12 / 11:30'
 * - Mid Row (42vp): Left '01 · Difficult Customer' + live English sentence quote, Right 40x40 squircle Play/Pause button
 * - Bottom: 3vp LinearProgressIndicator
 */
@ComponentV2
export struct HoldToReplayTopLiveCard {
  @Param palette: AppPalette = DARK_PALETTE;
  @Param lessonNum: number = 1;
  @Param lessonTitle: string = '';
  @Param trackTimeLabel: string = 'PODCAST · 00:00 / 00:00';
  @Param liveHeaderBadge: string = 'START LISTENING';
  @Param liveSentence: string = '';
  @Param liveProgress: number = 0.0;
  @Param isPlaying: boolean = false;
  @Param isPlayedBefore: boolean = false;
  @Param onCardTap: () => void = () => {};
  @Param onPlayPauseTap: () => void = () => {};
  @Param onConfirmReplay: () => void = () => {};

  @Local stage: LiveHoldStage = LiveHoldStage.IDLE;
  @Local fillProgress: number = 0.0;
  @Local holdEntryEpoch: number = 0;
  @Local iconRotationDeg: number = 0;
  @Local holdPlayedSnapshot: boolean = false;

  private tapThresholdTimer: number = -1;
  private animTimer: number = -1;
  private fillStartMs: number = 0;
  private downX: number = 0;
  private downY: number = 0;
  private downOnRightBtn: boolean = false;
  private cardW: number = 380;
  private cardH: number = 112;

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

  private showingHold(): boolean {
    return this.stage === LiveHoldStage.IN_PROGRESS || this.stage === LiveHoldStage.COMPLETE;
  }

  private startHoldCountdown(): void {
    if (this.stage !== LiveHoldStage.PENDING_TAP) {
      return;
    }
    this.holdPlayedSnapshot = this.isPlayedBefore;
    this.stage = LiveHoldStage.IN_PROGRESS;
    this.holdEntryEpoch++;
    this.iconRotationDeg = 0;
    this.fillStartMs = Date.now();
    this.animTimer = setInterval(() => {
      if (this.stage !== LiveHoldStage.IN_PROGRESS) {
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
        this.stage = LiveHoldStage.COMPLETE;
        this.iconRotationDeg = this.holdPlayedSnapshot ? -360 : 0;
      }
    }, 12);
  }

  private cancelHold(): void {
    this.clearTimers();
    this.stage = LiveHoldStage.IDLE;
    this.downOnRightBtn = false;
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
    this.stage = LiveHoldStage.IDLE;
    this.downOnRightBtn = false;
    this.onConfirmReplay();
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      SinjaHoldFiller({
        fillProgress: this.fillProgress,
        confirmProgress: 0.0,
        fillerBg: this.stage === LiveHoldStage.COMPLETE ? '#3D1ED760' : this.palette.accentSoft,
        fillerEdge: this.palette.accent
      })

      Column({ space: 0 }) {
        // Row 1: Top-Left Pill + Track & Time
        Row({ space: 8 }) {
          Stack({ alignContent: Alignment.Start }) {
            if (this.showingHold()) {
              KobraStaggeredPhrase({
                prefixWord: this.stage === LiveHoldStage.COMPLETE ? 'Release' : 'Hold',
                middleWord: 'to',
                actionWord: this.holdPlayedSnapshot ? 'replay' : 'start',
                entryEpoch: this.holdEntryEpoch,
                fontSize: 10,
                fontColor: this.stage === LiveHoldStage.COMPLETE ? this.palette.accentFg : this.palette.accent,
                fontWeight: FontWeight.Bold,
                wordGap: 3.5,
                fullWaveOnPrefixChange: true
              })
            } else {
              Row({ space: 6 }) {
                Circle()
                  .width(6)
                  .height(6)
                  .fill(this.palette.accent)
                  .opacity(this.isPlaying ? 1.0 : 0.35)
                  .scale({ x: this.isPlaying ? 1.0 : 0.82, y: this.isPlaying ? 1.0 : 0.82 })

                Text(this.liveHeaderBadge)
                  .fontSize(10)
                  .fontWeight(FontWeight.Bold)
                  .letterSpacing(0.6)
                  .fontColor(this.palette.accent)
                  .maxLines(1)
              }
            }
          }
          .height(20)
          .padding({ left: 9, right: 9 })
          .backgroundColor(
            this.stage === LiveHoldStage.COMPLETE ? this.palette.accent : this.palette.accentSoft
          )
          .borderRadius(9999)

          Text(this.trackTimeLabel)
            .fontSize(11)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.palette.textPassed)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .textAlign(TextAlign.End)
            .layoutWeight(1)
        }
        .width('100%')
        .height(20)

        // Row 2: Lesson Number & Title + Live Sentence Quote + Right 40x40 Play Button
        Row({ space: 10 }) {
          Column({ space: 3 }) {
            Text(`${String(this.lessonNum).padStart(2, '0')} · ${this.lessonTitle}`)
              .fontSize(14.5)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.palette.textPrimary)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })

            Text(this.liveSentence || 'Tap to start listening...')
              .fontSize(12.5)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.palette.accent)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)

          // Right 40x40 Squircle Play/Pause Button
          Stack({ alignContent: Alignment.Center }) {
            if (this.showingHold()) {
              EpVectorIcon({
                kind: this.holdPlayedSnapshot ? 'chunkyReplay' : 'chunkyPlay',
                iconSize: 19,
                iconColor: this.stage === LiveHoldStage.COMPLETE ? this.palette.accentFg : this.palette.accent,
                iconRotationDeg: this.iconRotationDeg
              })
                .animation({ duration: 420, curve: Curve.FastOutSlowIn })
            } else {
              EpVectorIcon({
                kind: this.isPlaying ? 'pause' : 'play',
                iconSize: 22,
                iconColor: this.palette.accentFg
              })
            }
          }
          .width(40)
          .height(40)
          .backgroundColor(
            this.stage === LiveHoldStage.COMPLETE
              ? this.palette.accent
              : (this.showingHold() ? this.palette.accentSoft : this.palette.accent)
          )
          .borderRadius(this.isPlaying || this.showingHold() ? 13 : 20)
          .animation({ duration: 240, curve: Curve.FastOutSlowIn })
        }
        .width('100%')
        .height(42)
        .margin({ top: 6, bottom: 9 })

        // Row 3: 3vp Pill Progress Bar (1:1 iOS ClipRRect + LinearProgressIndicator)
        Stack({ alignContent: Alignment.Start }) {
          Row()
            .width('100%')
            .height(3)
            .backgroundColor(this.palette.surface2)
            .borderRadius(9999)
          Row()
            .width(`${Math.round(Math.max(0.0, Math.min(1.0, this.liveProgress)) * 100)}%`)
            .height(3)
            .backgroundColor(this.palette.accent)
            .borderRadius(9999)
        }
        .width('100%')
        .height(3)
        .clip(true)
        .borderRadius(9999)
      }
      .width('100%')
      .padding({ left: 14, right: 14, top: 12, bottom: 12 })
    }
    .width('100%')
    .backgroundColor(this.palette.surfaceInset)
    .borderRadius(18)
    .border({
      width: 1,
      color: this.showingHold() ? this.palette.accent : this.palette.locateBarBorder
    })
    .clip(true)
    .shadow(
      this.stage === LiveHoldStage.COMPLETE
        ? { radius: 18, color: this.palette.accentSoft, offsetX: 0, offsetY: 4 }
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
        this.stage = LiveHoldStage.PENDING_TAP;
        this.downX = t.x;
        this.downY = t.y;
        // Right 40x40 play button hit-zone (right padding 14vp + 40vp + 8vp slop)
        this.downOnRightBtn = t.x >= this.cardW - 64 && t.y >= 20 && t.y <= 86;
        this.tapThresholdTimer = setTimeout(() => {
          this.tapThresholdTimer = -1;
          this.startHoldCountdown();
        }, 150);
      } else if (event.type === TouchType.Move) {
        const moveDist = Math.hypot(t.x - this.downX, t.y - this.downY);
        const inside = t.x >= -8 && t.x <= this.cardW + 8 && t.y >= -8 && t.y <= this.cardH + 8;
        if ((this.stage === LiveHoldStage.PENDING_TAP && moveDist > 8) || !inside) {
          this.cancelHold();
        }
      } else if (event.type === TouchType.Up) {
        if (this.stage === LiveHoldStage.PENDING_TAP) {
          const tappedRight = this.downOnRightBtn;
          this.clearTimers();
          this.stage = LiveHoldStage.IDLE;
          this.downOnRightBtn = false;
          HapticEngine.pulseTick();
          if (tappedRight) {
            this.onPlayPauseTap();
          } else {
            this.onCardTap();
          }
        } else if (this.stage === LiveHoldStage.IN_PROGRESS) {
          this.cancelHold();
        } else if (this.stage === LiveHoldStage.COMPLETE) {
          this.confirmHold();
        }
      } else if (event.type === TouchType.Cancel) {
        this.cancelHold();
      }
    })
  }
}

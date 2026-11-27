import { HapticEngine, PuraXMetrics } from '@englishpod/ep_design';
import { PlayerStore } from '../state/PlayerStore';

/**
 * Top Continue-Listening Live Card with 650ms Hold-to-Replay progressive fill
 * and linear motor milestone haptics.
 */
@ComponentV2
export struct HoldToReplayLiveCard {
  @Param store: PlayerStore = PlayerStore.getInstance();
  @Local holdProgress: number = 0;
  @Local isHolding: boolean = false;
  private holdTimerId: number = -1;
  private lastMilestone: number = 0;

  private currentSummary() {
    const id = this.store.lastOpenedLessonId || '0001';
    return this.store.lessons.find((l) => l.lessonId === id) ?? this.store.lessons[0];
  }

  private startHold(): void {
    this.cancelHold();
    this.isHolding = true;
    this.holdProgress = 0;
    this.lastMilestone = 0;
    const stepMs = 30;
    const stepPct = (stepMs / PuraXMetrics.HOLD_TO_REPLAY_MS) * 100;
    this.holdTimerId = setInterval(() => {
      this.holdProgress = Math.min(100, this.holdProgress + stepPct);
      const milestone = Math.floor(this.holdProgress / 25) * 25;
      if (milestone > this.lastMilestone && milestone <= 100) {
        this.lastMilestone = milestone;
        HapticEngine.pulseProgressMilestone(milestone);
      }
      if (this.holdProgress >= 100) {
        this.cancelHold();
        const targetId = this.store.lastOpenedLessonId || '0001';
        void this.store.holdToReplay(targetId);
      }
    }, stepMs);
  }

  private cancelHold(): void {
    if (this.holdTimerId !== -1) {
      clearInterval(this.holdTimerId);
      this.holdTimerId = -1;
    }
    this.isHolding = false;
    this.holdProgress = 0;
  }

  build() {
    Stack({ alignContent: Alignment.Start }) {
      // Progressive Hold-to-Replay fill background
      Row()
        .width(`${this.holdProgress}%`)
        .height('100%')
        .backgroundColor(this.store.palette.accentSoft)
        .borderRadius(PuraXMetrics.SQUIRCLE_CARD_RADIUS)

      Row({ space: 12 }) {
        Column({ space: 6 }) {
          Row({ space: 8 }) {
            Text(`继续精听 · ${this.currentSummary()?.code ?? 'B0001'}`)
              .fontSize(11)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.store.palette.accent)
              .padding({ left: 8, right: 8, top: 3, bottom: 3 })
              .backgroundColor(this.store.palette.accentSoft)
              .borderRadius(999)

            Text(this.isHolding ? '继续按住从头重播...' : '长按重播')
              .fontSize(11)
              .fontColor(this.store.palette.textPassed)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }

          Text(this.currentSummary()?.title ?? 'EnglishPod')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.store.palette.textPrimary)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })

          Row({ space: 8 }) {
            Progress({
              value: this.store.getProgress(this.currentSummary()?.lessonId ?? '0001').progressPct,
              total: 100,
              type: ProgressType.Linear
            })
              .color(this.store.palette.accent)
              .backgroundColor(this.store.palette.metroOutline)
              .layoutWeight(1)
              .height(4)

            Text(`${this.store.getProgress(this.currentSummary()?.lessonId ?? '0001').progressPct}%`)
              .fontSize(11)
              .fontColor(this.store.palette.textPassed)
          }
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)

        Button('▶')
          .width(48)
          .height(48)
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.store.palette.accentFg)
          .backgroundColor(this.store.palette.accent)
          .borderRadius(16)
          .onClick(() => {
            void this.store.continueListening();
          })
      }
      .padding(16)
      .width('100%')
    }
    .width('100%')
    .borderRadius(PuraXMetrics.SQUIRCLE_CARD_RADIUS)
    .linearGradient({
      angle: 135,
      colors: [
        [this.store.palette.deckGradStart, 0.0],
        [this.store.palette.deckGradMid, 0.55],
        [this.store.palette.deckGradEnd, 1.0]
      ]
    })
    .border({ width: 1, color: this.store.palette.deckBorder })
    .clip(true)
    .gesture(
      LongPressGesture({ repeat: false, duration: 150 })
        .onAction(() => this.startHold())
        .onActionEnd(() => this.cancelHold())
        .onActionCancel(() => this.cancelHold())
    )
  }
}

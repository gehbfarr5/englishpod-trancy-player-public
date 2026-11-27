import { PlayerStore } from '../state/PlayerStore';

/**
 * Clean HarmonyOS 7.0 (API 26) ecosystem hub modal opened on demand so the
 * main Library & Player screens preserve 100% iOS visual purity.
 */
@ComponentV2
export struct HarmonyToolsSheet {
  @Param store: PlayerStore = PlayerStore.getInstance();

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('#73000000')
        .onClick(() => {
          this.store.harmonySheetOpen = false;
        })

      Column({ space: 10 }) {
        Row()
          .width(36)
          .height(4)
          .backgroundColor(this.store.palette.border)
          .borderRadius(9999)
          .margin({ bottom: 4 })

        Row() {
          Column({ space: 2 }) {
            Text('HarmonyOS 7.0 Features')
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.store.palette.textPrimary)
            Text('API 26 · HUAWEI Pura X View')
              .fontSize(11)
              .fontColor(this.store.palette.textPassed)
          }
          .alignItems(HorizontalAlign.Start)
          Blank()
          Button('Close')
            .height(30)
            .padding({ left: 12, right: 12 })
            .fontSize(12)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.store.palette.textPrimary)
            .backgroundColor(this.store.palette.surface2)
            .borderRadius(9999)
            .onClick(() => {
              this.store.harmonySheetOpen = false;
            })
        }
        .width('100%')

        Row({ space: 8 }) {
          Button(this.store.flashWindowActive ? 'Flash Window · ON' : 'Flash Window')
            .layoutWeight(1)
            .height(38)
            .fontSize(12)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.store.flashWindowActive ? this.store.palette.accentFg : this.store.palette.textPrimary)
            .backgroundColor(this.store.flashWindowActive ? this.store.palette.accent : this.store.palette.surface2)
            .borderRadius(12)
            .onClick(() => void this.store.toggleFlashWindow())

          Button(this.store.spatialAudioEnabled ? 'Spatial Audio · ON' : 'Spatial Audio')
            .layoutWeight(1)
            .height(38)
            .fontSize(12)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.store.spatialAudioEnabled ? this.store.palette.accentFg : this.store.palette.textPrimary)
            .backgroundColor(this.store.spatialAudioEnabled ? this.store.palette.accent : this.store.palette.surface2)
            .borderRadius(12)
            .onClick(() => this.store.toggleSpatialAudio())
        }
        .width('100%')

        Row({ space: 8 }) {
          Button(this.store.dailyReminderEnabled ? 'Daily 21:00 · ON' : 'Daily Reminder')
            .layoutWeight(1)
            .height(38)
            .fontSize(12)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.store.dailyReminderEnabled ? this.store.palette.accentFg : this.store.palette.textPrimary)
            .backgroundColor(this.store.dailyReminderEnabled ? this.store.palette.accent : this.store.palette.surface2)
            .borderRadius(12)
            .onClick(() => void this.store.toggleDailyReminder())

          Button('Tap-to-Share')
            .layoutWeight(1)
            .height(38)
            .fontSize(12)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.store.palette.textPrimary)
            .backgroundColor(this.store.palette.surface2)
            .borderRadius(12)
            .onClick(() => this.store.triggerKnockShare())
        }
        .width('100%')

        Row({ space: 8 }) {
          Button('Celia: Resume')
            .layoutWeight(1)
            .height(34)
            .fontSize(11)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.store.palette.accent)
            .backgroundColor(this.store.palette.accentSoft)
            .borderRadius(10)
            .onClick(() => void this.store.invokeXiaoyiSkill('resumeLastLesson', {}))

          Button('Celia: Loop Line')
            .layoutWeight(1)
            .height(34)
            .fontSize(11)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.store.palette.accent)
            .backgroundColor(this.store.palette.accentSoft)
            .borderRadius(10)
            .onClick(() => void this.store.invokeXiaoyiSkill('replayCurrentSentence', {}))
        }
        .width('100%')
      }
      .width('100%')
      .constraintSize({ maxWidth: 520 })
      .padding({ left: 20, right: 20, top: 12, bottom: this.store.bottomSafeInsetVp + 18 })
      .backgroundColor(this.store.palette.surface1)
      .borderRadius({ topLeft: 24, topRight: 24 })
      .border({ width: { top: 1 }, color: this.store.palette.deckBorder })
    }
    .width('100%')
    .height('100%')
  }
}

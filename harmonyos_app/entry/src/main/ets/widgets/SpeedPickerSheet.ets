import { IOS_SPEED_OPTIONS, PlayerStore, SpeedOption } from '../state/PlayerStore';
import { EpVectorIcon } from './EpVectorIcons';

/**
 * 1:1 port of iOS _showSpeedPickerModal (main.dart:9135-9237):
 * - Header: "Playback Speed" + "Close" pill
 * - 5 options: 0.8x, 0.9x, 1.0x, 1.1x, 1.25x with check icon
 */
@ComponentV2
export struct SpeedPickerSheet {
  @Param store: PlayerStore = PlayerStore.getInstance();

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      // Scrim
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('#73000000')
        .onClick(() => {
          this.store.speedSheetOpen = false;
        })

      // Bottom Sheet
      Column({ space: 0 }) {
        Row()
          .width(36)
          .height(4)
          .backgroundColor(this.store.palette.border)
          .borderRadius(9999)
          .margin({ bottom: 14 })

        Row() {
          Text('Playback Speed')
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.store.palette.textPrimary)
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
              this.store.speedSheetOpen = false;
            })
        }
        .width('100%')
        .margin({ bottom: 12 })

        Column({ space: 6 }) {
          ForEach(
            IOS_SPEED_OPTIONS,
            (opt: SpeedOption) => {
              Row() {
                Text(opt.label)
                  .fontSize(14)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(
                    Math.abs(opt.value - this.store.playbackSpeed) < 0.01
                      ? this.store.palette.accent
                      : this.store.palette.textPrimary
                  )
                Blank()
                if (Math.abs(opt.value - this.store.playbackSpeed) < 0.01) {
                  EpVectorIcon({
                    kind: 'check',
                    iconSize: 20,
                    iconColor: this.store.palette.accent
                  })
                }
              }
              .width('100%')
              .padding({ left: 14, right: 14, top: 13, bottom: 13 })
              .backgroundColor(
                Math.abs(opt.value - this.store.playbackSpeed) < 0.01
                  ? this.store.palette.accentSoft
                  : Color.Transparent
              )
              .borderRadius(12)
              .onClick(() => {
                this.store.setPlaybackSpeed(opt.value);
                this.store.speedSheetOpen = false;
              })
            },
            (opt: SpeedOption) => `${opt.value}`
          )
        }
        .width('100%')
      }
      .width('100%')
      .constraintSize({ maxWidth: 480 })
      .padding({ left: 20, right: 20, top: 12, bottom: this.store.bottomSafeInsetVp + 18 })
      .backgroundColor(this.store.palette.surface1)
      .borderRadius({ topLeft: 24, topRight: 24 })
      .border({ width: { top: 1 }, color: this.store.palette.deckBorder })
    }
    .width('100%')
    .height('100%')
  }
}

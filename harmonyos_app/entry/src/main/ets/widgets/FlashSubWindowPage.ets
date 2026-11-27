import { PlayerStore } from '../state/PlayerStore';
import { EpVectorIcon } from './EpVectorIcons';

/**
 * HarmonyOS 7.0 Flash Control Window & Flash Ball subwindow UI using vector icons.
 */
@Entry
@ComponentV2
struct FlashSubWindowPage {
  private store: PlayerStore = PlayerStore.getInstance();
  @Local collapsedBall: boolean = false;

  build() {
    if (this.collapsedBall) {
      Button(this.store.currentLesson?.code ?? 'EP')
        .width(48)
        .height(48)
        .fontSize(11)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.store.palette.accentFg)
        .backgroundColor(this.store.palette.accent)
        .borderRadius(999)
        .onClick(() => {
          this.collapsedBall = false;
          void this.store.toggleFlashBallCollapse();
        })
    } else {
      Column({ space: 6 }) {
        Row() {
          Text(`${this.store.currentLesson?.code ?? 'B0001'} · FLASH WINDOW`)
            .fontSize(10)
            .fontWeight(FontWeight.Bold)
            .letterSpacing(0.6)
            .fontColor(this.store.palette.accent)
          Blank()
          Text('Minimize')
            .fontSize(10)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.store.palette.textPassed)
            .onClick(() => {
              this.collapsedBall = true;
              void this.store.toggleFlashBallCollapse();
            })
        }
        .width('100%')

        Row({ space: 8 }) {
          Text(this.store.activeSentenceText() || 'EnglishPod')
            .layoutWeight(1)
            .fontSize(12)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.store.palette.textPrimary)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })

          Stack({ alignContent: Alignment.Center }) {
            EpVectorIcon({
              kind: 'replay',
              iconSize: 16,
              iconColor: this.store.palette.textPrimary
            })
          }
          .width(34)
          .height(34)
          .backgroundColor(this.store.palette.surface2)
          .borderRadius(10)
          .onClick(() => this.store.seekToSegment(this.store.activeSegmentIndex))

          Stack({ alignContent: Alignment.Center }) {
            EpVectorIcon({
              kind: this.store.isPlaying ? 'pause' : 'play',
              iconSize: 16,
              iconColor: this.store.palette.accentFg
            })
          }
          .width(34)
          .height(34)
          .backgroundColor(this.store.palette.accent)
          .borderRadius(10)
          .onClick(() => void this.store.togglePlayPause())
        }
        .width('100%')
      }
      .width('100%')
      .height('100%')
      .padding(10)
      .backgroundColor(this.store.palette.glassBg)
      .backdropBlur(20)
      .borderRadius(20)
      .border({ width: 1, color: this.store.palette.accent })
    }
  }
}

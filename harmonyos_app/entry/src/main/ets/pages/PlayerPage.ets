import { PuraXMetrics } from '@englishpod/ep_design';
import { PlayerStore } from '../state/PlayerStore';
import { EpVectorIcon } from '../widgets/EpVectorIcons';
import { MetrolistDock } from '../widgets/MetrolistDock';
import { TranscriptListView } from '../widgets/TranscriptListView';
import { VocabPanel } from '../widgets/VocabPanel';

/**
 * 1:1 port of iOS _buildImmersivePlayerScreen (main.dart:7551-7924) +
 * Pura X View (16:9.5) Landscape Dual-Pane Workbench with Split Vocab Drawer.
 */
@ComponentV2
export struct PlayerPage {
  @Param store: PlayerStore = PlayerStore.getInstance();

  private activeTabIndex(): number {
    if (this.store.playerTab === 'pb') return 0;
    if (this.store.playerTab === 'dg') return 1;
    return 2;
  }

  @Builder
  TopTabChip(tabKey: 'pb' | 'dg' | 'vocab', label: string, chipWidth: number) {
    Stack({ alignContent: Alignment.Center }) {
      Text(label)
        .fontSize(12)
        .fontWeight(FontWeight.Bold)
        .fontColor(
          this.store.playerTab === tabKey
            ? this.store.palette.accentFg
            : ((tabKey === 'pb' || tabKey === 'dg') && this.store.currentTrack === tabKey
              ? this.store.palette.textPrimary
              : this.store.palette.textPassed)
        )

      // Active background audio source underline while viewing Vocab
      Row()
        .width(
          this.store.playerTab !== tabKey &&
            (tabKey === 'pb' || tabKey === 'dg') &&
            this.store.currentTrack === tabKey
            ? 42
            : 0
        )
        .height(2.2)
        .backgroundColor(this.store.palette.accent)
        .borderRadius(9999)
        .position({ y: 24.5 })
        .animation({ duration: 250, curve: Curve.FastOutSlowIn })
    }
    .width(chipWidth)
    .height(30)
    .onClick(() => void this.store.switchPlayerTab(tabKey))
  }

  @Builder
  TopSegmentedCapsule(chipWidth: number, includeVocab: boolean) {
    Stack({ alignContent: Alignment.Start }) {
      Row()
        .width(chipWidth)
        .height(30)
        .backgroundColor(this.store.palette.accent)
        .borderRadius(9999)
        .translate({
          x: (includeVocab ? this.activeTabIndex() : (this.store.currentTrack === 'dg' ? 1 : 0)) * chipWidth
        })
        .animation({ duration: 250, curve: Curve.FastOutSlowIn })

      Row() {
        this.TopTabChip('pb', 'Podcast', chipWidth)
        this.TopTabChip('dg', 'Dialogue', chipWidth)
        if (includeVocab) {
          this.TopTabChip('vocab', 'Vocab', chipWidth)
        }
      }
    }
    .height(36)
    .padding(3)
    .backgroundColor(this.store.palette.surface2)
    .borderRadius(9999)
  }

  @Builder
  BackToLibraryPill() {
    Row({ space: 5 }) {
      EpVectorIcon({
        kind: 'arrowBack',
        iconSize: 16,
        iconColor: this.store.palette.textPrimary
      })
      Text('Library')
        .fontSize(12.5)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.store.palette.textPrimary)
    }
    .height(36)
    .padding({ left: 13, right: 13 })
    .backgroundColor(this.store.palette.surface2)
    .borderRadius(9999)
    .onClick(() => this.store.returnToLibrary())
  }

  build() {
    if (this.store.layoutMode === 'landscape_workbench') {
      // Pura X View 16:9.5 Landscape Dual-Pane Workbench
      Row({ space: 14 }) {
        // Left 40% Console (Full iOS Metrolist Transport + Top Controls)
        Column({ space: 8 }) {
          Row() {
            this.BackToLibraryPill()
            Blank()
            Row({ space: 6 }) {
              Text(this.store.landscapeVocabDrawerOpen ? 'Vocab ON' : 'Vocab')
                .fontSize(11.5)
                .fontWeight(FontWeight.Bold)
                .fontColor(
                  this.store.landscapeVocabDrawerOpen
                    ? this.store.palette.accentFg
                    : this.store.palette.textPrimary
                )
                .padding({ left: 10, right: 10, top: 6, bottom: 6 })
                .backgroundColor(
                  this.store.landscapeVocabDrawerOpen
                    ? this.store.palette.accent
                    : this.store.palette.surface2
                )
                .borderRadius(9999)
                .onClick(() => {
                  this.store.landscapeVocabDrawerOpen = !this.store.landscapeVocabDrawerOpen;
                })

              Stack({ alignContent: Alignment.Center }) {
                EpVectorIcon({
                  kind: 'harmonySpark',
                  iconSize: 13,
                  iconColor: this.store.palette.accent
                })
              }
              .width(30)
              .height(30)
              .backgroundColor(this.store.palette.surface2)
              .borderRadius(9999)
              .onClick(() => {
                this.store.harmonySheetOpen = true;
              })
            }
          }
          .width('100%')

          Column({ space: 2 }) {
            Text(
              `LESSON ${String(this.store.currentLesson?.lessonNumber ?? 1).padStart(2, '0')} · ${(this.store.currentLesson?.level ?? '').toUpperCase()}`
            )
              .fontSize(10.5)
              .fontWeight(FontWeight.Bold)
              .letterSpacing(0.7)
              .fontColor(this.store.palette.accent)

            Text(this.store.currentLesson?.title ?? '')
              .fontSize(16.5)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.store.palette.textPrimary)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)

          this.TopSegmentedCapsule(96, false)

          Blank()
          MetrolistDock({ store: this.store, isLandscapeConsole: true })
        }
        .width('40%')
        .height('100%')
        .padding({ left: 16, right: 16, top: 12, bottom: 12 })
        .backgroundColor(this.store.palette.deckBg)
        .radialGradient({
          center: ['50%', '0%'],
          radius: '135%',
          colors: [
            [this.store.palette.deckGradStart, 0.0],
            [this.store.palette.deckGradMid, 0.58],
            [this.store.palette.deckGradEnd, 1.0]
          ]
        })
        .borderRadius(22)
        .border({ width: 1, color: this.store.palette.deckBorder })

        // Right 60% Full-Height Transcript + Split Vocab Drawer
        Row({ space: 10 }) {
          Column() {
            if (!this.store.currentLesson) {
              Column() {
                LoadingProgress().width(36).height(36).color(this.store.palette.accent)
              }
              .width('100%')
              .height('100%')
              .justifyContent(FlexAlign.Center)
            } else {
              TranscriptListView({ store: this.store })
            }
          }
          .layoutWeight(1)
          .height('100%')

          if (this.store.landscapeVocabDrawerOpen && this.store.currentLesson) {
            Column() {
              VocabPanel({ store: this.store, compactDrawer: true })
            }
            .width(PuraXMetrics.LANDSCAPE_VOCAB_DRAWER_WIDTH_VP)
            .height('100%')
            .padding(12)
            .backgroundColor(this.store.palette.surface1)
            .borderRadius(20)
            .border({ width: 1, color: this.store.palette.deckBorder })
          }
        }
        .layoutWeight(1)
        .height('100%')
      }
      .width('100%')
      .height('100%')
      .padding({
        left: 14 + this.store.leftCutoutVp,
        right: 14 + this.store.rightCutoutVp,
        top: 10,
        bottom: this.store.bottomSafeInsetVp
      })
      .backgroundColor(this.store.palette.bgWell)
    } else {
      // Portrait 1:1 iOS Immersive Player Screen
      Column({ space: 0 }) {
        // Unified Top Bar: [<- Library] + [Podcast | Dialogue | Vocab]
        Row() {
          this.BackToLibraryPill()
          Blank()
          this.TopSegmentedCapsule(76, true)
        }
        .width('100%')
        .padding({
          left: 16,
          right: 16,
          top: this.store.topSafeInsetVp + 8,
          bottom: 10
        })
        .backgroundColor(this.store.palette.deckBg)
        .radialGradient({
          center: ['50%', '0%'],
          radius: '135%',
          colors: [
            [this.store.palette.deckGradStart, 0.0],
            [this.store.palette.deckGradMid, 0.58],
            [this.store.palette.deckGradEnd, 1.0]
          ]
        })
        .border({ width: { bottom: 1 }, color: this.store.palette.deckBorder })

        // Transcript or Vocab Body
        Column() {
          if (!this.store.currentLesson) {
            Column() {
              LoadingProgress().width(38).height(38).color(this.store.palette.accent)
            }
            .width('100%')
            .height('100%')
            .justifyContent(FlexAlign.Center)
          } else if (this.store.playerTab === 'vocab') {
            VocabPanel({ store: this.store, compactDrawer: false })
          } else {
            TranscriptListView({ store: this.store })
          }
        }
        .layoutWeight(1)
        .width('100%')

        // Metrolist Bottom Player Control Dock
        MetrolistDock({ store: this.store, isLandscapeConsole: false })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.store.palette.bgWell)
    }
  }
}

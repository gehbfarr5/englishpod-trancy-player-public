import { VocabContextExample, VocabEntry, VocabMatcher } from '@englishpod/ep_domain';
import { PlayerStore } from '../state/PlayerStore';
import { EpVectorIcon } from './EpVectorIcons';

/**
 * 1:1 port of iOS _buildInlineVocabularyTab & _buildVocabCard P21 Accordion (main.dart:8492-8788),
 * supporting both full-tab Portrait view and split-pane Landscape drawer.
 */
@ComponentV2
export struct VocabPanel {
  @Param store: PlayerStore = PlayerStore.getInstance();
  @Param compactDrawer: boolean = false;

  private keyVocab(): VocabEntry[] {
    return (this.store.currentLesson?.vocabulary ?? []).filter((v) => v.type === 'key');
  }

  private suppVocab(): VocabEntry[] {
    return (this.store.currentLesson?.vocabulary ?? []).filter((v) => v.type !== 'key');
  }

  private examplesFor(word: string): VocabContextExample[] {
    const lesson = this.store.currentLesson;
    if (!lesson) return [];
    return VocabMatcher.findContextualSentencesForWord(lesson, word);
  }

  private isExpanded(word: string): boolean {
    return this.store.expandedVocabWords.includes(word.toLowerCase());
  }

  @Builder
  VocabAccordionCard(v: VocabEntry) {
    Column({ space: 0 }) {
      // Accordion Header
      Row({ space: 6 }) {
        Column({ space: 2 }) {
          Row({ space: 6 }) {
            Text(v.word)
              .fontSize(this.compactDrawer ? 14 : 16)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.store.palette.accent)

            Text(`${v.pos} · ${v.type === 'key' ? 'Key' : 'Supplementary'}`)
              .fontSize(this.compactDrawer ? 10.5 : 12)
              .fontStyle(FontStyle.Italic)
              .fontColor(this.store.palette.textPassed)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
          }
          .width('100%')
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)

        if (this.examplesFor(v.word).length > 0 && !this.compactDrawer) {
          Text(`${this.examplesFor(v.word).length} in lesson`)
            .fontSize(10)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.isExpanded(v.word) ? this.store.palette.accent : this.store.palette.textPassed)
            .padding({ left: 7, right: 7, top: 2, bottom: 2 })
            .backgroundColor(this.isExpanded(v.word) ? this.store.palette.accentSoft : this.store.palette.surface2)
            .borderRadius(9999)
        }

        EpVectorIcon({
          kind: 'chevronDown',
          iconSize: 18,
          iconColor: this.isExpanded(v.word) ? this.store.palette.accent : this.store.palette.textPassed,
          iconRotationDeg: this.isExpanded(v.word) ? 180 : 0
        })
          .animation({ duration: 250, curve: Curve.FastOutSlowIn })
      }
      .width('100%')

      Text(v.definition)
        .fontSize(this.compactDrawer ? 12 : 13.5)
        .lineHeight(this.compactDrawer ? 17 : 20)
        .fontColor(this.store.palette.textPrimary)
        .margin({ top: 5 })
        .width('100%')

      // Expandable Contextual Sentences Panel
      if (this.isExpanded(v.word)) {
        Column({ space: 6 }) {
          if (this.examplesFor(v.word).length === 0) {
            Text(`Tap "${v.word}" inside the transcript to hear it in context.`)
              .fontSize(12)
              .fontColor(this.store.palette.textPassed)
          } else {
            Text('IN THIS LESSON · TAP SENTENCE TO PLAY')
              .fontSize(9.5)
              .fontWeight(FontWeight.Bold)
              .letterSpacing(0.7)
              .fontColor(this.store.palette.accent)

            ForEach(
              this.examplesFor(v.word),
              (ex: VocabContextExample) => {
                Row({ space: 8 }) {
                  EpVectorIcon({
                    kind: 'playCircleFill',
                    iconSize: 16,
                    iconColor: this.store.palette.accent
                  })
                  Text(ex.segment.text)
                    .fontSize(12)
                    .lineHeight(16.5)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.store.palette.textPrimary)
                    .layoutWeight(1)
                }
                .width('100%')
                .alignItems(VerticalAlign.Top)
                .padding({ left: 10, right: 10, top: 8, bottom: 8 })
                .backgroundColor(this.store.palette.surface1)
                .borderRadius(10)
                .border({ width: 1, color: this.store.palette.border })
                .onClick(() => {
                  void this.store.playContextualExample(ex.track, ex.segmentIndex, ex.segment.start);
                })
              },
              (ex: VocabContextExample) => `${ex.track}_${ex.segmentIndex}`
            )
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(11)
        .margin({ top: 11 })
        .backgroundColor(this.store.palette.surfaceInset)
        .borderRadius(12)
        .border({ width: 1, color: this.store.palette.border })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 15, right: 15, top: 13, bottom: 13 })
    .margin({ bottom: 10 })
    .backgroundColor(this.store.palette.surface1)
    .borderRadius(this.isExpanded(v.word) ? 16 : 14)
    .border({
      width: 1,
      color: this.isExpanded(v.word) || this.store.selectedVocab?.word === v.word
        ? this.store.palette.locateBarBorder
        : this.store.palette.border
    })
    .onClick(() => this.store.toggleVocabExpanded(v.word))
  }

  build() {
    List({ space: 0 }) {
      ListItem() {
        Column({ space: 3 }) {
          if (this.compactDrawer) {
            Row() {
              Text(`Vocabulary (${this.store.currentLesson?.vocabulary.length ?? 0})`)
                .fontSize(14)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.store.palette.textPrimary)
              Blank()
              Text('Hide')
                .fontSize(11)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.store.palette.accent)
                .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                .backgroundColor(this.store.palette.accentSoft)
                .borderRadius(9999)
                .onClick(() => {
                  this.store.landscapeVocabDrawerOpen = false;
                })
            }
            .width('100%')
            .margin({ bottom: 8 })
          } else {
            Text(
              `LESSON ${String(this.store.currentLesson?.lessonNumber ?? 1).padStart(2, '0')} · PLAYING: ${this.store.currentTrack === 'dg' ? 'DIALOGUE' : 'PODCAST'}`
            )
              .fontSize(11)
              .fontWeight(FontWeight.Bold)
              .letterSpacing(0.8)
              .fontColor(this.store.palette.accent)

            Text(`Vocabulary (${this.store.currentLesson?.vocabulary.length ?? 0})`)
              .fontSize(19)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.store.palette.textPrimary)
              .margin({ bottom: 10 })
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }

      if (this.keyVocab().length > 0) {
        ListItem() {
          Text('KEY VOCABULARY · TAP CARD TO EXPAND EXAMPLES')
            .fontSize(10.5)
            .fontWeight(FontWeight.Bold)
            .letterSpacing(0.8)
            .fontColor(this.store.palette.accent)
            .margin({ bottom: 8 })
        }

        ForEach(
          this.keyVocab(),
          (v: VocabEntry) => {
            ListItem() {
              this.VocabAccordionCard(v)
            }
          },
          (v: VocabEntry) => `key_${v.word}`
        )
      }

      if (this.suppVocab().length > 0) {
        ListItem() {
          Text('SUPPLEMENTARY VOCABULARY')
            .fontSize(10.5)
            .fontWeight(FontWeight.Bold)
            .letterSpacing(0.8)
            .fontColor(this.store.palette.accent)
            .margin({ top: 8, bottom: 8 })
        }

        ForEach(
          this.suppVocab(),
          (v: VocabEntry) => {
            ListItem() {
              this.VocabAccordionCard(v)
            }
          },
          (v: VocabEntry) => `supp_${v.word}`
        )
      }
    }
    .width('100%')
    .height('100%')
    .padding(this.compactDrawer ? { left: 2, right: 2, top: 2, bottom: 8 } : { left: 18, right: 18, top: 16, bottom: 28 })
    .scrollBar(BarState.Auto)
  }
}

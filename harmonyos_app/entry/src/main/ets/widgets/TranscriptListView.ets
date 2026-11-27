import { PuraXMetrics } from '@englishpod/ep_design';
import {
  StageGroupCalculator,
  StageGroupInfo,
  TextSpanToken,
  TranscriptSegment,
  VocabMatcher
} from '@englishpod/ep_domain';
import { PlayerStore } from '../state/PlayerStore';
import { EpVectorIcon } from './EpVectorIcons';

/**
 * 1:1 port of iOS _buildTranscriptBody, _buildLessonInlineHeader, _buildTranscriptItem,
 * _buildStageBoxHeaderRow, _buildSentenceInnerContent, _buildVocabularyHighlightedText,
 * and _buildFullWidthReturnBanner (main.dart:7616-8455).
 */
@ComponentV2
export struct TranscriptListView {
  @Param store: PlayerStore = PlayerStore.getInstance();
  @Local firstVisibleIndex: number = 0;
  @Local lastVisibleIndex: number = 6;
  private scroller: Scroller = new Scroller();
  private lastProgrammaticJumpAtMs: number = 0;

  @Monitor('store.activeSegmentIndex')
  onActiveSegmentChanged(): void {
    const active = this.store.activeSegmentIndex;
    if (!this.store.showReturnBanner) {
      this.lastProgrammaticJumpAtMs = Date.now();
      this.scroller.scrollToIndex(active, true, ScrollAlign.CENTER);
    }
  }

  @Monitor('store.scrollJumpTick')
  onJumpRequested(): void {
    this.lastProgrammaticJumpAtMs = Date.now();
    this.scroller.scrollToIndex(this.store.activeSegmentIndex, true, ScrollAlign.CENTER);
  }

  private tokensFor(seg: TranscriptSegment): TextSpanToken[] {
    const vocab = this.store.currentLesson?.vocabulary ?? [];
    return VocabMatcher.tokenize(seg.text, vocab);
  }

  private stageFor(idx: number): StageGroupInfo | null {
    const list = this.store.stageGroups;
    return idx < list.length ? list[idx] : null;
  }

  private isBoxCollapsed(info: StageGroupInfo | null): boolean {
    if (!info) return false;
    return this.store.collapsedStageBoxIds.includes(info.boxGroupId);
  }

  private stageBorderRadii(isFirst: boolean, roundBottom: boolean): BorderRadiuses {
    return {
      topLeft: isFirst ? 20 : 0,
      topRight: isFirst ? 20 : 0,
      bottomLeft: roundBottom ? 20 : 0,
      bottomRight: roundBottom ? 20 : 0
    };
  }

  @Builder
  LessonInlineHeader() {
    Column({ space: 3 }) {
      Text(
        `LESSON ${String(this.store.currentLesson?.lessonNumber ?? 1).padStart(2, '0')} · ${(this.store.currentLesson?.level ?? '').toUpperCase()} · ${this.store.currentTrack === 'dg' ? 'DIALOGUE TRACK' : 'PODCAST TRACK'}`
      )
        .fontSize(11)
        .fontWeight(FontWeight.Bold)
        .letterSpacing(0.8)
        .fontColor(this.store.palette.accent)

      Text(this.store.currentLesson?.title ?? '')
        .fontSize(19)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.store.palette.textPrimary)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .margin({ bottom: 16 })
  }

  @Builder
  StageBoxHeaderRow(info: StageGroupInfo, isCollapsed: boolean) {
    Column({ space: 0 }) {
      Row({ space: 8 }) {
        Text(info.badgeText)
          .fontSize(10.5)
          .fontWeight(FontWeight.Bold)
          .letterSpacing(0.6)
          .fontColor(this.store.palette.accent)
          .padding({ left: 10, right: 10, top: 3.5, bottom: 3.5 })
          .backgroundColor(this.store.palette.accentSoft)
          .borderRadius(9999)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)

        Row({ space: 4 }) {
          Text(isCollapsed ? 'Tap to expand' : info.subText)
            .fontSize(11)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.store.palette.textPassed)

          EpVectorIcon({
            kind: 'chevronDown',
            iconSize: 16,
            iconColor: this.store.palette.textPassed,
            iconRotationDeg: isCollapsed ? 0 : 180
          })
            .animation({ duration: 250, curve: Curve.FastOutSlowIn })
        }
      }
      .width('100%')
      .padding({ bottom: isCollapsed ? 2 : 9 })
      .border({
        width: { bottom: isCollapsed ? 0 : 1 },
        color: this.store.palette.border
      })
      .onClick(() => {
        this.store.toggleStageBoxCollapsed(info.boxGroupId);
      })
    }
    .width('100%')
  }

  @Builder
  SentenceInnerContent(seg: TranscriptSegment, idx: number, info: StageGroupInfo | null) {
    Column({ space: 4 }) {
      Row({ space: 8 }) {
        Text(StageGroupCalculator.resolveSpeakerDisplayName(seg, info))
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .letterSpacing(0.85)
          .fontColor(idx === this.store.activeSegmentIndex ? this.store.palette.accent : this.store.palette.textPassed)

        if (idx === this.store.activeSegmentIndex && this.store.singleSentenceLoop) {
          Text('LOOP 1')
            .fontSize(9.5)
            .fontWeight(FontWeight.Bold)
            .letterSpacing(0.5)
            .fontColor(this.store.palette.accent)
            .padding({ left: 7, right: 7, top: 2, bottom: 2 })
            .backgroundColor(this.store.palette.accentSoft)
            .borderRadius(9999)
        }
      }
      .height(18)

      Text() {
        ForEach(this.tokensFor(seg), (tok: TextSpanToken) => {
          if (tok.vocab) {
            Span(tok.text)
              .fontColor(
                idx === this.store.activeSegmentIndex
                  ? this.store.palette.vocabHlActive
                  : (idx < this.store.activeSegmentIndex
                    ? this.store.palette.vocabHlPassed
                    : this.store.palette.vocabHlUnplayed)
              )
              .onClick(() => {
                this.store.selectedVocab = tok.vocab;
                if (this.store.layoutMode === 'landscape_workbench') {
                  this.store.landscapeVocabDrawerOpen = true;
                }
              })
          } else {
            Span(tok.text)
          }
        })
      }
      .fontSize(this.store.layoutMode === 'landscape_workbench' ? 18.5 : 21.5)
      .lineHeight(this.store.layoutMode === 'landscape_workbench' ? 27 : 30)
      .fontWeight(FontWeight.Bold)
      .fontColor(
        idx === this.store.activeSegmentIndex
          ? this.store.palette.textPrimary
          : (idx < this.store.activeSegmentIndex
            ? this.store.palette.textPassed
            : this.store.palette.textUpcoming)
      )
      .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 14, right: 4, top: 6, bottom: 6 })
    .border({
      width: { left: 3 },
      color: idx === this.store.activeSegmentIndex ? this.store.palette.accent : Color.Transparent
    })
  }

  @Builder
  TranscriptRow(seg: TranscriptSegment, idx: number) {
    Column() {
      if (idx === 0) {
        this.LessonInlineHeader()
      }

      if (this.stageFor(idx) !== null && !this.stageFor(idx)!.isFirstInBox && this.isBoxCollapsed(this.stageFor(idx))) {
        // Collapsed stage item
      } else if (seg.isSection && this.stageFor(idx) !== null && this.stageFor(idx)!.isFirstInBox) {
        Column() {
          this.StageBoxHeaderRow(this.stageFor(idx)!, this.isBoxCollapsed(this.stageFor(idx)))
        }
        .width('100%')
        .padding({
          left: 15,
          right: 15,
          top: 13,
          bottom: this.stageFor(idx)!.isLastInBox || this.isBoxCollapsed(this.stageFor(idx)) ? 13 : 4
        })
        .margin({
          top: 6,
          bottom: this.stageFor(idx)!.isLastInBox || this.isBoxCollapsed(this.stageFor(idx)) ? 20 : 0
        })
        .backgroundColor(this.store.palette.stageBoxBg)
        .borderRadius(
          this.stageBorderRadii(true, this.stageFor(idx)!.isLastInBox || this.isBoxCollapsed(this.stageFor(idx)))
        )
        .border({
          width: {
            top: 1,
            left: 1,
            right: 1,
            bottom: this.stageFor(idx)!.isLastInBox || this.isBoxCollapsed(this.stageFor(idx)) ? 1 : 0
          },
          color: this.store.palette.stageBoxBorder
        })
      } else if (this.stageFor(idx) === null) {
        Column() {
          this.SentenceInnerContent(seg, idx, null)
        }
        .width('100%')
        .margin({ bottom: 18 })
        .onClick(() => {
          if (!seg.isSection) {
            this.store.seekToSegment(idx);
          }
        })
      } else {
        Column() {
          if (this.stageFor(idx)!.isFirstInBox) {
            this.StageBoxHeaderRow(this.stageFor(idx)!, this.isBoxCollapsed(this.stageFor(idx)))
            if (!this.isBoxCollapsed(this.stageFor(idx))) {
              Column() {
                this.SentenceInnerContent(seg, idx, this.stageFor(idx))
              }
              .padding({ top: 10 })
              .onClick(() => this.store.seekToSegment(idx))
            }
          } else {
            Column() {
              this.SentenceInnerContent(seg, idx, this.stageFor(idx))
            }
            .onClick(() => this.store.seekToSegment(idx))
          }
        }
        .width('100%')
        .padding({
          left: 15,
          right: 15,
          top: this.stageFor(idx)!.isFirstInBox ? 13 : 6,
          bottom: this.stageFor(idx)!.isLastInBox || this.isBoxCollapsed(this.stageFor(idx)) ? 14 : 6
        })
        .margin({
          top: this.stageFor(idx)!.isFirstInBox ? 6 : 0,
          bottom: this.stageFor(idx)!.isLastInBox || this.isBoxCollapsed(this.stageFor(idx)) ? 20 : 0
        })
        .backgroundColor(this.store.palette.stageBoxBg)
        .borderRadius(
          this.stageBorderRadii(
            this.stageFor(idx)!.isFirstInBox,
            this.stageFor(idx)!.isLastInBox || this.isBoxCollapsed(this.stageFor(idx))
          )
        )
        .border({
          width: {
            top: this.stageFor(idx)!.isFirstInBox ? 1 : 0,
            left: 1,
            right: 1,
            bottom: this.stageFor(idx)!.isLastInBox || this.isBoxCollapsed(this.stageFor(idx)) ? 1 : 0
          },
          color: this.store.palette.stageBoxBorder
        })
      }
    }
    .width('100%')
    .constraintSize({
      maxWidth:
        this.store.layoutMode === 'portrait_wide'
          ? PuraXMetrics.PORTRAIT_MAX_READ_WIDTH_VP
          : 9999
    })
  }

  build() {
    Column({ space: 0 }) {
      List({ space: 0, scroller: this.scroller }) {
        ForEach(
          this.store.activeSegments(),
          (seg: TranscriptSegment, idx: number) => {
            ListItem() {
              this.TranscriptRow(seg, idx)
            }
          },
          (seg: TranscriptSegment, idx: number) => `${this.store.currentLesson?.lessonId ?? ''}_${this.store.currentTrack}_${seg.id}_${idx}`
        )
      }
      .width('100%')
      .layoutWeight(1)
      .alignListItem(ListItemAlign.Center)
      .padding({ left: 18, right: 18, top: 14, bottom: 8 })
      .scrollBar(BarState.Auto)
      .onScrollIndex((start: number, end: number) => {
        this.firstVisibleIndex = start;
        this.lastVisibleIndex = end;
        if (Date.now() - this.lastProgrammaticJumpAtMs > 900) {
          const active = this.store.activeSegmentIndex;
          const away = active < start || active > end;
          this.store.onUserScrolledTranscript(away);
        }
      })

      // Option 1: Full-Width Docked Return Banner (`42vp`)
      if (this.store.showReturnBanner && this.store.playerTab !== 'vocab') {
        Row({ space: 8 }) {
          Stack({ alignContent: Alignment.Center }) {
            EpVectorIcon({
              kind: 'locate',
              iconSize: 13,
              iconColor: this.store.palette.accent
            })
          }
          .width(22)
          .height(22)
          .backgroundColor(this.store.palette.accentSoft)
          .borderRadius(9999)

          Text(this.store.currentLiveSentenceQuote())
            .fontSize(12)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.store.palette.textPrimary)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        }
        .width('100%')
        .height(42)
        .padding({ left: 16, right: 16 })
        .backgroundColor(this.store.palette.locateBarBg)
        .border({ width: { top: 1 }, color: this.store.palette.locateBarBorder })
        .onClick(() => this.store.snapBackToActiveSentence())
      }
    }
    .width('100%')
    .height('100%')
  }
}

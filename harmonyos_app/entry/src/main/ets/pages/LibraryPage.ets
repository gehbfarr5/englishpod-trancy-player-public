import { PuraXMetrics } from '@englishpod/ep_design';
import { LessonSummary } from '@englishpod/ep_domain';
import { LibraryFilterKey, PlayerStore } from '../state/PlayerStore';
import { EpVectorIcon } from '../widgets/EpVectorIcons';
import { HoldToReplayCourseCard } from '../widgets/HoldToReplayCourseCard';
import { HoldToReplayTopLiveCard } from '../widgets/HoldToReplayTopLiveCard';

function formatClock(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface FilterItem {
  key: LibraryFilterKey;
  label: string;
}

@ComponentV2
export struct LibraryPage {
  @Param store: PlayerStore = PlayerStore.getInstance();
  @Param navT: number = 0.0;
  @Local themeBtnCenterX: number = 280;
  @Local themeBtnCenterY: number = 64;
  private listScroller: Scroller = new Scroller();

  private filterItems(): FilterItem[] {
    return [
      { key: 'all', label: `All (${this.store.lessons.length})` },
      { key: 'in_progress', label: 'In Progress' },
      { key: 'completed', label: 'Completed' }
    ];
  }

  private filterIndex(): number {
    if (this.store.libraryFilter === 'all') return 0;
    if (this.store.libraryFilter === 'in_progress') return 1;
    return 2;
  }

  private filteredLessons(): LessonSummary[] {
    const rev = this.store.progressRevision;
    void rev;
    return this.store.lessons.filter((item) => {
      const rec = this.store.getProgress(item.lessonId);
      const pct = rec.progressPct;
      const isCompleted = rec.isCompleted || pct >= 95;
      const hasStarted = rec.hasStarted || isCompleted || pct > 0;
      if (this.store.libraryFilter === 'completed') {
        return isCompleted;
      }
      if (this.store.libraryFilter === 'in_progress') {
        return hasStarted && pct < 95 && !isCompleted;
      }
      return true;
    });
  }

  private centerActiveLesson(): void {
    const targetId = this.store.currentLesson?.lessonId ?? this.store.lastOpenedLessonId;
    const list = this.filteredLessons();
    const idx = list.findIndex((l) => l.lessonId === targetId);
    if (idx >= 0) {
      this.listScroller.scrollToIndex(idx + 1, true, ScrollAlign.CENTER);
    }
  }

  @Builder
  TopHeaderBar() {
    Row() {
      Column({ space: 2 }) {
        Text('EnglishPod')
          .fontSize(22)
          .fontWeight(FontWeight.Bold)
          .letterSpacing(-0.6)
          .fontColor(this.store.palette.textPrimary)

        Text(`Elementary · ${this.store.lessons.length} Lessons`)
          .fontSize(11.5)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.store.palette.textPassed)
      }
      .alignItems(HorizontalAlign.Start)

      Blank()

      Row({ space: 6 }) {
        // Theme Toggle Pill (Auto / Dark / Light + Circular Reveal)
        Row({ space: 4.5 }) {
          EpVectorIcon({
            kind: this.store.palette.isDark ? 'moon' : 'sun',
            iconSize: 13.5,
            iconColor: this.store.palette.accent
          })
          Text(this.store.themeToggleLabel())
            .fontSize(11.5)
            .fontWeight(FontWeight.Bold)
            .fontColor(
              this.store.themePreference === 'system'
                ? this.store.palette.textPassed
                : this.store.palette.textPrimary
            )
        }
        .height(28)
        .padding({ left: 10, right: 10 })
        .backgroundColor(this.store.palette.surfaceInset)
        .borderRadius(9999)
        .border({
          width: 1,
          color: this.store.themePreference === 'system'
            ? this.store.palette.border
            : this.store.palette.accent
        })
        .onAreaChange((_, area) => {
          const pos = area.globalPosition;
          this.themeBtnCenterX = Number(pos.x) + Number(area.width) / 2;
          this.themeBtnCenterY = Number(pos.y) + Number(area.height) / 2;
        })
        .onClick(() => {
          this.store.toggleThemeWithCircularReveal(this.themeBtnCenterX, this.themeBtnCenterY);
        })
        .gesture(
          LongPressGesture({ repeat: false, duration: 500 })
            .onAction(() => {
              this.store.resetThemeToSystem();
            })
        )

        // Completed Counter Pill ('0 / 335 Done')
        Row() {
          Text(`${this.store.completedLessonCount()} / ${this.store.lessons.length} Done`)
            .fontSize(11.5)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.store.palette.accent)
        }
        .height(28)
        .padding({ left: 10, right: 10 })
        .backgroundColor(this.store.palette.surfaceInset)
        .borderRadius(9999)
        .border({ width: 1, color: this.store.palette.border })

        // Subtle HarmonyOS 7.0 Feature Hub Icon (preserves iOS visual purity)
        Stack({ alignContent: Alignment.Center }) {
          EpVectorIcon({
            kind: 'harmonySpark',
            iconSize: 13,
            iconColor: this.store.palette.accent
          })
        }
        .id('ep_harmony_tools_btn')
        .width(28)
        .height(28)
        .backgroundColor(this.store.palette.surfaceInset)
        .borderRadius(9999)
        .border({ width: 1, color: this.store.palette.border })
        .onClick(() => {
          this.store.harmonySheetOpen = true;
        })
      }
    }
    .width('100%')
  }

  @Builder
  TopLiveCardSection() {
    HoldToReplayTopLiveCard({
      palette: this.store.palette,
      lessonNum: this.store.currentLesson?.lessonNumber ?? 1,
      lessonTitle: this.store.currentLesson?.title ?? (this.store.lessons[0]?.title ?? 'Difficult Customer'),
      trackTimeLabel: `${this.store.currentTrack === 'dg' ? 'DIALOGUE' : 'PODCAST'} · ${formatClock(this.store.currentPositionSec)} / ${formatClock(this.store.durationSec)}`,
      liveHeaderBadge: this.resolveLiveHeaderBadge(),
      liveSentence: this.store.currentLiveSentenceQuote(),
      liveProgress: this.resolveLiveProgress(),
      isPlaying: this.store.isPlaying,
      isPlayedBefore: this.resolveIsPlayedBefore(),
      onCardTap: () => void this.store.continueListening(false),
      onPlayPauseTap: () => {
        if (this.store.isPlaying) {
          void this.store.pause();
        } else {
          void this.store.play();
        }
      },
      onConfirmReplay: () => {
        const lid = this.store.currentLesson?.lessonId ?? this.store.lastOpenedLessonId;
        void this.store.holdToReplayLesson(lid);
      }
    })
  }

  private resolveLiveHeaderBadge(): string {
    const lid = this.store.currentLesson?.lessonId ?? this.store.lastOpenedLessonId;
    const rec = this.store.getProgress(lid);
    const pct = rec.progressPct;
    const isDone = rec.isCompleted || pct >= 95;
    const hasStarted = rec.hasStarted || isDone || pct > 0;
    if (isDone) {
      return pct >= 95 ? 'LESSON COMPLETED' : 'REPLAYING LESSON';
    }
    return hasStarted ? 'CONTINUE LISTENING' : 'START LISTENING';
  }

  private resolveLiveProgress(): number {
    const lid = this.store.currentLesson?.lessonId ?? this.store.lastOpenedLessonId;
    const rec = this.store.getProgress(lid);
    if ((rec.isCompleted || rec.progressPct >= 95) && !this.store.isPlaying) {
      return 1.0;
    }
    if (this.store.durationSec > 1.0) {
      return Math.max(0.0, Math.min(1.0, this.store.currentPositionSec / this.store.durationSec));
    }
    return Math.max(0.0, Math.min(1.0, rec.progressPct / 100.0));
  }

  private resolveIsPlayedBefore(): boolean {
    const lid = this.store.currentLesson?.lessonId ?? this.store.lastOpenedLessonId;
    const rec = this.store.getProgress(lid);
    return rec.isCompleted || rec.hasStarted || rec.progressPct > 0 || this.store.currentPositionSec > 0.5;
  }

  @Builder
  SlidingFilterPills(pillWidth: number) {
    Stack({ alignContent: Alignment.Start }) {
      // P16 Sliding Active Pill Indicator
      Row()
        .width(pillWidth)
        .height(30)
        .backgroundColor(this.store.palette.accent)
        .borderRadius(9999)
        .translate({ x: this.filterIndex() * pillWidth })
        .animation({ duration: 250, curve: Curve.FastOutSlowIn })

      Row() {
        ForEach(
          this.filterItems(),
          (f: FilterItem) => {
            Text(f.label)
              .width(pillWidth)
              .height(30)
              .textAlign(TextAlign.Center)
              .fontSize(11.5)
              .fontWeight(FontWeight.Bold)
              .fontColor(
                this.store.libraryFilter === f.key
                  ? this.store.palette.accentFg
                  : this.store.palette.textPassed
              )
              .maxLines(1)
              .onClick(() => {
                if (this.store.libraryFilter === f.key) {
                  this.centerActiveLesson();
                } else {
                  this.store.libraryFilter = f.key;
                }
              })
          },
          (f: FilterItem) => f.key
        )
      }
    }
    .width(pillWidth * 3 + 6)
    .height(36)
    .padding(3)
    .backgroundColor(this.store.palette.surfaceInset)
    .borderRadius(9999)
    .border({ width: 0.8, color: this.store.palette.border })
  }

  @Builder
  CourseListWell(horizontalPad: number) {
    if (this.filteredLessons().length === 0) {
      Column() {
        Text('No lessons in this filter yet.')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.store.palette.textPassed)
      }
      .width('100%')
      .layoutWeight(1)
      .justifyContent(FlexAlign.Center)
    } else {
      List({ space: 0, scroller: this.listScroller }) {
        ListItem() {
          Row() {
            Text('COURSE LIST')
              .fontSize(10.5)
              .fontWeight(FontWeight.Bold)
              .letterSpacing(0.8)
              .fontColor(this.store.palette.textPassed)
            Blank()
            Text('SCROLL TO BROWSE ↓')
              .fontSize(10.5)
              .fontWeight(FontWeight.Bold)
              .letterSpacing(0.8)
              .fontColor(this.store.palette.textPassed)
          }
          .width('100%')
          .height(24)
          .padding({ left: 4, right: 4, bottom: 8 })
        }

        ForEach(
          this.filteredLessons(),
          (item: LessonSummary) => {
            ListItem() {
              HoldToReplayCourseCard({
                item,
                palette: this.store.palette,
                isDone: this.computeCardIsDone(item.lessonId),
                isCurrent: item.lessonId === this.store.lastOpenedLessonId,
                highlightStatusPill: this.computeCardHighlight(item.lessonId),
                statusLabel: this.computeCardStatusLabel(item.lessonId),
                displayBarValue: this.computeCardBarValue(item.lessonId),
                onTap: () => void this.store.openFromLibrary(item.lessonId),
                onConfirmReplay: () => void this.store.holdToReplayLesson(item.lessonId)
              })
            }
          },
          (item: LessonSummary) => `${item.lessonId}_${this.store.progressRevision}`
        )
      }
      .width('100%')
      .layoutWeight(1)
      .padding({
        left: horizontalPad,
        right: horizontalPad,
        top: 14,
        bottom: 24 + this.store.bottomSafeInsetVp
      })
      .scrollBar(BarState.Auto)
    }
  }

  private computeCardIsDone(lessonId: string): boolean {
    const rec = this.store.getProgress(lessonId);
    return rec.isCompleted || rec.progressPct >= 95;
  }

  private computeCardHighlight(lessonId: string): boolean {
    const rec = this.store.getProgress(lessonId);
    return rec.isCompleted || rec.hasStarted || rec.progressPct > 0;
  }

  private computeCardStatusLabel(lessonId: string): string {
    const rec = this.store.getProgress(lessonId);
    const pct = rec.progressPct;
    const isDone = rec.isCompleted || pct >= 95;
    const hasStarted = rec.hasStarted || isDone || pct > 0;
    if (isDone) {
      if (pct >= 95) return 'Done 100%';
      if (pct > 0) return `Replay ${pct}%`;
      return 'Replay 0%';
    }
    if (pct > 0) return `Resume ${pct}%`;
    if (hasStarted) return 'Resume 0%';
    return 'New';
  }

  private computeCardBarValue(lessonId: string): number {
    const rec = this.store.getProgress(lessonId);
    const pct = rec.progressPct;
    const isDone = rec.isCompleted || pct >= 95;
    if (isDone && pct >= 95) return 1.0;
    return Math.max(0.0, Math.min(1.0, pct / 100.0));
  }

  build() {
    if (this.store.layoutMode === 'landscape_workbench') {
      // Pura X View 16:9.5 Landscape Split Library: 38% Left Gradient Deck + 62% Right iOS Course List
      Row({ space: 0 }) {
        Column({ space: 12 }) {
          this.TopHeaderBar()
          this.TopLiveCardSection()
          this.SlidingFilterPills(86)
          Blank()
        }
        .width('39%')
        .height('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({
          left: 18 + this.store.leftCutoutVp,
          right: 16,
          top: 14,
          bottom: this.store.bottomSafeInsetVp + 8
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
        .border({ width: { right: 1 }, color: this.store.palette.deckBorder })

        Column() {
          this.CourseListWell(16)
        }
        .layoutWeight(1)
        .height('100%')
        .padding({ right: this.store.rightCutoutVp })
        .backgroundColor(this.store.palette.bgWell)
      }
      .width('100%')
      .height('100%')
    } else {
      // Portrait 1:1 iOS Course Library (Edge-to-Edge Top Deck + Recessed Course List Well)
      Column({ space: 0 }) {
        Column({ space: 12 }) {
          this.TopHeaderBar()
          this.TopLiveCardSection()
          this.SlidingFilterPills(98)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({
          left: 18,
          right: 18,
          top: this.store.topSafeInsetVp + 10,
          bottom: 14
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
        .borderRadius({ bottomLeft: 26, bottomRight: 26 })
        .border({ width: { bottom: 1 }, color: this.store.palette.deckBorder })
        .shadow({
          radius: 26,
          color: this.store.palette.isDark ? '#AD000000' : '#1A141413',
          offsetX: 0,
          offsetY: 12
        })

        this.CourseListWell(16)
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.store.palette.bgWell)
    }
  }
}

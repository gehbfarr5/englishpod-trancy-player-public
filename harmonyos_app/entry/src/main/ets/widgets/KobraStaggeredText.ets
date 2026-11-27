/**
 * Kobra Input-OTP inspired staggered 3D perspective character flip
 * 1:1 port of iOS _KobraPrefixWordSwitcher / _KobraStaggeredSuffixText / _KobraFullPhraseSwitcher
 * (main.dart:480-863, 2475-2718).
 */
function easeBounce(t: number): number {
  // cubic-bezier(0.34, 1.38, 0.64, 1.0) approximation for smooth spring overshoot
  const inv = 1.0 - t;
  return 1.0 - inv * inv * (inv - 1.35 * t);
}

function easeSmoothOut(t: number): number {
  const inv = 1.0 - t;
  return 1.0 - inv * inv * inv;
}

@ComponentV2
export struct KobraStaggeredPhrase {
  @Param prefixWord: string = 'Hold';    // 'Hold' | 'Release'
  @Param middleWord: string = 'to';
  @Param actionWord: string = 'replay';  // 'replay' | 'start'
  @Param entryEpoch: number = 0;
  @Param fontSize: number = 14.5;
  @Param fontColor: string = '#060608';
  @Param fontWeight: FontWeight = FontWeight.Bold;
  @Param wordGap: number = 4.5;
  @Param fullWaveOnPrefixChange: boolean = false;

  @Local enterRaw: number = 0.0;
  @Local prefixRaw: number = 1.0;
  private animTimerId: number = -1;
  private enterStartMs: number = 0;
  private prefixStartMs: number = 0;

  aboutToAppear(): void {
    this.triggerFullEnter();
  }

  aboutToDisappear(): void {
    if (this.animTimerId !== -1) {
      clearInterval(this.animTimerId);
      this.animTimerId = -1;
    }
  }

  @Monitor('entryEpoch')
  onEpochChanged(): void {
    this.triggerFullEnter();
  }

  @Monitor('prefixWord')
  onPrefixChanged(): void {
    if (this.fullWaveOnPrefixChange) {
      this.triggerFullEnter();
    } else {
      this.prefixStartMs = Date.now();
      this.prefixRaw = 0.0;
      this.ensureTimer();
    }
  }

  private triggerFullEnter(): void {
    this.enterStartMs = Date.now();
    this.prefixStartMs = this.enterStartMs;
    this.enterRaw = 0.0;
    this.prefixRaw = 1.0;
    this.ensureTimer();
  }

  private ensureTimer(): void {
    if (this.animTimerId !== -1) {
      return;
    }
    this.animTimerId = setInterval(() => {
      const now = Date.now();
      const nextEnter = Math.min(1.0, (now - this.enterStartMs) / 380.0);
      const nextPrefix = Math.min(1.0, (now - this.prefixStartMs) / 380.0);
      this.enterRaw = nextEnter;
      this.prefixRaw = nextPrefix;
      if (nextEnter >= 1.0 && nextPrefix >= 1.0) {
        clearInterval(this.animTimerId);
        this.animTimerId = -1;
      }
    }, 12);
  }

  private charLocalT(globalIdx: number, rawT: number): number {
    const delayFrac = Math.min(0.56, globalIdx * 0.036);
    const spanFrac = 1.0 - delayFrac;
    return Math.max(0.0, Math.min(1.0, (rawT - delayFrac) / spanFrac));
  }

  private charTranslateY(globalIdx: number, rawT: number): number {
    const curved = easeBounce(this.charLocalT(globalIdx, rawT));
    return (1.0 - curved) * 6.5;
  }

  private charRotateX(globalIdx: number, rawT: number): number {
    const curved = easeSmoothOut(this.charLocalT(globalIdx, rawT));
    return (1.0 - curved) * -40.0;
  }

  private charScale(globalIdx: number, rawT: number): number {
    const curved = easeBounce(this.charLocalT(globalIdx, rawT));
    return 0.90 + 0.10 * curved;
  }

  private charOpacity(globalIdx: number, rawT: number): number {
    return this.charLocalT(globalIdx, rawT);
  }

  build() {
    Row({ space: this.wordGap }) {
      // Word 1: Hold / Release
      Row() {
        ForEach(
          this.prefixWord.split(''),
          (ch: string, idx: number) => {
            Text(ch)
              .fontSize(this.fontSize)
              .fontWeight(this.fontWeight)
              .fontColor(this.fontColor)
              .opacity(this.charOpacity(idx, this.fullWaveOnPrefixChange ? this.enterRaw : Math.min(this.enterRaw, this.prefixRaw)))
              .translate({ y: this.charTranslateY(idx, this.fullWaveOnPrefixChange ? this.enterRaw : Math.min(this.enterRaw, this.prefixRaw)) })
              .rotate({ x: 1, y: 0, z: 0, angle: this.charRotateX(idx, this.fullWaveOnPrefixChange ? this.enterRaw : Math.min(this.enterRaw, this.prefixRaw)) })
              .scale({
                x: this.charScale(idx, this.fullWaveOnPrefixChange ? this.enterRaw : Math.min(this.enterRaw, this.prefixRaw)),
                y: this.charScale(idx, this.fullWaveOnPrefixChange ? this.enterRaw : Math.min(this.enterRaw, this.prefixRaw))
              })
          },
          (ch: string, idx: number) => `${this.prefixWord}_${idx}_${ch}`
        )
      }

      // Word 2: to
      Row() {
        ForEach(
          this.middleWord.split(''),
          (ch: string, idx: number) => {
            Text(ch)
              .fontSize(this.fontSize)
              .fontWeight(this.fontWeight)
              .fontColor(this.fontColor)
              .opacity(this.charOpacity(4 + idx, this.enterRaw))
              .translate({ y: this.charTranslateY(4 + idx, this.enterRaw) })
              .rotate({ x: 1, y: 0, z: 0, angle: this.charRotateX(4 + idx, this.enterRaw) })
              .scale({
                x: this.charScale(4 + idx, this.enterRaw),
                y: this.charScale(4 + idx, this.enterRaw)
              })
          },
          (ch: string, idx: number) => `${this.middleWord}_${idx}_${ch}`
        )
      }

      // Word 3: replay / start
      Row() {
        ForEach(
          this.actionWord.split(''),
          (ch: string, idx: number) => {
            Text(ch)
              .fontSize(this.fontSize)
              .fontWeight(this.fontWeight)
              .fontColor(this.fontColor)
              .opacity(this.charOpacity(6 + idx, this.enterRaw))
              .translate({ y: this.charTranslateY(6 + idx, this.enterRaw) })
              .rotate({ x: 1, y: 0, z: 0, angle: this.charRotateX(6 + idx, this.enterRaw) })
              .scale({
                x: this.charScale(6 + idx, this.enterRaw),
                y: this.charScale(6 + idx, this.enterRaw)
              })
          },
          (ch: string, idx: number) => `${this.actionWord}_${idx}_${ch}`
        )
      }
    }
    .justifyContent(FlexAlign.Center)
  }
}

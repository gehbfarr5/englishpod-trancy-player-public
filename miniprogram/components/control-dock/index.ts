/**
 * 底部控制坞组件（Control Dock）。
 */
Component({
  properties: {
    /** 播放时间文案（如 `01:23`）。 */
    positionLabel: { type: String, value: '00:00' },
    /** 音频时长文案（如 `03:45`）。 */
    durationLabel: { type: String, value: '00:00' },
    /** 播放进度百分比（0..100）。 */
    progressPct: { type: Number, value: 0 },
    /** 是否正在播放。 */
    isPlaying: { type: Boolean, value: false },
    /**
     * 当前音轨是否已自然结束并停住（EP-PBC-001 §3.2）。
     *
     * 手机端只有 DG 会出现这个终态（PB 自然结束恒切下一课 / 末课环绕回第一课），
     * 此时主按钮显示重播图标 ↺，点击从本音轨 00:00 重播。
     */
    ended: { type: Boolean, value: false },
    /** 单句循环是否开启。 */
    singleSentenceLoop: { type: Boolean, value: false },
    /** 整课重复是否开启。 */
    repeatEpisode: { type: Boolean, value: false },
    /** 倍速文案（如 `1.0x`）。 */
    speedLabel: { type: String, value: '1.0x' },
    /** 是否存在上一课。 */
    hasPrevLesson: { type: Boolean, value: false },
    /** 是否存在下一课。 */
    hasNextLesson: { type: Boolean, value: false },
  },

  data: {
    /** 是否正在拖动进度条。 */
    scrubbing: false,
    /** 拖动时的临时进度百分比。 */
    scrubPct: 0,
    /** 进度条轨道左边界（px，测量一次）。 */
    trackLeft: 20,
    /** 进度条轨道宽度（px，测量一次）。 */
    trackWidth: 335,
  },

  lifetimes: {
    attached(): void {
      try {
        const info = wx.getWindowInfo();
        const w = info.windowWidth || 375;
        this.setData({ trackLeft: 20, trackWidth: Math.max(100, w - 40) });
      } catch {
        // 忽略
      }
      this.measureTrack();
    },
  },

  methods: {
    measureTrack(): void {
      wx.createSelectorQuery()
        .in(this)
        .select('#scrubTrack')
        .boundingClientRect((rect) => {
          if (rect && rect.width > 0) {
            this.setData({ trackLeft: rect.left, trackWidth: rect.width });
          }
        })
        .exec();
    },

    ratioFromTouch(event: WechatMiniprogram.TouchEvent): number {
      const width = this.data.trackWidth > 0 ? this.data.trackWidth : 335;
      const left = this.data.trackLeft > 0 ? this.data.trackLeft : 20;
      // ⚠️ touchend 事件中 event.touches 为空，触摸点存在于 event.changedTouches 中
      const touch =
        (event.changedTouches && event.changedTouches[0]) ||
        (event.touches && event.touches[0]);
      if (!touch || typeof touch.clientX !== 'number') {
        return Math.min(1, Math.max(0, this.data.scrubPct / 100));
      }
      const ratio = (touch.clientX - left) / width;
      return Math.min(1, Math.max(0, ratio));
    },

    /**
     * WXS 高频拖动开始通知（视图层直接触发）
     */
    onWxsScrubStart(detail: { ratio: number }): void {
      const ratio = detail && typeof detail.ratio === 'number' ? detail.ratio : 0;
      this.setData({ scrubbing: true, scrubPct: ratio * 100 });
      this.triggerEvent('scrubStart', { ratio });
    },

    /**
     * WXS 高频拖动结束通知（视图层松手时触发一次 seek）
     */
    onWxsScrubEnd(detail: { ratio: number }): void {
      const ratio = detail && typeof detail.ratio === 'number' ? detail.ratio : 0;
      this.setData({ scrubbing: false, scrubPct: ratio * 100, progressPct: ratio * 100 });
      this.triggerEvent('scrubEnd', { ratio });
    },

    onScrubStart(event: WechatMiniprogram.TouchEvent): void {
      const ratio = this.ratioFromTouch(event);
      this.setData({ scrubbing: true, scrubPct: ratio * 100 });
      this.triggerEvent('scrubStart', { ratio });
    },

    onScrubMove(event: WechatMiniprogram.TouchEvent): void {
      if (!this.data.scrubbing) {
        return;
      }
      const ratio = this.ratioFromTouch(event);
      this.setData({ scrubPct: ratio * 100 });
      this.triggerEvent('scrubMove', { ratio });
    },

    onScrubEnd(event: WechatMiniprogram.TouchEvent): void {
      if (!this.data.scrubbing) {
        return;
      }
      const ratio = this.ratioFromTouch(event);
      this.setData({ scrubbing: false, scrubPct: ratio * 100, progressPct: ratio * 100 });
      this.triggerEvent('scrubEnd', { ratio });
    },

    onToggle(): void {
      this.triggerEvent('toggle');
    },
    onPrevSentence(): void {
      this.triggerEvent('prevSentence');
    },
    onNextSentence(): void {
      this.triggerEvent('nextSentence');
    },
    onPrevLesson(): void {
      this.triggerEvent('prevLesson');
    },
    onNextLesson(): void {
      this.triggerEvent('nextLesson');
    },
    onToggleLoop(): void {
      this.triggerEvent('toggleLoop');
    },
    onToggleRepeat(): void {
      this.triggerEvent('toggleRepeat');
    },
    onCycleSpeed(): void {
      this.triggerEvent('cycleSpeed');
    },
  },
});

Component({
  properties: {
    lessonId: { type: String, value: '' },
    indexText: { type: String, value: '' },
    title: { type: String, value: '' },
    level: { type: String, value: '' },
    statusLabel: { type: String, value: 'New' },
    isDone: { type: Boolean, value: false },
    isCurrent: { type: Boolean, value: false },
    highlight: { type: Boolean, value: false },
    barValue: { type: Number, value: 0 },
  },

  data: {
    barPercent: 0,
  },

  observers: {
    barValue(value: number): void {
      const v = Number.isFinite(value) ? value : 0;
      this.setData({ barPercent: Math.max(0, Math.min(1, v)) * 100 });
    },
  },

  methods: {
    onTap(): void {
      this.triggerEvent('lessonTap', { lessonId: this.data.lessonId });
    },
  },
});

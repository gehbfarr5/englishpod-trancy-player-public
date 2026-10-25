/**
 * 课程卡片组件（Lesson Card）
 *
 * 遵循高性能轻量化原则：
 * 进度百分比直接通过属性 `barPercent` 下发，移除内部 observers 及级联 setData，
 * 彻底消除长列表初次装载与分片增量加载时的二次渲染开销。
 */
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
    barPercent: { type: Number, value: 0 },
  },

  methods: {
    onTap(): void {
      this.triggerEvent('lessonTap', { lessonId: this.data.lessonId });
    },
  },
});

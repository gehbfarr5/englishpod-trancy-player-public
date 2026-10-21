/**
 * 继续收听聚光灯卡组件（Continue Listening spotlight card）。
 *
 * 纯展示组件：所有数据由页面注入，交互以事件方式回抛：
 *   - 点击整卡 → 触发 `cardtap`（页面据此跳转播放器）；
 *   - 点击圆形播放/暂停按钮 → 触发 `toggle`。
 */
Component({
  properties: {
    /** 课程 ID。 */
    lessonId: { type: String, value: '' },
    /** 课程标题。 */
    title: { type: String, value: '' },
    /** 徽章文案。 */
    badge: { type: String, value: 'CONTINUE LISTENING' },
    /** 课程属性（例如 "Elementary · Daily Life"）。 */
    attributes: { type: String, value: '' },
    /** 实时当前句文本（兼容保留）。 */
    sentenceText: { type: String, value: '' },
    /** 句文本兜底文案。 */
    fallbackText: { type: String, value: '' },
    /** 进度百分比（0..100）。 */
    progressPct: { type: Number, value: 0 },
    /** 是否正在播放。 */
    isPlaying: { type: Boolean, value: false },
  },

  data: {
    barWidth: 0,
  },

  observers: {
    progressPct(value: number): void {
      const pct = Number.isFinite(value) ? value : 0;
      this.setData({ barWidth: Math.max(0, Math.min(100, pct)) });
    },
  },

  methods: {
    onCardTap(): void {
      this.triggerEvent('cardtap');
    },

    onToggle(): void {
      this.triggerEvent('toggle');
    },
  },
});

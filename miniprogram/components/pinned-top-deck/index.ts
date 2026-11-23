/**
 * 顶部钉住区容器组件（Elevated Pinned Top Deck）。
 *
 * 负责「容器 + Header Row + 完成度 pill（设备同步入口）+ 继续收听播放空间插槽」。
 */
Component({
  options: {
    multipleSlots: true,
  },

  properties: {
    /** App 展示名（占位常量，由页面传入）。 */
    appName: { type: String, value: '' },
    /** 副标题，如 `Elementary · 335 Lessons`。 */
    subtitle: { type: String, value: '' },
    /** 完成度文案，如 `3 / 335 Done`。 */
    completionText: { type: String, value: '' },
    /** 多端同步连接状态：unlinked | synced | syncing | offline | error。 */
    syncStatus: { type: String, value: 'unlinked' },
    /** 状态栏高度（px，运行时计算）。 */
    safeTopPx: { type: Number, value: 0 },
    /** 导航栏高度（px，运行时计算，用于给右上角胶囊按钮预留透明安全区）。 */
    navBarPx: { type: Number, value: 0 },
  },

  data: {},

  methods: {
    onCompletionTap(): void {
      this.triggerEvent('completiontap');
    },
  },
});

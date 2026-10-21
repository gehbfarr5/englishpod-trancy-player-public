/**
 * 顶部钉住区容器组件（Elevated Pinned Top Deck）。
 *
 * 只负责「容器 + Header Row + 完成度 pill + 两个具名插槽」：
 *   - `continue` 插槽：继续收听聚光灯卡；
 *   - `filters`  插槽：三态筛选 pills。
 *
 * 顶部安全区通过 `safeTopPx`（状态栏高度）与 `navBarPx`（导航栏高度，为胶囊按钮预留）
 * 由页面在运行时计算后传入——**组件本身不写死任何像素**。
 */
Component({
  options: {
    // 需要同时投影两个具名插槽。
    multipleSlots: true,
  },

  properties: {
    /** App 展示名（占位常量，由页面传入）。 */
    appName: { type: String, value: '' },
    /** 副标题，如 `Elementary · 30 Lessons`。 */
    subtitle: { type: String, value: '' },
    /** 完成度文案，如 `3 / 30 Done`。 */
    completionText: { type: String, value: '' },
    /** 状态栏高度（px，运行时计算）。 */
    safeTopPx: { type: Number, value: 0 },
    /** 导航栏高度（px，运行时计算，用于给右上角胶囊按钮预留透明安全区）。 */
    navBarPx: { type: Number, value: 0 },
  },

  data: {},

  methods: {},
});

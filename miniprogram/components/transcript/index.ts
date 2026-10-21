/**
 * 字幕组件。
 *
 * 纯渲染 + 事件上抛：
 *   - 点击任意行 → `lineTap`（`detail = { segIdx }`）；
 *   - 点击舞台盒子头部 → `toggle`（转发自 `stage-box`，`detail = { boxGroupId }`）。
 *
 * 行 id 为 `seg-<下标>`，父级可用 `scroll-into-view` 自动定位当前句。
 * ⚠️ Part 0 收敛后不再接收/透传 `activeWordIdx`（iOS 无逐词高亮）。
 */
Component({
  properties: {
    /** 区块序列（主持人行 / 舞台盒子）。 */
    blocks: { type: Array, value: [] },
    /** 当前高亮片段下标。 */
    activeSegIdx: { type: Number, value: -1 },
    /** 已折叠的盒子 ID 列表（透传给 stage-box）。 */
    collapsedBoxIds: { type: Array, value: [] },
  },

  methods: {
    /** 点击某行：派发 `lineTap`。 */
    onLineTap(event: WechatMiniprogram.TouchEvent): void {
      const segIdx = Number(event.currentTarget.dataset.idx);
      if (!Number.isFinite(segIdx) || segIdx < 0) {
        return;
      }
      this.triggerEvent('lineTap', { segIdx });
    },

    /** 转发舞台盒子的折叠切换。 */
    onToggleBox(event: WechatMiniprogram.CustomEvent<{ boxGroupId: number }>): void {
      this.triggerEvent('toggleBox', { boxGroupId: event.detail.boxGroupId });
    },

    /**
     * 量测某字幕行的视口内位置（供父级做返回定位条可见性判定，A-4）。
     *
     * ⚠️ 行节点位于**本自定义组件内部**，页面的 `createSelectorQuery` 选不到；
     * 必须由组件用 `.in(this)` 量测，再把结果回调给父级。
     */
    measureRow(segIdx: number, cb: (rect: { top: number; bottom: number } | null) => void): void {
      wx.createSelectorQuery()
        .in(this)
        .select(`#seg-${segIdx}`)
        .boundingClientRect((rect) => {
          cb(rect ? { top: rect.top, bottom: rect.bottom } : null);
        })
        .exec();
    },
  },
});

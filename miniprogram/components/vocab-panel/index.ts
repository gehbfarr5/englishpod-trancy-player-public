/**
 * Vocab 词汇面板组件。
 *
 * 手风琴：父级用 `expandedIndex` 控制单开；点击头部派发 `toggle`（`detail = { index }`），
 * 点击例句派发 `playExample`（`detail = { track, segIdx }`）。
 *
 * 展开：**瞬时**（`max-height` 只作裁剪、不参与过渡）+ 120ms `opacity` 淡入（B 批「减少动效」）。
 * 批次 4 的「批量量测内层自然高度」已随之移除 —— 不再过渡高度后，`--ep-acc-max-h` 上限
 * 就是唯一机制（它足够宽松，不会再出现裁切）。
 */
Component({
  properties: {
    /** 词条列表（含课内例句）。 */
    entries: { type: Array, value: [] },
    /** 当前展开的词条下标（-1 表示全部收起）。 */
    expandedIndex: { type: Number, value: -1 },
  },

  methods: {
    /** 切换展开。 */
    onToggle(event: WechatMiniprogram.TouchEvent): void {
      const index = Number(event.currentTarget.dataset.idx);
      if (!Number.isFinite(index)) {
        return;
      }
      this.triggerEvent('toggle', { index });
    },

    /** 点例句跳播。 */
    onExample(event: WechatMiniprogram.TouchEvent): void {
      const segIdx = Number(event.currentTarget.dataset.idx);
      const track = String(event.currentTarget.dataset.track || '');
      if (!Number.isFinite(segIdx) || segIdx < 0 || !track) {
        return;
      }
      this.triggerEvent('playExample', { track, segIdx });
    },
  },
});

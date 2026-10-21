/**
 * 舞台盒子组件。
 *
 * 头部（徽章 + 副标题 + chevron）固定；主体为插槽。
 * 折叠状态由父级下发的 `collapsedIds`（已折叠的 boxGroupId 列表）决定，
 * 点击头部派发 `toggle`（`detail = { boxGroupId }`）。
 *
 * 展开：**瞬时**（`max-height` 只作裁剪、不参与过渡）+ 120ms `opacity` 淡入（B 批「减少动效」）。
 * 批次 4 的「量测内层自然高度」已随之移除 —— 不再过渡高度后，`--ep-stagebox-max-h` 上限
 * 就是唯一机制（它足够宽松，不会再出现裁切）。
 */
Component({
  properties: {
    /** 顶部徽章文案。 */
    badgeText: { type: String, value: '' },
    /** 副标题。 */
    subText: { type: String, value: '' },
    /** 盒子类型（`dialogue` / `example` / `phrase`）。 */
    stageKind: { type: String, value: 'dialogue' },
    /** 盒子分组 ID。 */
    boxGroupId: { type: Number, value: 0 },
    /** 已折叠的盒子 ID 列表。 */
    collapsedIds: { type: Array, value: [] },
  },

  methods: {
    /** 切换折叠：向上派发 `toggle`。 */
    onToggle(): void {
      this.triggerEvent('toggle', { boxGroupId: this.data.boxGroupId });
    },
  },
});

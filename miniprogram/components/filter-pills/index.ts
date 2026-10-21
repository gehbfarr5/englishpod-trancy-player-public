/**
 * 三态筛选 pills 组件（滑动指示器）。
 *
 * 用法：
 * ```html
 * <filter-pills filters="{{filters}}" active-key="{{activeFilter}}" bind:change="onFilterChange" />
 * ```
 *
 * - `filters`：`{ key: string; label: string }[]`；
 * - `activeKey`：当前选中筛选键；
 * - 触发 `change` 事件，`detail = { key }`。
 */
interface FilterPillItem {
  /** 筛选键（`all` / `in_progress` / `completed`）。 */
  key: string;
  /** 展示文案。 */
  label: string;
}

Component({
  properties: {
    /** 筛选项列表。 */
    filters: { type: Array, value: [] as FilterPillItem[] },
    /** 当前选中筛选键。 */
    activeKey: { type: String, value: 'all' },
  },

  data: {
    /** 筛选项数量（默认 3）。 */
    filterCount: 3,
    /** 指示块平移步数（= 选中项下标）。 */
    stepIndex: 0,
  },

  observers: {
    'filters, activeKey'(filters: FilterPillItem[], activeKey: string): void {
      const list = Array.isArray(filters) ? filters : [];
      const count = list.length > 0 ? list.length : 3;
      const rawIndex = list.findIndex((item) => item.key === activeKey);
      const stepIndex = rawIndex >= 0 ? rawIndex : 0;
      this.setData({
        filterCount: count,
        stepIndex,
      });
    },
  },

  methods: {
    /** 点击某个 chip：向上派发 `change` 事件。 */
    onChipTap(event: WechatMiniprogram.TouchEvent): void {
      const key = event.currentTarget.dataset.key as string | undefined;
      if (!key) {
        return;
      }
      this.triggerEvent('change', { key });
    },
  },
});

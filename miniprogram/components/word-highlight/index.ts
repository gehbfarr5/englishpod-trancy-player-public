/**
 * 句级高亮组件（字幕行内的词节点渲染）。
 *
 * 纯展示：词节点与 `isVocab` 由父级在加载期一次性注入；播放中只接收
 * `activeSegIdx` 一个游标，由 WXS 在视图层按**句**算 class。
 *
 * ⚠️ iOS 定稿没有逐词高亮：本组件不再接收 `activeWordIdx`（已随 Part 0 收敛删除）。
 */
Component({
  properties: {
    /** 词节点：`{ text: string; isVocab: boolean }[]`。 */
    words: { type: Array, value: [] },
    /** 本行对应的全局片段下标（供 WXS 判定已播/当前/未播）。 */
    segIndex: { type: Number, value: 0 },
    /** 当前高亮片段下标。 */
    activeSegIdx: { type: Number, value: -1 },
  },
});

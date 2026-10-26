/**
 * 课程解锁收银台底弹窗组件（Unlock Modal）
 *
 * 遵循微信小程序设计规范：
 * - 底部抽屉（Bottom Sheet）上滑微动效；
 * - 适配底部 Home Indicator 安全区（safe-area-inset-bottom）；
 * - 清晰展示 ¥9.9 定价与终身畅听权益；
 * - 提供取消关闭与一键解锁动作抛出。
 */
import { LIFETIME_UNLOCK_PRICE_YUAN } from '../../core/entitlement';

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    priceYuan: {
      type: String,
      value: LIFETIME_UNLOCK_PRICE_YUAN,
    },
    loading: {
      type: Boolean,
      value: false,
    },
  },

  methods: {
    onClose(): void {
      if (this.data.loading) return;
      this.triggerEvent('close');
    },

    onUnlock(): void {
      if (this.data.loading) return;
      this.triggerEvent('unlock');
    },

    noop(): void {
      // 阻止冒泡
    },
  },
});

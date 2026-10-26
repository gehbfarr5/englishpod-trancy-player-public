const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'user_entitlements';

/**
 * 微信虚拟支付发货回调云函数
 * 当用户完成支付后，微信会推送 xpay_goods_deliver_notify 事件到本云函数
 */
exports.main = async (event, context) => {
  try {
    console.log('[virtualPayDeliver] 收到发货通知：', event);

    const openid = event.openid || (event.ToUserName ? event.FromUserName : '');
    const outTradeNo = event.outTradeNo || (event.Attach ? JSON.parse(event.Attach).outTradeNo : '');

    if (!openid) {
      console.warn('[virtualPayDeliver] 未知 openid，忽略');
      return { ErrCode: 0, ErrMsg: 'success' };
    }

    // 更新或插入用户终身 VIP 权益
    const existing = await db.collection(COLLECTION).where({ openid }).limit(1).get();
    if (existing.data && existing.data.length > 0) {
      await db.collection(COLLECTION).doc(existing.data[0]._id).update({
        data: {
          isLifetimeVip: true,
          unlockedAt: db.serverDate(),
          lastOrderNo: outTradeNo,
        },
      });
    } else {
      await db.collection(COLLECTION).add({
        data: {
          openid,
          isLifetimeVip: true,
          unlockedAt: db.serverDate(),
          lastOrderNo: outTradeNo,
        },
      });
    }

    console.log('[virtualPayDeliver] 发货处理完成：', openid);
    return { ErrCode: 0, ErrMsg: 'success' };
  } catch (err) {
    console.error('[virtualPayDeliver] 发货处理异常：', err);
    // 微信要求异常时返回 ErrCode，以便微信重试
    return { ErrCode: -1, ErrMsg: err.message || 'fail' };
  }
};

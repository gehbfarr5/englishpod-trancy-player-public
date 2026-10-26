const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'user_entitlements';

exports.main = async (event, context) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;

    if (!openid) {
      return {
        success: false,
        data: { isVip: false },
        error: { code: 'NO_OPENID', message: '无法获取用户 OPENID' },
      };
    }

    const res = await db.collection(COLLECTION).where({ openid }).limit(1).get();
    if (res.data && res.data.length > 0) {
      const doc = res.data[0];
      return {
        success: true,
        data: {
          isVip: Boolean(doc.isLifetimeVip || doc.isVip),
          unlockedAt: doc.unlockedAt || doc.createdAt,
          orderId: doc.orderId,
        },
        error: null,
      };
    }

    return {
      success: true,
      data: { isVip: false },
      error: null,
    };
  } catch (err) {
    console.error('[getEntitlement] 查询失败：', err);
    return {
      success: false,
      data: { isVip: false },
      error: { code: 'INTERNAL_ERROR', message: err.message || String(err) },
    };
  }
};

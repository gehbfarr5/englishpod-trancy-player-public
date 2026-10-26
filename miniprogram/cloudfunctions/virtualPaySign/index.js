const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;

    if (!openid) {
      return {
        success: false,
        error: { code: 'NO_OPENID', message: '无法获取用户 OPENID' },
      };
    }

    const productId = event.productId || 'ep_unlock_all';
    const productName = event.productName || 'EnglishPod 335课终身精听通卡';
    const priceFen = event.priceFen || 990;
    const outTradeNo = `EP_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const signData = {
      offerId: process.env.VIRTUAL_PAY_OFFER_ID || '',
      buyQuantity: 1,
      env: 0, // 0: 正式版, 1: 沙箱
      currencyType: 'CNY',
      platform: 'android',
      productId,
      goodsPrice: priceFen,
      outTradeNo,
      attach: JSON.stringify({ openid, productId }),
    };

    // 微信虚拟支付签名（如果环境变量配置了 XPAY_APP_KEY，则计算真实 HMAC-SHA256 签名）
    const appKey = process.env.XPAY_APP_KEY || '';
    let paySig = '';
    let signature = '';
    if (appKey) {
      const signStr = `buyQuantity=1&currencyType=CNY&env=${signData.env}&goodsPrice=${priceFen}&outTradeNo=${outTradeNo}&platform=android&productId=${productId}&key=${appKey}`;
      paySig = crypto.createHmac('sha256', appKey).update(signStr).digest('hex');
      signature = crypto.createHmac('sha256', appKey).update(JSON.stringify(signData)).digest('hex');
    }

    return {
      success: true,
      signData,
      paySig,
      signature,
      outTradeNo,
    };
  } catch (err) {
    console.error('[virtualPaySign] 签名生成失败：', err);
    return {
      success: false,
      error: { code: 'SIGN_FAILED', message: err.message || String(err) },
    };
  }
};

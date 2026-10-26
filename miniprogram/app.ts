import { LearningStore } from './adapters/wechat/learningStore';
import { CLOUD_ENV_ID } from './config/env';

/**
 * 小程序入口。
 *
 * 职责（M1）：
 *   1. 启动时初始化微信云开发（CloudBase），后续所有课程数据/音频都来自云端；
 *   2. 暴露全局状态（`cloudReady` / `envId`）供各页面判断云能力是否就绪。
 *
 * 注意：本文件是「平台相关」层，允许调用 `wx.*`。
 *      纯业务逻辑请勿写在此处，应下沉到 `core/`。
 */
App<IAppOption>({
  globalData: {
    cloudReady: false,
    envId: CLOUD_ENV_ID,
  },

  onLaunch(): void {
    // 微信小程序版本更新管理器：检测到新版本时自动提示重启应用，防止旧版本强缓存
    if (typeof wx !== 'undefined' && typeof wx.getUpdateManager === 'function') {
      try {
        const updateManager = wx.getUpdateManager();
        updateManager.onUpdateReady(() => {
          wx.showModal({
            title: '更新提示',
            content: '新版本已下载完毕，是否立即重启体验最新版本？',
            confirmText: '立即重启',
            showCancel: false,
            success: (res) => {
              if (res.confirm) {
                updateManager.applyUpdate();
              }
            },
          });
        });
      } catch (err) {
        console.warn('[app] 更新管理器启动异常：', err);
      }
    }

    // §4.1.10：一次性清除 0.3.5 及更早的旧进度键（owner 2026-10-20 授权）。
    // 只删白名单里的两个键，不碰 ep_learning_v2_*；失败也不影响启动。
    try {
      const result = new LearningStore().purgeLegacyKeys();
      if (result.removed.length > 0) {
        console.info('[app] 已清除旧版进度键：', result.removed.join(', '));
      }
    } catch (err) {
      console.warn('[app] 清除旧版进度键失败（忽略）：', err);
    }

    if (!wx.cloud) {
      // 基础库过低或未开通云开发时会走到这里。
      console.error('[app] 当前基础库不支持 wx.cloud，请将基础库调整为 2.2.3 及以上，并开通云开发。');
      return;
    }

    if (CLOUD_ENV_ID === 'REPLACE_WITH_YOUR_CLOUD_ENV_ID') {
      console.warn('[app] 检测到 CLOUD_ENV_ID 仍为占位符，请先在 config/env.ts 中替换为你的云开发环境 ID。');
    }

    try {
      wx.cloud.init({
        env: CLOUD_ENV_ID,
        // 开启后可在云开发控制台看到用户访问来源，便于排查。
        traceUser: true,
      });
      this.globalData.cloudReady = true;
      console.info(`[app] 云开发初始化完成，envId=${CLOUD_ENV_ID}`);
    } catch (err) {
      console.error('[app] 云开发初始化失败：', err);
    }
  },
});

/// <reference types="miniprogram-api-typings" />

/**
 * 全局小程序类型扩展。
 *
 * 说明：
 * - 这里只放「跨页面共享」的全局类型声明，业务类型请放到 `core/types.ts`。
 * - `App` 实例上的自定义字段必须在此扩展，供各页面通过 `getApp<IAppOption>()` 使用。
 */

/** 全局 App 实例的自定义数据结构。 */
interface IAppOption {
  globalData: {
    /** 云开发是否已完成初始化。 */
    cloudReady: boolean;
    /** 当前使用的云开发环境 ID。 */
    envId: string;
  };
}

/**
 * 单测用内存键值端口（实现 `adapters/wechat/learningStore.ts` 的 `SyncKeyValue`）。
 *
 * 用它代替 `wx.setStorageSync` 可以确定性地模拟：
 *   - 正常往返；
 *   - **写入失败**（§4.1.8：不得谎报已保存）；
 *   - **杀进程重启**（同一份 Map 交给新的 store/journal 实例）。
 */

import { SyncKeyValue } from '../adapters/wechat/learningStore';

export interface MemoryKeyValue extends SyncKeyValue {
  /** 底层数据（跨「进程重启」复用时交同一个实例）。 */
  readonly data: Map<string, string>;
  /** 让写入失败（模拟容量超限）。 */
  failWrites: boolean;
  /** 统计每个键的写入次数。 */
  readonly writes: Map<string, number>;
}

/** 创建内存键值端口。 */
export function createMemoryKeyValue(): MemoryKeyValue {
  const data = new Map<string, string>();
  const writes = new Map<string, number>();
  const kv: MemoryKeyValue = {
    data,
    writes,
    failWrites: false,
    get(key: string): unknown {
      return data.has(key) ? data.get(key) : '';
    },
    set(key: string, value: string): boolean {
      if (kv.failWrites) {
        return false;
      }
      data.set(key, value);
      writes.set(key, (writes.get(key) ?? 0) + 1);
      return true;
    },
    remove(key: string): boolean {
      if (kv.failWrites) {
        return false;
      }
      return data.delete(key);
    },
    keys(): string[] {
      return Array.from(data.keys());
    },
  };
  return kv;
}

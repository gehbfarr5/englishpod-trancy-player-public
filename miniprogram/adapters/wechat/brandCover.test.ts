/**
 * `adapters/wechat/brandCover.ts` 单测。
 *
 * 通过注入最小 `wx` 全局 mock 与可控时钟（替换 Date.now，不 sleep），覆盖：
 *   - 首次解析：上传 → 换取临时链接 → 写入 v2 持久缓存（≤1 小时；maxAge 更短取更短）；
 *   - 未过期命中：内存命中不读盘、持久命中（模拟重启）不再上传/换链；
 *   - 过期：内存/持久过期后重新解析，不返回旧链接；
 *   - 畸形/过期/非 https 持久项与 v1 遗留 24 小时项一律不信任；
 *   - 云/存储失败与 wx.cloud 缺失：优雅空结果，不抛错。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { clearBrandCoverMemoryCache, resolveBrandCoverHttps } from './brandCover';

const HTTPS_BASE = 'https://bucket.tcb.qcloud.la/brand/brand_icon_dark.png';
const V1_KEY = 'ep_brand_cover_https_v1';
const V2_KEY = 'ep_brand_cover_https_v2';

/** 固定起始时刻与缓存上限（毫秒），保证过期判定完全确定。 */
const START_MS = 1700000000000;
const ONE_HOUR_MS = 60 * 60 * 1000;

type WxMockOptions = {
  tempUrl?: (callNo: number) => string;
  maxAgeSec?: number;
  failUpload?: boolean;
  failTempUrl?: boolean;
  failGetStorage?: boolean;
  failSetStorage?: boolean;
};

interface WxMock {
  store: Map<string, unknown>;
  reads: Record<string, number>;
  writes: Record<string, number>;
  removals: Record<string, number>;
  copies: () => number;
  uploadCalls: () => number;
  tempUrlCalls: () => number;
}

/** 安装 wx mock（存储/文件系统/云），带各维度调用计数。 */
function installWxMock(opts: WxMockOptions = {}): WxMock {
  const store = new Map<string, unknown>();
  const reads: Record<string, number> = {};
  const writes: Record<string, number> = {};
  const removals: Record<string, number> = {};
  let copies = 0;
  let uploadCalls = 0;
  let tempUrlCalls = 0;
  const tempUrlOf = opts.tempUrl ?? ((callNo: number) => `${HTTPS_BASE}?v=${callNo}`);

  const wxMock = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getFileSystemManager: () => ({
      accessSync: (): void => {
        throw new Error('mock: local file not exists');
      },
      copyFileSync: (): void => {
        copies += 1;
      },
    }),
    getStorageSync: (key: string): unknown => {
      reads[key] = (reads[key] ?? 0) + 1;
      if (opts.failGetStorage) {
        throw new Error('mock storage read failure');
      }
      return store.has(key) ? store.get(key) : '';
    },
    setStorageSync: (key: string, value: unknown): void => {
      writes[key] = (writes[key] ?? 0) + 1;
      if (opts.failSetStorage) {
        throw new Error('mock storage write failure');
      }
      store.set(key, value);
    },
    removeStorageSync: (key: string): void => {
      removals[key] = (removals[key] ?? 0) + 1;
      store.delete(key);
    },
    cloud: {
      uploadFile: (): Promise<{ fileID: string }> => {
        uploadCalls += 1;
        if (opts.failUpload) {
          return Promise.reject(new Error('mock upload failure'));
        }
        return Promise.resolve({ fileID: 'cloud://env.bucket/brand/brand_icon_dark.png' });
      },
      getTempFileURL: (param: { fileList: string[] }): Promise<{ fileList: unknown[] }> => {
        tempUrlCalls += 1;
        if (opts.failTempUrl) {
          return Promise.reject(new Error('mock getTempFileURL failure'));
        }
        return Promise.resolve({
          fileList: param.fileList.map((fileID) => ({
            fileID,
            tempFileURL: tempUrlOf(tempUrlCalls),
            maxAge: opts.maxAgeSec ?? 0,
            status: 0,
            errMsg: 'ok',
          })),
        });
      },
    },
  };
  (globalThis as unknown as { wx: unknown }).wx = wxMock;
  return {
    store,
    reads,
    writes,
    removals,
    copies: () => copies,
    uploadCalls: () => uploadCalls,
    tempUrlCalls: () => tempUrlCalls,
  };
}

/** 每个用例的独立起点：清空模块内存缓存 + 全新 wx mock。 */
function setup(opts: WxMockOptions = {}): WxMock {
  clearBrandCoverMemoryCache();
  return installWxMock(opts);
}

/** 可控时钟：测试内替换 Date.now（不 sleep），结束自动还原。 */
async function withFakeClock<T>(body: (advanceMs: (ms: number) => void) => Promise<T>): Promise<T> {
  const realNow = Date.now;
  let currentMs = START_MS;
  Date.now = () => currentMs;
  try {
    return await body((ms: number) => {
      currentMs += ms;
    });
  } finally {
    Date.now = realNow;
  }
}

/** 取出持久缓存里的 v2 项。 */
function v2Entry(store: Map<string, unknown>): { url: string; expireAtMs: number } {
  return store.get(V2_KEY) as { url: string; expireAtMs: number };
}

describe('resolveBrandCoverHttps · 首次解析与缓存写入', () => {
  test('首次解析：上传 + 换取临时链接，写入 ≤1 小时的 v2 持久缓存并清除 v1', async () => {
    const mock = setup();
    await withFakeClock(async () => {
      const url = await resolveBrandCoverHttps();
      assert.equal(url, `${HTTPS_BASE}?v=1`);
      assert.equal(mock.uploadCalls(), 1);
      assert.equal(mock.tempUrlCalls(), 1);
      assert.equal(mock.copies(), 1);

      const entry = v2Entry(mock.store);
      assert.equal(entry.url, `${HTTPS_BASE}?v=1`);
      assert.equal(entry.expireAtMs - START_MS, ONE_HOUR_MS, '无 maxAge → 保守 1 小时上限');
      assert.equal(mock.writes[V2_KEY] ?? 0, 1);
      assert.equal(mock.removals[V1_KEY] ?? 0, 1, '成功写入 v2 后应尽力清除 v1');
    });
  });

  test('provider maxAge 更短（30 分钟）→ 取更短有效期', async () => {
    const mock = setup({ maxAgeSec: 1800 });
    await withFakeClock(async () => {
      await resolveBrandCoverHttps();
      assert.equal(v2Entry(mock.store).expireAtMs - START_MS, 1800 * 1000);
    });
  });

  test('provider maxAge 更长（2 小时）→ 封顶 1 小时', async () => {
    const mock = setup({ maxAgeSec: 7200 });
    await withFakeClock(async () => {
      await resolveBrandCoverHttps();
      assert.equal(v2Entry(mock.store).expireAtMs - START_MS, ONE_HOUR_MS);
    });
  });

  test('解析结果非 https：照常返回但不进入任何缓存', async () => {
    const mock = setup({ tempUrl: () => 'http://insecure.example/cover.png' });
    await withFakeClock(async () => {
      assert.equal(await resolveBrandCoverHttps(), 'http://insecure.example/cover.png');
      assert.ok(!mock.store.has(V2_KEY), '非 https 不应写入持久缓存');
      await resolveBrandCoverHttps();
      assert.equal(mock.uploadCalls(), 2, '未缓存 → 再次调用应重新解析');
    });
  });
});

describe('resolveBrandCoverHttps · 未过期命中', () => {
  test('内存命中：不再读盘、不再上传/换链', async () => {
    const mock = setup();
    await withFakeClock(async () => {
      const first = await resolveBrandCoverHttps();
      const second = await resolveBrandCoverHttps();
      assert.equal(second, first);
      assert.equal(mock.uploadCalls(), 1);
      assert.equal(mock.tempUrlCalls(), 1);
      assert.equal(mock.reads[V2_KEY] ?? 0, 1, '仅首次解析读盘一次（未命中），内存命中不读盘');
    });
  });

  test('持久命中（模拟重启清内存）：不重新上传/换链', async () => {
    const mock = setup();
    await withFakeClock(async () => {
      const first = await resolveBrandCoverHttps();
      clearBrandCoverMemoryCache();
      const second = await resolveBrandCoverHttps();
      assert.equal(second, first);
      assert.equal(mock.uploadCalls(), 1, '持久命中不应重新上传');
      assert.equal(mock.tempUrlCalls(), 1);
      assert.equal(mock.reads[V2_KEY] ?? 0, 2, '两次读盘：首解析未命中 + 重启后持久命中');
    });
  });
});

describe('resolveBrandCoverHttps · 过期重新解析', () => {
  test('内存缓存过期 → 重新解析，不返回旧链接', async () => {
    const mock = setup();
    await withFakeClock(async (advanceMs) => {
      const first = await resolveBrandCoverHttps();
      advanceMs(ONE_HOUR_MS + 1);
      const second = await resolveBrandCoverHttps();
      assert.notEqual(second, first);
      assert.equal(second, `${HTTPS_BASE}?v=2`);
      assert.equal(mock.uploadCalls(), 2, '过期后应重新解析');
      assert.equal(mock.tempUrlCalls(), 2);
    });
  });

  test('maxAge=30 分钟 → 满 30 分钟即重解析（推进时钟，不睡等）', async () => {
    const mock = setup({ maxAgeSec: 1800 });
    await withFakeClock(async (advanceMs) => {
      const first = await resolveBrandCoverHttps();
      advanceMs(1800 * 1000 + 1);
      assert.notEqual(await resolveBrandCoverHttps(), first);
      assert.equal(mock.uploadCalls(), 2);
    });
  });

  test('持久缓存过期（模拟重启清内存）→ 重新解析', async () => {
    const mock = setup();
    await withFakeClock(async (advanceMs) => {
      await resolveBrandCoverHttps();
      advanceMs(ONE_HOUR_MS + 1);
      clearBrandCoverMemoryCache();
      assert.equal(await resolveBrandCoverHttps(), `${HTTPS_BASE}?v=2`);
      assert.equal(mock.uploadCalls(), 2);
    });
  });
});

describe('resolveBrandCoverHttps · 不信任坏缓存', () => {
  const badEntries: Array<[string, unknown]> = [
    ['空串（未命中默认值）', ''],
    ['纯字符串', 'https://plain.example/cover.png'],
    ['null', null],
    [
      '非 https 链接',
      { url: 'http://insecure.example/cover.png', expireAtMs: START_MS + 24 * 3600 * 1000 },
    ],
    ['无主机 HTTPS', { url: 'https://', expireAtMs: START_MS + 1000 }],
    ['含空白 HTTPS', { url: 'https://bad host/cover.png', expireAtMs: START_MS + 1000 }],
    ['v2 超长有效期', { url: 'https://ok.example/cover.png', expireAtMs: START_MS + ONE_HOUR_MS + 1 }],
    ['expireAtMs 为 Infinity', { url: 'https://ok.example/cover.png', expireAtMs: Number.POSITIVE_INFINITY }],
    ['恰好到期', { url: 'https://ok.example/cover.png', expireAtMs: START_MS }],
    ['缺 expireAtMs', { url: 'https://ok.example/cover.png' }],
    ['expireAtMs 非数字', { url: 'https://ok.example/cover.png', expireAtMs: 'soon' }],
    ['expireAtMs 为 NaN', { url: 'https://ok.example/cover.png', expireAtMs: Number.NaN }],
    ['已过期', { url: 'https://ok.example/cover.png', expireAtMs: START_MS - 1 }],
  ];

  for (const [label, bad] of badEntries) {
    test(`畸形/过期持久项（${label}）→ 不供给旧值，触发重新解析`, async () => {
      const mock = setup();
      await withFakeClock(async () => {
        mock.store.set(V2_KEY, bad);
        const url = await resolveBrandCoverHttps();
        assert.equal(url, `${HTTPS_BASE}?v=1`, '应重新解析得到新链接');
        assert.equal(mock.uploadCalls(), 1, '坏持久项不应被复用');
      });
    });
  }

  test('v1 遗留 24 小时项不被信任：不读 v1、重新解析并清除', async () => {
    const mock = setup();
    await withFakeClock(async () => {
      mock.store.set(V1_KEY, {
        url: 'https://legacy.example/cover.png',
        expireAt: START_MS + 24 * 3600 * 1000,
      });
      const url = await resolveBrandCoverHttps();
      assert.notEqual(url, 'https://legacy.example/cover.png');
      assert.equal(url, `${HTTPS_BASE}?v=1`);
      assert.equal(mock.uploadCalls(), 1, 'v1 遗留项不应被复用');
      assert.equal(mock.reads[V1_KEY] ?? 0, 0, '不应读取已弃用的 v1 键');
      assert.equal(mock.removals[V1_KEY] ?? 0, 1, '成功解析后应清除 v1');
      assert.ok(!mock.store.has(V1_KEY));
    });
  });
});

describe('resolveBrandCoverHttps · 失败容错', () => {
  test('wx.cloud 不可用：返回空串且不抛错', async () => {
    clearBrandCoverMemoryCache();
    (globalThis as unknown as { wx: unknown }).wx = {};
    await withFakeClock(async () => {
      assert.equal(await resolveBrandCoverHttps(), '');
    });
  });

  test('上传失败：返回空串且不抛错', async () => {
    setup({ failUpload: true });
    await withFakeClock(async () => {
      assert.equal(await resolveBrandCoverHttps(), '');
    });
  });

  test('换取临时链接失败：返回空串且不抛错', async () => {
    setup({ failTempUrl: true });
    await withFakeClock(async () => {
      assert.equal(await resolveBrandCoverHttps(), '');
    });
  });

  test('持久缓存读取异常：按未命中处理，仍完成解析并写盘', async () => {
    const mock = setup({ failGetStorage: true });
    await withFakeClock(async () => {
      assert.equal(await resolveBrandCoverHttps(), `${HTTPS_BASE}?v=1`);
      assert.equal(mock.uploadCalls(), 1);
      assert.ok(mock.store.has(V2_KEY), '读取异常不应阻断写入');
    });
  });

  test('持久缓存写入异常：不影响解析结果与内存命中', async () => {
    const mock = setup({ failSetStorage: true });
    await withFakeClock(async () => {
      const first = await resolveBrandCoverHttps();
      assert.equal(first, `${HTTPS_BASE}?v=1`);
      assert.equal(await resolveBrandCoverHttps(), first, '写入异常不影响内存复用');
      assert.equal(mock.uploadCalls(), 1);
    });
  });

  test('支持按浅色/深色主题分别解析与独立缓存', async () => {
    const mock = setup({
      tempUrl: (callNo: number) => `https://bucket.tcb.qcloud.la/brand/brand_icon_${callNo % 2 === 1 ? 'dark' : 'light'}.png`,
    });
    await withFakeClock(async () => {
      const darkUrl = await resolveBrandCoverHttps('dark');
      assert.ok(darkUrl.includes('dark'));
      const lightUrl = await resolveBrandCoverHttps('light');
      assert.ok(lightUrl.includes('light'));
      assert.notEqual(darkUrl, lightUrl);
      assert.equal(mock.uploadCalls(), 2, '深浅双模式各自上传对应资源');

      // 验证内存命中不重复上传
      const cachedDark = await resolveBrandCoverHttps('dark');
      const cachedLight = await resolveBrandCoverHttps('light');
      assert.equal(cachedDark, darkUrl);
      assert.equal(cachedLight, lightUrl);
      assert.equal(mock.uploadCalls(), 2, '命中缓存不触发再次上传');
    });
  });
});

test('解析失败日志不包含原始异常对象', async () => {
  setup({ failUpload: true });
  const previousWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    await withFakeClock(async () => {
      assert.equal(await resolveBrandCoverHttps(), '');
    });
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0], ['[brandCover] 解析封面 HTTPS 链接失败']);
  } finally {
    console.warn = previousWarn;
  }
});

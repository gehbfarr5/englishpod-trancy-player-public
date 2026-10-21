/**
 * `adapters/wechat/cloudAudioUrl.ts` 单测。
 *
 * 覆盖：非 fileID 原样返回、fileID 解析为临时链接、**缓存命中不再请求**、
 *       失败抛出可读错误。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { clearTempUrlCache, isCloudFileId, resolvePlayableUrl } from './cloudAudioUrl';

const FILE_ID = 'cloud://env.bucket/audio/0001/pb.m4a';
const HTTPS = 'https://bucket.tcb.qcloud.la/audio/0001/pb.m4a';

/** 安装 wx.cloud mock，返回调用计数器。 */
function installCloudMock(opts: { ttlSec?: number; fail?: boolean } = {}): {
  calls: () => number;
} {
  let calls = 0;
  (globalThis as unknown as { wx: unknown }).wx = {
    cloud: {
      getTempFileURL: (param: { fileList: string[] }) => {
        calls += 1;
        if (opts.fail) {
          return Promise.reject(new Error('mock failure'));
        }
        return Promise.resolve({
          fileList: param.fileList.map((fileID) => ({
            fileID,
            tempFileURL: HTTPS,
            maxAge: opts.ttlSec ?? 7200,
            status: 0,
            errMsg: 'ok',
          })),
        });
      },
    },
  };
  return { calls: () => calls };
}

describe('isCloudFileId', () => {
  test('识别 cloud:// 前缀', () => {
    assert.equal(isCloudFileId(FILE_ID), true);
    assert.equal(isCloudFileId(HTTPS), false);
    assert.equal(isCloudFileId(''), false);
  });
});

describe('resolvePlayableUrl', () => {
  test('非 fileID：原样返回且不请求', async () => {
    const mock = installCloudMock();
    clearTempUrlCache();
    assert.equal(await resolvePlayableUrl(HTTPS), HTTPS);
    assert.equal(mock.calls(), 0);
  });

  test('fileID：解析为临时 HTTPS 链接', async () => {
    const mock = installCloudMock();
    clearTempUrlCache();
    assert.equal(await resolvePlayableUrl(FILE_ID), HTTPS);
    assert.equal(mock.calls(), 1);
  });

  test('缓存命中：同一 fileID 只请求一次', async () => {
    const mock = installCloudMock();
    clearTempUrlCache();
    await resolvePlayableUrl(FILE_ID);
    await resolvePlayableUrl(FILE_ID);
    await resolvePlayableUrl(FILE_ID);
    assert.equal(mock.calls(), 1, '缓存命中后不应再次请求');
  });

  test('maxAge 为 0（未提供）→ 仍可用（走 2 小时兜底）', async () => {
    const mock = installCloudMock({ ttlSec: 0 });
    clearTempUrlCache();
    assert.equal(await resolvePlayableUrl(FILE_ID), HTTPS);
    assert.equal(await resolvePlayableUrl(FILE_ID), HTTPS);
    assert.equal(mock.calls(), 1);
  });

  test('解析失败：抛出可读错误', async () => {
    installCloudMock({ fail: true });
    clearTempUrlCache();
    await assert.rejects(() => resolvePlayableUrl(FILE_ID), /解析|解析|getTempFileURL|failure/);
  });
});

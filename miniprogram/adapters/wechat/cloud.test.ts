import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WechatCloudAdapter } from './cloud';
import { CLOUD_STORAGE_FILEID_PREFIX } from '../../config/env';

// The library caches parsed display entries without file_ids. A new player
// adapter needs getLessonIndex to hydrate its own cloud audio map.
const MP3 = 'cloud://fixture.bucket/audio/0114/pb.mp3';
const DG = 'cloud://fixture.bucket/audio/0114/dg.mp3';
function indexItem(withMap = true) {
  return {
    lesson_id: '0114', lesson_number: 114, code: 'B0114',
    level: 'Elementary', title: 'Fixture Lesson',
    audio: { dg: 'audio/0114/dg.mp3', pb: 'audio/0114/pb.mp3', rv: null },
    ...(withMap ? { file_ids: { dg: DG, pb: MP3 } } : {}),
  };
}

function mockIndex(items: unknown[]) {
  let calls = 0;
  (globalThis as unknown as { wx: unknown }).wx = {
    cloud: { callFunction: async () => {
      calls += 1;
      return { result: { success: true, data: { items } } };
    } },
  };
  return () => calls;
}

describe('WechatCloudAdapter audio file IDs', () => {
  it('new player adapter does not fabricate m4a before async index hydration', async () => {
    const count = mockIndex([indexItem()]);
    const adapter = new WechatCloudAdapter();
    assert.equal(adapter.resolveAudioFileId('0114', 'pb'), '');
    await adapter.getLessonIndex();
    assert.equal(count(), 1);
    assert.equal(adapter.resolveAudioFileId('0114', 'pb'), MP3);
    assert.equal(adapter.resolveAudioFileId('0114', 'dg'), DG);
  });

  it('handles index/detail race and prefers authoritative file_ids over stale m4a detail', async () => {
    let unblock: (value: unknown) => void = () => {};
    const promise = new Promise<unknown>(resolve => { unblock = resolve; });
    (globalThis as unknown as { wx: unknown }).wx = {
      cloud: { callFunction: () => promise },
    };
    const adapter = new WechatCloudAdapter();
    const loading = adapter.getLessonIndex();
    assert.equal(adapter.resolveAudioFileId('0114', 'pb'), '');
    unblock({ result: { success: true, data: { items: [indexItem()] } } });
    await loading;
    assert.equal(adapter.resolveAudioFileId('0114', 'pb', 'audio/0114/pb.m4a'), MP3);
  });

  it('accepts only lesson/track-matched detail paths if file_ids are absent', async () => {
    mockIndex([indexItem(false)]);
    const adapter = new WechatCloudAdapter();
    await adapter.getLessonIndex();
    const prefix = CLOUD_STORAGE_FILEID_PREFIX.replace(/\/+$/, '');
    assert.equal(adapter.resolveAudioFileId('0114', 'pb', 'audio/0114/pb.mp3'),
      prefix + '/audio/0114/pb.mp3');
    assert.equal(adapter.resolveAudioFileId('0114', 'dg', 'audio/0114/dg.mp3'),
      prefix + '/audio/0114/dg.mp3');
    assert.equal(adapter.resolveAudioFileId('0114', 'pb'), '');
    assert.equal(adapter.resolveAudioFileId('0114', 'pb', 'audio/0113/pb.mp3'), '');
    assert.equal(adapter.resolveAudioFileId('0114', 'pb', 'audio/0114/dg.mp3'), '');
    assert.equal(adapter.resolveAudioFileId('0114', 'pb', '../audio/0114/pb.mp3'), '');
    assert.equal(adapter.resolveAudioFileId('0114', 'pb', 'audio/0114/pb.mp3?token=abc'), '');
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { WechatCloudAdapter } from '../adapters/wechat/cloud';

let definition: any;
(globalThis as any).wx = { getStorageSync: () => undefined };
(globalThis as any).Page = (options: any) => { definition = options; };

async function page() {
  await import('../pages/m1Experiment/index');
  const writes: any[] = [];
  return Object.assign({}, definition, {
    data: { ...definition.data },
    writes,
    isVisible: true,
    isDisposed: false,
    setData(value: any) { writes.push(value); Object.assign(this.data, value); },
  });
}

test('hidden audio updates do not render; showing reads the latest real position without media commands', async () => {
  const p = await page();
  let position = 12;
  let pauses = 0;
  p.experiment = {
    state: () => ({ view: 'dg', playback: { positionSec: position, durationSec: 180,
      isPlaying: true, sourceLoaded: true }, commands: { sourceLoads: 1, playRequests: 0,
      pauseRequests: 0, seeks: 0, viewSelections: 1 } }),
    pause: () => { pauses++; },
  };
  p.media = { getLastErrorCode: () => 0 };
  p.onHide();
  position = 48;
  p.refreshState();
  assert.equal(p.writes.length, 0);
  assert.equal(pauses, 0);
  p.onShow();
  assert.equal(p.data.positionSec, 48);
  assert.equal(p.data.currentView, 'dg');
  assert.equal(pauses, 0);
});

test('exiting during course loading ignores late success and failure', async () => {
  const original = WechatCloudAdapter.prototype.getLessonIndex;
  try {
    for (const fail of [false, true]) {
      let finish!: (value?: any) => void;
      WechatCloudAdapter.prototype.getLessonIndex = () => new Promise((resolve, reject) => {
        finish = fail ? () => reject(new Error('late failure')) : resolve;
      });
      const p = await page();
      const pending = p.initializeLesson();
      p.onUnload();
      const writesAtExit = p.writes.length;
      finish([]);
      await pending;
      assert.equal(p.writes.length, writesAtExit);
      assert.equal(p.source, undefined);
      p.onShow();
      p.refreshState();
      assert.equal(p.writes.length, writesAtExit);
    }
  } finally {
    WechatCloudAdapter.prototype.getLessonIndex = original;
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlaybackDiagnosticSession } from './playbackDiagnostics';

test('disabled-by-default recorder is memory only and measures callback proxies', () => {
  let clock = 1000;
  const recorder = new PlaybackDiagnosticSession(() => clock);
  clock += 125;
  recorder.detailReady();
  clock += 75;
  recorder.loadRequested();
  clock += 135;
  recorder.canplay();
  clock += 15;
  recorder.playEvent();
  const result = recorder.snapshot();
  assert.equal(result.schema, 'ep-wechat-playback-local-v1');
  assert.equal(result.measurement, 'wechat_callback_proxies_not_audible_frame');
  assert.equal(result.screenToDetailMs, 125);
  assert.equal(result.loadToCanplayMs, 135);
  assert.equal(result.loadToPlayEventMs, 150);
  assert.deepEqual(result.events.map(x => x.kind),
    ['screen_open', 'detail_ready', 'audio_load_requested',
      'audio_canplay', 'audio_play_event']);
});

test('reports contain only enumerated safe fields; never accept freeform URLs or messages', () => {
  let clock = 0;
  const recorder = new PlaybackDiagnosticSession(() => clock);
  clock += 5;
  recorder.error(10002);
  recorder.error(23987);
  recorder.background();
  recorder.foreground(false);
  recorder.foreground(true);
  const report = recorder.snapshot();
  assert.equal(report.errorCount, 2);
  assert.equal(report.backgroundCount, 1);
  assert.equal(report.foregroundCount, 2);
  assert.deepEqual(report.events.map(event => event.kind),
    ['screen_open', 'error_network', 'error_other',
      'background', 'foreground_paused', 'foreground_playing']);
  assert.deepEqual(Object.keys(report).sort(), [
    'schema', 'measurement', 'events', 'screenToDetailMs', 'loadToCanplayMs',
    'loadToPlayEventMs', 'errorCount', 'backgroundCount', 'foregroundCount',
  ].sort());
  for (const event of report.events) {
    assert.deepEqual(Object.keys(event).sort(), ['kind', 'elapsedMs'].sort());
  }
  assert.equal(JSON.stringify(report).includes('https://'), false);
  assert.equal(report.loadToCanplayMs, null);
});

test('bounded event ring and monotonic safe offsets; snapshot is detached', () => {
  let clock = 2000;
  const recorder = new PlaybackDiagnosticSession(() => clock);
  for (let i = 0; i < 60; i++) {
    clock += 100;
    recorder.waiting();
  }
  clock = -1000;
  recorder.pauseEvent();
  const saved = recorder.snapshot();
  assert.equal(saved.events.length, 40);
  assert.equal(saved.events[saved.events.length - 1].elapsedMs, 0);
  saved.events.pop();
  assert.equal(recorder.snapshot().events.length, 40);
  assert.equal(recorder.snapshot().errorCount, 0);
});

test('progress guard holds are recorded as a whitelisted event (Issue #61)', () => {
  let clock = 0;
  const recorder = new PlaybackDiagnosticSession(() => clock);
  clock = 1500;
  recorder.guardHold();
  const report = recorder.snapshot();
  const kinds = report.events.map((event) => event.kind);
  assert.ok(kinds.includes('progress_guard_hold'), '守卫命中应留下指纹事件');
  assert.equal(kinds.includes('audio_waiting'), false, '不得混入其他事件');
  // 新事件不得扩大采集范围：报告字段集合保持不变。
  assert.deepEqual(Object.keys(report).sort(), [
    'backgroundCount',
    'errorCount',
    'events',
    'foregroundCount',
    'loadToCanplayMs',
    'loadToPlayEventMs',
    'measurement',
    'schema',
    'screenToDetailMs',
  ]);
});

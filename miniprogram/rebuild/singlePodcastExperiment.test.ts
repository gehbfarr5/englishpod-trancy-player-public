import assert from 'node:assert/strict';
import test from 'node:test';
import {
  M1MediaPort,
  M1PlaybackSnapshot,
  readM1ViewKey,
  SinglePodcastExperiment,
} from './singlePodcastExperiment';

class FakeMedia implements M1MediaPort {
  calls: string[] = [];
  current: M1PlaybackSnapshot = {
    sourceLoaded: false,
    positionSec: 0,
    durationSec: 0,
    isPlaying: false,
  };

  snapshot(): M1PlaybackSnapshot {
    return { ...this.current };
  }

  loadPodcast(source: string, title: string): void {
    this.calls.push(`load:${source}:${title}`);
    this.current = { ...this.current, sourceLoaded: true };
  }

  play(): void {
    this.calls.push('play');
    this.current = { ...this.current, isPlaying: true };
  }

  pause(): void {
    this.calls.push('pause');
    this.current = { ...this.current, isPlaying: false };
  }

  seek(positionSec: number): void {
    this.calls.push(`seek:${positionSec}`);
    this.current = { ...this.current, positionSec };
  }
}


test('WXML bindtap view selection reads data-key from currentTarget.dataset', () => {
  const media = new FakeMedia();
  const experiment = new SinglePodcastExperiment(media);
  const event = {
    detail: {},
    currentTarget: { dataset: { key: 'dg' } },
  };
  const key = readM1ViewKey(event);
  assert.equal(key, 'dg');
  if (key) experiment.selectView(key);
  assert.equal(experiment.state().view, 'dg');
  assert.deepEqual(media.calls, []);
});

test('invalid or missing tap datasets are ignored safely', () => {
  assert.equal(readM1ViewKey({ detail: { key: 'dg' } }), null);
  assert.equal(readM1ViewKey({ currentTarget: { dataset: { key: 'other' } } }), null);
});

test('content view changes never issue audio commands or mutate playback state', () => {
  const media = new FakeMedia();
  media.current = {
    sourceLoaded: true,
    positionSec: 37,
    durationSec: 180,
    isPlaying: true,
  };
  const experiment = new SinglePodcastExperiment(media);
  const before = experiment.state();

  for (const view of ['dg', 'vocab', 'pb'] as const) {
    experiment.selectView(view);
  }

  const after = experiment.state();
  assert.equal(after.view, 'pb');
  assert.deepEqual(after.playback, before.playback);
  assert.deepEqual(media.calls, []);
  assert.equal(after.commands.sourceLoads, 0);
  assert.equal(after.commands.playRequests, 0);
  assert.equal(after.commands.pauseRequests, 0);
  assert.equal(after.commands.seeks, 0);
  assert.equal(after.commands.viewSelections, 3);
});

test('only the Podcast control surface can issue load, play, pause and seek', () => {
  const media = new FakeMedia();
  const experiment = new SinglePodcastExperiment(media);

  experiment.startPodcast('https://audio.example/pb.mp3', 'Lesson 0001 Podcast');
  experiment.play();
  experiment.seek(42);
  experiment.pause();

  assert.deepEqual(media.calls, [
    'load:https://audio.example/pb.mp3:Lesson 0001 Podcast',
    'play',
    'seek:42',
    'pause',
  ]);
  assert.equal(experiment.state().commands.sourceLoads, 1);
  assert.equal(experiment.state().commands.playRequests, 1);
  assert.equal(experiment.state().commands.seeks, 1);
  assert.equal(experiment.state().commands.pauseRequests, 1);
});

test('invalid source, title and seek positions are rejected before touching audio', () => {
  const media = new FakeMedia();
  const experiment = new SinglePodcastExperiment(media);

  assert.throws(() => experiment.startPodcast('  ', 'Lesson'), /source is required/);
  assert.throws(() => experiment.startPodcast('https://audio.example/pb.mp3', ' '), /title is required/);
  assert.throws(() => experiment.seek(-1), /non-negative finite number/);
  assert.throws(() => experiment.seek(Number.NaN), /non-negative finite number/);
  assert.deepEqual(media.calls, []);
});

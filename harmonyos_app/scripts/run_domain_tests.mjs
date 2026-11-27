#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('/Volumes/DevEco-Studio/DevEco-Studio.app/Contents/plugins/openharmony/ace-server/node_modules/typescript/lib/typescript.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOMAIN_SRC = path.resolve(__dirname, '../packages/ep_domain/src/main/ets');

function loadEtsModule(relPath, deps = {}) {
  const fullPath = path.join(DOMAIN_SRC, relPath);
  const src = fs.readFileSync(fullPath, 'utf8');
  const transpiled = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText;

  const mod = { exports: {} };
  const customRequire = (spec) => {
    for (const [key, val] of Object.entries(deps)) {
      if (spec.endsWith(key)) return val;
    }
    return {};
  };
  const fn = new Function('exports', 'require', 'module', transpiled);
  fn(mod.exports, customRequire, mod);
  return mod.exports;
}

const modelsMod = loadEtsModule('models/LessonModels.ets');
const pbcMod = loadEtsModule('contract/PlaybackContractPolicy.ets', { LessonModels: modelsMod });
const navMod = loadEtsModule('contract/TranscriptNavigation.ets', { LessonModels: modelsMod });
const stageMod = loadEtsModule('contract/StageGroupCalculator.ets', { LessonModels: modelsMod });
const vocabMod = loadEtsModule('vocab/VocabMatcher.ets', { LessonModels: modelsMod });

const { CourseEntryIntent, NaturalEndAction, PlaybackContractPolicy } = pbcMod;
const { TranscriptNavigation } = navMod;
const { StageGroupCalculator } = stageMod;
const { VocabMatcher } = vocabMod;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS: ${name}`);
}

const lessons = ['0001', '0002', '0003'];

test('Library entry ALWAYS selects PB track and restores PB breakpoint', () => {
  const d = PlaybackContractPolicy.evaluateTransition({
    intent: CourseEntryIntent.LIBRARY,
    currentLessonId: '0001',
    targetLessonId: '0002',
    currentTrack: 'dg',
    lessonIdOrder: lessons,
    isCurrentlyPlaying: false,
    isTargetCompleted: false,
    savedPbSec: 45.0,
    savedDgSec: 15.0,
    pbDurationSec: 600.0,
    dgDurationSec: 120.0
  });
  assert.equal(d.targetTrack, 'pb');
  assert.equal(d.targetPositionSec, 45.0);
  assert.equal(d.requestPlay, true);
  assert.equal(d.updateLastOpened, true);
});

test('Library entry on COMPLETED lesson resets position to 00:00', () => {
  const d = PlaybackContractPolicy.evaluateTransition({
    intent: CourseEntryIntent.LIBRARY,
    currentLessonId: '0001',
    targetLessonId: '0002',
    currentTrack: 'pb',
    lessonIdOrder: lessons,
    isCurrentlyPlaying: false,
    isTargetCompleted: true,
    savedPbSec: 580.0,
    savedDgSec: 100.0,
    pbDurationSec: 600.0,
    dgDurationSec: 120.0
  });
  assert.equal(d.targetTrack, 'pb');
  assert.equal(d.targetPositionSec, 0.0);
  assert.equal(d.requestPlay, true);
});

test('Continue Listening card body preserves paused state per EP-PBC-001 v1.5 while play icon requests play', () => {
  const dBody = PlaybackContractPolicy.evaluateTransition({
    intent: CourseEntryIntent.CONTINUE_LISTENING,
    currentLessonId: '0001',
    targetLessonId: '0001',
    currentTrack: 'dg',
    lessonIdOrder: lessons,
    isCurrentlyPlaying: false,
    playActionOnly: false,
    isTargetCompleted: false,
    savedPbSec: 120.0,
    savedDgSec: 30.0,
    pbDurationSec: 600.0,
    dgDurationSec: 120.0
  });
  assert.equal(dBody.targetTrack, 'pb');
  assert.equal(dBody.targetPositionSec, 120.0);
  assert.equal(dBody.requestPlay, false);
  assert.equal(dBody.updateLastOpened, false);

  const dBtn = PlaybackContractPolicy.evaluateTransition({
    intent: CourseEntryIntent.CONTINUE_LISTENING,
    currentLessonId: '0001',
    targetLessonId: '0001',
    currentTrack: 'dg',
    lessonIdOrder: lessons,
    isCurrentlyPlaying: false,
    playActionOnly: true,
    isTargetCompleted: false,
    savedPbSec: 120.0,
    savedDgSec: 30.0,
    pbDurationSec: 600.0,
    dgDurationSec: 120.0
  });
  assert.equal(dBtn.requestPlay, true);
  assert.equal(dBtn.updateLastOpened, false);
});

test('Same-lesson PB <-> DG switch preserves play state and target breakpoint', () => {
  const d = PlaybackContractPolicy.evaluateTransition({
    intent: CourseEntryIntent.TRACK_SWITCH,
    currentLessonId: '0001',
    targetLessonId: '0001',
    currentTrack: 'pb',
    requestedTrack: 'dg',
    lessonIdOrder: lessons,
    isCurrentlyPlaying: true,
    isTargetCompleted: false,
    savedPbSec: 150.0,
    savedDgSec: 42.0,
    pbDurationSec: 600.0,
    dgDurationSec: 120.0
  });
  assert.equal(d.targetTrack, 'dg');
  assert.equal(d.targetPositionSec, 42.0);
  assert.equal(d.requestPlay, true);
});

test('Manual Prev from first & Manual Next from last are disabled no-ops', () => {
  const prev = PlaybackContractPolicy.evaluateTransition({
    intent: CourseEntryIntent.MANUAL_PREV,
    currentLessonId: '0001',
    targetLessonId: '',
    currentTrack: 'pb',
    lessonIdOrder: lessons,
    isCurrentlyPlaying: true,
    isTargetCompleted: false,
    savedPbSec: 0,
    savedDgSec: 0,
    pbDurationSec: 600,
    dgDurationSec: 120
  });
  assert.equal(prev.isNoOp, true);

  const next = PlaybackContractPolicy.evaluateTransition({
    intent: CourseEntryIntent.MANUAL_NEXT,
    currentLessonId: '0003',
    targetLessonId: '',
    currentTrack: 'pb',
    lessonIdOrder: lessons,
    isCurrentlyPlaying: true,
    isTargetCompleted: false,
    savedPbSec: 0,
    savedDgSec: 0,
    pbDurationSec: 600,
    dgDurationSec: 120
  });
  assert.equal(next.isNoOp, true);
});

test('Auto-next on PB natural end advances and loops last->first', () => {
  const mid = PlaybackContractPolicy.evaluateTransition({
    intent: CourseEntryIntent.AUTO_NEXT,
    currentLessonId: '0001',
    targetLessonId: '',
    currentTrack: 'pb',
    lessonIdOrder: lessons,
    isCurrentlyPlaying: true,
    isTargetCompleted: false,
    savedPbSec: 0,
    savedDgSec: 0,
    pbDurationSec: 600,
    dgDurationSec: 120
  });
  assert.equal(mid.targetLessonId, '0002');
  assert.equal(mid.targetTrack, 'pb');
  assert.equal(mid.targetPositionSec, 0.0);

  const wrap = PlaybackContractPolicy.evaluateTransition({
    intent: CourseEntryIntent.AUTO_NEXT,
    currentLessonId: '0003',
    targetLessonId: '',
    currentTrack: 'pb',
    lessonIdOrder: lessons,
    isCurrentlyPlaying: true,
    isTargetCompleted: false,
    savedPbSec: 0,
    savedDgSec: 0,
    pbDurationSec: 600,
    dgDurationSec: 120
  });
  assert.equal(wrap.targetLessonId, '0001');
  assert.equal(wrap.targetTrack, 'pb');
});

test('NaturalEnd priority & DG never auto-advances', () => {
  assert.equal(
    PlaybackContractPolicy.evaluateNaturalEnd('pb', true, true, true),
    NaturalEndAction.LOOP_SENTENCE
  );
  assert.equal(
    PlaybackContractPolicy.evaluateNaturalEnd('pb', false, true, true),
    NaturalEndAction.LOOP_CURRENT_TRACK
  );
  assert.equal(
    PlaybackContractPolicy.evaluateNaturalEnd('pb', false, false, true),
    NaturalEndAction.ADVANCE_AUTO_NEXT
  );
  assert.equal(
    PlaybackContractPolicy.evaluateNaturalEnd('dg', false, false, true),
    NaturalEndAction.STOP_PLAYBACK
  );
});

test('Completion >=95% on PB only, no completion on seek, monotonic', () => {
  const ok = PlaybackContractPolicy.evaluateProgress({
    wasPreviouslyCompleted: false,
    wasPreviouslyStarted: true,
    previousPct: 90,
    track: 'pb',
    currentPositionSec: 96,
    durationSec: 100,
    naturalEnded: false,
    isSeeking: false
  });
  assert.equal(ok.isCompleted, true);

  const seek = PlaybackContractPolicy.evaluateProgress({
    wasPreviouslyCompleted: false,
    wasPreviouslyStarted: true,
    previousPct: 20,
    track: 'pb',
    currentPositionSec: 98,
    durationSec: 100,
    naturalEnded: false,
    isSeeking: true
  });
  assert.equal(seek.isCompleted, false);

  const dg = PlaybackContractPolicy.evaluateProgress({
    wasPreviouslyCompleted: false,
    wasPreviouslyStarted: true,
    previousPct: 50,
    track: 'dg',
    currentPositionSec: 100,
    durationSec: 100,
    naturalEnded: true,
    isSeeking: false
  });
  assert.equal(dg.isCompleted, false);

  const mono = PlaybackContractPolicy.evaluateProgress({
    wasPreviouslyCompleted: true,
    wasPreviouslyStarted: true,
    previousPct: 100,
    track: 'pb',
    currentPositionSec: 10,
    durationSec: 100,
    naturalEnded: false,
    isSeeking: false
  });
  assert.equal(mono.isCompleted, true);
  assert.equal(mono.progressPct, 10);
});

test('StageGroupCalculator & speaker mapping match iOS lesson_0001.json', () => {
  const l1 = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../flutter_app/assets/lessons_safe/lesson_0001.json'), 'utf8')
  );
  const mapSeg = (s, i) => ({
    id: s.id ?? i,
    speaker: s.speaker ?? '',
    text: s.text ?? '',
    isSection: s.is_section ?? false,
    inDialogueBlock: s.in_dialogue_block ?? false,
    start: s.start ?? 0,
    end: s.end ?? 0,
    words: s.words ?? []
  });
  const pbSegs = l1.tracks.pb.map(mapSeg);
  const dgSegs = l1.tracks.dg.map(mapSeg);
  const pbGroups = StageGroupCalculator.computeStageGroups(pbSegs, 'pb');
  const dgGroups = StageGroupCalculator.computeStageGroups(dgSegs, 'dg');

  assert.equal(dgGroups[0].badgeText, 'FULL DIALOGUE TRACK');
  assert.equal(dgGroups[0].isFirstInBox, true);
  assert.equal(dgGroups[dgGroups.length - 1].isLastInBox, true);

  assert.equal(pbGroups[0], null);
  assert.equal(StageGroupCalculator.resolveSpeakerDisplayName(pbSegs[0], pbGroups[0]), 'MARCO');
  assert.equal(StageGroupCalculator.resolveSpeakerDisplayName(pbSegs[1], pbGroups[1]), 'AMIRA');
  assert.ok(pbGroups.some((g) => g && g.kind === 'dialogue'));
});

test('TranscriptNavigation 0.5s pre-scroll & VocabMatcher contextual examples', () => {
  const l1 = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../flutter_app/assets/lessons_safe/lesson_0001.json'), 'utf8')
  );
  const mapSeg = (s, i) => ({
    id: s.id ?? i,
    speaker: s.speaker ?? '',
    text: s.text ?? '',
    isSection: s.is_section ?? false,
    inDialogueBlock: s.in_dialogue_block ?? false,
    start: s.start ?? 0,
    end: s.end ?? 0,
    words: s.words ?? []
  });
  const detail = {
    lessonNumber: 1,
    lessonId: '0001',
    code: 'B0001',
    level: 'Elementary',
    title: l1.title,
    rawTitle: l1.raw_title,
    audio: l1.audio,
    vocabulary: l1.vocabulary,
    dgSegments: l1.tracks.dg.map(mapSeg),
    pbSegments: l1.tracks.pb.map(mapSeg)
  };
  assert.equal(TranscriptNavigation.findActiveSegmentIndex(detail.pbSegments, 3.1), 0);
  const examples = VocabMatcher.findContextualSentencesForWord(detail, 'complimentary');
  assert.ok(examples.length >= 1);
});

console.log(`\nALL ${passed} L1 DOMAIN TESTS PASSED.`);

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatLessonAttributes,
  resolveLessonDifficulty,
  resolveLessonTopic,
} from './lessonAttributes';

test('resolveLessonDifficulty', () => {
  assert.equal(resolveLessonDifficulty('B0001', 'Elementary'), 'Elementary');
  assert.equal(resolveLessonDifficulty('C0003', 'Daily Life'), 'Intermediate');
  assert.equal(resolveLessonDifficulty('D0018', 'Upper'), 'Upper Intermediate');
  assert.equal(resolveLessonDifficulty('E0029', 'Advanced'), 'Advanced');
  assert.equal(resolveLessonDifficulty('F0001', 'Media'), 'Advanced Media');
  assert.equal(resolveLessonDifficulty('', 'Upper'), 'Upper Intermediate');
  assert.equal(resolveLessonDifficulty('', ''), 'Elementary');
});

test('resolveLessonTopic', () => {
  assert.equal(resolveLessonTopic('Difficult Customer', 'Elementary'), 'Daily Life');
  assert.equal(resolveLessonTopic('Hotel Upgrade', 'Daily Life'), 'Daily Life');
  assert.equal(resolveLessonTopic('I need an assistant!', 'The Office'), 'The Office');
  assert.equal(resolveLessonTopic('Daily Life - Cut In Line', 'Intermediate'), 'Daily Life');
  assert.equal(resolveLessonTopic('The Weekend - Road Trip', 'Intermediate'), 'The Weekend');
});

test('formatLessonAttributes', () => {
  assert.equal(
    formatLessonAttributes({ code: 'B0001', level: 'Elementary', title: 'Difficult Customer' }),
    'Elementary · Daily Life',
  );
  assert.equal(
    formatLessonAttributes({ code: 'C0003', level: 'Daily Life', title: 'Hotel Upgrade' }),
    'Intermediate · Daily Life',
  );
  assert.equal(
    formatLessonAttributes({ code: 'C0004', level: 'The Office', title: 'I need an assistant!' }),
    'Intermediate · The Office',
  );
  assert.equal(
    formatLessonAttributes({ code: 'D0018', level: 'Upper', title: 'Intermediate - Protest!' }),
    'Upper Intermediate · Intermediate',
  );
});

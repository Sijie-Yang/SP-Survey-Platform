import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyQuestion, validateSiliconAnswer } from './answerValidate.mjs';

describe('silicon answer validation', () => {
  it('marks annotation and custom skills unsupported', () => {
    assert.equal(classifyQuestion({ type: 'imageannotation' }).supported, false);
    assert.equal(classifyQuestion({ type: 'skillquestion', skillHtml: '<div>' }).supported, false);
    assert.equal(classifyQuestion({ type: 'imagerating' }).supported, true);
  });

  it('validates ratings and checkboxes', () => {
    assert.equal(validateSiliconAnswer({ type: 'imagerating', rateMin: 1, rateMax: 5 }, 4).ok, true);
    assert.equal(validateSiliconAnswer({ type: 'imagerating', rateMin: 1, rateMax: 5 }, 999).ok, false);
    assert.equal(validateSiliconAnswer({ type: 'imagerating' }, 'pretty' ).ok, false);
    assert.equal(validateSiliconAnswer({
      type: 'imagecheckbox',
      choices: [{ value: 'a', text: 'A' }, { value: 'b', text: 'B' }],
    }, ['a']).ok, true);
    assert.equal(validateSiliconAnswer({
      type: 'imagecheckbox',
      choices: [{ value: 'a', text: 'A' }, { value: 'b', text: 'B' }],
    }, ['c']).ok, false);
    assert.equal(validateSiliconAnswer({
      type: 'imageranking',
      choices: [{ value: 'a' }, { value: 'b' }, { value: 'c' }],
    }, ['c', 'c']).ok, false);
    assert.equal(validateSiliconAnswer({ type: 'imageannotation' }, {}).skipped, true);
  });

  it('rejects conditionals and multi-trial set assignment before a run starts', () => {
    assert.equal(classifyQuestion({ type: 'imagerating', visibleIf: '{q1} = 1' }).supported, false);
    assert.equal(classifyQuestion({ type: 'imagerating', trialCount: 3 }).supported, false);
    assert.equal(classifyQuestion({ type: 'imagerating', mediaAssignmentMode: 'set' }).supported, false);
  });
});

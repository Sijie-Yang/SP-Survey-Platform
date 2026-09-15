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
    assert.equal(validateSiliconAnswer({ type: 'imagerating' }, 4).ok, true);
    assert.equal(validateSiliconAnswer({ type: 'imagerating' }, 'pretty' ).ok, false);
    assert.equal(validateSiliconAnswer({ type: 'imagecheckbox' }, ['a']).ok, true);
    assert.equal(validateSiliconAnswer({ type: 'imageannotation' }, {}).skipped, true);
  });
});

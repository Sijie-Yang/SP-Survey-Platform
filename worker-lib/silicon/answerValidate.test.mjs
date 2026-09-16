import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyQuestion, validateSiliconAnswer } from './answerValidate.mjs';

describe('silicon answer validation', () => {
  it('supports every answerable platform family', () => {
    assert.equal(classifyQuestion({ type: 'imageannotation' }).supported, false);
    assert.equal(classifyQuestion({ type: 'skillquestion', skillResultSchema: [{ key: 'choice', type: 'choice' }] }).supported, false);
    assert.equal(classifyQuestion({ type: 'text' }).supported, true);
    assert.equal(classifyQuestion({ type: 'consent' }).supported, true);
    assert.equal(classifyQuestion({ type: 'comment' }).supported, true);
    assert.equal(classifyQuestion({
      type: 'matrix',
      rows: ['safety'],
      columns: ['low', 'high'],
    }).supported, true);
    assert.equal(classifyQuestion({
      type: 'pointallocation',
      choices: ['trees', 'lights'],
      budget: 100,
    }).supported, true);
    assert.equal(classifyQuestion({ type: 'imagerating' }).supported, true);
    assert.equal(classifyQuestion({ type: 'html' }).supported, false);
  });

  it('validates ratings, checkboxes, text, matrix, allocation, annotation, and skills', () => {
    assert.equal(validateSiliconAnswer({ type: 'imagerating', rateMin: 1, rateMax: 5 }, 4).ok, true);
    assert.equal(validateSiliconAnswer({ type: 'imagerating', rateMin: 1, rateMax: 5 }, 999).ok, false);
    assert.equal(validateSiliconAnswer({ type: 'imagerating' }, 'pretty').ok, false);
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
    assert.equal(validateSiliconAnswer({ type: 'text' }, 'a quiet street').ok, true);
    assert.equal(validateSiliconAnswer({ type: 'consent' }, true).ok, true);
    assert.equal(validateSiliconAnswer({
      type: 'matrix',
      rows: ['safety', 'shade'],
      columns: ['low', 'high'],
    }, { safety: 'high', shade: 'low' }).ok, true);
    assert.equal(validateSiliconAnswer({
      type: 'pointallocation',
      choices: ['trees', 'lights'],
      budget: 100,
    }, { trees: 40, lights: 60 }).ok, true);
    assert.equal(validateSiliconAnswer({
      type: 'pointallocation',
      choices: ['trees', 'lights'],
      budget: 100,
    }, { trees: 40, lights: 10 }).ok, false);
    assert.equal(validateSiliconAnswer({
      type: 'imageannotation',
      allowedTools: ['bbox'],
      annotationLabels: ['tree'],
      minAnnotations: 1,
    }, { shapes: [{ tool: 'bbox', label: 'tree', points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.5 }] }] }).ok, true);
    assert.equal(validateSiliconAnswer({
      type: 'skillquestion',
      skillResultSchema: [{ key: 'choice', type: 'choice' }, { key: 'chosenIndex', type: 'number' }],
    }, { choice: 'A', chosenIndex: 0 }).ok, true);
    assert.equal(validateSiliconAnswer({ type: 'number', min: 0, max: 100 }, 42).ok, true);
    assert.equal(validateSiliconAnswer({ type: 'number', min: 10, max: 20 }, 5).ok, false);
    assert.equal(validateSiliconAnswer({ type: 'imageranking', isRequired: true, choices: [{ value: 'a' }] }, []).ok, false);
    assert.equal(classifyQuestion({ type: 'imagerating', mediaType: 'video' }).supported, true);
  });

  it('validates slider groups by dimension id and range', () => {
    const question = {
      type: 'imageslidergroup',
      scaleMin: 1,
      scaleMax: 7,
      dimensions: [
        { id: 'safe', label: '安全感', left: 'Unsafe', right: 'Safe' },
        { id: 'beauty', label: '美观', min: 0, max: 10 },
      ],
    };
    assert.equal(classifyQuestion(question).supported, true);
    assert.equal(validateSiliconAnswer(question, { safe: 4, beauty: 8 }).ok, true);
    assert.equal(validateSiliconAnswer(question, { safe: 4 }).ok, false);
    assert.equal(validateSiliconAnswer(question, 4).ok, false);
    assert.equal(classifyQuestion({ type: 'imageslidergroup', dimensions: [] }).supported, false);
  });

  it('accepts multi-trial payloads and no longer blocks set assignment', () => {
    assert.equal(classifyQuestion({ type: 'imagerating', visibleIf: '{q1} = 1' }).supported, true);
    assert.equal(classifyQuestion({ type: 'imagerating', trialCount: 3 }).supported, true);
    assert.equal(classifyQuestion({ type: 'imagerating', mediaAssignmentMode: 'set' }).supported, true);
    const checked = validateSiliconAnswer(
      { type: 'imagerating', rateMin: 1, rateMax: 5, trialCount: 2 },
      { trials: [{ answer: 2, shown_images: ['a'] }, { answer: 5, shown_images: ['b'] }] },
    );
    assert.equal(checked.ok, true);
    assert.equal(checked.answer.trials.length, 2);
    assert.equal(validateSiliconAnswer(
      { type: 'imagerating', rateMin: 1, rateMax: 5, trialCount: 2 },
      4,
    ).ok, false);
  });
});

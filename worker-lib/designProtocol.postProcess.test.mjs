import test from 'node:test';
import assert from 'node:assert/strict';
import { postProcessAiConfig, validateSurveyConfig } from './designProtocol.mjs';

test('postProcessAiConfig fills imagecheckbox tags and strips skillHtml/falApiKey', () => {
  const out = postProcessAiConfig({
    pages: [{
      name: 'p1',
      elements: [
        { type: 'imagecheckbox', name: 'q1', title: 'Tags' },
        {
          type: 'skillquestion',
          name: 'q2',
          skillId: 'image_preference_forced',
          skillHtml: '<b>no</b>',
          falApiKey: 'secret',
          skillConfig: { mediaCount: 2 },
        },
        { type: 'imageannotation', name: 'q3', allowedTools: ['path', 'points', 'region'] },
      ],
    }],
  });
  const [cb, skill, ann] = out.pages[0].elements;
  assert.equal(cb.choices.length, 3);
  assert.equal(cb.choices[0].value, 'tag_a');
  assert.equal(skill.skillId, 'preset_image_preference_forced');
  assert.equal(skill.imageCount, 2);
  assert.equal('skillHtml' in skill, false);
  assert.equal('falApiKey' in skill, false);
  assert.deepEqual(ann.allowedTools, ['line', 'point', 'polygon']);
});

test('validateSurveyConfig warns on empty mediaslidergroup / mediapointallocation', () => {
  const report = validateSurveyConfig({
    pages: [{
      name: 'p1',
      elements: [
        { type: 'mediaslidergroup', name: 's1', title: 'Sliders', randomImageSelection: true },
        { type: 'mediapointallocation', name: 'p1', title: 'Points', randomImageSelection: true },
      ],
    }],
  });
  assert.equal(report.valid, true);
  assert.ok(report.warnings.some((w) => /dimensions/i.test(w.message)));
  assert.ok(report.warnings.some((w) => /choices/i.test(w.message)));
});

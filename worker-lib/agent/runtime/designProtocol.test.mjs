import assert from 'node:assert/strict';
import test from 'node:test';
import { postProcessAiConfig, validateSurveyConfig } from '../../designProtocol.mjs';

test('worker protocol repairs structured annotation labels before persistence', () => {
  const output = postProcessAiConfig({
    pages: [{
      name: 'p1',
      elements: [{
        type: 'imageannotation',
        name: 'hazards',
        annotationLabels: [{ text: '危险点', value: 'danger' }, '遮挡'],
      }],
    }],
  });
  assert.deepEqual(output.pages[0].elements[0].annotationLabels, ['危险点', '遮挡']);
  assert.equal(validateSurveyConfig(output).valid, true);
});

test('worker validation rejects unprocessed structured annotation labels', () => {
  const report = validateSurveyConfig({
    pages: [{
      name: 'p1',
      elements: [{
        type: 'imageannotation',
        name: 'hazards',
        annotationLabels: [{ text: '危险点', value: 'danger' }],
      }],
    }],
  });
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.path.endsWith('annotationLabels[0]')));
});

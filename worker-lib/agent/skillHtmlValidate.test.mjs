import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSkillForSave } from './skillHtmlValidate.mjs';

const sourceHtml = `
  <script>
    document.addEventListener('spskill-init', function() {});
    SPSkill.setAnswer({ choice: 'a' });
  </script>
`;

test('Worker rejects result contracts without exact native parity', () => {
  const json = prepareSkillForSave({
    contractVersion: 1,
    sourceHtml,
    resultSchema: [{ key: 'choice', type: 'json' }],
    exampleAnswer: { choice: { a: 1 } },
  });
  assert.equal(json.ok, false);
  assert.match(json.errors.join(' '), /exact native result\/export family/);

  const multi = prepareSkillForSave({
    contractVersion: 1,
    sourceHtml,
    resultSchema: [
      { key: 'choice', type: 'choice', options: ['a', 'b'] },
      { key: 'note', type: 'text' },
    ],
    exampleAnswer: { choice: 'a', note: 'ok' },
  });
  assert.equal(multi.ok, false);
  assert.match(multi.errors.join(' '), /exactly one native result field/);
});

test('Worker preserves native field settings and rejects custom analysisHtml', () => {
  const valid = prepareSkillForSave({
    contractVersion: 1,
    sourceHtml,
    resultSchema: [{ key: 'choice', type: 'choice', options: ['a', 'b'] }],
    exampleAnswer: { choice: 'a' },
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.skill.resultSchema[0].options, ['a', 'b']);

  const custom = prepareSkillForSave({
    contractVersion: 1,
    sourceHtml,
    resultSchema: [{ key: 'choice', type: 'choice', options: ['a', 'b'] }],
    exampleAnswer: { choice: 'a' },
    analysisHtml: '<div>custom</div>',
  });
  assert.equal(custom.ok, false);
  assert.match(custom.errors.join(' '), /analysisHtml is not allowed/);
});

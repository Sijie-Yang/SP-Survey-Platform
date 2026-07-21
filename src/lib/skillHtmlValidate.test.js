import { validateSkillSourceHtml, prepareSkillForSave } from './skillHtmlValidate';

describe('validateSkillSourceHtml', () => {
  test('rejects missing setAnswer', () => {
    const r = validateSkillSourceHtml('<script>parent.postMessage({type:"skill-result"},"*")</script>');
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/SPSkill\.setAnswer/);
  });

  test('accepts SPSkill.setAnswer', () => {
    const r = validateSkillSourceHtml(`
      <script>
      document.addEventListener('spskill-init', function(){});
      SPSkill.setAnswer({ score: 1 });
      </script>
    `);
    expect(r.ok).toBe(true);
  });
});

describe('prepareSkillForSave', () => {
  test('normalizes string schemas', () => {
    const r = prepareSkillForSave({
      sourceHtml: '<script>SPSkill.setAnswer({x:1})</script>',
      configSchema: ['prompt'],
      resultSchema: ['score'],
    });
    expect(r.ok).toBe(true);
    expect(r.skill.configSchema[0].key).toBe('prompt');
    expect(r.skill.resultSchema[0].key).toBe('score');
  });
});

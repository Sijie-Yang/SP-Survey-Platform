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

  test('warns on unknown result types but still saves', () => {
    const r = prepareSkillForSave({
      sourceHtml: '<script>SPSkill.setAnswer({graph:{}})</script>',
      resultSchema: [{ key: 'graph', label: 'Graph', type: 'customGraph' }],
      analysisHtml: '<div id="app"></div>',
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/Unknown resultSchema type/);
    expect(r.skill.analysisHtml).toContain('app');
  });

  test('accepts archetype types without warning', () => {
    const r = prepareSkillForSave({
      sourceHtml: '<script>SPSkill.setAnswer({marks:[]})</script>',
      resultSchema: [{ key: 'marks', label: 'Marks', type: 'points' }],
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).not.toMatch(/Unknown resultSchema type/);
  });
});

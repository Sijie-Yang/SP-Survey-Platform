import {
  SP_SCHEME_EXAMPLE_PACKAGE,
  applySpSchemePackage,
  buildSpSchemeText,
  parseSpSchemePackage,
  validateSpSchemePackage,
} from './spScheme';

const clone = (value) => JSON.parse(JSON.stringify(value));
const messages = (list) => list.map((item) => item.message).join('\n');

describe('SP-Scheme text', () => {
  test('carries the package format, sampling rules, result families and SDK contract', () => {
    const text = buildSpSchemeText();
    expect(text).toContain('"format": "sp-scheme-package"');
    expect(text).toContain('huggingface_random');
    expect(text).toContain('SPSkill.setAnswer');
    expect(text).toContain('pairwiseChoice');
    expect(text).toContain('`imageslidergroup`');
    expect(text).toContain('preset_best_worst_choice');
    expect(text).not.toMatch(/expectedDraftUpdatedAt/);
  });
});

describe('parseSpSchemePackage', () => {
  test('accepts a model reply wrapped in a json fence', () => {
    const reply = `Here is your study:\n\`\`\`json\n${JSON.stringify(SP_SCHEME_EXAMPLE_PACKAGE)}\n\`\`\`\nGood luck!`;
    expect(parseSpSchemePackage(reply).format).toBe('sp-scheme-package');
  });

  test('rejects non-JSON', () => {
    expect(() => parseSpSchemePackage('not json')).toThrow('not valid JSON');
  });
});

describe('validateSpSchemePackage', () => {
  test('the documented example passes', () => {
    const report = validateSpSchemePackage(clone(SP_SCHEME_EXAMPLE_PACKAGE));
    expect(messages(report.errors)).toBe('');
    expect(report.ok).toBe(true);
    expect(report.summary).toMatchObject({ pageCount: 2, questionCount: 3, customInteractionCount: 1 });
    const duel = report.survey.pages[1].elements[0];
    expect(duel.skillId).toBe('skill_pkg_safety_duel');
    expect(duel.skillResultSchema[0].type).toBe('pairwiseChoice');
  });

  test('rejects a missing custom interaction reference', () => {
    const pkg = clone(SP_SCHEME_EXAMPLE_PACKAGE);
    pkg.survey.pages[1].elements[0].skillId = 'custom:nope';
    const report = validateSpSchemePackage(pkg);
    expect(report.ok).toBe(false);
    expect(messages(report.errors)).toContain('no customInteractions entry for "custom:nope"');
  });

  test('rejects invented media URLs on randomly sampled questions', () => {
    const pkg = clone(SP_SCHEME_EXAMPLE_PACKAGE);
    pkg.survey.pages[1].elements[1].choices = [{ value: 'https://example.com/a.jpg' }];
    const report = validateSpSchemePackage(pkg);
    expect(messages(report.errors)).toContain('media URLs are not allowed');
  });

  test('rejects inline HTML on a question', () => {
    const pkg = clone(SP_SCHEME_EXAMPLE_PACKAGE);
    pkg.survey.pages[1].elements[0].skillHtml = '<div></div>';
    expect(messages(validateSpSchemePackage(pkg).errors)).toContain('put HTML in customInteractions');
  });

  test('applies the Skill save contract to custom interactions', () => {
    const pkg = clone(SP_SCHEME_EXAMPLE_PACKAGE);
    pkg.customInteractions[0].resultSchema = [{ key: 'x', type: 'madeUpFamily' }];
    pkg.customInteractions[0].sourceHtml = '<div>no sdk</div>';
    const text = messages(validateSpSchemePackage(pkg).errors);
    expect(text).toContain('SPSkill.setAnswer');
    expect(text).toContain('madeUpFamily');
  });

  test('rejects duplicate question names and credentials', () => {
    const pkg = clone(SP_SCHEME_EXAMPLE_PACKAGE);
    pkg.survey.pages[1].elements[1].name = 'safety_duel';
    pkg.survey.falApiKey = 'secret';
    const text = messages(validateSpSchemePackage(pkg).errors);
    expect(text).toContain('Duplicate question name');
    expect(text).toContain('credential');
  });

  test('rejects unknown built-in tasks', () => {
    const pkg = clone(SP_SCHEME_EXAMPLE_PACKAGE);
    pkg.survey.pages[1].elements[0].skillId = 'preset_does_not_exist';
    expect(messages(validateSpSchemePackage(pkg).errors)).toContain('unknown built-in task');
  });
});

describe('applySpSchemePackage', () => {
  test('saves custom interactions and rewrites placeholders to library ids', async () => {
    const report = validateSpSchemePackage(clone(SP_SCHEME_EXAMPLE_PACKAGE));
    const saveSkill = jest.fn(async (skill) => ({ skill: { ...skill, id: 'skill_123_abc', revision: 1 } }));
    const config = await applySpSchemePackage(report, { saveSkill, baseConfig: { theme: { primaryColor: '#123456' }, logo: 'x' } });
    expect(saveSkill).toHaveBeenCalledTimes(1);
    expect(saveSkill.mock.calls[0][0].sourceHtml).toContain('SPSkill.setAnswer');
    const duel = config.pages[1].elements[0];
    expect(duel).toMatchObject({ skillId: 'skill_123_abc', skillRevision: 1, skillContractVersion: 1 });
    expect(config.theme.primaryColor).toBe('#123456');
    expect(config.logo).toBe('x');
    expect(config.title).toBe('Street perception study');
  });

  test('refuses an invalid report', async () => {
    await expect(applySpSchemePackage({ ok: false }, { saveSkill: jest.fn() })).rejects.toThrow('Fix the package');
  });
});

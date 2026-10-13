import { strToU8, zipSync } from 'fflate';
import {
  SP_PREVIEW_SHIM,
  SP_SCHEME_EXAMPLE_PACKAGE,
  applySpSchemePackage,
  buildExampleZip,
  buildSpSchemeText,
  parseSpSchemePackage,
  readSpSchemeUpload,
  stripPreviewShim,
  validateSpSchemePackage,
} from './spScheme';

// The example package with its interaction file inlined, as the zip reader produces it.
const examplePkg = () => readSpSchemeUpload(buildExampleZip()).pkg;
const messages = (list) => list.map((item) => item.message).join('\n');

describe('SP-Scheme text', () => {
  test('asks for a tested prototype before the zip', () => {
    const text = buildSpSchemeText();
    expect(text.indexOf('Build a clickable prototype')).toBeLessThan(text.indexOf('Pack it as a zip'));
    expect(text).toContain('interactions/<ref>.html');
    expect(text).toContain(SP_PREVIEW_SHIM);
  });

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
    const reply = `Here is your study:\n\`\`\`json\n${JSON.stringify(examplePkg())}\n\`\`\`\nGood luck!`;
    expect(parseSpSchemePackage(reply).format).toBe('sp-scheme-package');
  });

  test('rejects non-JSON', () => {
    expect(() => parseSpSchemePackage('not json')).toThrow('not valid JSON');
  });
});

describe('readSpSchemeUpload', () => {
  test('reads a zip whose files sit inside a folder and inlines interaction files', () => {
    const { pkg, fromZip, files } = readSpSchemeUpload(buildExampleZip());
    expect(fromZip).toBe(true);
    expect(files).toContain('interactions/safety_duel.html');
    expect(pkg.customInteractions[0].sourceHtml).toContain('SPSkill.setAnswer');
  });

  test('flags a missing interaction file and a preview page', () => {
    const zip = zipSync({
      'sp-scheme.json': strToU8(JSON.stringify(SP_SCHEME_EXAMPLE_PACKAGE)),
      'preview.html': strToU8('<html></html>'),
      '__MACOSX/._sp-scheme.json': strToU8('junk'),
    });
    const read = readSpSchemeUpload(zip);
    expect(read.hasPreview).toBe(true);
    const report = validateSpSchemePackage(read.pkg);
    expect(messages(report.errors)).toContain('interactions/safety_duel.html is not in the zip');
  });

  test('a bare manifest with file references asks for the zip', () => {
    const read = readSpSchemeUpload(strToU8(JSON.stringify(SP_SCHEME_EXAMPLE_PACKAGE)));
    expect(read.fromZip).toBe(false);
    expect(messages(validateSpSchemePackage(read.pkg).errors)).toContain('upload the whole zip');
  });

  test('rejects a zip without sp-scheme.json', () => {
    expect(() => readSpSchemeUpload(zipSync({ 'a.html': strToU8('x') }))).toThrow('no sp-scheme.json');
  });
});

describe('preview shim', () => {
  test('is removed before saving', () => {
    const html = `<head>${SP_PREVIEW_SHIM}</head><body>x</body>`;
    expect(stripPreviewShim(html)).toBe('<head></head><body>x</body>');
  });
});

describe('validateSpSchemePackage', () => {
  test('the documented example passes', () => {
    const report = validateSpSchemePackage(examplePkg());
    expect(messages(report.errors)).toBe('');
    expect(report.ok).toBe(true);
    expect(report.summary).toMatchObject({ pageCount: 2, questionCount: 3, customInteractionCount: 1 });
    const duel = report.survey.pages[1].elements[0];
    expect(duel.skillId).toBe('skill_pkg_safety_duel');
    expect(duel.skillResultSchema[0].type).toBe('pairwiseChoice');
  });

  test('rejects a missing custom interaction reference', () => {
    const pkg = examplePkg();
    pkg.survey.pages[1].elements[0].skillId = 'custom:nope';
    const report = validateSpSchemePackage(pkg);
    expect(report.ok).toBe(false);
    expect(messages(report.errors)).toContain('no customInteractions entry for "custom:nope"');
  });

  test('rejects invented media URLs on randomly sampled questions', () => {
    const pkg = examplePkg();
    pkg.survey.pages[1].elements[1].choices = [{ value: 'https://example.com/a.jpg' }];
    const report = validateSpSchemePackage(pkg);
    expect(messages(report.errors)).toContain('media URLs are not allowed');
  });

  test('rejects inline HTML on a question', () => {
    const pkg = examplePkg();
    pkg.survey.pages[1].elements[0].skillHtml = '<div></div>';
    expect(messages(validateSpSchemePackage(pkg).errors)).toContain('put HTML in customInteractions');
  });

  test('applies the Skill save contract to custom interactions', () => {
    const pkg = examplePkg();
    pkg.customInteractions[0].resultSchema = [{ key: 'x', type: 'madeUpFamily' }];
    pkg.customInteractions[0].sourceHtml = '<div>no sdk</div>';
    const text = messages(validateSpSchemePackage(pkg).errors);
    expect(text).toContain('SPSkill.setAnswer');
    expect(text).toContain('madeUpFamily');
  });

  test('rejects duplicate question names and credentials', () => {
    const pkg = examplePkg();
    pkg.survey.pages[1].elements[1].name = 'safety_duel';
    pkg.survey.falApiKey = 'secret';
    const text = messages(validateSpSchemePackage(pkg).errors);
    expect(text).toContain('Duplicate question name');
    expect(text).toContain('credential');
  });

  test('rejects unknown built-in tasks', () => {
    const pkg = examplePkg();
    pkg.survey.pages[1].elements[0].skillId = 'preset_does_not_exist';
    expect(messages(validateSpSchemePackage(pkg).errors)).toContain('unknown built-in task');
  });
});

describe('applySpSchemePackage', () => {
  test('saves custom interactions and rewrites placeholders to library ids', async () => {
    const report = validateSpSchemePackage(examplePkg());
    const saveSkill = jest.fn(async (skill) => ({ skill: { ...skill, id: 'skill_123_abc', revision: 1 } }));
    const config = await applySpSchemePackage(report, { saveSkill, baseConfig: { theme: { primaryColor: '#123456' }, logo: 'x' } });
    expect(saveSkill).toHaveBeenCalledTimes(1);
    expect(saveSkill.mock.calls[0][0].sourceHtml).toContain('SPSkill.setAnswer');
    expect(saveSkill.mock.calls[0][0].sourceHtml).not.toContain('sp-preview-shim');
    expect(saveSkill.mock.calls[0][0].file).toBeUndefined();
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

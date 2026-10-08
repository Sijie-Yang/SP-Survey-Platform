import fs from 'fs';
import path from 'path';
import { Model } from 'survey-core';
import 'survey-core/survey.i18n';
import { validateSurveyConfig } from './designProtocol/validate';
import { normalizeRecommendation } from './analysisRecommendation';
import { applySurveyLocale } from './surveyLocale';
import { pickTrialMediaSetsForQuestion } from './surveyMediaInjection';

const DIR = path.join(__dirname, '..', '..', 'public', 'project_templates');
const ID = '2026-demo-cat-choice';

function loadTemplate() {
  return JSON.parse(fs.readFileSync(path.join(DIR, `${ID}.json`), 'utf8'));
}

test('cat pairwise demo is a listed builtin template with bundled art', () => {
  const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
  expect(index.templates).toContain(`${ID}.json`);

  const tpl = loadTemplate();
  expect(tpl.id).toBe(ID);
  expect(tpl.showOnLanding).toBe(false);
  expect(tpl.config.locale).toBe('zh');
  expect(JSON.stringify(tpl)).toMatch(/你更喜欢哪只猫/);
  expect(JSON.stringify(tpl)).toMatch(/Which cat do you prefer/);
  expect(tpl.description).toMatch(/非街道|Non-street/);
  expect(tpl.tags).toEqual(expect.arrayContaining(['demo', 'pairwise', 'non-street']));
  expect(tpl.tags.join(' ')).not.toMatch(/streetscape|street-view|gsv/i);

  const result = validateSurveyConfig(tpl.config);
  expect(result.errors || []).toEqual([]);
  const names = tpl.config.pages.flatMap((page) => page.elements || []).map((q) => q.name);
  expect(new Set(names).size).toBe(names.length);
  const { items } = normalizeRecommendation(tpl.config);
  expect(items.length).toBeGreaterThan(0);
  items.forEach((item) => item.questions.forEach((q) => expect(names).toContain(q)));

  const choice = tpl.config.pages.flatMap((page) => page.elements).find((q) => q.name === 'cat_choice');
  expect(choice).toMatchObject({
    type: 'imagepicker',
    imageCount: 2,
    trialCount: 6,
    allowTie: false,
    multiSelect: false,
    mediaAssignmentMode: 'individual',
    mediaFolders: ['cats'],
  });

  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, ID, 'images.json'), 'utf8'));
  expect(manifest.templateId).toBe(ID);
  expect(manifest.images).toEqual([
    'cats/orange-tabby.jpg',
    'cats/black.jpg',
    'cats/siamese.jpg',
    'cats/calico.jpg',
  ]);
  manifest.images.forEach((rel) => {
    const file = path.join(DIR, ID, rel);
    expect(fs.statSync(file).size).toBeGreaterThan(1000);
  });
  const bundledUrls = manifest.images.map((rel) => `/project_templates/${ID}/${rel}`);
  expect(tpl.preloadedImages.map((img) => img.url)).toEqual(bundledUrls);
  expect(tpl.preloadedImages.every((img) => img.folder === 'cats' && img.type === 'image')).toBe(true);

  const covers = JSON.parse(fs.readFileSync(path.join(DIR, 'cover_images', 'index.json'), 'utf8'));
  expect(covers.covers[ID]).toBe('2026-demo-cat-choice.jpg');
  expect(fs.statSync(path.join(DIR, 'cover_images', covers.covers[ID])).size).toBeGreaterThan(1000);
});

test('six pairwise trials each draw two distinct bundled cats', () => {
  const tpl = loadTemplate();
  const choice = tpl.config.pages.flatMap((page) => page.elements).find((q) => q.name === 'cat_choice');
  const { trialMediaSets } = pickTrialMediaSetsForQuestion(
    tpl.preloadedImages,
    choice,
    choice.trialCount,
    new Set(),
    new Set(),
    null,
    tpl.imageDatasetConfig.mediaFolderTags,
  );
  const known = new Set(['orange-tabby.jpg', 'black.jpg', 'siamese.jpg', 'calico.jpg']);
  expect(trialMediaSets).toHaveLength(6);
  trialMediaSets.forEach((trial) => {
    expect(trial).toHaveLength(2);
    const names = trial.map((img) => img.name);
    expect(new Set(names).size).toBe(2);
    names.forEach((name) => expect(known.has(name)).toBe(true));
    trial.forEach((img) => expect(String(img.url)).toMatch(/^\/project_templates\/2026-demo-cat-choice\/cats\//));
  });

  const seen = new Set();
  for (let i = 0; i < 40; i += 1) {
    const again = pickTrialMediaSetsForQuestion(
      tpl.preloadedImages,
      choice,
      1,
      new Set(),
      new Set(),
      null,
      tpl.imageDatasetConfig.mediaFolderTags,
    );
    again.trialMediaSets.flat().forEach((img) => seen.add(img.name));
  }
  expect(seen).toEqual(known);
});

test('the choice trial opens in Chinese and keeps the English prompt', () => {
  const tpl = loadTemplate();
  const model = new Model(tpl.config);
  applySurveyLocale(model, tpl.config);
  expect(model.locale).toBe('zh-cn');
  expect(model.pageNextText).toBe('下一页');
  const question = model.getQuestionByName('cat_choice');
  expect(question.title).toContain('你更喜欢哪只猫');
  expect(question.title).toContain('Which cat do you prefer');
});

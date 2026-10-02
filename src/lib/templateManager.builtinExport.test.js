import { supabase } from './supabase';
import {
  BUILTIN_EXPORT_MANIFEST_PATH,
  buildOnlineTemplatesBuiltinZipFiles,
  listAllTemplatesForExport,
  seedBuiltinTemplates,
  templateToBuiltinJson,
} from './templateManager';
import {
  buildBuiltinImportSnapshot,
  buildOnlineImportSnapshot,
  diffBuiltinImportSnapshots,
} from './templateBuiltinDiff';
import { hydrateSkillContractSnapshots } from './skillContracts';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn() } } }));
jest.mock('./r2', () => ({ isR2Configured: () => false }));

const onlineTemplate = (overrides = {}) => ({
  id: '2025-yang-thermal',
  name: 'Thermal',
  description: 'desc',
  author: 'Yang',
  year: '2025',
  category: 'Academic Research',
  tags: ['official', 'thermal'],
  website: 'https://doi.org/x',
  huggingfaceDataset: 'sijiey/thermal',
  config: {
    title: 'Thermal',
    spAnalysisRecommendation: { method: 'trueskill', note: 'keep me' },
    pages: [{ name: 'p1', elements: [{ type: 'text', name: 'q1' }] }],
  },
  imageDatasetConfig: {
    mediaFolderTags: { indoor: 'set', 'indoor/a': 'category', bad: 'other' },
    mediaFolders: ['indoor', 'indoor/a'],
    imageFeatures: { l0: true },
    datasetName: 'sijiey/thermal',
  },
  preloadedImages: [{ url: 'https://r2/templates/2025-yang-thermal/a.jpg', name: 'a.jpg' }],
  thumbnail_url: 'https://r2/cover.jpg',
  is_pinned: true,
  is_approved: false,
  show_on_landing: false,
  submitter_email: 'someone@example.com',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2026-09-30T10:00:00.000Z',
  ...overrides,
});

const byPath = (files) => Object.fromEntries(files.map((f) => [f.path, f.content]));

beforeEach(() => jest.clearAllMocks());

test('export-all writes the same template JSON and index bytes as the selected export', () => {
  const list = [onlineTemplate(), onlineTemplate({ id: '2024-liang-building', name: 'Building' })];
  const selected = byPath(buildOnlineTemplatesBuiltinZipFiles(list, { scope: 'selected' }).files);
  const all = byPath(buildOnlineTemplatesBuiltinZipFiles(list, { scope: 'all' }).files);
  ['2025-yang-thermal.json', '2024-liang-building.json', 'index.json'].forEach((path) => {
    expect(all[path]).toBe(selected[path]);
  });
  expect(all['2025-yang-thermal.json']).toBe(`${JSON.stringify(templateToBuiltinJson(list[0]), null, 2)}\n`);
  expect(JSON.parse(all['index.json'])).toEqual({
    templates: ['2025-yang-thermal.json', '2024-liang-building.json'],
  });
});

test('manifest records export time, count and each id with Supabase updated_at outside the template JSON', () => {
  const list = [onlineTemplate(), onlineTemplate({ id: 'no-name', name: '' })];
  const { files, manifest } = buildOnlineTemplatesBuiltinZipFiles(list, {
    scope: 'all',
    exportedAt: '2026-10-02T08:00:00.000Z',
  });
  expect(manifest).toEqual({
    format: 'sp-survey-builtin-templates',
    version: 1,
    scope: 'all',
    exported_at: '2026-10-02T08:00:00.000Z',
    template_count: 1,
    templates: [{ id: '2025-yang-thermal', updated_at: '2026-09-30T10:00:00.000Z' }],
  });
  expect(BUILTIN_EXPORT_MANIFEST_PATH).toMatch(/^[^/]+\/manifest\.json$/);
  expect(JSON.parse(byPath(files)[BUILTIN_EXPORT_MANIFEST_PATH])).toEqual(manifest);
  const topLevelJson = files.map((f) => f.path).filter((p) => !p.includes('/'));
  expect(topLevelJson).toEqual(['2025-yang-thermal.json', 'index.json']);
  expect(byPath(files)['2025-yang-thermal.json']).not.toContain('updated_at');
});

test('listAllTemplatesForExport surfaces Supabase errors instead of returning an empty list', async () => {
  const query = { select: jest.fn(() => query), order: jest.fn(() => query) };
  query.order
    .mockImplementationOnce(() => query)
    .mockImplementationOnce(() => Promise.resolve({ data: null, error: new Error('permission denied') }));
  supabase.from.mockReturnValue(query);
  await expect(listAllTemplatesForExport()).rejects.toThrow('permission denied');
});

test('round trip keeps config keys and folder tags, drops other media settings and admin flags', async () => {
  const online = onlineTemplate();
  const builtin = JSON.parse(JSON.stringify(templateToBuiltinJson(online)));

  expect(builtin.config.spAnalysisRecommendation).toEqual({ method: 'trueskill', note: 'keep me' });
  expect(builtin.imageDatasetConfig).toEqual({
    mediaFolderTags: { indoor: 'set', 'indoor/a': 'category' },
    mediaFolders: ['indoor', 'indoor/a'],
  });
  ['thumbnail_url', 'is_approved', 'show_on_landing', 'submitter_email', 'updatedAt'].forEach((key) => {
    expect(builtin).not.toHaveProperty(key);
  });
  expect(builtin.preloadedImages).toEqual([]);

  const { diffs } = diffBuiltinImportSnapshots(
    buildBuiltinImportSnapshot(builtin),
    buildOnlineImportSnapshot(online),
  );
  // Both preview sides sanitize media config, so the dropped keys are invisible here.
  expect(diffs).toEqual([]);

  global.fetch = jest.fn(async (url) => {
    if (url === '/project_templates/index.json') {
      return { ok: true, json: async () => ({ templates: ['2025-yang-thermal.json'] }) };
    }
    if (url === '/project_templates/2025-yang-thermal.json') {
      return { ok: true, json: async () => builtin };
    }
    return { ok: false, status: 404 };
  });
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'admin', email: 'a@b.c' } } });
  const query = {};
  ['select', 'eq'].forEach((m) => { query[m] = jest.fn(() => query); });
  query.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  query.insert = jest.fn().mockResolvedValue({ error: null });
  supabase.from.mockReturnValue(query);

  const result = await seedBuiltinTemplates();
  expect(result.inserted).toBe(1);
  const row = query.insert.mock.calls[0][0];
  expect(row.survey_config).toEqual(online.config);
  expect(row.image_dataset_config).toEqual(builtin.imageDatasetConfig);
  expect(row).toMatchObject({
    paper_url: online.website,
    huggingface_dataset: online.huggingfaceDataset,
    is_pinned: true,
    is_approved: true,
    show_on_landing: true,
    created_at: online.createdAt,
    user_id: 'admin',
    preloaded_images: [],
  });
  expect(row).not.toHaveProperty('thumbnail_url');

  const projectConfig = await hydrateSkillContractSnapshots({ ...row.survey_config, title: 'New project' });
  expect(projectConfig.spAnalysisRecommendation).toEqual(online.config.spAnalysisRecommendation);
});

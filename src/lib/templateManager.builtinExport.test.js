import { supabase } from './supabase';
import {
  BUILTIN_EXPORT_MANIFEST_PATH,
  buildOnlineTemplatesBuiltinZipFiles,
  listAllTemplatesForExport,
  previewBuiltinTemplateImport,
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
  user_id: 'submitter-1',
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
    templates: [{ id: '2025-yang-thermal', updated_at: '2026-09-30T10:00:00.000Z', user_id: 'submitter-1' }],
  });
  expect(BUILTIN_EXPORT_MANIFEST_PATH).toMatch(/^[^/]+\/manifest\.json$/);
  expect(JSON.parse(byPath(files)[BUILTIN_EXPORT_MANIFEST_PATH])).toEqual(manifest);
  const topLevelJson = files.map((f) => f.path).filter((p) => !p.includes('/'));
  expect(topLevelJson).toEqual(['2025-yang-thermal.json', 'index.json']);
  expect(byPath(files)['2025-yang-thermal.json']).not.toContain('updated_at');
  expect(byPath(files)[BUILTIN_EXPORT_MANIFEST_PATH]).not.toContain('someone@example.com');
});

test('listAllTemplatesForExport surfaces Supabase errors instead of returning an empty list', async () => {
  const query = { select: jest.fn(() => query), order: jest.fn(() => query) };
  query.order
    .mockImplementationOnce(() => query)
    .mockImplementationOnce(() => Promise.resolve({ data: null, error: new Error('permission denied') }));
  supabase.from.mockReturnValue(query);
  await expect(listAllTemplatesForExport()).rejects.toThrow('permission denied');
});


const MANIFEST_URL = `/project_templates/${BUILTIN_EXPORT_MANIFEST_PATH}`;

function mockStatic({ templates = {}, manifest = null } = {}) {
  global.fetch = jest.fn(async (url) => {
    if (url === '/project_templates/index.json') {
      return { ok: true, json: async () => ({ templates: Object.keys(templates).map((id) => `${id}.json`) }) };
    }
    if (url === MANIFEST_URL) {
      return manifest ? { ok: true, json: async () => manifest } : { ok: false, status: 404 };
    }
    const m = /^\/project_templates\/([^/]+)\.json$/.exec(url);
    if (m && templates[m[1]]) return { ok: true, json: async () => templates[m[1]] };
    return { ok: false, status: 404 };
  });
}

function mockTemplatesTable(existing = null, { insertErrors = [] } = {}) {
  const query = {};
  ['select', 'eq'].forEach((m) => { query[m] = jest.fn(() => query); });
  query.maybeSingle = jest.fn().mockResolvedValue({ data: existing, error: null });
  query.insert = jest.fn().mockImplementation(async () => ({ error: insertErrors.shift() || null }));
  query.update = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) }));
  supabase.from.mockReturnValue(query);
  return query;
}

const exportOf = (online, exportedAt = '2026-10-01T00:00:00.000Z') => {
  const { files } = buildOnlineTemplatesBuiltinZipFiles([online], { scope: 'all', exportedAt });
  const map = byPath(files);
  return {
    builtin: JSON.parse(map[`${online.id}.json`]),
    manifest: JSON.parse(map[BUILTIN_EXPORT_MANIFEST_PATH]),
  };
};

beforeEach(() => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'admin', email: 'a@b.c' } } });
});

test('export keeps every image_dataset_config key, review flags and cover; strips secret-like keys', () => {
  const online = onlineTemplate({
    imageDatasetConfigFull: {
      ...onlineTemplate().imageDatasetConfig,
      hfToken: 'hf_xxx',
      streetLevel: { provider: 'gsv', apiKey: 'k' },
    },
  });
  const builtin = templateToBuiltinJson(online);
  expect(builtin.config.spAnalysisRecommendation).toEqual({ method: 'trueskill', note: 'keep me' });
  expect(builtin.imageDatasetConfig).toEqual({
    mediaFolderTags: { indoor: 'set', 'indoor/a': 'category' },
    mediaFolders: ['indoor', 'indoor/a'],
    imageFeatures: { l0: true },
    datasetName: 'sijiey/thermal',
    streetLevel: { provider: 'gsv' },
  });
  expect(builtin).toMatchObject({
    isPinned: true,
    isApproved: false,
    showOnLanding: false,
    thumbnailUrl: 'https://r2/cover.jpg',
  });
  ['submitter_email', 'user_id', 'updatedAt'].forEach((key) => expect(builtin).not.toHaveProperty(key));
  expect(builtin.preloadedImages).toEqual([]);
});

test('unedited round trip previews as unchanged; dropped media keys and cover show as real diffs', () => {
  const online = onlineTemplate({ imageDatasetConfigFull: onlineTemplate().imageDatasetConfig });
  const { builtin } = exportOf(online);
  expect(diffBuiltinImportSnapshots(
    buildBuiltinImportSnapshot(builtin),
    buildOnlineImportSnapshot(online),
  ).diffs).toEqual([]);

  // A builtin JSON written by the old exporter (folder tags only, no cover key).
  const legacy = { ...builtin, imageDatasetConfig: { mediaFolderTags: { indoor: 'set' }, mediaFolders: ['indoor'] } };
  delete legacy.thumbnailUrl;
  const { diffs, unchanged } = diffBuiltinImportSnapshots(
    buildBuiltinImportSnapshot(legacy),
    buildOnlineImportSnapshot(online),
  );
  expect(unchanged).toBe(false);
  const media = diffs.find((d) => d.field === 'imageDatasetConfig');
  expect(media.paths.map((p) => p.path)).toEqual(expect.arrayContaining([
    '$.datasetName', '$.imageFeatures', '$.mediaFolders',
  ]));
  expect(diffs.find((d) => d.field === 'thumbnailUrl')).toBeUndefined();

  const { diffs: coverDiffs } = diffBuiltinImportSnapshots(
    buildBuiltinImportSnapshot({ ...builtin, thumbnailUrl: null }),
    buildOnlineImportSnapshot(online),
  );
  expect(coverDiffs.map((d) => d.field)).toEqual(['thumbnailUrl']);
});

test('import of a new pending template keeps its exported status, cover, media keys and submitter', async () => {
  const online = onlineTemplate({ imageDatasetConfigFull: onlineTemplate().imageDatasetConfig });
  const { builtin, manifest } = exportOf(online);
  mockStatic({ templates: { [online.id]: builtin }, manifest });
  const query = mockTemplatesTable(null);

  const result = await seedBuiltinTemplates();
  expect(result.inserted).toBe(1);
  expect(query.insert).toHaveBeenCalledTimes(1);
  const row = query.insert.mock.calls[0][0];
  expect(row).toMatchObject({
    is_approved: false,
    show_on_landing: false,
    is_active: false,
    is_pinned: true,
    thumbnail_url: 'https://r2/cover.jpg',
    user_id: 'submitter-1',
    submitter_email: null,
    created_at: online.createdAt,
    paper_url: online.website,
    huggingface_dataset: online.huggingfaceDataset,
    preloaded_images: [],
  });
  expect(row.image_dataset_config).toEqual(builtin.imageDatasetConfig);
  expect(row.survey_config).toEqual(online.config);

  const projectConfig = await hydrateSkillContractSnapshots({ ...row.survey_config, title: 'New project' });
  expect(projectConfig.spAnalysisRecommendation).toEqual(online.config.spAnalysisRecommendation);
});

test('import falls back to the admin when the exported submitter cannot be used', async () => {
  const online = onlineTemplate();
  const { builtin, manifest } = exportOf(online);
  mockStatic({ templates: { [online.id]: builtin }, manifest });
  const query = mockTemplatesTable(null, { insertErrors: [{ code: '23503', message: 'fk' }] });

  const result = await seedBuiltinTemplates();
  expect(result.inserted).toBe(1);
  expect(query.insert).toHaveBeenCalledTimes(2);
  expect(query.insert.mock.calls[1][0]).toMatchObject({ user_id: 'admin', submitter_email: 'a@b.c' });
  expect(result.warnings.join(' ')).toMatch(/original submitter unavailable/);
});

test('legacy builtin JSON without flags still inserts as an approved landing template', async () => {
  const legacy = { id: '2025-x-y', name: 'Legacy', config: { pages: [] }, tags: [] };
  mockStatic({ templates: { '2025-x-y': legacy } });
  const query = mockTemplatesTable(null);
  await seedBuiltinTemplates();
  expect(query.insert.mock.calls[0][0]).toMatchObject({
    is_approved: true, show_on_landing: true, is_active: true, user_id: 'admin', thumbnail_url: null,
  });
});

test('updating an existing template never touches review flags or submitter', async () => {
  const online = onlineTemplate();
  const { builtin, manifest } = exportOf(online);
  mockStatic({ templates: { [online.id]: { ...builtin, name: 'Edited' } }, manifest });
  const query = mockTemplatesTable({ id: online.id, preloaded_images: [], updated_at: online.updatedAt });

  const result = await seedBuiltinTemplates();
  expect(result.updated).toBe(1);
  const patch = query.update.mock.calls[0][0];
  expect(patch.name).toBe('Edited');
  expect(patch.thumbnail_url).toBe('https://r2/cover.jpg');
  expect(patch.image_dataset_config).toEqual(builtin.imageDatasetConfig);
  ['is_approved', 'show_on_landing', 'is_active', 'is_pinned', 'user_id', 'submitter_email'].forEach((key) => {
    expect(patch).not.toHaveProperty(key);
  });
});

test('online edits after the export are flagged in the preview and skipped unless opted in', async () => {
  const online = onlineTemplate();
  const { builtin, manifest } = exportOf(online);
  const editedOnline = { ...online, name: 'Renamed online', updatedAt: '2026-10-01T12:00:00.000Z' };
  mockStatic({ templates: { [online.id]: builtin }, manifest });

  const preview = await previewBuiltinTemplateImport([editedOnline]);
  expect(preview.toUpdate).toHaveLength(1);
  expect(preview.toUpdate[0].conflict).toEqual({
    exportedUpdatedAt: online.updatedAt,
    onlineUpdatedAt: '2026-10-01T12:00:00.000Z',
  });
  expect(preview.toConflict.map((i) => i.id)).toEqual([online.id]);
  expect(preview.exportedAt).toBe('2026-10-01T00:00:00.000Z');

  // Same online timestamp as the export → plain diff, no conflict.
  const fresh = await previewBuiltinTemplateImport([{ ...online, name: 'Renamed online' }]);
  expect(fresh.toUpdate[0].conflict).toBeNull();

  const existingRow = { id: online.id, preloaded_images: [], updated_at: editedOnline.updatedAt };
  let query = mockTemplatesTable(existingRow);
  let result = await seedBuiltinTemplates({ idsToImport: [online.id] });
  expect(result.updated).toBe(0);
  expect(result.skipped).toBe(1);
  expect(query.update).not.toHaveBeenCalled();
  expect(result.warnings.join(' ')).toMatch(/edited online after the export/);

  query = mockTemplatesTable(existingRow);
  result = await seedBuiltinTemplates({ idsToImport: [online.id], overwriteConflictIds: [online.id] });
  expect(result.updated).toBe(1);
  expect(query.update).toHaveBeenCalledTimes(1);
});

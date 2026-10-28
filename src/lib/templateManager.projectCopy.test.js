import { supabase } from './supabase';
import { copyImagesInR2, deleteImagesFromR2, isR2Configured } from './r2';
import { copyProjectToAdmin, planProjectCopy, projectCopyName } from './templateManager';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn() } } }));
jest.mock('./r2', () => ({
  isR2Configured: jest.fn(() => true),
  copyImagesInR2: jest.fn(),
  deleteImagesFromR2: jest.fn(async () => ({ success: true })),
  listImagesFromR2: jest.fn(),
  uploadImageToR2: jest.fn(),
}));

const OWNER = 'owner-uuid';
const ADMIN = 'admin-uuid';
const BASE = 'https://media.sp-survey.org';
const sourceRow = () => ({
  id: 'proj_src',
  user_id: OWNER,
  name: '儿童环境公平',
  description: 'desc',
  template_id: 'tpl',
  survey_config: { title: 'old live' },
  survey_config_draft: {
    title: '儿童环境公平',
    ownResponseSupabase: { url: 'https://x.supabase.co', anonKey: 'k' },
    spSite: { html: `<img src="${BASE}/${OWNER}/proj_src/streets/a.jpg">`, mediaFolders: ['streets'] },
    pages: [{ name: 'p1', elements: [{ type: 'image', imageLink: `${BASE}/${OWNER}/proj_src/cover%20pic.png` }] }],
  },
  preloaded_images: [
    { name: 'a.jpg', url: `${BASE}/${OWNER}/proj_src/streets/a.jpg`, key: `${OWNER}/proj_src/streets/a.jpg`, folder: 'streets' },
    { name: 'b.jpg', url: `${BASE}/${OWNER}/proj_src/streets/b.jpg`, key: `${OWNER}/proj_src/streets/b.jpg`, folder: 'streets' },
    { name: 'shared.jpg', url: `${BASE}/skill-preview/streets/shared.jpg`, key: 'skill-preview/streets/shared.jpg' },
  ],
  image_dataset_config: { mediaFolders: ['streets'] },
  metadata: { author: 'A', resultsAiAnalyses: { q1: { code: 'x' } }, spBenchTasks: [{ id: 't' }], datasetRelease: { doi: 'd' } },
  release_managed: true,
  survey_config_published: { title: 'published' },
  public_slug: 'kids',
});

function mockDb({ row = sourceRow(), insertResult } = {}) {
  const calls = { inserts: [], updates: 0, deletes: 0 };
  supabase.from.mockImplementation(() => {
    const q = {};
    q.select = jest.fn(() => q);
    q.eq = jest.fn(() => q);
    q.update = jest.fn(() => { calls.updates += 1; return q; });
    q.delete = jest.fn(() => { calls.deletes += 1; return q; });
    q.insert = jest.fn((r) => { calls.inserts.push(r); q.inserting = r; return q; });
    q.maybeSingle = jest.fn(async () => (q.inserting
      ? (insertResult || { data: { id: q.inserting.id, name: q.inserting.name }, error: null })
      : { data: row, error: null }));
    return q;
  });
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: ADMIN, email: 'admin@x.org' } } });
  return calls;
}

beforeEach(() => {
  jest.clearAllMocks();
  isR2Configured.mockReturnValue(true);
  copyImagesInR2.mockImplementation(async (copies) => ({
    success: true, copied: copies.map((c) => ({ ...c, url: `${BASE}/${c.to}` })), errors: [],
  }));
});

test('copy names say 副本', () => {
  expect(projectCopyName('街道感知')).toBe('街道感知（副本）');
  expect(projectCopyName('')).toBe('未命名项目（副本）');
});

test('plan lists every original-folder file once, including ones only in the page html', () => {
  const plan = planProjectCopy({
    id: 'proj_src', user_id: OWNER, name: 'x', config: sourceRow().survey_config_draft,
    preloadedImages: sourceRow().preloaded_images, imageDatasetConfig: {}, metadata: {},
  }, { adminId: ADMIN, newId: 'proj_new', now: 'now' });
  const froms = plan.copies.map((c) => c.from).sort();
  expect(froms).toEqual([
    `${OWNER}/proj_src/cover pic.png`,
    `${OWNER}/proj_src/streets/a.jpg`,
    `${OWNER}/proj_src/streets/b.jpg`,
  ]);
  plan.copies.forEach((c) => expect(c.to.startsWith(`${ADMIN}/proj_new/`)).toBe(true));
});

test('admin copy creates a new admin-owned project and never writes the original', async () => {
  const calls = mockDb();
  const result = await copyProjectToAdmin('proj_src');

  expect(calls.updates).toBe(0);
  expect(calls.deletes).toBe(0);
  expect(calls.inserts).toHaveLength(1);
  const row = calls.inserts[0];
  expect(row.id).not.toBe('proj_src');
  expect(row.id).toMatch(/^proj_/);
  expect(row.user_id).toBe(ADMIN);
  expect(row.name).toBe('儿童环境公平（副本）');
  // Draft is copied, unpublished, no slug / release / responses settings.
  expect(row.survey_config.title).toBe('儿童环境公平');
  expect(row.survey_config_draft).toEqual(row.survey_config);
  expect(row).not.toHaveProperty('release_managed');
  expect(row).not.toHaveProperty('survey_config_published');
  expect(row).not.toHaveProperty('public_slug');
  expect(JSON.stringify(row)).not.toMatch(/ownResponseSupabase|anonKey/);
  // Media now points at the admin's copy; shared preview media is untouched.
  const newPrefix = `${ADMIN}/${row.id}/`;
  expect(row.preloaded_images[0].key).toBe(`${newPrefix}streets/a.jpg`);
  expect(row.preloaded_images[0].url).toBe(`${BASE}/${newPrefix}streets/a.jpg`);
  expect(row.preloaded_images[2].key).toBe('skill-preview/streets/shared.jpg');
  expect(row.survey_config.spSite.html).toContain(`${newPrefix}streets/a.jpg`);
  expect(row.survey_config.pages[0].elements[0].imageLink).toBe(`${BASE}/${newPrefix}cover%20pic.png`);
  expect(JSON.stringify(row)).not.toContain(`${OWNER}/proj_src/`);
  // Metadata keeps analyses, drops original-only links, records the source.
  expect(row.metadata.resultsAiAnalyses).toEqual({ q1: { code: 'x' } });
  expect(row.metadata).not.toHaveProperty('spBenchTasks');
  expect(row.metadata).not.toHaveProperty('datasetRelease');
  expect(row.metadata.copiedFrom).toMatchObject({ projectId: 'proj_src', ownerId: OWNER, projectName: '儿童环境公平' });
  // R2 copies go from the original folder into the admin folder only.
  const copies = copyImagesInR2.mock.calls[0][0];
  copies.forEach((c) => {
    expect(c.from.startsWith(`${OWNER}/proj_src/`)).toBe(true);
    expect(c.to.startsWith(newPrefix)).toBe(true);
  });
  expect(deleteImagesFromR2).not.toHaveBeenCalled();
  expect(result).toMatchObject({ success: true, copiedMedia: 3, failedMedia: [] });
});

test('files that fail to copy keep pointing at the original file', async () => {
  const calls = mockDb();
  copyImagesInR2.mockImplementation(async (copies) => ({
    success: false,
    copied: copies.filter((c) => !c.from.endsWith('b.jpg')),
    errors: copies.filter((c) => c.from.endsWith('b.jpg')).map((c) => ({ from: c.from, error: 'NoSuchKey' })),
  }));
  const result = await copyProjectToAdmin('proj_src');
  const row = calls.inserts[0];
  expect(row.preloaded_images[1].key).toBe(`${OWNER}/proj_src/streets/b.jpg`);
  expect(row.preloaded_images[0].key).toBe(`${ADMIN}/${row.id}/streets/a.jpg`);
  expect(result.failedMedia).toEqual([{ key: `${OWNER}/proj_src/streets/b.jpg`, error: 'NoSuchKey' }]);
});

test('a failed insert removes the copied files from the admin folder only', async () => {
  mockDb({ insertResult: { data: null, error: new Error('rls') } });
  await expect(copyProjectToAdmin('proj_src')).rejects.toThrow('rls');
  const [keys, opts] = deleteImagesFromR2.mock.calls[0];
  expect(opts.allowedPrefix.startsWith(`${ADMIN}/`)).toBe(true);
  keys.forEach((k) => expect(k.startsWith(opts.allowedPrefix)).toBe(true));
});

test('requires a signed-in admin', async () => {
  mockDb();
  supabase.auth.getUser.mockResolvedValue({ data: { user: null } });
  await expect(copyProjectToAdmin('proj_src')).rejects.toThrow('请先登录');
});

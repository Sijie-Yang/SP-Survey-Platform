import { supabase } from './supabase';
import { loadPreviewMediaLibrary, savePreviewMediaLibrary, withLegacyPreviewConfig, LEGACY_PREVIEW_CONFIG_KEY } from './previewMediaLibraryStorage';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
const row = { revision: 4, preloaded_images: [{ key: 'skill-preview/a.jpg', url: 'https://media.test/a.jpg',
  name: 'a.jpg', media_id: 'stable', folder: 'experiment/nested', logicalFolder: 'experiment/nested' }],
image_dataset_config: { mediaFolders: ['experiment/nested'], mediaFolderTags: { 'experiment/nested': 'category' } }, updated_at: '2026-09-14' };
beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); });
function mockRead(result) {
  const single = jest.fn().mockResolvedValue(result);
  const eq = jest.fn(() => ({ single }));
  const select = jest.fn(() => ({ eq }));
  supabase.from.mockReturnValue({ select });
  return { single, eq, select };
}

test('a new browser reads cloud directories, tags and stable media identities', async () => {
  const query = mockRead({ data: row });
  const loaded = await loadPreviewMediaLibrary();
  expect(supabase.from).toHaveBeenCalledWith('preview_media_library');
  expect(query.eq).toHaveBeenCalledWith('id', 'shared');
  expect(loaded.preloadedImages).toEqual(row.preloaded_images);
  expect(loaded.imageDatasetConfig).toEqual(row.image_dataset_config);
  expect(loaded.revision).toBe(4);
});

test('refresh-only saves preserve folder tags and send the expected revision', async () => {
  mockRead({ data: row });
  const owner = await loadPreviewMediaLibrary();
  supabase.rpc.mockResolvedValue({ data: { ...row, revision: 5 } });
  const next = await savePreviewMediaLibrary(owner, { preloaded_images: row.preloaded_images });
  expect(supabase.rpc).toHaveBeenCalledWith('save_preview_media_library', {
    p_expected_revision: 4,
    p_images: [expect.objectContaining({ logicalFolder: 'experiment/nested', media_id: 'stable' })],
    p_config: row.image_dataset_config,
  });
  expect(next.revision).toBe(5);
  expect(owner.revision).toBe(4);
});

test('root moves and deliberate clearing are saved without falling back to previous entries', async () => {
  mockRead({ data: row });
  const owner = await loadPreviewMediaLibrary();
  supabase.rpc.mockResolvedValue({ data: { ...row, revision: 5 } });
  await savePreviewMediaLibrary(owner, { preloaded_images: [{ ...row.preloaded_images[0], logicalFolder: '', folder: '' }] });
  expect(supabase.rpc.mock.calls[0][1].p_images[0].logicalFolder).toBe('');
  await savePreviewMediaLibrary(owner, { preloaded_images: [], image_dataset_config: {} });
  expect(supabase.rpc.mock.calls[1][1]).toMatchObject({ p_images: [], p_config: { mediaFolders: [], mediaFolderTags: {} } });
});

test('conflicts fail without changing the caller revision, while missing migration gives actionable guidance', async () => {
  mockRead({ data: row });
  const owner = await loadPreviewMediaLibrary();
  supabase.rpc.mockResolvedValue({ error: { code: '40001' } });
  await expect(savePreviewMediaLibrary(owner, {})).rejects.toThrow('其他页面更新');
  expect(owner.revision).toBe(4);
  mockRead({ error: { code: 'PGRST205' } });
  await expect(loadPreviewMediaLibrary()).rejects.toThrow('preview_media_library.sql');
});

test('legacy browser tags bootstrap only revision zero, never overwrite an initialized cloud library', () => {
  const oldConfig = { mediaFolders: ['old/sub'], mediaFolderTags: { 'old/sub': 'set' }, token: 'not-media-config' };
  localStorage.setItem(LEGACY_PREVIEW_CONFIG_KEY, JSON.stringify(oldConfig));
  const fresh = { revision: 0, preloadedImages: [], imageDatasetConfig: {} };
  expect(withLegacyPreviewConfig(fresh).imageDatasetConfig).toEqual({ mediaFolders: ['old/sub'], mediaFolderTags: { 'old/sub': 'set' } });
  const cloud = { ...fresh, revision: 1 };
  expect(withLegacyPreviewConfig(cloud)).toBe(cloud);
});

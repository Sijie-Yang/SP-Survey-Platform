import { uploadMediaBatch, uploadObjectKey } from './mediaUploadBatch';
const file = (name = 'scene.jpg') => ({ name, size: 12 });
function setup(overrides = {}) {
  let id = 0;
  return { files: [file(), file()], prefix: 'owner/project/', folder: 'set1',
    prepare: async (raw) => raw, makeId: () => String(++id),
    upload: jest.fn(async (_file, key) => ({ success: true, url: `https://media.test/${key}` })),
    persist: jest.fn(async () => {}), ...overrides };
}
test('same names and names with sanitized collisions always have distinct immutable keys', async () => {
  const options = setup({ files: [file('a b.jpg'), file('a_b.jpg'), file('a b.jpg')] });
  const result = await uploadMediaBatch(options);
  expect(new Set(result.uploaded.map((m) => m.key)).size).toBe(3);
  expect(result.uploaded.map((m) => m.name)).toEqual(['a b.jpg', 'a_b.jpg', 'a b.jpg']);
  expect(uploadObjectKey('p/', 'set/a', '中文.jpg', 'id')).toBe('p/set/a/____id.jpg');
});
test('failed files remain retryable and other files continue after a thrown network error', async () => {
  const options = setup({ upload: jest.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ success: true, url: '/ok.jpg' }) });
  const result = await uploadMediaBatch(options);
  expect(result.failures[0]).toMatchObject({ file: options.files[0], error: 'Offline' });
  expect(result.uploaded).toHaveLength(1);
  expect(result.pending).toHaveLength(0);
  expect(options.persist).toHaveBeenCalledWith(result.uploaded);
});
test('checkpoint failure preserves uploaded entries and stops before unsaved work grows', async () => {
  const options = setup({ files: Array.from({ length: 12 }, () => file()), persist: jest.fn().mockRejectedValue(new Error('Save denied')) });
  const result = await uploadMediaBatch(options);
  expect(result.uploaded).toHaveLength(10);
  expect(result.pending).toHaveLength(2);
  expect(result.saveError).toBe('Save denied');
  expect(options.upload).toHaveBeenCalledTimes(10);
});
test('reject empty, unsupported and oversized files before upload; record transformations', async () => {
  const options = setup({ files: [{ name: 'a.jpg', size: 0 }, file('a.exe'), { name: 'big.mp4', size: 41 * 1024 * 1024 }, file('ok.png')], prepare: async () => ({ name: 'ok.jpg', size: 6 }) });
  const result = await uploadMediaBatch(options);
  expect(result.failures).toHaveLength(3);
  expect(options.upload).toHaveBeenCalledTimes(1);
  expect(result.uploaded[0]).toMatchObject({ name: 'ok.png', original_bytes: 12, uploaded_bytes: 6, image_compressed: true });
});
test('leaving a project stops new uploads but saves the completed files', async () => {
  let stop = false;
  const options = setup({ shouldStop: () => stop, onProgress: () => { stop = true; } });
  const result = await uploadMediaBatch(options);
  expect(result.uploaded).toHaveLength(1);
  expect(result.pending).toEqual([options.files[1]]);
  expect(options.persist).toHaveBeenCalledWith(result.uploaded);
});

import { strToU8, zipSync } from 'fflate';
import { buildExampleSite, buildExampleZip, readSpSchemeUpload } from './spScheme';
import { prepareSpSchemeUpload } from './spSchemeImport';
import { importIntoStudio } from './studioImport';
import { createStudioProject, loadStudioProject, removeStudioProject, saveStudioProject } from './studioData';
import { deleteImagesFromR2, uploadImageToR2 } from './r2';

// CRA resets mock implementations before each test; they are set in beforeEach.
jest.mock('./studioData', () => ({
  createStudioProject: jest.fn(),
  loadStudioProject: jest.fn(),
  removeStudioProject: jest.fn(),
  saveStudioProject: jest.fn(),
}));
jest.mock('./r2', () => ({
  uploadImageToR2: jest.fn(),
  deleteImagesFromR2: jest.fn(),
}));

const prepare = (bytes, name) => prepareSpSchemeUpload(readSpSchemeUpload(bytes), { name });

function zipWithImages() {
  return zipSync({
    'study/index.html': strToU8(buildExampleSite()),
    'study/images/a.jpg': new Uint8Array([1, 2, 3]),
    'study/images/b.jpg': new Uint8Array([4, 5, 6]),
  });
}

beforeEach(() => {
  removeStudioProject.mockResolvedValue({ success: true });
  saveStudioProject.mockResolvedValue({ success: true });
  deleteImagesFromR2.mockResolvedValue({ success: true });
  createStudioProject.mockResolvedValue({ success: true, project: { id: 'p1', name: 'Street perception study' }, surveyConfig: { title: 'x', pages: [] } });
  loadStudioProject.mockResolvedValue({ id: 'p1', name: 'Street perception study', preloadedImages: [], _surveyConfig: { title: 'x', pages: [], theme: { primaryColor: '#123456' } } });
  uploadImageToR2.mockImplementation((file, key) => Promise.resolve({ success: true, url: `https://media.test/${key}`, key }));
});

test('the example becomes a new project named after the page, saved once', async () => {
  const result = await importIntoStudio({ prepared: prepare(buildExampleZip(), 'example.zip'), userId: 'u1', fallbackName: 'New study' });
  expect(result).toMatchObject({ projectId: 'p1', created: true });
  expect(createStudioProject).toHaveBeenCalledWith('Street perception study');
  expect(saveStudioProject).toHaveBeenCalledTimes(1);
  const [project, config] = saveStudioProject.mock.calls[0];
  expect(project.id).toBe('p1');
  expect(config.spSite.html).toContain('SPSite.onReady');
  expect(config.theme.primaryColor).toBe('#123456');
  expect(uploadImageToR2).not.toHaveBeenCalled();
});

test('images in the zip are uploaded first, then config and media list are saved together', async () => {
  const prepared = prepare(zipWithImages(), 'study.zip');
  const progress = [];
  await importIntoStudio({ prepared, userId: 'u1', onProgress: (p) => progress.push(p) });
  expect(uploadImageToR2).toHaveBeenCalledTimes(2);
  expect(uploadImageToR2.mock.calls[0][1]).toMatch(/^u1\/p1\/images\/a__.+\.jpg$/);
  expect(saveStudioProject).toHaveBeenCalledTimes(1);
  const [project, config] = saveStudioProject.mock.calls[0];
  expect(project.preloadedImages.map((e) => e.folder)).toEqual(['images', 'images']);
  expect(project.preloadedSource).toBe('r2');
  expect(config.spSite.mediaFolders).toEqual(['images']);
  expect(progress[progress.length - 1]).toEqual({ done: 2, total: 2 });
});

test('a failed image imports nothing: uploaded files are removed and the new project deleted', async () => {
  uploadImageToR2
    .mockImplementationOnce((file, key) => Promise.resolve({ success: true, url: `https://media.test/${key}`, key }))
    .mockImplementationOnce(() => Promise.resolve({ success: false, error: 'network down' }));
  await expect(importIntoStudio({ prepared: prepare(zipWithImages(), 'study.zip'), userId: 'u1' }))
    .rejects.toMatchObject({ code: 'media', failures: [expect.objectContaining({ error: 'network down' })] });
  expect(saveStudioProject).not.toHaveBeenCalled();
  expect(deleteImagesFromR2).toHaveBeenCalledWith([expect.stringMatching(/^u1\/p1\/images\/a__/)], { allowedPrefix: 'u1/p1/' });
  expect(removeStudioProject).toHaveBeenCalledWith('p1');
});

test('replacing the page of an existing project keeps the project and its settings', async () => {
  const existing = { id: 'p9', name: 'Mine', preloadedImages: [{ url: 'https://x/old.jpg', name: 'old.jpg' }], _surveyConfig: { pages: [], responseQuota: 50 } };
  const result = await importIntoStudio({ prepared: prepare(buildExampleZip(), 'example.zip'), project: existing, userId: 'u1' });
  expect(result).toMatchObject({ projectId: 'p9', created: false });
  expect(createStudioProject).not.toHaveBeenCalled();
  const [project, config] = saveStudioProject.mock.calls[0];
  expect(project.preloadedImages).toHaveLength(1);
  expect(config.responseQuota).toBe(50);
});

test('a failed save deletes the project created for the import', async () => {
  saveStudioProject.mockResolvedValueOnce({ success: false, error: 'offline' });
  await expect(importIntoStudio({ prepared: prepare(buildExampleZip(), 'example.zip'), userId: 'u1' })).rejects.toMatchObject({ code: 'save' });
  expect(removeStudioProject).toHaveBeenCalledWith('p1');
});

test('an upload that cannot be imported writes nothing', async () => {
  const prepared = prepare(strToU8('{"format":"sp-scheme-package","spScheme":"2.0","survey":{}}'), 'bad.json');
  expect(prepared.report.ok).toBe(false);
  await expect(importIntoStudio({ prepared, userId: 'u1' })).rejects.toMatchObject({ code: 'invalid' });
  expect(createStudioProject).not.toHaveBeenCalled();
  expect(saveStudioProject).not.toHaveBeenCalled();
});

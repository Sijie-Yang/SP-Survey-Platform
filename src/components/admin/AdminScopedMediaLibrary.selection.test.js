import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminScopedMediaLibrary from './AdminScopedMediaLibrary';
import { isR2Configured, uploadImageToR2 } from '../../lib/r2';

jest.mock('../../lib/r2', () => ({ isR2Configured: jest.fn(() => false), projectR2Prefix: () => 'u/p/', listImagesFromR2: jest.fn(async () => ({ success: false, unreachable: true })), uploadImageToR2: jest.fn() }));
jest.mock('../../lib/mediaLibraryDownload', () => ({ downloadMediaEntriesZip: jest.fn() }));
jest.mock('../../lib/templateRequest', () => ({}));
jest.mock('../../lib/imageFeaturesL0', () => ({ L0_MODEL: 'l0' }));
jest.mock('../../lib/falInference', () => ({ SEG_MODEL: 'seg' }));
jest.mock('./MediaFilePreviewDialog', () => () => null);
const file = (id, folder) => ({ name: `${id}.jpg`, key: `u/p/${id}.jpg`, media_id: id, url: `https://media.test/${id}.jpg`, logicalFolder: folder, folder, type: 'image' });
const owner = { id: 'p', preloadedImages: [file('a', 'one'), file('b', 'two'), file('c', 'one/nested')], imageDatasetConfig: { mediaFolders: ['one', 'one/nested', 'two', 'target'] } };
async function selectAndMove(save) {
  render(<AdminScopedMediaLibrary owner={owner} r2Prefix="u/p/" onPersist={save} />);
  // The current root gallery is empty; checked folders still supply selectable files.
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select folder one', exact: true }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select folder two', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Select filtered (3)', exact: true }));
  expect(screen.getByRole('button', { name: 'ZIP selected (3)' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Move (3)', exact: true }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Target folder' }));
  fireEvent.click(await screen.findByRole('option', { name: 'target', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
}
test('checked folders drive file selection and successful file moves clear files and folders', async () => {
  const save = jest.fn().mockResolvedValue();
  await selectAndMove(save);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Move (0)', exact: true })).toBeDisabled(), { timeout: 3000 });
  expect(screen.getByRole('checkbox', { name: 'Select folder one', exact: true })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Select folder two', exact: true })).not.toBeChecked();
  const saved = save.mock.calls[0][0];
  expect(saved.preloaded_images.map((f) => f.folder)).toEqual(['target', 'target', 'target']);
  expect(saved.image_dataset_config.mediaFolders).toContain('one/nested');
  expect(saved.preloaded_images.map((f) => f.url)).toEqual(owner.preloadedImages.map((f) => f.url));
});
test('a failed persisted move retains checked folders, files, and their original locations', async () => {
  await selectAndMove(jest.fn().mockRejectedValue(new Error('Storage unavailable')));
  await waitFor(() => expect(screen.getAllByText('Storage unavailable').length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Move (3)', exact: true })).toBeEnabled());
  expect(screen.getByRole('checkbox', { name: 'Select folder one', exact: true })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Select filtered (3)', exact: true })).toBeEnabled();
});

test('folder input imports nested media into the open folder and preserves existing same-name objects', async () => {
  isR2Configured.mockReturnValue(true);
  uploadImageToR2.mockImplementation(async (_, key) => ({ success: true, url: `https://media.test/${key}` }));
  const save = jest.fn().mockResolvedValue();
  render(<AdminScopedMediaLibrary owner={owner} r2Prefix="u/p/" onPersist={save} />);
  fireEvent.click(screen.getByText('target', { exact: true }));
  const input = screen.getByLabelText('Upload media folder');
  expect(input).toHaveAttribute('webkitdirectory');
  const media = new File(['pixels'], 'a.jpg', { type: 'image/jpeg' });
  Object.defineProperty(media, 'webkitRelativePath', { value: 'Study/街道/a.jpg' });
  const readme = new File(['text'], 'readme.txt', { type: 'text/plain' });
  fireEvent.change(input, { target: { files: [media, readme] } });
  await waitFor(() => expect(save).toHaveBeenCalled());
  const saved = save.mock.calls[0][0];
  expect(screen.queryByText(/Upload failed:/)?.textContent).toBeUndefined();
  expect(uploadImageToR2).toHaveBeenCalledTimes(1);
  expect(saved.preloaded_images).toHaveLength(owner.preloadedImages.length + 1);
  const uploaded = saved.preloaded_images.find((f) => f.folder === 'target/Study/街道');
  expect(uploaded).toMatchObject({ name: 'a.jpg', folder: 'target/Study/街道' });
  expect(uploaded.key).toMatch(/^u\/p\/target\/Study\/街道\/a__.+\.jpg$/);
  expect(saved.preloaded_images.find((f) => f.media_id === 'a').url).toBe(owner.preloadedImages[0].url);
  expect(await screen.findByText(/Skipped 1 non-media or system files/)).toBeInTheDocument();
  isR2Configured.mockReturnValue(false);
});

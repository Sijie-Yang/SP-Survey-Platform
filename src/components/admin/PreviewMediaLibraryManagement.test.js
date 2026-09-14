import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PreviewMediaLibraryManagement from './PreviewMediaLibraryManagement';
import { loadPreviewMediaLibrary, savePreviewMediaLibrary } from '../../lib/previewMediaLibraryStorage';

jest.mock('../../lib/previewMediaLibraryStorage', () => ({
  loadPreviewMediaLibrary: jest.fn(), savePreviewMediaLibrary: jest.fn(), withLegacyPreviewConfig: (owner) => owner,
}));
jest.mock('./AdminScopedMediaLibrary', () => function Library({ owner, onPersist }) {
  return <div>
    <div data-testid="saved-folder">{owner.preloadedImages[0]?.logicalFolder}</div>
    <button onClick={() => onPersist({ preloaded_images: [{ ...owner.preloadedImages[0], logicalFolder: 'new/nested' }] }).catch(() => {})}>Move</button>
  </div>;
});
const owner = { id: 'preview-media', revision: 1, preloadedImages: [{ key: 'skill-preview/a.jpg', logicalFolder: 'old/nested' }], imageDatasetConfig: {} };
beforeEach(() => { jest.resetAllMocks(); loadPreviewMediaLibrary.mockResolvedValue(owner); });

test('management waits for the cloud record and reopening reads saved folders without local storage', async () => {
  let finish;
  loadPreviewMediaLibrary.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<PreviewMediaLibraryManagement />);
  expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument();
  await act(async () => finish(owner));
  expect(screen.getByTestId('saved-folder')).toHaveTextContent('old/nested');
  const saved = { ...owner, revision: 2, preloadedImages: [{ ...owner.preloadedImages[0], logicalFolder: 'new/nested' }] };
  savePreviewMediaLibrary.mockResolvedValue(saved);
  fireEvent.click(screen.getByRole('button', { name: 'Move' }));
  await waitFor(() => expect(screen.getByTestId('saved-folder')).toHaveTextContent('new/nested'));
  view.unmount();
  localStorage.clear();
  loadPreviewMediaLibrary.mockResolvedValue(saved);
  render(<PreviewMediaLibraryManagement />);
  expect(await screen.findByTestId('saved-folder')).toHaveTextContent('new/nested');
});

test('failed saves retain the old owner and offer a cloud reload', async () => {
  savePreviewMediaLibrary.mockRejectedValue(new Error('媒体库已在其他页面更新'));
  render(<PreviewMediaLibraryManagement />);
  fireEvent.click(await screen.findByRole('button', { name: 'Move' }));
  expect(await screen.findByText('媒体库已在其他页面更新')).toBeInTheDocument();
  expect(screen.getByTestId('saved-folder')).toHaveTextContent('old/nested');
  loadPreviewMediaLibrary.mockResolvedValue({ ...owner, revision: 2 });
  fireEvent.click(screen.getByRole('button', { name: '重新加载云端记录' }));
  await screen.findByRole('button', { name: 'Move' });
  expect(loadPreviewMediaLibrary).toHaveBeenCalledTimes(2);
});

test('cloud loading errors do not open an editable local-only library', async () => {
  loadPreviewMediaLibrary.mockRejectedValue(new Error('请先运行 preview_media_library.sql'));
  render(<PreviewMediaLibraryManagement />);
  expect(await screen.findByText('请先运行 preview_media_library.sql')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument();
  expect(savePreviewMediaLibrary).not.toHaveBeenCalled();
});

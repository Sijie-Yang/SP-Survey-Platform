import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MediaFolderBrowser from './MediaFolderBrowser';
import { moveImagesInR2, deleteImagesFromR2 } from '../../lib/r2';
import { normalizeMediaEntry, getDirectChildMedia, mediaRelativePathFromListing } from '../../lib/mediaUtils';
jest.mock('../../lib/r2', () => ({ projectR2Prefix: (u, p) => `${u}/${p}/`, moveImagesInR2: jest.fn(), deleteImagesFromR2: jest.fn() }));
const entry = (key) => ({ name: 'scene.jpg', key, media_id: key, url: `https://media.test/${key}`, folder: 'source', original_bytes: 4000 });
beforeEach(() => jest.clearAllMocks());
async function move(pool, save, target = 'target') {
  render(<MediaFolderBrowser currentProject={{ id: 'p', preloadedImages: pool }} userId="u" onProjectUpdate={save} currentFolder="source" onCurrentFolderChange={jest.fn()} selectedMediaEntries={[pool[0]]} />);
  fireEvent.click(screen.getByRole('button', { name: /^Move selected/ }));
  fireEvent.change(screen.getByLabelText('Target folder (empty = root)'), { target: { value: target } });
  fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
  await waitFor(() => expect(save).toHaveBeenCalled());
}
test('same-name files move independently while historical URLs and metadata remain unchanged', async () => {
  const original = entry('u/p/source/scene__one.jpg');
  const save = jest.fn();
  await move([original, entry('u/p/source/scene__two.jpg')], save);
  const moved = save.mock.calls[0][0].preloadedImages;
  expect(moved[0]).toMatchObject({ ...original, folder: 'target', logicalFolder: 'target' });
  expect(moved[1].folder).toBe('source');
  expect(normalizeMediaEntry(moved[0]).folder).toBe('target');
  expect(moveImagesInR2).not.toHaveBeenCalled();
  expect(deleteImagesFromR2).not.toHaveBeenCalled();
});
test('moving back to root survives normalization and retains a unique ZIP filename', async () => {
  const save = jest.fn();
  await move([entry('u/p/source/scene__one.jpg')], save, '');
  const moved = save.mock.calls[0][0].preloadedImages[0];
  expect(normalizeMediaEntry(normalizeMediaEntry(moved)).folder).toBe('');
  expect(getDirectChildMedia([moved], '', 'u/p/')).toHaveLength(1);
  expect(mediaRelativePathFromListing(moved, 'u/p/')).toBe('scene__one.jpg');
});
test('failed metadata save never changes storage objects', async () => {
  await move([entry('u/p/source/scene__one.jpg')], jest.fn().mockRejectedValue(new Error('Save denied')));
  await waitFor(() => expect(screen.getByText('Save denied')).toBeTruthy());
  expect(deleteImagesFromR2).not.toHaveBeenCalled(); expect(moveImagesInR2).not.toHaveBeenCalled();
});

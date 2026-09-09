import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MediaFolderBrowser from './MediaFolderBrowser';
import { moveImagesInR2, deleteImagesFromR2 } from '../../lib/r2';

jest.mock('../../lib/r2', () => ({
  projectR2Prefix: (u, p) => `${u}/${p}/`,
  moveImagesInR2: jest.fn(), deleteImagesFromR2: jest.fn(),
}));
const entry = (key) => ({ name: 'scene.jpg', key, media_id: key, url: `https://media.test/${key}`, folder: 'source' });
beforeEach(() => { jest.clearAllMocks(); moveImagesInR2.mockResolvedValue({ success: true }); deleteImagesFromR2.mockResolvedValue({ success: true }); });
async function move(pool, save) {
  render(<MediaFolderBrowser currentProject={{ id: 'p', preloadedImages: pool }} userId="u"
    onProjectUpdate={save} currentFolder="source" onCurrentFolderChange={jest.fn()} selectedMediaEntries={[pool[0]]} />);
  fireEvent.click(screen.getByRole('button', { name: /^Move selected/ }));
  fireEvent.change(screen.getByLabelText('Target folder (empty = root)'), { target: { value: 'target' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
}
test('moving one same-name file preserves its unique storage basename and saves before deleting', async () => {
  const save = jest.fn(async () => { expect(deleteImagesFromR2).not.toHaveBeenCalled(); });
  await move([entry('u/p/source/scene__one.jpg'), entry('u/p/source/scene__two.jpg')], save);
  await waitFor(() => expect(deleteImagesFromR2).toHaveBeenCalledTimes(1));
  expect(moveImagesInR2).toHaveBeenCalledWith([{ from: 'u/p/source/scene__one.jpg', to: 'u/p/target/scene__one.jpg' }], expect.objectContaining({ deferDelete: true }));
  expect(save.mock.calls[0][0].preloadedImages[1].key).toBe('u/p/source/scene__two.jpg');
});
test('an occupied target is rejected before any storage change', async () => {
  const save = jest.fn();
  await move([entry('u/p/source/scene.jpg'), { ...entry('u/p/target/scene.jpg'), folder: 'target' }], save);
  await waitFor(() => expect(screen.getByText(/target already contains/)).toBeTruthy());
  expect(moveImagesInR2).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
test('a failed media-list save retains the original files', async () => {
  await move([entry('u/p/source/scene__one.jpg')], jest.fn().mockRejectedValue(new Error('Save denied')));
  await waitFor(() => expect(screen.getByText('Save denied')).toBeTruthy());
  expect(deleteImagesFromR2).not.toHaveBeenCalled();
});

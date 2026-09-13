import { mediaSelectionCandidates } from './mediaLibrarySelection';

const file = (id, folder, name = 'scene.jpg', type = 'image') => ({ media_id: id, key: `u/p/${id}`, name, logicalFolder: folder, type });
const pool = [file('a', 'one'), file('b', 'two'), file('c', 'one/nested'), file('d', 'one-other'), file('e', ''), file('v', 'two', 'scene.mp4', 'video')];
const ids = (options) => mediaSelectionCandidates(pool, options).map((f) => f.media_id).sort();

test('multiple checked folders include descendants and exclude unrelated current folder', () => {
  expect(ids({ folders: new Set(['one', 'two']), currentFolder: 'one-other' })).toEqual(['a', 'b', 'c', 'v']);
});
test('overlapping parent and child selections do not duplicate media or confuse path prefixes', () => {
  expect(ids({ folders: new Set(['one', 'one/nested']) })).toEqual(['a', 'c']);
});
test('multi-folder selection respects both search and media type', () => {
  expect(ids({ folders: new Set(['one', 'two']), search: 'SCENE', type: 'image' })).toEqual(['a', 'b', 'c']);
  expect(ids({ folders: new Set(['one', 'two']), search: 'nested' })).toEqual(['c']);
  expect(ids({ folders: new Set(['one', 'two']), search: 'missing' })).toEqual([]);
});
test('without checked folders, selection uses only direct files of the current folder or root', () => {
  expect(ids({ currentFolder: 'one' })).toEqual(['a']);
  expect(ids({})).toEqual(['e']);
});

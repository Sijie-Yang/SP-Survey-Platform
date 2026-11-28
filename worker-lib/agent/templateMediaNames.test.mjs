import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copiedMediaEntries } from './projectLifecycle.mjs';

const ID = '236a3465-ef58-4c35-9ee7-7e1a3a4fc833';

describe('media copied from a template', () => {
  it('keeps the names the template lists, with the folder from the new key', () => {
    const files = [
      { from: `templates/t1/photos/lawnA_1slight__${ID}.jpg`, to: `u1/p1/photos/lawnA_1slight__${ID}.jpg`, url: 'https://m/1', name: `lawnA_1slight__${ID}.jpg` },
      { from: `templates/t1/images/unsplash_1__crop__${ID}.jpg`, to: `u1/p1/images/unsplash_1__crop__${ID}.jpg`, url: 'https://m/2', name: `unsplash_1__crop__${ID}.jpg` },
    ];
    const template = [
      { key: files[0].from, name: 'lawnA_1slight.jpg' },
      { key: files[1].from, name: 'unsplash(1)_crop.jpg' },
    ];
    assert.deepEqual(copiedMediaEntries(files, template, 'u1/p1/'), [
      { url: 'https://m/1', name: 'lawnA_1slight.jpg', key: files[0].to, folder: 'photos' },
      { url: 'https://m/2', name: 'unsplash(1)_crop.jpg', key: files[1].to, folder: 'images' },
    ]);
  });

  it('falls back to the stored name without its id when the template does not list the file', () => {
    const files = [{ from: `templates/t1/a__${ID}.png`, to: `u1/p1/a__${ID}.png`, url: 'https://m/a', name: `a__${ID}.png` }];
    assert.deepEqual(copiedMediaEntries(files, null, 'u1/p1/'), [{ url: 'https://m/a', name: 'a.png', key: files[0].to, folder: '' }]);
    // A template whose own list carries the stored name (published from a project copy).
    assert.equal(copiedMediaEntries(files, [{ key: files[0].from, name: `a__${ID}.png` }], 'u1/p1/')[0].name, 'a.png');
  });
});

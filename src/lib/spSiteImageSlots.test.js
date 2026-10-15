import { findImageSlots, linkImageSlots, prepareSiteDocument } from './spSite';

const page = `<html><head></head><body><script>
const PHOTO_URLS = [];
const IMAGES = ['a.jpg', "b.png"];
const STEPS = ['one', 'two'];
const PIC_GRID = [[1, 2]];
</script><p>const IMG = []</p></body></html>`;

test('finds image lists the page keeps in its own code', () => {
  expect(findImageSlots(page)).toEqual([{ name: 'PHOTO_URLS', count: 0 }, { name: 'IMAGES', count: 2 }]);
});

test('a page that reads SPSite.getMedia is left alone', () => {
  const own = page.replace('</script>', 'SPSite.getMedia("x");</script>');
  expect(findImageSlots(own)).toEqual([]);
  expect(linkImageSlots(own)).toBe(own);
});

test('image lists read the linked folders and keep the page list as fallback', () => {
  const out = linkImageSlots(page);
  expect(out).toContain('const PHOTO_URLS = (window.SPSite && SPSite.imageSlot ? SPSite.imageSlot("PHOTO_URLS", []) : [])');
  expect(out).toContain(`SPSite.imageSlot("IMAGES", ['a.jpg', "b.png"])`);
  expect(out).toContain("const STEPS = ['one', 'two'];");
  expect(out).toContain('<p>const IMG = []</p>');
});

test('lists are only rewritten when media folders are linked', () => {
  expect(prepareSiteDocument(page, { boot: { media: {} } })).not.toContain('SPSite.imageSlot("PHOTO_URLS"');
  expect(prepareSiteDocument(page, { boot: { media: { photos: [{ url: 'https://m/x.jpg', name: 'x.jpg' }] } } })).toContain('SPSite.imageSlot("PHOTO_URLS"');
});

test('the media library root gives the page the files that are in no folder', () => {
  const { siteMediaFolders } = require('./spSite');
  const pool = [
    { url: 'https://m/r1.jpg', name: 'r1.jpg', folder: '' },
    { url: 'https://m/r2.jpg', name: 'r2.jpg' },
    { url: 'https://m/s/a.jpg', name: 'a.jpg', folder: 'streets' },
  ];
  expect(siteMediaFolders(pool, { spSite: { mediaFolders: ['/'] } })).toEqual({
    '': [
      { url: 'https://m/r1.jpg', name: 'r1.jpg', type: 'image', folder: '' },
      { url: 'https://m/r2.jpg', name: 'r2.jpg', type: 'image', folder: '' },
    ],
  });
  expect(Object.keys(siteMediaFolders(pool, { spSite: { mediaFolders: ['/', 'streets'] } })).sort()).toEqual(['', 'streets']);
  expect(siteMediaFolders(pool, { spSite: { mediaFolders: [] } })).toEqual({});
});

test('an entry known only by its storage key is placed in the folder the key names', () => {
  const { siteMediaFolders } = require('./spSite');
  const pool = [{ url: 'https://m/u/p/streets/a.jpg', key: '0b5f1f0e-1c2d-4e3f-8a9b-1c2d3e4f5a6b/proj_1/streets/a.jpg' }, { url: 'https://m/u/p/b.jpg', key: '0b5f1f0e-1c2d-4e3f-8a9b-1c2d3e4f5a6b/proj_1/b.jpg' }];
  const out = siteMediaFolders(pool, { spSite: { mediaFolders: ['/'] } });
  expect((out[''] || []).map((m) => m.url)).toEqual(['https://m/u/p/b.jpg']);
});

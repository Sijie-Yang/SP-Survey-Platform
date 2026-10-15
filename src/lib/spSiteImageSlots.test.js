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

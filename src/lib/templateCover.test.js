import { resolveTemplateCover, DEFAULT_TEMPLATE_COVER } from './templateCover';

test('cover file wins over the media library and the preset library', () => {
  expect(resolveTemplateCover({
    id: 'study',
    thumbnail_url: 'https://chosen.example/thumb.jpg',
    preloadedImages: [{ url: 'https://lib.example/a.jpg', type: 'image' }],
  }, {
    coverFile: 'study.jpg',
    presetUrls: ['/preset.jpg'],
  })).toBe('/project_templates/cover_images/study.jpg');
});

test('a chosen thumbnail is used before a random library image', () => {
  expect(resolveTemplateCover({
    id: 'study',
    thumbnail_url: 'https://chosen.example/thumb.jpg',
    preloadedImages: [{ url: 'https://lib.example/a.jpg', type: 'image' }],
  }, { presetUrls: ['/preset.jpg'] })).toBe('https://chosen.example/thumb.jpg');
});

test('the template media library is used when no cover file is stored', () => {
  expect(resolveTemplateCover({
    id: 'study',
    preloadedImages: [{ url: 'https://lib.example/a.jpg', type: 'image' }],
  }, {
    extraLibraryUrls: ['https://bundled.example/b.jpg'],
    presetUrls: ['/preset.jpg'],
  })).toBe('https://lib.example/a.jpg');
});

test('bundled library images are used when the template database has none', () => {
  expect(resolveTemplateCover({ id: 'study' }, {
    extraLibraryUrls: ['https://bundled.example/b.jpg'],
    presetUrls: ['/preset.jpg'],
  })).toBe('https://bundled.example/b.jpg');
});

test('the preset library is used only when the template library is empty', () => {
  expect(resolveTemplateCover({ id: 'study' }, { presetUrls: ['/preset.jpg'] })).toBe('/preset.jpg');
  expect(resolveTemplateCover({ id: 'study' })).toBe(DEFAULT_TEMPLATE_COVER);
});

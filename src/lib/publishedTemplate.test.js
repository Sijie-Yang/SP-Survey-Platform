import { supabase } from './supabase';
import { fetchPublishedTemplate, publishedTemplateFromRow } from './publishedTemplate';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }));

function mockOnline(result) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => result),
  };
  supabase.from.mockReturnValue(chain);
  return chain;
}

const row = {
  id: '2013-salesses-collaborative',
  name: 'Place Pulse 1.0',
  description: 'Live description',
  author: 'Salesses',
  year: '2013',
  paper_url: 'https://doi.org/10.1371/journal.pone.0068400',
  thumbnail_url: null,
  survey_config: { pages: [{ name: 'live', elements: [] }] },
  preloaded_images: [{ url: 'https://media.example/a.jpg', type: 'image', name: 'a.jpg' }],
  image_dataset_config: { mediaFolders: [] },
};

test('an approved online template keeps its survey and media library', () => {
  expect(publishedTemplateFromRow(row)).toMatchObject({
    source: 'online',
    config: row.survey_config,
    preloadedImages: row.preloaded_images,
  });
  expect(publishedTemplateFromRow({ id: 'x' })).toBeNull();
});

test('wiki loading prefers the online template over the bundled file', async () => {
  mockOnline({ data: row, error: null });
  const fetchSpy = jest.spyOn(global, 'fetch');
  const template = await fetchPublishedTemplate(row.id);
  expect(template.source).toBe('online');
  expect(template.preloadedImages).toEqual(row.preloaded_images);
  expect(template.config).toEqual(row.survey_config);
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

test('a missing online template falls back to the bundled file and its image folder', async () => {
  mockOnline({ data: null, error: null });
  const bundled = { id: row.id, name: 'Bundled', config: { pages: [{ elements: [] }] }, preloadedImages: [] };
  jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    if (String(url).endsWith('/images.json')) {
      return { ok: true, json: async () => ({ images: ['scene.jpg'] }) };
    }
    return { ok: true, json: async () => bundled };
  });
  const template = await fetchPublishedTemplate(row.id);
  expect(template.source).toBe('bundled');
  expect(template.config).toEqual(bundled.config);
  expect(template.preloadedImages).toEqual([{
    url: `/project_templates/${row.id}/scene.jpg`,
    name: 'scene.jpg',
    key: `builtin/${row.id}/scene.jpg`,
    type: 'image',
  }]);
  global.fetch.mockRestore();
});

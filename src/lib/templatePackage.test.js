import { mediaCsv, packageFileName, paperCitation, templateJson, templateMediaFiles, templateReadme, totalBytes } from './templatePackage';

jest.mock('./supabase', () => ({ supabase: null }));

const listing = [
  { key: 'templates/t1/streets/a.jpg', name: 'a.jpg', folder: 'streets', url: 'https://m/t1/streets/a.jpg', size: 1000 },
  { key: 'templates/t1/b.png', name: 'b.png', folder: '', url: 'https://m/t1/b.png', size: 500 },
  { key: 'templates/t1/features/l0.csv', name: 'l0.csv', url: 'https://m/f', size: 9 },
  { key: 'templates/t1/preannotations/x.json', name: 'x.json', url: 'https://m/p', size: 9 },
];

test('media files keep folders under media/ and skip features/annotations', () => {
  const files = templateMediaFiles(listing, 't1');
  expect(files.map((f) => f.path)).toEqual(['media/b.png', 'media/streets/a.jpg']);
  expect(files[1].folder).toBe('streets');
  expect(totalBytes(files)).toBe(1500);
  expect(mediaCsv(files).split('\n')[0]).toBe('path,folder,bytes,url');
});

test('template.json strips own-response credentials and moves page html out', () => {
  const published = {
    name: 'T', config: { pages: [], spSite: { html: '<html></html>', mediaFolders: ['streets'] }, ownResponseSupabase: { url: 'x', anonKey: 'secret' } },
    imageDatasetConfig: { folders: 1 },
  };
  const json = templateJson({ template: { id: 't1', tags: ['task:rating'] }, published, paper: { title: 'P', doi: '10.1/x' } });
  expect(json.surveyConfig.spSite.html).toBe('(see index.html)');
  expect(JSON.stringify(json)).not.toContain('secret');
  expect(json.paper.doi).toBe('10.1/x');
});

test('readme cites the paper and lists missing files', () => {
  const files = templateMediaFiles(listing, 't1');
  const text = templateReadme({ template: { id: 't1' }, title: 'Title', paper: { authors: 'A, B', year: 2025, title: 'Paper.', venue: 'CEUS', doi: '10.1/x' }, files, hasPage: true, failed: [files[0]] });
  expect(text).toContain('A, B (2025) Paper. CEUS. https://doi.org/10.1/x');
  expect(text).toContain('index.html');
  expect(text).toContain('- media/b.png');
  expect(paperCitation(null)).toBe('');
  expect(packageFileName('2025 x/y')).toBe('sp-survey-template_2025_x_y.zip');
});

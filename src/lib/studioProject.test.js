import {
  cleanFolderName,
  defaultUploadFolder,
  importedProjectName,
  libraryFolders,
  libraryThumbnails,
  looseFileCount,
  missingPageFolders,
  pageFolders,
  pageForAiText,
  projectKind,
  projectStatus,
  sortProjectsNewestFirst,
} from './studioProject';

const page = (html, extra = {}) => ({ pages: [], spSite: { html, id: 'site-1', ...extra } });

test('tells an AI page from a classic survey and an empty project', () => {
  expect(projectKind({ _surveyConfig: page('<p>x</p>') })).toBe('page');
  expect(projectKind({ _surveyConfig: { pages: [{ elements: [{ type: 'text', name: 'q' }] }] } })).toBe('classic');
  expect(projectKind({ _surveyConfig: { pages: [{ elements: [] }] } })).toBe('empty');
  expect(projectKind({})).toBe('empty');
  expect(projectKind(page('<p>x</p>'))).toBe('page');
});

test('draft, published and changes waiting come from the release stamps', () => {
  expect(projectStatus({})).toEqual({ state: 'draft', version: 0 });
  expect(projectStatus({ releaseManaged: false, publishedVersion: 2 })).toEqual({ state: 'draft', version: 0 });
  const published = { releaseManaged: true, publishedVersion: 3, publishedAt: '2026-01-01T10:00:00Z', draftUpdatedAt: '2026-01-01T10:00:00Z' };
  expect(projectStatus(published)).toEqual({ state: 'published', version: 3 });
  expect(projectStatus({ ...published, draftUpdatedAt: '2026-01-02T10:00:00Z' })).toEqual({ state: 'pending', version: 3 });
});

test('projects are listed newest first', () => {
  const list = sortProjectsNewestFirst([
    { id: 'a', lastModified: '2026-01-01T00:00:00Z' },
    { id: 'b', lastModified: '2026-03-01T00:00:00Z' },
    { id: 'c' },
    { name: 'no id' },
  ]);
  expect(list.map((p) => p.id)).toEqual(['b', 'a', 'c']);
});

test('the folders a page reads, and which of them are still empty', () => {
  const config = page('<script>SPSite.getMedia("streets"); SPSite.getMedia(\'\')</script>', { mediaFolders: ['practice', '/'] });
  expect(pageFolders(config).sort()).toEqual(['practice', 'streets']);
  const project = {
    id: 'p1',
    userId: 'u1',
    preloadedImages: [
      { url: 'https://m/u1/p1/streets/a.jpg', name: 'a.jpg', key: 'u1/p1/streets/a.jpg', folder: 'streets', type: 'image' },
      { url: 'https://m/u1/p1/streets/b.jpg', name: 'b.jpg', key: 'u1/p1/streets/b.jpg', folder: 'streets', type: 'image' },
      { url: 'https://m/u1/p1/c.jpg', name: 'c.jpg', key: 'u1/p1/c.jpg', type: 'image' },
    ],
  };
  expect(missingPageFolders(project, config)).toEqual(['practice']);
  expect(libraryFolders(project)).toEqual([{ folder: 'streets', count: 2 }]);
  expect(looseFileCount(project)).toBe(1);
  expect(libraryThumbnails(project, 2).map((e) => e.name)).toEqual(['a.jpg', 'b.jpg']);
  expect(defaultUploadFolder(config)).toBe('practice');
  expect(defaultUploadFolder({ pages: [] })).toBe('images');
});

test('typed folder names stay inside the project', () => {
  expect(cleanFolderName(' streets / set 1 ')).toBe('streets/set_1');
  expect(cleanFolderName('../../other-user/x')).toBe('other-user/x');
  expect(cleanFolderName('街景/图片')).toBe('街景/图片');
  expect(cleanFolderName('<script>')).toBe('script');
  expect(cleanFolderName('...')).toBe('');
});

test('a new project is named after the page title, else a useful file name', () => {
  expect(importedProjectName({ title: 'Street study', name: 'x.zip' }, 'New')).toBe('Street study');
  expect(importedProjectName({ title: '', name: 'walkability.zip' }, 'New')).toBe('walkability');
  expect(importedProjectName({ title: '', name: 'index.html + 2' }, 'New')).toBe('New');
  expect(importedProjectName({ title: '', name: 'index.html' }, 'New')).toBe('New');
  expect(importedProjectName({}, 'New')).toBe('New');
});

test('the text for an AI to edit holds the spec and the current page', () => {
  const text = pageForAiText('SPEC', '<html>page</html>');
  expect(text.startsWith('SPEC')).toBe(true);
  expect(text).toContain('```html\n<html>page</html>\n```');
});

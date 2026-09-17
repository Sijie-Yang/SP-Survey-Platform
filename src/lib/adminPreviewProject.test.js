import { toAdminPreviewProject } from './adminPreviewProject';

const project = {
  id: 'proj_1789437408398_xip9r5qzx',
  name: 'Street study',
  user_id: 'researcher-a',
  preloadedImages: [{ url: '/park.jpg', name: 'park.jpg', folder: 'park', logicalFolder: 'park' }],
  imageDatasetConfig: {
    mediaFolderTags: { park: 'category', set_a: 'set' },
    mediaFolders: ['park', 'set_a'],
  },
  config: {
    pages: [{
      name: 'page1',
      elements: [{ name: 'q_cat', type: 'imagepicker', mediaAssignmentMode: 'category', mediaFolders: ['park'] }],
    }],
  },
  preloadedSource: 'r2',
  draftUpdatedAt: '2026-09-18T00:00:00.000Z',
};

test('admin editor and preview keep dataset tags, logical folders, and the current survey', () => {
  const trimmed = {
    id: project.id,
    name: project.name,
    preloadedImages: project.preloadedImages,
  };
  expect(trimmed.imageDatasetConfig).toBeUndefined();
  expect(trimmed.config).toBeUndefined();

  const preview = toAdminPreviewProject(project);
  expect(preview.imageDatasetConfig.mediaFolderTags).toEqual(project.imageDatasetConfig.mediaFolderTags);
  expect(preview.imageDatasetConfig.mediaFolders).toEqual(['park', 'set_a']);
  expect(preview.config.pages[0].elements[0].mediaFolders).toEqual(['park']);
  expect(preview.preloadedImages[0].logicalFolder).toBe('park');
  expect(preview.draftUpdatedAt).toBe(project.draftUpdatedAt);
});

test('admin builder preview uses the working draft instead of a stale saved config', () => {
  const draft = { pages: [{ name: 'draft', elements: [{ name: 'q_set', mediaAssignmentMode: 'set' }] }] };
  const preview = toAdminPreviewProject(project, { config: draft });
  expect(preview.config.pages[0].elements[0].name).toBe('q_set');
  expect(preview.imageDatasetConfig.mediaFolderTags.set_a).toBe('set');
});

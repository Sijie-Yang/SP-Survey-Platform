import { studioPublishProblems } from './studioPublish';

test('an empty project cannot be published', async () => {
  expect(await studioPublishProblems({ id: 'p1' }, { pages: [{ name: 'p', elements: [] }] })).toEqual([{ code: 'empty' }]);
});

test('a page whose image folder is empty cannot be published', async () => {
  const config = { pages: [], spSite: { html: '<script>SPSite.getMedia("streets")</script>', id: 's' } };
  expect(await studioPublishProblems({ id: 'p1', preloadedImages: [] }, config)).toEqual([{ code: 'folder-empty', folder: 'streets' }]);
  const withImages = { id: 'p1', preloadedImages: [{ url: 'https://m/a.jpg', name: 'a.jpg', folder: 'streets' }] };
  expect(await studioPublishProblems(withImages, config)).toEqual([]);
});

test('a classic survey runs the participant check', async () => {
  const config = { pages: [{ name: 'p', elements: [{ type: 'imagepicker', name: 'q1', title: 'Pick one', choices: [], imageCount: 2 }] }] };
  const problems = await studioPublishProblems({ id: 'p1', preloadedImages: [] }, config);
  expect(problems.some((p) => p.code === 'media' && p.question === 'Pick one')).toBe(true);
  const fine = await studioPublishProblems({ id: 'p1' }, { pages: [{ name: 'p', elements: [{ type: 'text', name: 'q1', title: 'Name' }] }] });
  expect(fine).toEqual([]);
});

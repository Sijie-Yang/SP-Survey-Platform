import { smokeQuestions, smokeTestSite } from './spSiteSmoke';

test('placeholder media are named after the planned files of each folder', () => {
  const survey = { pages: [{ name: 'p1', elements: [
    { type: 'radiogroup', name: 'task', choices: ['a', 'b'], mediaFolders: ['sp-scheme/x/task'], imageCount: 1, trialCount: 2 },
    { type: 'text', name: 'age' },
  ] }] };
  const plan = { files: [{ path: 'img/task/101.jpg', folder: 'sp-scheme/x/task' }, { path: 'img/task/102.jpg', folder: 'sp-scheme/x/task' }] };
  const [task, age] = smokeQuestions(survey, plan);
  expect(task.trials.map((t) => t.media[0].name)).toEqual(['101.jpg', '102.jpg']);
  expect(task.trials[0].media[0].url).toMatch(/^data:image\/svg/);
  expect(age.media || []).toEqual([]);
  expect(survey.pages[0].elements[0].trialMediaSets).toBeUndefined();
});

test('does not run without a real browser', async () => {
  await expect(smokeTestSite('<html></html>')).resolves.toEqual({ ran: false, problems: [] });
});

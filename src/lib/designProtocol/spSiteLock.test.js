import { applyOperations } from './operations';

const config = {
  title: 'S',
  pages: [{ name: 'p1', elements: [{ type: 'imagepicker', name: 'safer', imageCount: 2 }] }],
  spSite: { id: 'site-0123456789abcdef', html: '<html></html>' },
};

test('an SP-Scheme page keeps its questions: question edits go through the page', () => {
  expect(() => applyOperations(config, [{ op: 'addQuestion', pageName: 'p1', question: { type: 'text', name: 'age' } }]))
    .toThrow(/sp_scheme_import/);
  expect(() => applyOperations(config, [{ op: 'removeQuestion', name: 'safer' }])).toThrow(/sp_scheme_import/);
  const next = applyOperations(config, [{ op: 'updateSurvey', patch: { title: 'S2' } }]);
  expect(next.surveyConfig.title).toBe('S2');
});

test('a survey without a page is edited as before', () => {
  const { spSite, ...plain } = config;
  expect(() => applyOperations(plain, [{ op: 'addQuestion', pageName: 'p1', question: { type: 'text', name: 'age' } }])).not.toThrow();
});

test('a question edit finds its page by the question name', () => {
  const { spSite, ...plain } = config;
  const next = applyOperations(plain, [{ op: 'updateQuestion', questionName: 'safer', patch: { title: 'Which is safer?' } }]);
  expect(next.surveyConfig.pages[0].elements[0].title).toBe('Which is safer?');
  expect(next.inverse[0].pageName).toBe('p1');
});

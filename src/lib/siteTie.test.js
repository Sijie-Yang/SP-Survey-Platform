import { applySiteAnswer, buildSiteQuestions } from './spSite';
import { buildQuestionLongCsv } from './questionSummaryExport';
import { NO_PREFERENCE } from './choiceTie';

const question = { type: 'imagepicker', name: 'walk', imageCount: 2, allowTie: true, tieLabel: 'Not comparable', choices: [{ value: 'a.jpg', imageLink: 'https://m.example/a.jpg' }, { value: 'b.jpg', imageLink: 'https://m.example/b.jpg' }] };

test('the page\'s "no preference" button is stored as a tie', () => {
  const [site] = buildSiteQuestions({ pages: [{ name: 'p', elements: [question] }] });
  const result = applySiteAnswer(site, undefined, 'Not comparable');
  expect(result).toEqual({ ok: true, stored: NO_PREFERENCE });
});

test('the long CSV reads an answer stored under the tie label as a tie', () => {
  const rows = [{ participant_id: 'P1', responses: { walk: { trials: [{ answer: 'Not comparable', shown_images: ['https://m.example/a.jpg', 'https://m.example/b.jpg'] }] } } }];
  const csv = buildQuestionLongCsv({ ...question, trialCount: 1 }, rows, { pages: [{ name: 'p', elements: [question] }] });
  expect(csv).toMatch(/,tie,,tie(,|\r?\n|$)/);
});

test('the long CSV names the chosen image by file name too', () => {
  const rows = [{ participant_id: 'P1', responses: { walk: { trials: [{ answer: 'https://m.example/u/p/img/street_07__abc.jpg', shown_images: ['https://m.example/u/p/img/street_07__abc.jpg', 'https://m.example/b.jpg'] }] } } }];
  const csv = buildQuestionLongCsv({ ...question, trialCount: 1 }, rows, { pages: [{ name: 'p', elements: [question] }] });
  expect(csv.split(/\r?\n/)[0]).toMatch(/,value,value_name,outcome/);
  expect(csv).toMatch(/,street_07__abc\.jpg,A/);
});

import { answerUnits, checkTooFastFlag, evaluateResponseQuality } from './quality';

const row = (seconds, responses) => ({ survey_metadata: { timing: { total_seconds: seconds } }, responses });
const pairs = (n) => ({ trials: Array.from({ length: n }, () => ({ answer: 'a.jpg' })) });

describe('too fast', () => {
  test('counts one answer per question and per trial, not the page records', () => {
    expect(answerUnits(row(1, { walk: pairs(12), gender: 'f', note: '', __sp_page_state: {} }))).toBe(13);
  });

  test('flags 12 pairwise choices and 3 questions in 4 seconds even when every submission is that fast', () => {
    const bots = Array.from({ length: 18 }, () => row(4, { walk: pairs(12), a: 1, b: 2, c: 3 }));
    expect(checkTooFastFlag(bots[0], bots)).toEqual(['too_fast']);
    expect(evaluateResponseQuality(bots[0], { pages: [] }, bots)).toContain('too_fast');
  });

  test('keeps a careful submission and a tiny survey', () => {
    const careful = row(60, { walk: pairs(12), a: 1, b: 2, c: 3 });
    expect(checkTooFastFlag(careful, [careful, careful, careful])).toEqual([]);
    const consent = row(1, { consent: true });
    expect(checkTooFastFlag(consent, [consent])).toEqual([]);
  });

  test('still flags a submission far faster than the others', () => {
    const others = [row(300, { a: 1, b: 2, c: 3 }), row(320, { a: 1, b: 2, c: 3 }), row(310, { a: 1, b: 2, c: 3 })];
    const quick = row(50, { a: 1, b: 2, c: 3 });
    expect(checkTooFastFlag(quick, [...others, quick])).toEqual(['too_fast']);
  });
});

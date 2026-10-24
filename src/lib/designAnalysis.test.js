import { analyseDesign, bradleyTerry, designExportFiles, welch } from './designAnalysis';
import { designSizing, normalizeDesign, questionTrialsForVersion, versionTrials } from './experimentDesign';
import { seededRandom } from './designRandom';

const url = (k) => `https://media.example.org/p/${k}`;

/** Simulate completed responses that follow the design. */
function simulate(design, questions, people, answer, { conditions = null } = {}) {
  const rand = seededRandom(99);
  const rows = [];
  for (let p = 0; p < people; p += 1) {
    const version = p % designSizing(design).versions;
    const trials = versionTrials(design, version);
    const condition = conditions ? conditions[p % conditions.length] : null;
    const responses = {};
    questions.forEach((q) => {
      responses[q.name] = {
        trials: questionTrialsForVersion(design, trials, q, { designId: design.id, version }).map(({ media, context }) => ({
          ...context,
          shown_images: media.map(url),
          shown_media_ids: media,
          answer: answer(q, media, context, rand, condition),
        })),
      };
    });
    rows.push({
      participant_id: `p${p}`,
      responses,
      survey_metadata: { condition, experiment_design: { id: design.id, version, claim: p % 4 ? 'server' : 'local' } },
    });
  }
  return rows;
}

describe('Bradley–Terry', () => {
  test('recovers the order of known strengths', () => {
    const truth = { a: 2, b: 1, c: 0, d: -1 };
    const items = Object.keys(truth);
    const rand = seededRandom(5);
    const comparisons = [];
    for (let i = 0; i < 4000; i += 1) {
      const [x, y] = [items[i % 4], items[(i + 1 + (i % 3)) % 4]];
      if (x === y) continue;
      const pX = 1 / (1 + Math.exp(truth[y] - truth[x]));
      comparisons.push(rand() < pX ? { winner: x, loser: y } : { winner: y, loser: x });
    }
    const s = bradleyTerry(comparisons, items);
    expect(s[0]).toBeGreaterThan(s[1]);
    expect(s[1]).toBeGreaterThan(s[2]);
    expect(s[2]).toBeGreaterThan(s[3]);
    expect(s[0] - s[3]).toBeGreaterThan(2.4);
    expect(s[0] - s[3]).toBeLessThan(3.6);
  });

  test('Welch difference and interval', () => {
    const w = welch([1, 2, 3, 4, 5], [3, 4, 5, 6, 7]);
    expect(w.diff).toBe(2);
    expect(w.low).toBeLessThan(2);
    expect(w.high).toBeGreaterThan(2);
    expect(w.d).toBeCloseTo(1.265, 2);
  });
});

describe('analyseDesign', () => {
  test('pool pairs: execution check and Bradley–Terry ranking', () => {
    const keys = Array.from({ length: 12 }, (_, i) => `img${String(i).padStart(2, '0')}.jpg`);
    const design = { ...normalizeDesign({ type: 'pool_pairs', seed: 4, units: keys, perPerson: 6, target: 20, questions: ['pick'] }), id: 'd_pool' };
    const questions = [{ name: 'pick', type: 'imagepicker' }];
    const strength = (k) => -Number(k.slice(3, 5)) / 3;
    const rows = simulate(design, questions, designSizing(design).versions, (q, media, ctx, rand) => {
      const p0 = 1 / (1 + Math.exp(strength(media[1]) - strength(media[0])));
      return url(rand() < p0 ? media[0] : media[1]);
    });
    const result = analyseDesign(design, rows, { pages: [{ elements: questions }] });
    expect(result.execution.participants).toBe(rows.length);
    expect(result.execution.actual).toEqual(result.execution.planned);
    expect(result.execution.planned.max - result.execution.planned.min).toBeLessThanOrEqual(1);
    const bt = result.perQuestion[0].main;
    expect(bt.kind).toBe('bt');
    expect(bt.rows[0].unit).toBe('img00.jpg');
    expect(bt.rows.at(-1).unit).toBe('img11.jpg');
    expect(bt.rows[0].low).toBeLessThan(bt.rows[0].score);
    expect(bt.rows[0].high).toBeGreaterThan(bt.rows[0].score);
    const files = designExportFiles(design, result);
    expect(files.map((f) => f.path)).toEqual(expect.arrayContaining(['experiment_design/design_table.csv', 'experiment_design/pick__bt.csv']));
  });

  test('fixed pairs: share choosing b, rating differences, consistency, repeats and conditions', () => {
    const units = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, a: `before${i}.jpg`, b: `after${i}.jpg` }));
    const design = { ...normalizeDesign({ type: 'fixed_pairs', seed: 2, units, perPerson: 5, target: 20, repeats: 1, questions: ['choice', 'safe'] }), id: 'd_fixed' };
    const questions = [{ name: 'choice', type: 'imagepicker', title: 'Which is safer?' }, { name: 'safe', type: 'imagerating', title: 'Safety' }];
    const conditions = ['day', 'night'];
    const rows = simulate(design, questions, 80, (q, media, ctx, rand, condition) => {
      if (q.type === 'imagepicker') {
        const after = media.find((m) => m.startsWith('after'));
        const before = media.find((m) => m.startsWith('before'));
        return url(rand() < (condition === 'night' ? 0.85 : 0.65) ? after : before);
      }
      const isAfter = media[0].startsWith('after');
      return Math.max(1, Math.min(7, Math.round((isAfter ? 5 : 3.5) + (rand() - 0.5) * 2)));
    }, { conditions });
    const result = analyseDesign(design, rows, { pages: [{ elements: questions }], conditions: [{ id: 'day', label: 'Day' }, { id: 'night', label: 'Night' }] });
    const choice = result.perQuestion[0];
    expect(choice.main.kind).toBe('pair_share');
    expect(choice.main.overall.mean).toBeGreaterThan(0.65);
    expect(choice.main.overall.mean).toBeLessThan(0.85);
    expect(Math.abs(result.execution.leftRight.shareAB - 0.5)).toBeLessThan(0.05);
    expect(Math.abs(choice.main.position.share - 0.5)).toBeLessThan(0.1);
    expect(choice.conditions.contrasts[0].diff).toBeGreaterThan(0.1);
    expect(choice.repeats.kind).toBe('agreement');
    const rating = result.perQuestion[1];
    expect(rating.main.overallDiff.mean).toBeGreaterThan(1);
    expect(rating.repeats.kind).toBe('retest');
    expect(result.consistency.share).toBeGreaterThan(0.5);
  });

  test('responses from before the design are counted but not analysed', () => {
    const design = { ...normalizeDesign({ type: 'rate', seed: 1, units: ['a.jpg', 'b.jpg', 'c.jpg'], perPerson: 2, target: 2, questions: ['q'] }), id: 'd_rate' };
    const questions = [{ name: 'q', type: 'imagerating' }];
    const rows = simulate(design, questions, 3, () => 4);
    rows.push({ participant_id: 'old', responses: { q: 3 }, survey_metadata: {} });
    const result = analyseDesign(design, rows, { pages: [{ elements: questions }] });
    expect(result.execution.outsideDesign).toBe(1);
    expect(result.perQuestion[0].main.rows.every((r) => r.mean === 4)).toBe(true);
  });
});

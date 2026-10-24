import {
  buildVersions, computeDesignId, describeDesign, designMethodsText, designSizing, normalizeDesign,
  parseCatchText, parsePairsText, plannedExposures, questionTrialsForVersion, validateDesign, versionTrials,
} from './experimentDesign';
import { hashSeed, seededRandom, shuffled } from './designRandom';

const images = (n) => Array.from({ length: n }, (_, i) => `street_${String(i + 1).padStart(3, '0')}.jpg`);
const pairs = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, a: `before_${i + 1}.jpg`, b: `after_${i + 1}.jpg` }));

describe('designRandom', () => {
  test('seeded shuffle is repeatable and a permutation', () => {
    const list = images(30);
    const a = shuffled(list, seededRandom(7));
    expect(shuffled(list, seededRandom(7))).toEqual(a);
    expect([...a].sort()).toEqual([...list].sort());
    expect(shuffled(list, seededRandom(8))).not.toEqual(a);
  });

  test('Fisher–Yates puts each item in each position about equally often', () => {
    const rand = seededRandom(hashSeed('uniform'));
    const counts = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    for (let r = 0; r < 20000; r += 1) shuffled([0, 1, 2, 3], rand).forEach((v, pos) => { counts[v][pos] += 1; });
    counts.flat().forEach((c) => expect(Math.abs(c - 5000)).toBeLessThan(300));
  });
});

describe('rate design', () => {
  const design = normalizeDesign({ type: 'rate', seed: 42, units: images(97), perPerson: 12, target: 10, questions: ['safe'] });

  test('sizing', () => {
    const s = designSizing(design);
    expect(s.versions).toBe(Math.ceil((97 * 10) / 12));
    expect(s.exposuresMin).toBe(Math.floor((s.versions * 12) / 97));
  });

  test('every image is shown floor or ceil of the average after any number of versions', () => {
    [1, 7, 8, 9, 50, designSizing(design).versions].forEach((count) => {
      const exp = [...plannedExposures(design, count).values()];
      expect(Math.max(...exp) - Math.min(...exp)).toBeLessThanOrEqual(1);
      expect(exp.reduce((a, b) => a + b, 0)).toBe(count * 12);
    });
  });

  test('no version repeats an image, even across pass boundaries', () => {
    buildVersions(design, designSizing(design).versions).forEach((trials) => {
      const keys = trials.map((t) => t.unit);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toHaveLength(12);
    });
  });

  test('versions are deterministic and depend on the seed', () => {
    expect(versionTrials(design, 5)).toEqual(versionTrials(design, 5));
    const other = normalizeDesign({ ...design, seed: 43 });
    expect(versionTrials(other, 5)).not.toEqual(versionTrials(design, 5));
  });

  test('anchors go to everyone and repeats come last', () => {
    const d = normalizeDesign({ ...design, anchors: [design.units[0], design.units[1]], repeats: 2 });
    const t = versionTrials(d, 3);
    expect(t.filter((x) => x.role === 'anchor').map((x) => x.unit).sort()).toEqual([design.units[0], design.units[1]].sort());
    expect(t.slice(-2).every((x) => x.role === 'repeat')).toBe(true);
    expect(t.filter((x) => x.role === 'main').some((x) => d.anchors.includes(x.unit))).toBe(false);
    expect(t).toHaveLength(12 + 2 + 2);
  });
});

describe('fixed pairs design', () => {
  const design = normalizeDesign({ type: 'fixed_pairs', seed: 9, units: pairs(30), perPerson: 8, target: 6, questions: ['choice', 'rate'] });

  test('legacy {a, b} units become slots A and B', () => {
    expect(design.units[0]).toEqual({ id: 'p1', slots: { A: 'before_1.jpg', B: 'after_1.jpg' } });
  });

  test('left/right is exactly half per pair after whole passes', () => {
    const versions = buildVersions(design, designSizing(design).versions);
    const ab = new Map();
    versions.flat().forEach((t) => {
      const row = ab.get(t.unit) || { AB: 0, BA: 0 };
      row[t.order] += 1;
      ab.set(t.unit, row);
    });
    [...ab.values()].forEach((row) => expect(Math.abs(row.AB - row.BA)).toBeLessThanOrEqual(1));
  });

  test('position can be random or fixed', () => {
    const fixed = normalizeDesign({ ...design, position: 'fixed' });
    buildVersions(fixed, 10).flat().forEach((t) => expect(t.order).toBe('AB'));
    const random = normalizeDesign({ ...design, position: 'random' });
    const orders = new Set(buildVersions(random, 10).flat().map((t) => t.order));
    expect(orders).toEqual(new Set(['AB', 'BA']));
  });

  test('a choice question gets one trial per pair; a rating question two', () => {
    const trials = versionTrials(design, 0);
    const choice = questionTrialsForVersion(design, trials, { type: 'imagepicker' }, { designId: 'd_x', version: 0 });
    const rate = questionTrialsForVersion(design, trials, { type: 'imagerating' }, { designId: 'd_x', version: 0 });
    expect(choice).toHaveLength(8);
    expect(rate).toHaveLength(16);
    expect(rate[0].context.design_unit).toBe(rate[1].context.design_unit);
    const unit = design.units.find((u) => u.id === rate[0].context.design_unit);
    rate.slice(0, 2).forEach((r) => expect(r.media[0]).toBe(unit.slots[r.context.design_side]));
  });

  test('views: a question can take one slot, or half of the trials', () => {
    const d = normalizeDesign({ ...design, questions: ['choice', 'rate', 'onlyB'], views: { onlyB: { slots: ['B'] }, choice: { trials: 'first' }, rate: { trials: 'second' } } });
    const trials = versionTrials(d, 0);
    const onlyB = questionTrialsForVersion(d, trials, { name: 'onlyB', type: 'imagerating' });
    expect(onlyB).toHaveLength(8);
    onlyB.forEach((t) => expect(t.context.design_side).toBe('B'));
    const first = questionTrialsForVersion(d, trials, { name: 'choice', type: 'imagepicker' });
    const second = questionTrialsForVersion(d, trials, { name: 'rate', type: 'imagerating' });
    expect(first).toHaveLength(4);
    expect(second).toHaveLength(8);
    const firstUnits = new Set(first.map((t) => t.context.design_unit));
    second.forEach((t) => expect(firstUnits.has(t.context.design_unit)).toBe(false));
  });

  test('three-slot sets: every slot takes every position equally; a choice question can see two named slots', () => {
    const units = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, slots: { v0: `s${i}_v0.jpg`, v1: `s${i}_v1.jpg`, v2: `s${i}_v2.jpg` } }));
    const d = normalizeDesign({ type: 'fixed_pairs', seed: 4, units, perPerson: 6, target: 6, questions: ['pick', 'ab'], views: { ab: { slots: ['v0', 'v1'] } } });
    const positions = new Map();
    buildVersions(d, designSizing(d).versions).flat().forEach((t) => {
      t.slots.forEach((name, pos) => {
        const key = `${t.unit}|${name}|${pos}`;
        positions.set(key, (positions.get(key) || 0) + 1);
      });
    });
    const counts = [...positions.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    const ab = questionTrialsForVersion(d, versionTrials(d, 0), { name: 'ab', type: 'imagepicker' });
    expect(ab).toHaveLength(6);
    ab.forEach((t) => { expect(t.media).toHaveLength(2); expect(t.context.design_slots.sort()).toEqual(['v0', 'v1']); });
  });

  test('slotMode one: each person sees one image per set, half each, balanced across people', () => {
    const units = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, slots: { day: `s${i}_day.jpg`, night: `s${i}_night.jpg` } }));
    const d = normalizeDesign({ type: 'fixed_pairs', seed: 5, units, perPerson: 8, target: 10, slotMode: 'one', questions: ['rate'] });
    const perUnitSlot = new Map();
    buildVersions(d, designSizing(d).versions).forEach((trials) => {
      expect(trials).toHaveLength(8);
      trials.forEach((t) => expect(t.media).toHaveLength(1));
      const days = trials.filter((t) => t.order === 'day').length;
      expect(Math.abs(days - 4)).toBeLessThanOrEqual(0);
      trials.forEach((t) => perUnitSlot.set(`${t.unit}|${t.order}`, (perUnitSlot.get(`${t.unit}|${t.order}`) || 0) + 1));
    });
    units.forEach((u) => {
      const day = perUnitSlot.get(`${u.id}|day`) || 0;
      const night = perUnitSlot.get(`${u.id}|night`) || 0;
      expect(Math.abs(day - night)).toBeLessThanOrEqual(2);
    });
  });

  test('catch trials are mixed in with their expected answer', () => {
    const d = normalizeDesign({ ...design, catches: [{ id: 'c1', media: ['black.jpg', 'park.jpg'], expected: 'park.jpg' }] });
    const trials = versionTrials(d, 2);
    const c = trials.find((t) => t.role === 'catch');
    expect(c.expected).toBe('park.jpg');
    expect(trials).toHaveLength(9);
    const q = questionTrialsForVersion(d, trials, { name: 'choice', type: 'imagepicker' });
    expect(q.find((t) => t.context.design_role === 'catch').context.design_expected).toBe('park.jpg');
    expect(parseCatchText('black.jpg, 1\nx.jpg, y.jpg, y.jpg\nnope')).toEqual({
      catches: [{ id: 'catch01', media: ['black.jpg'], expected: 1 }, { id: 'catch02', media: ['x.jpg', 'y.jpg'], expected: 'y.jpg' }],
      problems: [3],
    });
  });

  test('parses a pasted table, with or without a header naming the slots', () => {
    const { units, problems } = parsePairsText('pair_id, a, b\nP1, x1.jpg, y1.jpg, Main St\nx2.jpg, y2.jpg\nbad');
    expect(units).toEqual([{ id: 'P1', slots: { a: 'x1.jpg', b: 'y1.jpg' }, label: 'Main St' }, { id: 'unit02', slots: { a: 'x2.jpg', b: 'y2.jpg' } }]);
    expect(problems).toEqual([4]);
    const three = parsePairsText('S1, a.jpg, b.jpg, c.jpg, Park');
    expect(three.units).toEqual([{ id: 'S1', slots: { A: 'a.jpg', B: 'b.jpg', C: 'c.jpg' }, label: 'Park' }]);
  });
});

describe('pool pairs design', () => {
  const design = normalizeDesign({ type: 'pool_pairs', seed: 3, units: images(41), perPerson: 6, target: 8, questions: ['pick'] });

  test('k images per trial: no repeats within a version, balanced exposures, a multi-select question sees the set', () => {
    const d = normalizeDesign({ ...design, perTrial: 4, perPerson: 5 });
    const count = designSizing(d).versions;
    buildVersions(d, count).forEach((trials) => {
      expect(trials).toHaveLength(5);
      const keys = trials.flatMap((t) => t.media);
      expect(new Set(keys).size).toBe(20);
    });
    const exp = [...plannedExposures(d, count).values()];
    expect(Math.max(...exp) - Math.min(...exp)).toBeLessThanOrEqual(1);
    const q = questionTrialsForVersion(d, versionTrials(d, 0), { name: 'pick', type: 'imagecheckbox' });
    expect(q).toHaveLength(5);
    q.forEach((t) => expect(t.media).toHaveLength(4));
  });

  test('pairs never repeat an image within a version and exposures stay balanced', () => {
    const count = designSizing(design).versions;
    buildVersions(design, count).forEach((trials) => {
      const keys = trials.flatMap((t) => t.media);
      expect(new Set(keys).size).toBe(keys.length);
      expect(trials).toHaveLength(6);
    });
    const exp = [...plannedExposures(design, count).values()];
    expect(Math.max(...exp) - Math.min(...exp)).toBeLessThanOrEqual(1);
  });
});

describe('validation and text', () => {
  const questions = [{ name: 'pick', type: 'imagepicker' }, { name: 'safe', type: 'imagerating' }, { name: 'why', type: 'comment' }];

  test('flags a choice question in a rating design and missing files', () => {
    const d = normalizeDesign({ type: 'rate', units: images(10), perPerson: 4, questions: ['pick', 'why'] });
    const { errors } = validateDesign(d, { poolKeys: new Set(images(9)), questions });
    const text = errors.map((e) => e.en).join(' ');
    expect(text).toMatch(/not in the media library/);
    expect(text).toMatch(/chooses among images/);
    expect(text).toMatch(/cannot follow a design/);
  });

  test('describes and cites the design', () => {
    const d = normalizeDesign({ type: 'fixed_pairs', seed: 1, units: pairs(60), perPerson: 10, target: 15, questions: ['pick', 'safe'] });
    expect(describeDesign(d, { zh: true })).toContain('每对会被看 15 次');
    expect(describeDesign(d, { zh: true })).toContain('大约需要 90 人');
    expect(designMethodsText(d)).toMatch(/90 versions of 10 \(SP-Survey/);
    expect(computeDesignId(d)).toBe(computeDesignId(normalizeDesign({ ...d })));
    expect(computeDesignId(d)).not.toBe(computeDesignId(normalizeDesign({ ...d, seed: 2 })));
  });
});

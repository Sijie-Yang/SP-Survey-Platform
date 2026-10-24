import {
  buildVersions, computeDesignId, describeDesign, designMethodsText, designSizing, normalizeDesign,
  parsePairsText, plannedExposures, questionTrialsForVersion, validateDesign, versionTrials,
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

  test('left/right is exactly half per pair after whole passes', () => {
    const versions = buildVersions(design, designSizing(design).versions);
    const ab = new Map();
    versions.flat().forEach((t) => {
      const row = ab.get(t.unit) || { ab: 0, ba: 0 };
      row[t.order] += 1;
      ab.set(t.unit, row);
    });
    [...ab.values()].forEach((row) => expect(Math.abs(row.ab - row.ba)).toBeLessThanOrEqual(1));
  });

  test('a choice question gets one trial per pair; a rating question two', () => {
    const trials = versionTrials(design, 0);
    const choice = questionTrialsForVersion(design, trials, { type: 'imagepicker' }, { designId: 'd_x', version: 0 });
    const rate = questionTrialsForVersion(design, trials, { type: 'imagerating' }, { designId: 'd_x', version: 0 });
    expect(choice).toHaveLength(8);
    expect(rate).toHaveLength(16);
    expect(rate[0].context.design_unit).toBe(rate[1].context.design_unit);
    const unit = design.units.find((u) => u.id === rate[0].context.design_unit);
    rate.slice(0, 2).forEach((r) => expect(r.media[0]).toBe(r.context.design_side === 'a' ? unit.a : unit.b));
  });

  test('parses a pasted pairs table', () => {
    const { units, problems } = parsePairsText('pair_id, a, b\nP1, x1.jpg, y1.jpg, Main St\nx2.jpg, y2.jpg\nbad');
    expect(units).toEqual([{ id: 'P1', a: 'x1.jpg', b: 'y1.jpg', label: 'Main St' }, { id: 'pair02', a: 'x2.jpg', b: 'y2.jpg' }]);
    expect(problems).toEqual([4]);
  });
});

describe('pool pairs design', () => {
  const design = normalizeDesign({ type: 'pool_pairs', seed: 3, units: images(41), perPerson: 6, target: 8, questions: ['pick'] });

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
    expect(text).toMatch(/two-image choice/);
    expect(text).toMatch(/cannot follow a design/);
  });

  test('describes and cites the design', () => {
    const d = normalizeDesign({ type: 'fixed_pairs', seed: 1, units: pairs(60), perPerson: 10, target: 15, questions: ['pick', 'safe'] });
    expect(describeDesign(d, { zh: true })).toContain('每对会被看 15 次');
    expect(describeDesign(d, { zh: true })).toContain('大约需要 90 人');
    expect(designMethodsText(d)).toMatch(/90 versions of 10 pairs/);
    expect(computeDesignId(d)).toBe(computeDesignId(normalizeDesign({ ...d })));
    expect(computeDesignId(d)).not.toBe(computeDesignId(normalizeDesign({ ...d, seed: 2 })));
  });
});

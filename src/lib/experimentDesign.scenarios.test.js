/* eslint-disable jest/no-conditional-expect */
/**
 * Stress scenarios: many design shapes run end to end through the same code the
 * Builder, the participant page and Results use. Each scenario checks the
 * invariants a researcher relies on rather than exact numbers.
 */
import {
  DESIGN_MAX_VERSIONS, buildVersions, computeDesignId, describeDesign, designMethodsText, designSizing,
  normalizeDesign, perTrial, plannedExposures, questionTrialsForVersion, questionView, validateDesign,
  designSlotNames, unitSlotNames,
} from './experimentDesign';
import { activeDesign, assignDesignVersion, designMediaForElement, designPoolIndex, designResponseMetadata } from './experimentDesignRuntime';
import { analyseDesign, designExportFiles } from './designAnalysis';
import { seededRandom } from './designRandom';

const url = (k) => `https://media.example.org/p/${k}`;
const images = (n, prefix = 'img') => Array.from({ length: n }, (_, i) => `${prefix}_${String(i + 1).padStart(3, '0')}.jpg`);
const sets = (n, names) => Array.from({ length: n }, (_, i) => ({
  id: `set${i + 1}`,
  slots: Object.fromEntries(names.map((s) => [s, `${s}/scene${i + 1}.jpg`])),
}));
const q = (name, type, extra = {}) => ({ name, type, title: name, ...extra });

const PAIR = new Set(['imagepicker', 'mediapicker']);
const MULTI = new Set(['imagecheckbox', 'mediacheckbox']);
const BOOL = new Set(['imageboolean', 'mediaboolean']);

/** A believable answer for any supported question type. */
function answerFor(question, media, ctx, rand) {
  const strength = (m) => -(parseInt(String(m).replace(/\D+/g, '').slice(-3), 10) || 0) / 20 + (String(m).includes('after') || String(m).includes('/B') ? 1 : 0);
  if (ctx.design_role === 'catch' && ctx.design_expected != null) {
    if (typeof ctx.design_expected === 'number') return ctx.design_expected;
    return rand() < 0.9 ? url(ctx.design_expected) : url(media[0]);
  }
  if (PAIR.has(question.type)) {
    const w = media.map((m) => Math.exp(strength(m)));
    let r = rand() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < media.length; i += 1) { r -= w[i]; if (r <= 0) return url(media[i]); }
    return url(media[media.length - 1]);
  }
  if (MULTI.has(question.type)) return media.filter((m) => rand() < 1 / (1 + Math.exp(-strength(m)))).map(url);
  if (BOOL.has(question.type)) return rand() < 1 / (1 + Math.exp(-strength(media[0]))) ? 'yes' : 'no';
  if (question.type === 'imagematrix' || question.type === 'mediamatrix') return { row1: Math.round(3 + strength(media[0]) + rand()) };
  return Math.max(1, Math.min(7, Math.round(4 + strength(media[0]) + (rand() - 0.5) * 2)));
}

/** Simulated completed responses through the runtime path the participant page uses. */
async function simulate(design, questions, pool, people, { conditions = null, seed = 5 } = {}) {
  const rand = seededRandom(seed);
  const poolIndex = designPoolIndex(pool);
  const rows = [];
  const { versions } = designSizing(design);
  for (let p = 0; p < people; p += 1) {
    const assignment = await assignDesignVersion(design, { claim: async () => ({ version: p % versions, claimId: `c${p}` }) });
    const condition = conditions ? conditions[p % conditions.length] : null;
    const responses = {};
    questions.forEach((question) => {
      const mapped = designMediaForElement(design, assignment, question, poolIndex);
      if (!mapped) return;
      responses[question.name] = {
        trials: mapped.trialMediaSets.map((set, i) => {
          const ctx = mapped.trialMediaContexts[i];
          const media = set.map((e) => e.key || e.media_id || e.name);
          return { ...ctx, shown_images: media.map(url), shown_media_ids: media, answer: answerFor(question, media, ctx, rand) };
        }),
      };
    });
    rows.push({ participant_id: `p${p}`, responses, survey_metadata: { condition, ...designResponseMetadata(assignment) } });
  }
  return rows;
}

const poolFor = (keys) => keys.map((key) => ({ key, media_id: key, name: key.split('/').pop(), url: url(key) }));

const designMedia = (design) => [
  ...design.units.flatMap((u) => (typeof u === 'string' ? [u] : Object.values(u.slots))),
  ...design.catches.flatMap((c) => c.media),
];

/**
 * Every scenario: a survey config (questions + conditions) and a design. `expect`
 * names the analysis kind per question and whether validation must pass.
 */
const SCENARIOS = [
  {
    name: 'rate: 30 images, 10 each, seen 5 times',
    questions: [q('score', 'imagerating')],
    design: { type: 'rate', units: images(30), perPerson: 10, target: 5 },
    kinds: { score: 'item_means' },
  },
  {
    name: 'rate: anchors + repeats + catch; rating, yes/no and slider follow',
    questions: [q('score', 'imagerating'), q('safe', 'imageboolean'), q('slide', 'imageslidergroup')],
    design: { type: 'rate', units: images(27), anchors: images(27).slice(24), repeats: 2, catches: [{ id: 'c1', media: ['black.jpg'], expected: 1 }], perPerson: 8, target: 4 },
    kinds: { score: 'item_means', safe: 'item_means', slide: 'item_means' },
    extraRoles: ['anchor', 'repeat', 'catch'],
  },
  {
    name: 'library pairs (k=2) with two participant groups',
    questions: [q('safer', 'imagepicker', { imageCount: 2 })],
    design: { type: 'pool_pairs', units: images(20), perPerson: 6, perTrial: 2, target: 8 },
    conditions: ['day', 'night'],
    kinds: { safer: 'bt' },
  },
  {
    name: 'library triples (k=3): pick one plus a rating of every image shown',
    questions: [q('best', 'imagepicker'), q('score', 'imagerating')],
    design: { type: 'pool_pairs', units: images(30), perPerson: 6, perTrial: 3, target: 6 },
    kinds: { best: 'bt', score: 'item_means' },
  },
  {
    name: 'library k=5: pick any + pick one',
    questions: [q('walk', 'imagecheckbox'), q('fav', 'imagepicker')],
    design: { type: 'pool_pairs', units: images(40), perPerson: 5, perTrial: 5, target: 5 },
    kinds: { walk: 'select_share', fav: 'bt' },
  },
  {
    name: 'library k=12 with exactly 12 images: one screen per person',
    questions: [q('fav', 'imagepicker')],
    design: { type: 'pool_pairs', units: images(12), perPerson: 1, perTrial: 12, target: 10 },
    kinds: { fav: 'bt' },
  },
  {
    name: 'library: anchors shown k to a screen, repeats and a catch screen',
    questions: [q('fav', 'imagepicker')],
    design: { type: 'pool_pairs', units: images(28), anchors: images(28).slice(24), repeats: 1, catches: [{ id: 'c1', media: ['black.jpg', 'park.jpg'], expected: 'park.jpg' }], perPerson: 5, perTrial: 2, target: 4 },
    kinds: { fav: 'bt' },
    extraRoles: ['anchor', 'repeat', 'catch'],
  },
  {
    name: 'fixed pairs: choice, rating and yes/no on the same pairs',
    questions: [q('choose', 'imagepicker'), q('score', 'imagerating'), q('safe', 'imageboolean')],
    design: { type: 'fixed_pairs', units: sets(10, ['A', 'B']), perPerson: 5, target: 6 },
    kinds: { choose: 'pair_share', score: 'item_means', safe: 'item_means' },
  },
  {
    name: 'fixed pairs: two choice questions on different halves of each person\'s pairs',
    questions: [q('safer', 'imagepicker'), q('nicer', 'imagepicker')],
    design: { type: 'fixed_pairs', units: sets(12, ['A', 'B']), perPerson: 6, target: 4, views: { safer: { trials: 'first' }, nicer: { trials: 'second' } } },
    kinds: { safer: 'pair_share', nicer: 'pair_share' },
    disjoint: ['safer', 'nicer'],
  },
  {
    name: 'fixed sets of 3: whole set, each image, and two named slots',
    questions: [q('pick', 'imagepicker'), q('score', 'imagerating'), q('ac', 'imagepicker')],
    design: { type: 'fixed_pairs', units: sets(9, ['A', 'B', 'C']), perPerson: 9, target: 4, views: { ac: { slots: ['A', 'C'] } } },
    kinds: { pick: 'slot_share', score: 'item_means', ac: 'slot_share' },
    mediaPerTrial: { pick: 3, score: 1, ac: 2 },
  },
  {
    name: 'fixed sets of 4, one image per set per person (Latin square), two groups',
    questions: [q('score', 'imagerating'), q('safe', 'imageboolean')],
    design: { type: 'fixed_pairs', units: sets(16, ['v1', 'v2', 'v3', 'v4']), slotMode: 'one', perPerson: 8, target: 8 },
    conditions: ['local', 'visitor'],
    kinds: { score: 'item_means', safe: 'item_means' },
    mediaPerTrial: { score: 1, safe: 1 },
  },
  {
    name: 'fixed pairs with random positions',
    questions: [q('choose', 'imagepicker')],
    design: { type: 'fixed_pairs', units: sets(8, ['A', 'B']), position: 'random', perPerson: 8, target: 5 },
    kinds: { choose: 'pair_share' },
  },
  {
    name: 'fixed pairs with fixed positions',
    questions: [q('choose', 'imagepicker')],
    design: { type: 'fixed_pairs', units: sets(8, ['A', 'B']), position: 'fixed', perPerson: 4, target: 5 },
    kinds: { choose: 'pair_share' },
  },
  {
    name: 'legacy a/b pairs still load',
    questions: [q('choose', 'imagepicker'), q('score', 'imagerating')],
    design: { type: 'fixed_pairs', units: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, a: `before_${i}.jpg`, b: `after_${i}.jpg` })), perPerson: 6, target: 4 },
    kinds: { choose: 'pair_share', score: 'item_means' },
  },
  {
    name: 'fixed pairs: anchors, repeats, catches and views together',
    questions: [q('choose', 'imagepicker'), q('score', 'imagerating')],
    design: {
      type: 'fixed_pairs', units: sets(11, ['A', 'B']), anchors: ['set11'], repeats: 2,
      catches: [{ id: 'c1', media: ['black.jpg', 'park.jpg'], expected: 'park.jpg' }], perPerson: 5, target: 4, views: { score: { trials: 'second' } },
    },
    kinds: { choose: 'pair_share', score: 'item_means' },
    extraRoles: ['anchor', 'repeat', 'catch'],
  },
  {
    name: 'fixed sets of 12 slots (the maximum)',
    questions: [q('pick', 'imagepicker')],
    design: { type: 'fixed_pairs', units: sets(5, 'ABCDEFGHIJKL'.split('')), perPerson: 5, target: 3 },
    kinds: { pick: 'slot_share' },
    mediaPerTrial: { pick: 12 },
  },
  {
    name: 'more per person than units: everyone sees all',
    questions: [q('score', 'imagerating')],
    design: { type: 'rate', units: images(5), perPerson: 20, target: 3 },
    kinds: { score: 'item_means' },
    warn: true,
  },
  {
    name: 'sizing by people instead of exposures',
    questions: [q('choose', 'imagepicker')],
    design: { type: 'fixed_pairs', units: sets(10, ['A', 'B']), perPerson: 4, sizing: 'people', people: 7 },
    kinds: { choose: 'pair_share' },
    versions: 7,
  },
  {
    name: 'mixed question types on one library design',
    questions: [q('fav', 'imagepicker'), q('any', 'imagecheckbox'), q('score', 'imagerating'), q('slide', 'imageslidergroup'), q('grid', 'imagematrix')],
    design: { type: 'pool_pairs', units: images(18), perPerson: 4, perTrial: 3, target: 4 },
    kinds: { fav: 'bt', any: 'select_share', score: 'item_means', slide: 'item_means', grid: 'item_means' },
  },
  {
    name: 'two images only in a library',
    questions: [q('fav', 'imagepicker')],
    design: { type: 'pool_pairs', units: images(2), perPerson: 1, perTrial: 2, target: 10 },
    kinds: { fav: 'bt' },
  },
];

describe.each(SCENARIOS)('scenario: $name', (sc) => {
  const conditions = sc.conditions ? sc.conditions.map((id) => ({ id, label: id })) : [];
  const config = { title: sc.name, conditions, pages: [{ name: 'p1', elements: sc.questions }], experimentDesign: { enabled: true, seed: 11, questions: sc.questions.map((x) => x.name), ...sc.design } };
  const design = activeDesign(config);
  const pool = poolFor(designMedia(design));
  const poolKeys = new Set(pool.map((e) => e.key));
  const sizing = designSizing(design);
  const check = validateDesign(design, { poolKeys, questions: sc.questions });
  const nVersions = Math.min(sizing.versions, 60);
  const versions = buildVersions(design, nVersions);

  test('is valid, sized and described', () => {
    expect(check.ok).toBe(true);
    if (sc.warn) expect(check.warnings.length).toBeGreaterThan(0);
    expect(sizing.versions).toBeGreaterThanOrEqual(1);
    expect(sizing.versions).toBeLessThanOrEqual(DESIGN_MAX_VERSIONS);
    if (sc.versions) expect(sizing.versions).toBe(sc.versions);
    expect(describeDesign(design, { zh: true, conditions }).length).toBeGreaterThan(20);
    expect(describeDesign(design, { zh: false, conditions }).length).toBeGreaterThan(20);
    expect(designMethodsText(design, { zh: true, conditions }).length).toBeGreaterThan(20);
    expect(designMethodsText(design, { zh: false, conditions }).length).toBeGreaterThan(20);
  });

  test('survives a JSON round trip with the same id', () => {
    const again = activeDesign(JSON.parse(JSON.stringify(config)));
    expect(again.id).toBe(design.id);
    expect(computeDesignId(normalizeDesign(again))).toBe(design.id);
    expect(buildVersions(again, 2)).toEqual(buildVersions(design, 2));
  });

  test('every version has the planned trials, no repeated unit, complete media', () => {
    const k = perTrial(design);
    const slotCount = design.type === 'fixed_pairs' ? (design.slotMode === 'one' ? 1 : designSlotNames(design).length) : (design.type === 'rate' ? 1 : k);
    const roles = new Set();
    versions.forEach((trials) => {
      const main = trials.filter((t) => t.role === 'main');
      expect(main).toHaveLength(sizing.perVersion);
      const unitsSeen = main.map((t) => t.unit);
      expect(new Set(unitsSeen).size).toBe(unitsSeen.length);
      if (design.type === 'pool_pairs') {
        const imagesSeen = main.flatMap((t) => t.media);
        expect(new Set(imagesSeen).size).toBe(imagesSeen.length);
      }
      trials.forEach((t) => {
        roles.add(t.role);
        expect(['main', 'anchor', 'repeat', 'catch']).toContain(t.role);
        if (t.role === 'main' || t.role === 'repeat' || t.role === 'anchor') expect(t.media).toHaveLength(slotCount);
        if (t.role === 'catch') expect(t.expected).not.toBeUndefined();
        t.media.forEach((m) => expect(poolKeys.has(m)).toBe(true));
      });
      const repeats = trials.filter((t) => t.role === 'repeat');
      repeats.forEach((r) => expect(unitsSeen).toContain(r.unit));
      expect(repeats).toHaveLength(sizing.repeats);
    });
    (sc.extraRoles || []).forEach((r) => expect(roles.has(r)).toBe(true));
  });

  test('exposure is balanced after any number of versions', () => {
    [1, 3, nVersions].forEach((count) => {
      const counts = [...plannedExposures(design, count).values()];
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    });
    const all = [...plannedExposures(design, sizing.versions > 300 ? 300 : sizing.versions).values()];
    if (sizing.versions <= 300) expect(Math.min(...all)).toBeGreaterThanOrEqual(design.sizing === 'people' ? 0 : design.target);
  });

  test('every question gets the trials its view asks for, through the runtime path', () => {
    const poolIndex = designPoolIndex(pool);
    const want = sc.mediaPerTrial || {};
    versions.slice(0, 5).forEach((trials, v) => {
      const assignment = { id: design.id, version: v, versions: sizing.versions, claim: 'local' };
      const perQuestionUnits = {};
      sc.questions.forEach((question) => {
        const mapped = designMediaForElement(design, assignment, question, poolIndex);
        expect(mapped).not.toBeNull();
        expect(mapped.missing).toEqual([]);
        expect(mapped.trialCount).toBeGreaterThan(0);
        expect(mapped.trialMediaSets).toHaveLength(mapped.trialCount);
        const direct = questionTrialsForVersion(design, trials, question, { designId: design.id, version: v });
        expect(direct).toHaveLength(mapped.trialCount);
        direct.forEach((t, i) => {
          expect(t.media.length).toBeGreaterThan(0);
          expect(mapped.trialMediaSets[i]).toHaveLength(t.media.length);
          if (want[question.name]) expect(t.media).toHaveLength(want[question.name]);
          else if (PAIR.has(question.type) || MULTI.has(question.type)) expect(t.media.length).toBeGreaterThanOrEqual(2);
          else expect(t.media).toHaveLength(1);
          expect(t.context.design_id).toBe(design.id);
          expect(t.context.design_version).toBe(v);
          expect(typeof t.context.design_unit).toBe('string');
          expect(t.context.design_media).toEqual(t.media);
          if (t.context.design_role === 'catch') expect(t.context.design_expected).not.toBeUndefined();
        });
        perQuestionUnits[question.name] = new Set(direct.filter((t) => t.context.design_role === 'main').map((t) => t.context.design_unit));
        const view = questionView(design, question);
        if (view.trials === 'all') expect(perQuestionUnits[question.name].size).toBe(sizing.perVersion);
      });
      if (sc.disjoint) {
        const [a, b] = sc.disjoint;
        perQuestionUnits[a].forEach((u) => expect(perQuestionUnits[b].has(u)).toBe(false));
        expect(perQuestionUnits[a].size + perQuestionUnits[b].size).toBe(sizing.perVersion);
      }
    });
  });

  test('fixed sets: every slot takes every position equally (alternate) or is seen equally (one)', () => {
    if (design.type !== 'fixed_pairs' || design.position !== 'alternate') return;
    const counts = new Map();
    buildVersions(design, sizing.versions > 200 ? 200 : sizing.versions).flat().forEach((t) => {
      if (t.role !== 'main') return;
      t.slots.forEach((name, pos) => {
        const key = `${t.unit}|${name}|${pos}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    const byUnit = new Map();
    counts.forEach((c, key) => {
      const unit = key.split('|')[0];
      if (!byUnit.has(unit)) byUnit.set(unit, []);
      byUnit.get(unit).push(c);
    });
    byUnit.forEach((cs) => expect(Math.max(...cs) - Math.min(...cs)).toBeLessThanOrEqual(1));
  });

  test('simulated responses analyse as designed and export', async () => {
    const people = Math.min(Math.max(sizing.versions, 24), 120);
    const rows = await simulate(design, sc.questions, pool, people, { conditions: sc.conditions || null });
    const result = analyseDesign(design, rows, config);
    expect(result.execution.participants).toBe(people);
    expect(result.execution.outsideDesign).toBe(0);
    expect(result.perQuestion).toHaveLength(sc.questions.length);
    result.perQuestion.forEach((pq) => {
      expect(pq.main).toBeTruthy();
      expect(pq.main.kind).toBe(sc.kinds[pq.name]);
      expect(typeof pq.why === 'string' || pq.why === undefined).toBe(true);
    });
    if (sc.conditions) {
      const withContrast = result.perQuestion.filter((pq) => pq.conditions?.contrasts?.length || pq.conditions?.kind === 'bt_by_group');
      expect(withContrast.length).toBeGreaterThan(0);
      result.perQuestion.filter((pq) => pq.conditions?.kind === 'bt_by_group').forEach((pq) => {
        expect(pq.conditions.groups).toHaveLength(sc.conditions.length);
        expect(typeof pq.conditions.correlation.rho).toBe('number');
        expect(Math.abs(pq.conditions.correlation.rho)).toBeLessThanOrEqual(1);
      });
    }
    if ((sc.extraRoles || []).includes('catch')) {
      expect(result.execution.catches.trials).toBeGreaterThan(0);
      expect(result.execution.catches.share).toBeGreaterThan(0.5);
    }
    if ((sc.extraRoles || []).includes('repeat')) {
      expect(result.perQuestion.some((pq) => pq.repeats && pq.repeats.n > 0)).toBe(true);
    }
    const files = designExportFiles(design, result);
    const paths = files.map((f) => f.path);
    expect(paths).toContain('experiment_design/design.json');
    expect(paths).toContain('experiment_design/design_table.csv');
    files.forEach((f) => expect(typeof f.content).toBe('string'));
  });
});

describe('edge cases', () => {
  test('a disabled or empty design is not active', () => {
    expect(activeDesign({ experimentDesign: { enabled: false, type: 'rate', units: images(3), questions: ['q'] } })).toBeNull();
    expect(activeDesign({ experimentDesign: { enabled: true, type: 'rate', units: [], questions: ['q'] } })).toBeNull();
    expect(activeDesign({ experimentDesign: { enabled: true, type: 'rate', units: images(3), questions: [] } })).toBeNull();
    expect(activeDesign({})).toBeNull();
  });

  test('validation catches the things a researcher could get wrong', () => {
    const questions = [q('pick', 'imagepicker'), q('score', 'imagerating'), q('text', 'comment')];
    const bad = (design, qs = questions) => validateDesign(normalizeDesign({ enabled: true, seed: 1, ...design }), { questions: qs, poolKeys: new Set(images(10)) });
    expect(bad({ type: 'rate', units: images(1), questions: ['score'] }).ok).toBe(false);
    expect(bad({ type: 'rate', units: images(10), questions: ['pick'] }).errors.map((e) => e.en).join(' ')).toMatch(/chooses among images/);
    expect(bad({ type: 'rate', units: images(10), questions: ['text'] }).errors.map((e) => e.en).join(' ')).toMatch(/cannot follow/);
    expect(bad({ type: 'rate', units: images(10), questions: ['gone'] }).errors.map((e) => e.en).join(' ')).toMatch(/no longer exists/);
    expect(bad({ type: 'pool_pairs', units: images(10), perPerson: 6, perTrial: 2, questions: ['pick'] }).errors.map((e) => e.en).join(' ')).toMatch(/fewer than/);
    expect(bad({ type: 'pool_pairs', units: images(10), perPerson: 2, perTrial: 3, anchors: images(10).slice(0, 2), questions: ['pick'] }).errors.map((e) => e.en).join(' ')).toMatch(/multiple of/);
    expect(bad({ type: 'rate', units: images(10).concat(['missing.jpg']), perPerson: 3, questions: ['score'] }).errors.map((e) => e.en).join(' ')).toMatch(/not in the media library/);
    expect(bad({ type: 'fixed_pairs', units: [{ id: 'a', slots: { A: 'img_001.jpg', B: 'img_002.jpg' } }, { id: 'b', slots: { A: 'img_003.jpg', C: 'img_004.jpg' } }], questions: ['pick'] }).errors.map((e) => e.en).join(' ')).toMatch(/same slots/);
    expect(bad({ type: 'fixed_pairs', units: sets(4, ['A', 'B']).map((u) => ({ ...u, slots: { A: 'img_001.jpg', B: 'img_002.jpg' } })), slotMode: 'one', questions: ['pick'] }).errors.map((e) => e.en).join(' ')).toMatch(/one image at a time/);
    expect(bad({ type: 'fixed_pairs', units: [{ id: 'a', slots: { A: 'img_001.jpg', B: 'img_002.jpg' } }, { id: 'b', slots: { A: 'img_003.jpg', B: 'img_004.jpg' } }], questions: ['pick'], views: { pick: { slots: ['A', 'Z'] } } }).errors.map((e) => e.en).join(' ')).toMatch(/do not exist/);
    expect(bad({ type: 'rate', units: images(10), perPerson: 3, target: 1, catches: [{ id: 'c', media: ['img_001.jpg'], expected: null }], questions: ['score'] }).warnings.map((e) => e.en).join(' ')).toMatch(/no expected answer/);
    expect(bad({ type: 'rate', units: images(10), perPerson: 10, target: 200000, questions: ['score'] }).errors.map((e) => e.en).join(' ')).toMatch(/limit/);
  });

  test('media deleted after publishing: the trial is dropped, not shown half-empty', () => {
    const design = activeDesign({ experimentDesign: { enabled: true, seed: 3, type: 'fixed_pairs', units: sets(6, ['A', 'B']), perPerson: 6, target: 2, questions: ['pick', 'score'] } });
    const pool = poolFor(designMedia(design).filter((k) => k !== 'B/scene3.jpg'));
    const poolIndex = designPoolIndex(pool);
    const assignment = { id: design.id, version: 0, versions: 2, claim: 'local' };
    const pick = designMediaForElement(design, assignment, q('pick', 'imagepicker'), poolIndex);
    expect(pick.missing).toEqual(['B/scene3.jpg']);
    pick.trialMediaSets.forEach((set) => expect(set).toHaveLength(2));
    expect(pick.trialCount).toBe(5);
    expect(pick.trialMediaContexts).toHaveLength(5);
    const score = designMediaForElement(design, assignment, q('score', 'imagerating'), poolIndex);
    expect(score.trialCount).toBe(11);
    score.trialMediaSets.forEach((set) => expect(set).toHaveLength(1));
  });

  test('version numbers outside the range still give a usable trial list', () => {
    const design = activeDesign({ experimentDesign: { enabled: true, seed: 3, type: 'rate', units: images(6), perPerson: 3, target: 2, questions: ['score'] } });
    const far = designMediaForElement(design, { id: design.id, version: 999, versions: 4, claim: 'local' }, q('score', 'imagerating'), designPoolIndex(poolFor(images(6))));
    expect(far.trialCount).toBe(3);
    const neg = designMediaForElement(design, { id: design.id, version: -1, versions: 4, claim: 'local' }, q('score', 'imagerating'), designPoolIndex(poolFor(images(6))));
    expect(neg.trialCount).toBe(3);
  });

  test('unit slot names come from the first unit and are shared', () => {
    const design = normalizeDesign({ enabled: true, type: 'fixed_pairs', units: sets(3, ['day', 'night', 'rain']), questions: ['x'] });
    expect(designSlotNames(design)).toEqual(['day', 'night', 'rain']);
    design.units.forEach((u) => expect(unitSlotNames(u)).toEqual(['day', 'night', 'rain']));
  });
});

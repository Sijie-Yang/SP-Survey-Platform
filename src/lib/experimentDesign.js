// Experiment design: one explicit table of who sees what, built from a seed.
// Kept free of survey-core and DOM so the Worker's Node tests can load it too.
//
// Four ideas cover every design:
//   unit    – the media that belong together in one trial: one image, or a
//             fixed tuple with named slots (A/B, day/night, v0/v1/v2) and an
//             optional label.
//   stream  – library designs fill a trial's slots from a seeded stream that
//             walks every image once per pass, each pass in its own order.
//   version – one participant's trial list. Version v takes the next slice of
//             the stream, so after any number of whole versions every unit
//             has been shown floor or ceil of the average count. Trials carry
//             a role: main, anchor (everyone), repeat (test–retest), catch
//             (known answer).
//   view    – what one question takes from the version: which trials (all,
//             first half, second half) and which slots (all together, each on
//             its own, or named slots).

import { hashSeed, seededRandom, shuffled } from './designRandom.js';

export const DESIGN_TYPES = ['rate', 'pool_pairs', 'fixed_pairs'];
export const DESIGN_MAX_TRIALS = 200;
export const DESIGN_MAX_VERSIONS = 100000;
/** Images shown together in one trial of a library-choice design. */
export const DESIGN_MAX_PER_TRIAL = 12;
/** Slots a fixed unit can have; named A, B, C … in file-name order. */
export const DESIGN_MAX_SLOTS = 12;
export const SLOT_NAMES = 'ABCDEFGHIJKL'.split('');
export const POSITION_MODES = ['alternate', 'random', 'fixed'];
export const SLOT_MODES = ['all', 'one'];

/** Question types that show the images of a trial together and ask for one of them. */
export const PAIR_CHOICE_TYPES = new Set(['imagepicker', 'mediapicker']);

/** Question types that show the images of a trial together and let people pick any number. */
export const MULTI_CHOICE_TYPES = new Set(['imagecheckbox', 'mediacheckbox']);

/** Question types that show one image per trial and can follow a design. */
export const SINGLE_MEDIA_TYPES = new Set([
  'imagerating', 'mediarating', 'imageboolean', 'mediaboolean',
  'imageslidergroup', 'mediaslidergroup', 'imagematrix', 'mediamatrix',
  'imagepointallocation', 'mediapointallocation',
]);

const toInt = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};
const cleanKey = (k) => (k == null ? '' : String(k).trim());
const uniq = (list) => [...new Set(list)];
const looksLikeFile = (s) => /\.[a-z0-9]{2,5}$/i.test(s);

/**
 * A fixed unit in a known shape: `{ id, slots: { A: key, B: key, … }, label? }`.
 * Accepts the older `{ id, a, b }` and `{ id, media: [...] }` forms.
 */
export function normalizeUnit(raw, index) {
  if (!raw) return null;
  let entries;
  if (raw.slots && typeof raw.slots === 'object') {
    entries = Object.entries(raw.slots).map(([name, key]) => [cleanKey(name), cleanKey(key)]);
  } else if (Array.isArray(raw.media)) {
    entries = raw.media.map((key, i) => [SLOT_NAMES[i], cleanKey(key)]);
  } else {
    entries = [['A', cleanKey(raw.a)], ['B', cleanKey(raw.b)]];
  }
  entries = entries.filter(([name, key]) => name && key).slice(0, DESIGN_MAX_SLOTS);
  const keys = entries.map(([, key]) => key);
  if (keys.length < 2 || uniq(keys).length !== keys.length) return null;
  const id = cleanKey(raw.id) || `unit${String(index + 1).padStart(2, '0')}`;
  const unit = { id, slots: Object.fromEntries(entries) };
  if (raw.label != null && String(raw.label).trim()) unit.label = String(raw.label).trim();
  return unit;
}

function normalizeCatch(raw, index) {
  if (!raw) return null;
  const media = uniq((Array.isArray(raw.media) ? raw.media : [raw.media]).map(cleanKey).filter(Boolean));
  if (!media.length) return null;
  const expected = raw.expected == null ? null : (typeof raw.expected === 'number' ? raw.expected : cleanKey(raw.expected));
  return { id: cleanKey(raw.id) || `catch${String(index + 1).padStart(2, '0')}`, media, expected };
}

function normalizeView(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const trials = ['all', 'first', 'second'].includes(raw.trials) ? raw.trials : 'all';
  let slots = 'auto';
  if (raw.slots === 'all' || raw.slots === 'each') slots = raw.slots;
  else if (Array.isArray(raw.slots)) {
    const names = uniq(raw.slots.map(cleanKey).filter(Boolean));
    if (names.length) slots = names;
  }
  if (trials === 'all' && slots === 'auto') return null;
  return { trials, slots };
}

/** A stored design in a known shape, or null when there is none or it is switched off. */
export function normalizeDesign(raw) {
  if (!raw || typeof raw !== 'object' || raw.enabled === false) return null;
  const type = DESIGN_TYPES.includes(raw.type) ? raw.type : null;
  if (!type) return null;
  let units;
  if (type === 'fixed_pairs') {
    const seen = new Set();
    units = (Array.isArray(raw.units) ? raw.units : [])
      .map(normalizeUnit)
      .filter((u) => u && !seen.has(u.id) && seen.add(u.id));
  } else {
    units = uniq((Array.isArray(raw.units) ? raw.units : []).map(cleanKey).filter(Boolean));
  }
  const unitIds = new Set(units.map(unitId));
  const anchors = uniq((Array.isArray(raw.anchors) ? raw.anchors : []).map(cleanKey))
    .filter((id) => unitIds.has(id));
  const catches = (Array.isArray(raw.catches) ? raw.catches : []).map(normalizeCatch).filter(Boolean);
  const questions = uniq((Array.isArray(raw.questions) ? raw.questions : []).map(cleanKey).filter(Boolean));
  const views = {};
  if (raw.views && typeof raw.views === 'object') {
    Object.entries(raw.views).forEach(([name, v]) => {
      const view = questions.includes(name) ? normalizeView(v) : null;
      if (view) views[name] = view;
    });
  }
  return {
    id: cleanKey(raw.id) || null,
    type,
    seed: toInt(raw.seed, 1) >>> 0 || 1,
    units,
    anchors,
    catches,
    perPerson: Math.max(1, toInt(raw.perPerson, 10)),
    perTrial: type === 'pool_pairs' ? Math.min(DESIGN_MAX_PER_TRIAL, Math.max(2, toInt(raw.perTrial, 2))) : 1,
    position: type === 'fixed_pairs' && POSITION_MODES.includes(raw.position) ? raw.position : 'alternate',
    slotMode: type === 'fixed_pairs' && SLOT_MODES.includes(raw.slotMode) ? raw.slotMode : 'all',
    sizing: raw.sizing === 'people' ? 'people' : 'target',
    target: Math.max(1, toInt(raw.target, 10)),
    people: Math.max(1, toInt(raw.people, 100)),
    repeats: Math.max(0, toInt(raw.repeats, 0)),
    questions,
    views,
    sourceFolders: Array.isArray(raw.sourceFolders) ? raw.sourceFolders.map(String) : [],
  };
}

export const unitId = (unit) => (typeof unit === 'string' ? unit : unit?.id);
export const unitSlotNames = (unit) => (unit && typeof unit === 'object' && unit.slots ? Object.keys(unit.slots) : []);
export const unitMedia = (unit) => (typeof unit === 'string' ? [unit] : unitSlotNames(unit).map((n) => unit.slots[n]));

/** Slot names shared by every fixed unit (A, B, … of the first unit). */
export function designSlotNames(design) {
  if (design.type !== 'fixed_pairs' || !design.units.length) return [];
  return unitSlotNames(design.units[0]);
}

/** Units that rotate through versions (everything except anchors). */
export function mainUnits(design) {
  const anchors = new Set(design.anchors);
  return design.units.filter((u) => !anchors.has(unitId(u)));
}

export function anchorUnits(design) {
  const byId = new Map(design.units.map((u) => [unitId(u), u]));
  return design.anchors.map((id) => byId.get(id)).filter(Boolean);
}

/** Images shown together in one library-choice trial. */
export const perTrial = (design) => (design.type === 'pool_pairs' ? design.perTrial || 2 : 1);

/** Stream positions each version takes: one per unit, `perTrial` per library-choice trial. */
export function slotsPerVersion(design) {
  const n = mainUnits(design).length;
  const k = design.perPerson * perTrial(design);
  return Math.max(1, Math.min(k, n || 1));
}

/** Versions needed, and how often each unit is shown once they are all done. */
export function designSizing(design) {
  const n = mainUnits(design).length;
  const m = slotsPerVersion(design);
  const versions = n
    ? Math.max(1, design.sizing === 'people' ? design.people : Math.ceil((n * design.target) / m))
    : 0;
  const total = versions * m;
  const perVersion = Math.floor(m / perTrial(design));
  return {
    units: n,
    perVersion,
    versions,
    people: versions,
    exposuresMin: n ? Math.floor(total / n) : 0,
    exposuresMax: n ? Math.ceil(total / n) : 0,
    anchors: design.anchors.length,
    catches: design.catches.length,
    repeats: Math.min(design.repeats, perVersion),
  };
}

/**
 * Seeded order of the main units for each pass, adjusted so a version that
 * spans the end of one pass and the start of the next never repeats a unit.
 */
function makePassCache(design) {
  const units = mainUnits(design);
  const n = units.length;
  const m = slotsPerVersion(design);
  const passes = [];
  // Fixed units cycle their slot layout by (pass + class) where class = unit index mod N. Interleaving the
  // classes inside each pass keeps every person's trials balanced across layouts as well (not only every unit's).
  const classes = design.type === 'fixed_pairs' && (design.slotMode === 'one' || design.position === 'alternate')
    ? Math.max(1, designSlotNames(design).length) : 1;
  const get = (p) => {
    while (passes.length <= p) {
      const q = passes.length;
      const rand = seededRandom(hashSeed(design.seed, 'pass', q));
      let order;
      if (classes > 1) {
        const groups = Array.from({ length: classes }, () => []);
        units.forEach((_, i) => groups[i % classes].push(i));
        const mixed = groups.map((g) => shuffled(g, rand));
        order = [];
        for (let i = 0; order.length < n; i += 1) {
          const g = mixed[i % classes];
          if (g.length) order.push(g.shift());
        }
      } else {
        order = shuffled(units.map((_, i) => i), rand);
      }
      if (q > 0) {
        const s0 = q * n;
        const vStart = Math.floor(s0 / m) * m;
        if (vStart < s0) {
          const head = Math.min(vStart + m - s0, n);
          const prev = passes[q - 1];
          const tail = new Set(prev.slice(vStart - (q - 1) * n));
          for (let i = 0; i < head; i += 1) {
            if (!tail.has(order[i])) continue;
            for (let j = head; j < n; j += 1) {
              if (!tail.has(order[j]) && order[j] % classes === order[i] % classes) {
                [order[i], order[j]] = [order[j], order[i]];
                break;
              }
            }
          }
        }
      }
      passes.push(order);
    }
    return passes[p];
  };
  return { units, n, m, get };
}

/** Display order of a fixed unit's slots in pass `pass`, by the design's position policy. */
function slotOrder(design, unit, pass, cls = 0) {
  const names = unitSlotNames(unit);
  if (design.position === 'fixed') return names;
  if (design.position === 'random') return shuffled(names, seededRandom(hashSeed(design.seed, 'pos', unit.id, pass)));
  // alternate: rotate by one position per pass, so every slot takes every position equally often;
  // the unit's class offsets the rotation so neighbouring trials of one person differ too.
  const r = (cls + pass) % names.length;
  return names.map((_, i) => names[(i + r) % names.length]);
}

/** One trial of a fixed unit: all its slots in display order, or one slot (slotMode 'one', Latin square). */
function unitTrial(design, unit, pass, role, cls = 0) {
  const names = unitSlotNames(unit);
  if (design.slotMode === 'one') {
    const name = names[(cls + pass) % names.length];
    return { role, unit: unit.id, media: [unit.slots[name]], slots: [name], order: name };
  }
  const order = slotOrder(design, unit, pass, cls);
  return { role, unit: unit.id, media: order.map((n) => unit.slots[n]), slots: order, order: order.join('') };
}

function versionMainTrials(design, cache, v) {
  const { units, n, m, get } = cache;
  if (!n) return [];
  const picks = [];
  for (let s = v * m; s < v * m + m; s += 1) {
    const pass = Math.floor(s / n);
    picks.push({ index: get(pass)[s % n], pass, stream: s });
  }
  const rand = seededRandom(hashSeed(design.seed, 'order', v));
  if (design.type === 'rate') {
    return shuffled(picks, rand).map(({ index }) => ({ role: 'main', unit: units[index], media: [units[index]] }));
  }
  if (design.type === 'fixed_pairs') {
    return shuffled(picks, rand).map(({ index, pass }) => unitTrial(design, units[index], pass, 'main', index));
  }
  const k = perTrial(design);
  const trials = [];
  for (let i = 0; i + k - 1 < picks.length; i += k) {
    // Positions inside a trial are shuffled too, so an image's screen position does not follow the pass order.
    const media = shuffled(picks.slice(i, i + k).map(({ index }) => units[index]), rand);
    trials.push({ role: 'main', unit: media.join('|'), media });
  }
  return shuffled(trials, rand);
}

function versionAnchorTrials(design, v) {
  const anchors = anchorUnits(design);
  if (!anchors.length) return [];
  if (design.type === 'rate') return anchors.map((key) => ({ role: 'anchor', unit: key, media: [key] }));
  if (design.type === 'fixed_pairs') return anchors.map((u, i) => unitTrial(design, u, v, 'anchor', i));
  const k = perTrial(design);
  const out = [];
  for (let i = 0; i + k - 1 < anchors.length; i += k) {
    const group = anchors.slice(i, i + k);
    // Rotate positions from version to version so no anchor keeps one side.
    const media = group.map((_, j) => group[(j + v) % k]);
    out.push({ role: 'anchor', unit: group.join('|'), media });
  }
  return out;
}

function versionCatchTrials(design, v) {
  return design.catches.map((c) => {
    const media = c.media.length > 1 ? shuffled(c.media, seededRandom(hashSeed(design.seed, 'catch', c.id, v))) : c.media.slice();
    return { role: 'catch', unit: c.id, media, expected: c.expected };
  });
}

/** The trials of one version, in the order the participant sees them. */
export function versionTrials(design, version, cache = null) {
  const c = cache || makePassCache(design);
  const v = Math.max(0, toInt(version, 0));
  const main = versionMainTrials(design, c, v);
  const rand = seededRandom(hashSeed(design.seed, 'extras', v));
  const trials = main.slice();
  [...versionAnchorTrials(design, v), ...versionCatchTrials(design, v)].forEach((extra) => {
    trials.splice(Math.floor(rand() * (trials.length + 1)), 0, extra);
  });
  const repeats = Math.min(design.repeats, main.length);
  if (repeats) {
    shuffled(main, rand).slice(0, repeats).forEach((t) => {
      trials.push({ ...t, role: 'repeat', media: t.media.slice() });
    });
  }
  return trials.map((t, i) => ({ ...t, trial: i }));
}

/** The first `count` versions (for previews and the exported design table). */
export function buildVersions(design, count) {
  const cache = makePassCache(design);
  const out = [];
  for (let v = 0; v < count; v += 1) out.push(versionTrials(design, v, cache));
  return out;
}

/** How often each main unit is shown in versions 0..count-1 (main trials only). */
export function plannedExposures(design, count) {
  const counts = new Map(mainUnits(design).map((u) => [unitId(u), 0]));
  buildVersions(design, count).forEach((trials) => trials.forEach((t) => {
    if (t.role !== 'main') return;
    if (design.type === 'pool_pairs') t.media.forEach((key) => counts.set(key, (counts.get(key) || 0) + 1));
    else counts.set(t.unit, (counts.get(t.unit) || 0) + 1);
  }));
  return counts;
}

/** Stable id: changes whenever the units, sizes or seed change, so old claims never mix in. */
export function computeDesignId(design) {
  const body = JSON.stringify([
    design.type, design.seed, design.units, design.anchors, design.catches, design.perPerson, perTrial(design),
    design.position, design.slotMode, design.sizing, design.sizing === 'people' ? design.people : design.target, design.repeats,
  ]);
  return `d_${hashSeed(body).toString(36)}`;
}

/** Does the question show all images of a trial on one screen (choose one, or choose any)? */
export function questionShowsPair(question) {
  return PAIR_CHOICE_TYPES.has(question?.type) || MULTI_CHOICE_TYPES.has(question?.type);
}

export function questionCanFollowDesign(question) {
  return questionShowsPair(question) || SINGLE_MEDIA_TYPES.has(question?.type);
}

/** Every question in the survey (nested panels included). */
export function surveyQuestions(config) {
  const out = [];
  const walk = (els) => (els || []).forEach((el) => {
    if (!el) return;
    if (Array.isArray(el.elements)) walk(el.elements);
    else if (el.name) out.push(el);
  });
  (config?.pages || []).forEach((p) => walk(p.elements));
  return out;
}

/** The view a question uses: its own, or the default for its type. */
export function questionView(design, question) {
  const own = design.views?.[question?.name];
  const slots = own?.slots && own.slots !== 'auto' ? own.slots : (questionShowsPair(question) ? 'all' : 'each');
  return { trials: own?.trials || 'all', slots };
}

/**
 * The trials one question shows for a version, by its view. A question that
 * shows a set gets a trial's media together; a single-media question gets one
 * trial per image (or per named slot) in the trial's display order.
 */
export function questionTrialsForVersion(design, trials, question, { designId = null, version = 0 } = {}) {
  const out = [];
  const base = { design_id: designId || design.id, design_version: version };
  const view = questionView(design, question);
  let chosen = trials;
  if (view.trials !== 'all') {
    const mains = trials.filter((t) => t.role === 'main');
    const half = Math.ceil(mains.length / 2);
    const keep = new Set((view.trials === 'first' ? mains.slice(0, half) : mains.slice(half)).map((t) => t.unit));
    chosen = trials.filter((t) => (t.role === 'main' || t.role === 'repeat' ? keep.has(t.unit) : true));
  }
  chosen.forEach((t) => {
    const ctx = { ...base, design_trial: t.trial, design_unit: t.unit, design_role: t.role };
    if (t.order) ctx.design_order = t.order;
    if (t.expected != null) ctx.design_expected = t.expected;
    const slotAt = (pos) => (t.slots ? t.slots[pos] : null);
    let positions = t.media.map((_, i) => i);
    if (Array.isArray(view.slots)) {
      positions = positions.filter((i) => view.slots.includes(slotAt(i)));
      if (!positions.length) return;
    }
    const together = Array.isArray(view.slots) ? questionShowsPair(question) : view.slots === 'all';
    if (positions.length === 1 || together) {
      const media = positions.map((i) => t.media[i]);
      const slots = t.slots ? positions.map(slotAt) : null;
      out.push({
        media,
        context: { ...ctx, design_media: media, ...(slots ? { design_slots: slots } : {}), ...(media.length === 1 && slots ? { design_side: slots[0] } : {}) },
      });
      return;
    }
    positions.forEach((pos) => {
      const side = slotAt(pos);
      out.push({ media: [t.media[pos]], context: { ...ctx, design_media: [t.media[pos]], design_position: pos, ...(side ? { design_side: side } : {}) } });
    });
  });
  return out;
}

/** Problems that stop the design from running, and warnings worth reading. */
export function validateDesign(design, { poolKeys = null, questions = [] } = {}) {
  const errors = [];
  const warnings = [];
  const sizing = designSizing(design);
  const add = (list, zh, en) => list.push({ zh, en });
  if (sizing.units < 2) add(errors, '至少需要 2 个刺激（不含锚点）。', 'Add at least 2 stimuli (not counting anchors).');
  const k = perTrial(design);
  if (design.type === 'pool_pairs' && sizing.units < design.perPerson * k) {
    add(errors, `图库只有 ${sizing.units} 张，不够每人 ${design.perPerson} 次、每次 ${k} 张用的 ${design.perPerson * k} 张不重复图。`,
      `The library has ${sizing.units} images, fewer than the ${design.perPerson * k} distinct images that ${design.perPerson} trials of ${k} images need.`);
  } else if (design.type !== 'pool_pairs' && design.perPerson > sizing.units && sizing.units >= 2) {
    add(warnings, `每人看 ${design.perPerson} 个，但只有 ${sizing.units} 个，所以每人看全部 ${sizing.units} 个。`,
      `Each person is set to see ${design.perPerson}, but there are only ${sizing.units}, so everyone sees all ${sizing.units}.`);
  }
  if (design.type === 'pool_pairs' && design.anchors.length % k) {
    add(errors, `锚点图会 ${k} 张一屏地显示，请选 ${k} 的倍数张。`, `Anchor images are shown ${k} to a screen; choose a multiple of ${k}.`);
  }
  if (design.type === 'fixed_pairs') {
    const names = designSlotNames(design).join(',');
    const odd = design.units.filter((u) => unitSlotNames(u).join(',') !== names);
    if (odd.length) {
      add(errors, `每组的槽位要一样（第一组是 ${names}），有 ${odd.length} 组不同（例如 ${odd.slice(0, 3).map((u) => u.id).join('、')}）。`,
        `Every unit needs the same slots (the first has ${names}); ${odd.length} differ (e.g. ${odd.slice(0, 3).map((u) => u.id).join(', ')}).`);
    }
  }
  if (sizing.versions > DESIGN_MAX_VERSIONS) add(errors, `需要 ${sizing.versions} 个版本，超过上限 ${DESIGN_MAX_VERSIONS}。`, `Needs ${sizing.versions} versions, above the ${DESIGN_MAX_VERSIONS} limit.`);
  if (design.repeats > sizing.perVersion) add(warnings, `重复试次多于每人看到的数量，只会重复 ${sizing.perVersion} 个。`, `More repeats than trials per person; only ${sizing.perVersion} will repeat.`);
  if (poolKeys) {
    const keys = [...design.units.flatMap(unitMedia), ...design.catches.flatMap((c) => c.media)];
    const missing = uniq(keys.filter((key) => !poolKeys.has(key)));
    if (missing.length) {
      add(errors, `${missing.length} 个文件不在媒体库里（例如 ${missing.slice(0, 3).join('、')}）。`,
        `${missing.length} file(s) are not in the media library (e.g. ${missing.slice(0, 3).join(', ')}).`);
    }
  }
  if (!design.questions.length) add(errors, '至少选一道题跟随这个设计。', 'Choose at least one question to follow this design.');
  const byName = new Map(questions.map((q) => [q.name, q]));
  design.questions.forEach((name) => {
    const q = byName.get(name);
    if (!q) {
      add(errors, `题目 ${name} 已不存在。`, `Question ${name} no longer exists.`);
      return;
    }
    if (!questionCanFollowDesign(q)) {
      add(errors, `题目 ${name}（${q.type}）不能跟随设计，只支持图片/媒体的选择、打分、是否、滑块、矩阵题。`,
        `Question ${name} (${q.type}) cannot follow a design; use image/media choice, rating, yes/no, slider or matrix questions.`);
      return;
    }
    const view = questionView(design, q);
    const singleOnly = design.type === 'rate' || (design.type === 'fixed_pairs' && design.slotMode === 'one');
    if (singleOnly && questionShowsPair(q)) {
      add(errors, `题目 ${name} 是从几张里选，但这个设计每次只给一张图。`, `Question ${name} chooses among images, but this design shows one image at a time.`);
    }
    if (Array.isArray(view.slots)) {
      const names = designSlotNames(design);
      const unknown = view.slots.filter((s) => !names.includes(s));
      if (unknown.length) add(errors, `题目 ${name} 指定的槽位 ${unknown.join('、')} 不存在。`, `Question ${name} names slots that do not exist: ${unknown.join(', ')}.`);
    }
  });
  design.catches.forEach((c) => {
    if (c.expected == null) add(warnings, `检查题 ${c.id} 没写正确答案，只会显示，不会评分。`, `Catch trial ${c.id} has no expected answer; it is shown but not scored.`);
  });
  return { errors, warnings, ok: errors.length === 0 };
}

export function designAnchorTrialCount(design) {
  return design.type === 'pool_pairs' ? Math.floor(design.anchors.length / perTrial(design)) : design.anchors.length;
}

const TYPE_NAMES = {
  rate: { zh: '给很多图打分', en: 'Rate many images' },
  pool_pairs: { zh: '从图库里挑选', en: 'Choose from a library' },
  fixed_pairs: { zh: '比较固定的几组图', en: 'Compare fixed sets' },
};

export function designTypeName(type, zh) {
  const names = TYPE_NAMES[type];
  return names ? (zh ? names.zh : names.en) : type;
}

const range = (a, b) => (a === b ? String(a) : `${a}–${b}`);

/** One plain sentence (two in Chinese) that says exactly what the design does. */
export function describeDesign(design, { zh = true, questionTitles = {}, conditions = [] } = {}) {
  const s = designSizing(design);
  const exp = range(s.exposuresMin, s.exposuresMax);
  const qs = design.questions.map((n) => questionTitles[n] || n);
  const parts = [];
  if (design.type === 'rate') {
    parts.push(zh
      ? `每人看 ${s.perVersion} 张图，顺序随机；平台把 ${s.units} 张图分成 ${s.versions} 个版本，新参与者领完成最少的版本，所以每张图会被看 ${exp} 次。`
      : `Each person sees ${s.perVersion} images in random order. The ${s.units} images are split into ${s.versions} versions and each new participant gets the version completed least often, so every image is seen ${exp} times.`);
  } else if (design.type === 'pool_pairs') {
    const k = perTrial(design);
    parts.push(zh
      ? `每人做 ${s.perVersion} 次挑选，每次从图库里${k === 2 ? '配两张、二选一' : `出 ${k} 张`}，位置随机，一个人不会重复看到同一张；${s.units} 张图分成 ${s.versions} 个版本，每张图会出现 ${exp} 次。`
      : `Each person makes ${s.perVersion} choices, each from ${k} library images in random positions, never seeing an image twice. The ${s.units} images are split into ${s.versions} versions, so every image appears ${exp} times.`);
  } else {
    const names = designSlotNames(design);
    const slotWord = zh ? (names.length === 2 ? '对' : '组') : (names.length === 2 ? 'pairs' : 'sets');
    const pos = design.slotMode === 'one'
      ? (zh ? `每组只给一个人看其中一张（${names.join('/')} 轮流，每人各看一半）` : `each person sees one image of a set (${names.join('/')} take turns, half each)`)
      : design.position === 'alternate'
        ? (names.length === 2
          ? (zh ? '每对里哪张在左轮流交换，正好各占一半' : 'which image sits on the left alternates, so each side gets exactly half')
          : (zh ? `每组里 ${names.length} 张图的位置轮流交换，每张在每个位置各占 1/${names.length}` : `the ${names.length} images of a set rotate through the positions, so each takes every position equally often`))
        : design.position === 'random'
          ? (zh ? `每${slotWord}里的位置随机` : 'positions within a set are random')
          : (zh ? `每${slotWord}里的位置固定（按表里的顺序）` : 'positions within a set are fixed (as listed)');
    parts.push(zh
      ? `每人看 ${s.perVersion} ${slotWord}，顺序随机；${pos}；${s.units} ${slotWord}分成 ${s.versions} 个版本，每${slotWord}会被看 ${exp} 次。`
      : `Each person sees ${s.perVersion} ${slotWord} in random order; ${pos}. The ${s.units} ${slotWord} are split into ${s.versions} versions, so every one is seen ${exp} times.`);
  }
  if (qs.length) {
    const custom = design.questions.filter((n) => design.views?.[n]);
    parts.push(zh
      ? `跟随这个设计的题：${qs.map((t) => `「${t}」`).join('、')}${qs.length > 1 ? (custom.length ? '，各题看的部分见下表' : '，这几道题看到的是同一批、同一顺序') : ''}。`
      : `Questions following this design: ${qs.map((t) => `"${t}"`).join(', ')}${qs.length > 1 ? (custom.length ? ' (what each shows is set below)' : ' (all show the same items in the same order)') : ''}.`);
  }
  if (s.anchors) {
    const a = designAnchorTrialCount(design);
    parts.push(zh ? `另有 ${a} 个锚点${design.type === 'rate' ? '图' : '组'}所有人都看。` : `${a} anchor ${design.type === 'rate' ? 'image(s)' : 'set(s)'} are shown to everyone.`);
  }
  if (s.catches) parts.push(zh ? `穿插 ${s.catches} 道检查题，答案已知。` : `${s.catches} catch trial(s) with a known answer are mixed in.`);
  if (s.repeats) parts.push(zh ? `最后再重复 ${s.repeats} 个，用来算重测一致性。` : `${s.repeats} trial(s) are repeated at the end to measure test–retest agreement.`);
  if (conditions.length > 1) {
    parts.push(zh ? `参与者还会被分到 ${conditions.length} 个实验条件之一（${conditions.map((c) => c.label || c.id).join('、')}），各条件人数保持平衡。` : `Participants are also assigned to one of ${conditions.length} conditions (${conditions.map((c) => c.label || c.id).join(', ')}), kept balanced.`);
  }
  parts.push(zh ? `大约需要 ${s.people} 人完成${conditions.length > 1 ? '（每个条件各做一轮更好）' : ''}。` : `About ${s.people} completed participants are needed${conditions.length > 1 ? ' (ideally that many per condition)' : ''}.`);
  return parts.join(zh ? '' : ' ');
}

/** Plain words for one question's view. */
export function describeView(design, question, zh) {
  const view = questionView(design, question);
  const parts = [];
  if (Array.isArray(view.slots)) parts.push(zh ? `只看 ${view.slots.join('、')}` : `slots ${view.slots.join(', ')} only`);
  else if (view.slots === 'each') parts.push(zh ? '一张一张看' : 'one image at a time');
  else parts.push(zh ? '整组一屏' : 'the whole set together');
  if (view.trials === 'first') parts.push(zh ? '只做前一半' : 'first half of the trials');
  if (view.trials === 'second') parts.push(zh ? '只做后一半' : 'second half of the trials');
  return parts.join(zh ? '，' : ', ');
}

/** A Methods paragraph a researcher can paste, describing the design and the analysis. */
export function designMethodsText(design, { zh = false, conditions = [] } = {}) {
  const s = designSizing(design);
  const exp = range(s.exposuresMin, s.exposuresMax);
  const id = design.id || computeDesignId(design);
  const k = perTrial(design);
  const nSlots = designSlotNames(design).length;
  const out = [];
  if (zh) {
    if (design.type === 'rate') out.push(`刺激分配采用平衡不完全区组设计（SP-Survey 设计 ${id}，随机种子 ${design.seed}）：${s.units} 张图被分成 ${s.versions} 个版本，每个版本 ${s.perVersion} 张，每张图在全部版本中出现 ${exp} 次；呈现顺序在版本内随机。`);
    if (design.type === 'pool_pairs') out.push(`${k === 2 ? '两两比较' : `${k} 选一/多选`}采用平衡分配（SP-Survey 设计 ${id}，随机种子 ${design.seed}）：${s.units} 张图被分成 ${s.versions} 个版本，每个版本 ${s.perVersion} 个试次、每次 ${k} 张，每张图出现 ${exp} 次，位置随机。`);
    if (design.type === 'fixed_pairs') {
      out.push(`${s.units} 组预先确定的图片${nSlots === 2 ? '对' : `组（每组 ${nSlots} 张）`}被分成 ${s.versions} 个版本（SP-Survey 设计 ${id}，随机种子 ${design.seed}），每个版本 ${s.perVersion} 组，每组被呈现 ${exp} 次；`
        + (design.slotMode === 'one' ? '每位参与者对每组只看其中一个版本，版本按拉丁方轮换，使人内和人间各版本均衡。'
          : design.position === 'alternate' ? '组内的呈现位置在呈现间轮换以平衡位置效应。'
            : design.position === 'random' ? '组内的呈现位置随机。' : '组内的呈现位置固定。'));
    }
    out.push('每位新参与者领取当前完成次数最少的版本。');
    if (s.anchors) out.push(`另有 ${designAnchorTrialCount(design)} 个锚点刺激向所有参与者呈现。`);
    if (s.catches) out.push(`穿插 ${s.catches} 个答案已知的检查试次。`);
    if (s.repeats) out.push(`每位参与者在最后重复 ${s.repeats} 个试次，用于估计重测一致性。`);
    if (conditions.length > 1) out.push(`参与者被平衡地随机分配到 ${conditions.length} 个组间条件之一。`);
    out.push(design.type === 'pool_pairs'
      ? `单选数据用 ${k === 2 ? 'Bradley–Terry' : 'Bradley–Terry（Luce 多项选择）'}模型估计每张图的得分，95% 区间来自按参与者重抽样 200 次的 bootstrap；多选数据按图报告被选比例及 Wilson 95% 区间。`
      : design.type === 'fixed_pairs'
        ? (nSlots === 2 ? '每组的选择比例报告 Wilson 95% 区间；同一组内两张图的评分差按参与者配对计算均值和 95% 区间。' : '每组各位置的被选比例报告 Wilson 95% 区间；同一组内其余图相对第一张的评分差按参与者配对计算均值和 95% 区间。')
        : '评分按图汇总为均值和 t 分布 95% 区间。');
    return out.join('');
  }
  if (design.type === 'rate') out.push(`Stimuli were assigned with a balanced incomplete block design generated by SP-Survey (design ${id}, seed ${design.seed}): the ${s.units} images were divided into ${s.versions} versions of ${s.perVersion} images, so each image appeared ${exp} times across versions; presentation order was randomised within each version.`);
  if (design.type === 'pool_pairs') out.push(`${k === 2 ? 'Pairwise comparisons' : `${k}-image choice sets`} were assigned with a balanced design generated by SP-Survey (design ${id}, seed ${design.seed}): the ${s.units} images were divided into ${s.versions} versions of ${s.perVersion} trials, so each image appeared ${exp} times, with positions randomised.`);
  if (design.type === 'fixed_pairs') {
    out.push(`The ${s.units} predefined image ${nSlots === 2 ? 'pairs' : `sets of ${nSlots}`} were divided into ${s.versions} versions of ${s.perVersion} (SP-Survey design ${id}, seed ${design.seed}), so each was presented ${exp} times; `
      + (design.slotMode === 'one' ? 'each participant saw one version of each set, rotated in a Latin square so versions were balanced within and between participants.'
        : design.position === 'alternate' ? 'the position of the images within a set alternated between presentations to counterbalance position.'
          : design.position === 'random' ? 'positions within a set were randomised.' : 'positions within a set were fixed.'));
  }
  out.push('Each new participant received the version completed least often so far.');
  if (s.anchors) out.push(`${designAnchorTrialCount(design)} anchor stimuli were shown to every participant.`);
  if (s.catches) out.push(`${s.catches} catch trial(s) with a known answer were interspersed.`);
  if (s.repeats) out.push(`Each participant repeated ${s.repeats} trial(s) at the end to estimate test–retest agreement.`);
  if (conditions.length > 1) out.push(`Participants were randomly assigned, with balancing, to one of ${conditions.length} between-participant conditions.`);
  out.push(design.type === 'pool_pairs'
    ? `Single choices were scaled with a ${k === 2 ? 'Bradley–Terry' : 'Bradley–Terry (Luce multinomial choice)'} model; 95% intervals come from 200 bootstrap resamples of participants. Multiple selections are reported as the share of presentations in which each image was selected, with Wilson 95% intervals.`
    : design.type === 'fixed_pairs'
      ? 'Choice shares per set are reported with Wilson 95% intervals; rating differences within a set were computed per participant and summarised as means with 95% t intervals.'
      : 'Ratings were summarised per image as means with 95% t intervals.');
  return out.join(' ');
}

/**
 * Parse a units table: one unit per line, "id, A, B[, C…][, label]" or just the
 * files. A header line (id, A, B, label) names the slots; without one they are A, B, C….
 */
export function parsePairsText(text) {
  const units = [];
  const problems = [];
  let slotNames = null;
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const cells = line.split(/[,\t;]/).map((c) => c.trim()).filter((c, j, all) => c || j < all.length - 1);
    if (!cells.length || !cells.join('')) return;
    if (i === 0 && cells.length >= 2 && !cells.some(looksLikeFile)) {
      const names = cells.slice(/pair|id|编号|组/i.test(cells[0]) ? 1 : 0).filter((c) => c && !/label|说明|备注/i.test(c));
      if (names.length >= 2) slotNames = names;
      return;
    }
    const hasId = !looksLikeFile(cells[0]);
    const id = hasId ? cells[0] : undefined;
    const rest = cells.slice(hasId ? 1 : 0);
    const files = [];
    while (rest.length && looksLikeFile(rest[0])) files.push(rest.shift());
    const label = rest.join(' ').trim() || undefined;
    const names = slotNames && slotNames.length >= files.length ? slotNames : SLOT_NAMES;
    const unit = normalizeUnit({ id, slots: Object.fromEntries(files.map((f, j) => [names[j], f])), label }, units.length);
    if (unit) units.push(unit);
    else problems.push(i + 1);
  });
  return { units, problems };
}

/** Parse catch trials: one per line, "file[, file…], expected answer". */
export function parseCatchText(text) {
  const catches = [];
  const problems = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const cells = line.split(/[,\t;]/).map((c) => c.trim()).filter(Boolean);
    if (!cells.length) return;
    const media = [];
    while (cells.length && looksLikeFile(cells[0])) media.push(cells.shift());
    if (!media.length) { problems.push(i + 1); return; }
    // "a.jpg, b.jpg, b.jpg" → the repeated last file is the expected answer.
    if (!cells.length && media.length > 1 && media.slice(0, -1).includes(media[media.length - 1])) cells.push(media.pop());
    let expected = cells.join(' ').trim();
    if (expected === '') expected = null;
    else if (/^-?\d+(\.\d+)?$/.test(expected)) expected = Number(expected);
    catches.push({ id: `catch${String(catches.length + 1).padStart(2, '0')}`, media, expected });
  });
  return { catches, problems };
}

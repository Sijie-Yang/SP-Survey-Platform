// Experiment design: one explicit table of who sees what, built from a seed.
// Kept free of survey-core and DOM so the Worker's Node tests can load it too.
//
// A design lists its units (images, or fixed pairs of images), how many each
// participant sees, and a seed. Participant versions come from a stream that
// walks through every unit once per pass, each pass in its own seeded order;
// version v takes the next slice of that stream. So after any number of whole
// versions, every unit has been shown either floor or ceil of the average count,
// and the same design always produces the same versions.

import { hashSeed, seededRandom, shuffled } from './designRandom.js';

export const DESIGN_TYPES = ['rate', 'pool_pairs', 'fixed_pairs'];
export const DESIGN_MAX_TRIALS = 200;
export const DESIGN_MAX_VERSIONS = 100000;

/** Question types that show two images and ask for one of them. */
export const PAIR_CHOICE_TYPES = new Set(['imagepicker', 'mediapicker']);

/** Question types that show one image per trial and can follow a design. */
export const SINGLE_MEDIA_TYPES = new Set([
  'imagerating', 'mediarating', 'imageboolean', 'mediaboolean',
  'imageslidergroup', 'mediaslidergroup', 'imagematrix', 'mediamatrix',
  'imagecheckbox', 'mediacheckbox', 'imagepointallocation', 'mediapointallocation',
]);

const toInt = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};
const cleanKey = (k) => (k == null ? '' : String(k).trim());
const uniq = (list) => [...new Set(list)];

function normalizePairUnit(raw, index) {
  if (!raw) return null;
  const a = cleanKey(raw.a);
  const b = cleanKey(raw.b);
  if (!a || !b || a === b) return null;
  const id = cleanKey(raw.id) || `pair${String(index + 1).padStart(2, '0')}`;
  const unit = { id, a, b };
  if (raw.label != null && String(raw.label).trim()) unit.label = String(raw.label).trim();
  if (raw.labelA != null && String(raw.labelA).trim()) unit.labelA = String(raw.labelA).trim();
  if (raw.labelB != null && String(raw.labelB).trim()) unit.labelB = String(raw.labelB).trim();
  return unit;
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
      .map(normalizePairUnit)
      .filter((u) => u && !seen.has(u.id) && seen.add(u.id));
  } else {
    units = uniq((Array.isArray(raw.units) ? raw.units : []).map(cleanKey).filter(Boolean));
  }
  const unitIds = new Set(units.map((u) => (typeof u === 'string' ? u : u.id)));
  const anchors = uniq((Array.isArray(raw.anchors) ? raw.anchors : []).map(cleanKey))
    .filter((id) => unitIds.has(id));
  return {
    id: cleanKey(raw.id) || null,
    type,
    seed: toInt(raw.seed, 1) >>> 0 || 1,
    units,
    anchors,
    perPerson: Math.max(1, toInt(raw.perPerson, 10)),
    sizing: raw.sizing === 'people' ? 'people' : 'target',
    target: Math.max(1, toInt(raw.target, 10)),
    people: Math.max(1, toInt(raw.people, 100)),
    repeats: Math.max(0, toInt(raw.repeats, 0)),
    questions: uniq((Array.isArray(raw.questions) ? raw.questions : []).map(cleanKey).filter(Boolean)),
    sourceFolders: Array.isArray(raw.sourceFolders) ? raw.sourceFolders.map(String) : [],
  };
}

export const unitId = (unit) => (typeof unit === 'string' ? unit : unit?.id);

/** Units that rotate through versions (everything except anchors). */
export function mainUnits(design) {
  const anchors = new Set(design.anchors);
  return design.units.filter((u) => !anchors.has(unitId(u)));
}

export function anchorUnits(design) {
  const byId = new Map(design.units.map((u) => [unitId(u), u]));
  return design.anchors.map((id) => byId.get(id)).filter(Boolean);
}

/** Stream positions each version takes: one per image, two per pool pair. */
export function slotsPerVersion(design) {
  const n = mainUnits(design).length;
  const k = design.type === 'pool_pairs' ? design.perPerson * 2 : design.perPerson;
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
  const perVersionPairs = design.type === 'pool_pairs' ? Math.floor(m / 2) : m;
  return {
    units: n,
    perVersion: perVersionPairs,
    versions,
    people: versions,
    exposuresMin: n ? Math.floor(total / n) : 0,
    exposuresMax: n ? Math.ceil(total / n) : 0,
    anchors: design.anchors.length,
    repeats: Math.min(design.repeats, perVersionPairs),
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
  const get = (p) => {
    while (passes.length <= p) {
      const q = passes.length;
      const order = shuffled(units.map((_, i) => i), seededRandom(hashSeed(design.seed, 'pass', q)));
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
              if (!tail.has(order[j])) {
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

function flipFor(design, id, pass) {
  return ((hashSeed(design.seed, 'flip', id) & 1) + pass) % 2 === 1;
}

function pairTrial(design, unit, pass, role) {
  const swap = flipFor(design, unit.id, pass);
  return {
    role,
    unit: unit.id,
    media: swap ? [unit.b, unit.a] : [unit.a, unit.b],
    order: swap ? 'ba' : 'ab',
  };
}

function versionMainTrials(design, cache, v) {
  const { units, n, m, get } = cache;
  if (!n) return [];
  const picks = [];
  for (let s = v * m; s < v * m + m; s += 1) {
    const pass = Math.floor(s / n);
    picks.push({ index: get(pass)[s % n], pass });
  }
  const rand = seededRandom(hashSeed(design.seed, 'order', v));
  if (design.type === 'rate') {
    return shuffled(picks, rand).map(({ index }) => ({ role: 'main', unit: units[index], media: [units[index]] }));
  }
  if (design.type === 'fixed_pairs') {
    return shuffled(picks, rand).map(({ index, pass }) => pairTrial(design, units[index], pass, 'main'));
  }
  const trials = [];
  for (let i = 0; i + 1 < picks.length; i += 2) {
    const a = units[picks[i].index];
    const b = units[picks[i + 1].index];
    trials.push({ role: 'main', unit: `${a}|${b}`, media: [a, b] });
  }
  return shuffled(trials, rand);
}

function versionAnchorTrials(design, v) {
  const anchors = anchorUnits(design);
  if (!anchors.length) return [];
  if (design.type === 'rate') return anchors.map((key) => ({ role: 'anchor', unit: key, media: [key] }));
  if (design.type === 'fixed_pairs') return anchors.map((u) => pairTrial(design, u, v, 'anchor'));
  const out = [];
  for (let i = 0; i + 1 < anchors.length; i += 2) {
    const [a, b] = v % 2 ? [anchors[i + 1], anchors[i]] : [anchors[i], anchors[i + 1]];
    out.push({ role: 'anchor', unit: `${anchors[i]}|${anchors[i + 1]}`, media: [a, b] });
  }
  return out;
}

/** The trials of one version, in the order the participant sees them. */
export function versionTrials(design, version, cache = null) {
  const c = cache || makePassCache(design);
  const v = Math.max(0, toInt(version, 0));
  const main = versionMainTrials(design, c, v);
  const rand = seededRandom(hashSeed(design.seed, 'extras', v));
  const trials = main.slice();
  versionAnchorTrials(design, v).forEach((anchor) => {
    trials.splice(Math.floor(rand() * (trials.length + 1)), 0, anchor);
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
  const counts = new Map(mainUnits(design).map((u) => [design.type === 'pool_pairs' ? u : unitId(u), 0]));
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
    design.type, design.seed, design.units, design.anchors, design.perPerson,
    design.sizing, design.sizing === 'people' ? design.people : design.target, design.repeats,
  ]);
  return `d_${hashSeed(body).toString(36)}`;
}

export function questionShowsPair(question) {
  return PAIR_CHOICE_TYPES.has(question?.type);
}

export function questionCanFollowDesign(question) {
  return PAIR_CHOICE_TYPES.has(question?.type) || SINGLE_MEDIA_TYPES.has(question?.type);
}

/** Every question in the survey (nested panels included). */
export function surveyQuestions(config) {
  const out = [];
  const walk = (elements) => (elements || []).forEach((el) => {
    if (!el) return;
    if (Array.isArray(el.elements)) walk(el.elements);
    else if (el.name) out.push(el);
  });
  (config?.pages || []).forEach((page) => walk(page.elements));
  return out;
}

/**
 * The trials one question shows for a version. A two-image choice question
 * shows each pair once; a one-image question shows each image of a pair as
 * its own trial, in the pair's left-to-right order.
 */
export function questionTrialsForVersion(design, trials, question, { designId = null, version = 0 } = {}) {
  const out = [];
  const base = { design_id: designId || design.id, design_version: version };
  trials.forEach((t) => {
    const ctx = { ...base, design_trial: t.trial, design_unit: t.unit, design_role: t.role };
    if (t.order) ctx.design_order = t.order;
    if (t.media.length === 1 || questionShowsPair(question)) {
      out.push({ media: t.media.slice(), context: { ...ctx, design_media: t.media.slice() } });
      return;
    }
    t.media.forEach((key, pos) => {
      const side = design.type === 'fixed_pairs'
        ? ((t.order === 'ba') !== (pos === 1) ? 'b' : 'a')
        : null;
      out.push({ media: [key], context: { ...ctx, design_media: [key], design_position: pos, ...(side ? { design_side: side } : {}) } });
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
  if (design.type === 'pool_pairs' && sizing.units < design.perPerson * 2) {
    add(errors, `图库只有 ${sizing.units} 张，不够每人 ${design.perPerson} 次比较用的 ${design.perPerson * 2} 张不重复图。`,
      `The library has ${sizing.units} images, fewer than the ${design.perPerson * 2} distinct images that ${design.perPerson} comparisons per person need.`);
  } else if (design.type !== 'pool_pairs' && design.perPerson > sizing.units && sizing.units >= 2) {
    add(warnings, `每人看 ${design.perPerson} 个，但只有 ${sizing.units} 个，所以每人看全部 ${sizing.units} 个。`,
      `Each person is set to see ${design.perPerson}, but there are only ${sizing.units}, so everyone sees all ${sizing.units}.`);
  }
  if (design.type === 'pool_pairs' && design.anchors.length % 2) {
    add(errors, '两两比较的锚点图要成对，请选偶数张。', 'Anchor images for pairwise comparison form pairs; choose an even number.');
  }
  if (sizing.versions > DESIGN_MAX_VERSIONS) add(errors, `需要 ${sizing.versions} 个版本，超过上限 ${DESIGN_MAX_VERSIONS}。`, `Needs ${sizing.versions} versions, above the ${DESIGN_MAX_VERSIONS} limit.`);
  if (design.repeats > sizing.perVersion) add(warnings, `重复试次多于每人看到的数量，只会重复 ${sizing.perVersion} 个。`, `More repeats than trials per person; only ${sizing.perVersion} will repeat.`);
  if (poolKeys) {
    const keys = design.type === 'fixed_pairs'
      ? design.units.flatMap((u) => [u.a, u.b])
      : design.units;
    const missing = uniq(keys.filter((k) => !poolKeys.has(k)));
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
    if (design.type === 'rate' && questionShowsPair(q)) {
      add(errors, `题目 ${name} 是二选一，但"给很多图打分"每次只给一张图。`, `Question ${name} is a two-image choice, but "Rate many images" shows one image at a time.`);
      return;
    }
    const perTrial = design.type === 'rate' || questionShowsPair(q) ? 1 : 2;
    const total = (sizing.perVersion + designAnchorTrialCount(design) + sizing.repeats) * perTrial;
    if (total > DESIGN_MAX_TRIALS) {
      add(errors, `题目 ${name} 每人要做 ${total} 次，超过上限 ${DESIGN_MAX_TRIALS}。`, `Question ${name} would need ${total} trials per person, above the ${DESIGN_MAX_TRIALS} limit.`);
    }
    if (total < 2) add(errors, `题目 ${name} 每人只有 1 次，设计至少要 2 次。`, `Question ${name} has only 1 trial per person; a design needs at least 2.`);
  });
  return { errors, warnings, ok: errors.length === 0 };
}

export function designAnchorTrialCount(design) {
  return design.type === 'pool_pairs' ? Math.floor(design.anchors.length / 2) : design.anchors.length;
}

const TYPE_NAMES = {
  rate: { zh: '给很多图打分', en: 'Rate many images' },
  pool_pairs: { zh: '从图库里两两比较', en: 'Pairwise comparison from a library' },
  fixed_pairs: { zh: '比较固定的几对图', en: 'Compare fixed pairs' },
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
    parts.push(zh
      ? `每人做 ${s.perVersion} 次二选一，每次两张图都来自图库、左右随机；${s.units} 张图分成 ${s.versions} 个版本，每张图会出现 ${exp} 次。`
      : `Each person makes ${s.perVersion} two-image choices drawn from the library, left and right at random. The ${s.units} images are split into ${s.versions} versions, so every image appears ${exp} times.`);
  } else {
    parts.push(zh
      ? `每人看 ${s.perVersion} 对，对子顺序随机；每对里哪张在左轮流交换，正好各占一半；${s.units} 对分成 ${s.versions} 个版本，每对会被看 ${exp} 次。`
      : `Each person sees ${s.perVersion} pairs in random order. Which image sits on the left alternates, so each side gets exactly half. The ${s.units} pairs are split into ${s.versions} versions, so every pair is seen ${exp} times.`);
  }
  if (qs.length) {
    parts.push(zh
      ? `跟随这个设计的题：${qs.map((t) => `「${t}」`).join('、')}${qs.length > 1 ? '，这几道题看到的是同一批、同一顺序' : ''}。`
      : `Questions following this design: ${qs.map((t) => `"${t}"`).join(', ')}${qs.length > 1 ? ' (all show the same items in the same order)' : ''}.`);
  }
  if (s.anchors) {
    const a = designAnchorTrialCount(design);
    parts.push(zh ? `另有 ${a} 个锚点${design.type === 'rate' ? '图' : '对'}所有人都看。` : `${a} anchor ${design.type === 'rate' ? 'image(s)' : 'pair(s)'} are shown to everyone.`);
  }
  if (s.repeats) parts.push(zh ? `最后再重复 ${s.repeats} 个，用来算重测一致性。` : `${s.repeats} trial(s) are repeated at the end to measure test–retest agreement.`);
  if (conditions.length > 1) {
    parts.push(zh ? `参与者还会被分到 ${conditions.length} 个实验条件之一（${conditions.map((c) => c.label || c.id).join('、')}），各条件人数保持平衡。` : `Participants are also assigned to one of ${conditions.length} conditions (${conditions.map((c) => c.label || c.id).join(', ')}), kept balanced.`);
  }
  parts.push(zh ? `大约需要 ${s.people} 人完成${conditions.length > 1 ? '（每个条件各做一轮更好）' : ''}。` : `About ${s.people} completed participants are needed${conditions.length > 1 ? ' (ideally that many per condition)' : ''}.`);
  return parts.join(zh ? '' : ' ');
}

/** A Methods paragraph a researcher can paste, describing the design and the analysis. */
export function designMethodsText(design, { zh = false, conditions = [] } = {}) {
  const s = designSizing(design);
  const exp = range(s.exposuresMin, s.exposuresMax);
  const id = design.id || computeDesignId(design);
  const out = [];
  if (zh) {
    if (design.type === 'rate') out.push(`刺激分配采用平衡不完全区组设计（SP-Survey 设计 ${id}，随机种子 ${design.seed}）：${s.units} 张图被分成 ${s.versions} 个版本，每个版本 ${s.perVersion} 张，每张图在全部版本中出现 ${exp} 次；呈现顺序在版本内随机。`);
    if (design.type === 'pool_pairs') out.push(`两两比较采用平衡分配（SP-Survey 设计 ${id}，随机种子 ${design.seed}）：${s.units} 张图被分成 ${s.versions} 个版本，每个版本 ${s.perVersion} 次比较，每张图出现 ${exp} 次，左右位置随机。`);
    if (design.type === 'fixed_pairs') out.push(`${s.units} 组预先确定的图片对被分成 ${s.versions} 个版本（SP-Survey 设计 ${id}，随机种子 ${design.seed}），每个版本 ${s.perVersion} 对，每对被呈现 ${exp} 次；每对的左右位置在呈现间交替以平衡位置效应。`);
    out.push('每位新参与者领取当前完成次数最少的版本。');
    if (s.anchors) out.push(`另有 ${designAnchorTrialCount(design)} 个锚点刺激向所有参与者呈现。`);
    if (s.repeats) out.push(`每位参与者在最后重复 ${s.repeats} 个试次，用于估计重测一致性。`);
    if (conditions.length > 1) out.push(`参与者被平衡地随机分配到 ${conditions.length} 个组间条件之一。`);
    out.push(design.type === 'pool_pairs'
      ? '选择数据用 Bradley–Terry 模型估计每张图的得分，95% 区间来自按参与者重抽样 200 次的 bootstrap。'
      : design.type === 'fixed_pairs'
        ? '每对的选择比例报告 Wilson 95% 区间；同一对两张图的评分差按参与者配对计算均值和 95% 区间。'
        : '评分按图汇总为均值和 t 分布 95% 区间。');
    return out.join('');
  }
  if (design.type === 'rate') out.push(`Stimuli were assigned with a balanced incomplete block design generated by SP-Survey (design ${id}, seed ${design.seed}): the ${s.units} images were divided into ${s.versions} versions of ${s.perVersion} images, so each image appeared ${exp} times across versions; presentation order was randomised within each version.`);
  if (design.type === 'pool_pairs') out.push(`Pairwise comparisons were assigned with a balanced design generated by SP-Survey (design ${id}, seed ${design.seed}): the ${s.units} images were divided into ${s.versions} versions of ${s.perVersion} comparisons, so each image appeared ${exp} times, with left–right position randomised.`);
  if (design.type === 'fixed_pairs') out.push(`The ${s.units} predefined image pairs were divided into ${s.versions} versions of ${s.perVersion} pairs (SP-Survey design ${id}, seed ${design.seed}), so each pair was presented ${exp} times; the left–right position of each pair alternated between presentations to counterbalance position.`);
  out.push('Each new participant received the version completed least often so far.');
  if (s.anchors) out.push(`${designAnchorTrialCount(design)} anchor stimuli were shown to every participant.`);
  if (s.repeats) out.push(`Each participant repeated ${s.repeats} trial(s) at the end to estimate test–retest agreement.`);
  if (conditions.length > 1) out.push(`Participants were randomly assigned, with balancing, to one of ${conditions.length} between-participant conditions.`);
  out.push(design.type === 'pool_pairs'
    ? 'Choices were scaled with a Bradley–Terry model; 95% intervals come from 200 bootstrap resamples of participants.'
    : design.type === 'fixed_pairs'
      ? 'Choice shares per pair are reported with Wilson 95% intervals; rating differences within a pair were computed per participant and summarised as means with 95% t intervals.'
      : 'Ratings were summarised per image as means with 95% t intervals.');
  return out.join(' ');
}

/** Parse a pairs table: one pair per line, "id, a, b[, label]" or "a, b". Header lines are skipped. */
export function parsePairsText(text) {
  const units = [];
  const problems = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const cells = line.split(/[,\t;]/).map((c) => c.trim()).filter((c, j, all) => c || j < all.length - 1);
    if (!cells.length || !cells.join('')) return;
    if (i === 0 && /pair|id|图|a\b/i.test(cells[0]) && cells.length >= 2 && !/\.[a-z0-9]{2,5}$/i.test(cells[1])) return;
    let id; let a; let b; let label;
    if (cells.length >= 3 && !/\.[a-z0-9]{2,5}$/i.test(cells[0])) [id, a, b, label] = cells;
    else [a, b, label] = cells;
    const unit = normalizePairUnit({ id, a, b, label }, units.length);
    if (unit) units.push(unit);
    else problems.push(i + 1);
  });
  return { units, problems };
}

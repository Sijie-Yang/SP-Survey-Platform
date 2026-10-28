/**
 * Platform analysis of a custom question's answers, without any model.
 *
 * A custom question (an SP-Scheme page's own task) stores whatever object the
 * page sends, usually one per trial: { imageA, imageB, compare, ratingA,
 * ratingB, reasonsA, reasonsB, grade, durationMs, ... }. This module reads
 * every field of those objects, decides deterministically what each one is
 * (image, score, choice between the images, tags, group, duration, time
 * stamp, order, free text, id) and turns them into analysis blocks the
 * platform computes like native analysis. It also says, field by field, what
 * was analysed and what was skipped and why, so the researcher can see the
 * coverage instead of guessing what a model left out.
 */

const MEDIA_RE = /\.(jpe?g|png|webp|gif|avif|bmp|tiff?|mp4|webm|mov|mp3|wav)(?:[?#].*)?$/i;
const TIME_NAME_RE = /(^|[_-])(at|ts|time|timestamp|date)$|At$|Time$|Timestamp$|Date$/;
const DURATION_WORD_RE = /duration|elapsed|latency|reaction|response_?time|^rt$|^rt_|_rt$/i;
const DURATION_UNIT_RE = /Rt$|RT$|Ms$|_ms$|Sec$|Secs$|Seconds$|_sec$|_secs$|_seconds$/;
const ORDER_NAME_RE = /^(round|trial|trial_?index|index|idx|order|step|seq|sequence|position|pos|n|num|no|number|screen|page)$/i;
const MAX_CATEGORIES = 20;

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const fileName = (v) => String(v ?? '').split(/[?#]/)[0].split('/').pop();

/**
 * The entries one record holds for the question: each trial's value of a
 * { trials: [...] } answer, the elements of an array of objects, or the
 * object itself. Nested plain objects are flattened one level ("a.b").
 */
export function answerRows(records) {
  const rows = [];
  (records || []).forEach((record, recordIndex) => {
    const participant = String(record?.participant_id || `row_${recordIndex + 1}`);
    const answer = record?.answer;
    let entries = [];
    if (isPlainObject(answer) && Array.isArray(answer.trials)) {
      entries = answer.trials.map((t) => ({ value: t?.value, shown: (t?.shown_media_ids?.length ? t.shown_media_ids : t?.shown_images) || [] }));
    } else if (Array.isArray(answer) && answer.every((a) => isPlainObject(a))) {
      entries = answer.map((value) => ({ value, shown: [] }));
    } else if (isPlainObject(answer)) {
      entries = [{ value: answer, shown: Array.isArray(record?.shown) ? record.shown : [] }];
    }
    entries.forEach((entry, trial) => {
      if (!isPlainObject(entry.value)) return;
      const fields = {};
      Object.entries(entry.value).forEach(([key, v]) => {
        if (isPlainObject(v) && Object.keys(v).length <= 20) Object.entries(v).forEach(([k, inner]) => { fields[`${key}.${k}`] = inner; });
        else fields[key] = v;
      });
      rows.push({ participant, trial, fields, shown: (entry.shown || []).map(fileName).filter(Boolean), context: isPlainObject(record?.context) ? record.context : {} });
    });
  });
  return rows;
}

/** "ratingA" -> { stem: "rating", slot: "a" }; "image_1" -> { stem: "image", slot: "1" }; else null. */
export function slotOf(name) {
  const text = String(name);
  let m = text.match(/^(.*[a-z一-鿿])([A-Z])$/);
  if (m) return { stem: m[1].toLowerCase(), slot: m[2].toLowerCase() };
  m = text.match(/^(.+?)[_-]?(left|right|Left|Right|\d{1,2})$/);
  if (m && /[a-z]/i.test(m[1])) return { stem: m[1].replace(/[_-]$/, '').toLowerCase(), slot: m[2].toLowerCase() };
  m = text.match(/^(.+)[_-]([a-zA-Z])$/);
  if (m) return { stem: m[1].toLowerCase(), slot: m[2].toLowerCase() };
  return null;
}

/** value → label pairs written in the page code ({ value: 'a_safer', label: 'A 更安全' }) and the question's choices. */
export function choiceLabels(pageHtml = '', question = null) {
  const labels = {};
  const re = /\{\s*value\s*:\s*(?:(['"])([^'"\n]{1,80})\1|(-?\d+(?:\.\d+)?))\s*,\s*(?:label|text|name)\s*:\s*(['"])([^'"\n]{1,120})\4/g;
  let m;
  const text = String(pageHtml || '');
  while ((m = re.exec(text))) {
    const value = m[2] ?? m[3];
    if (!(value in labels)) labels[value] = m[5];
  }
  const textOf = (v) => (v && typeof v === 'object' ? Object.values(v)[0] : v);
  (question?.choices || []).forEach((c) => {
    if (c && typeof c === 'object' && c.value != null && textOf(c.text)) labels[String(c.value)] = String(textOf(c.text));
  });
  return labels;
}

function kindOfValues(values) {
  const present = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (!present.length) return { kind: 'empty', present };
  if (present.every((v) => typeof v === 'number' && Number.isFinite(v))) return { kind: 'number', present };
  if (present.every((v) => typeof v === 'boolean')) return { kind: 'boolean', present };
  if (present.every((v) => Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number'))) return { kind: 'tags', present };
  if (present.every((v) => typeof v === 'string')) return { kind: 'string', present };
  if (present.every((v) => typeof v === 'string' || typeof v === 'number')) return { kind: 'string', present: present.map(String) };
  return { kind: 'object', present };
}

/**
 * What each field is. Returns [{ name, role, ... }] where role is one of
 * media, choice_pair, score, category, tags, group, duration, time, order,
 * text, id, constant, empty, object.
 */
export function profileFields(rows) {
  const names = [];
  rows.forEach((row) => Object.keys(row.fields).forEach((k) => { if (!names.includes(k)) names.push(k); }));
  const byParticipant = (name) => {
    const map = new Map();
    rows.forEach((row) => {
      const v = row.fields[name];
      if (v === null || v === undefined || v === '') return;
      if (!map.has(row.participant)) map.set(row.participant, new Set());
      map.get(row.participant).add(JSON.stringify(v));
    });
    return map;
  };
  const fields = names.map((name) => {
    const values = rows.map((row) => row.fields[name]);
    const { kind, present } = kindOfValues(values);
    const distinct = [...new Set(present.map((v) => JSON.stringify(v)))];
    const base = { name, kind, n: present.length, distinct: distinct.length };
    if (kind === 'empty') return { ...base, role: 'empty' };
    if (kind === 'object') return { ...base, role: 'object' };
    if (kind === 'string' && present.filter((v) => MEDIA_RE.test(v)).length >= present.length * 0.8) return { ...base, role: 'media' };
    if (kind === 'number') {
      // Epoch milliseconds (savedAt: 1793174906097) are time stamps whatever the name.
      if (present.every((v) => v > 1e11)) return { ...base, role: 'time' };
      if (DURATION_WORD_RE.test(name) || DURATION_UNIT_RE.test(name)) {
        const ms = /Ms$|_ms$|milli/i.test(name) || (!/Sec|_s$|seconds/i.test(name) && Math.max(...present) > 600);
        return { ...base, role: 'duration', unit: ms ? 'ms' : 's' };
      }
      if (TIME_NAME_RE.test(name)) return { ...base, role: 'time' };
      if (ORDER_NAME_RE.test(name) && present.every(Number.isInteger)) return { ...base, role: 'order' };
      if (distinct.length === 1) return { ...base, role: 'constant', value: present[0] };
      return { ...base, role: 'score', min: Math.min(...present), max: Math.max(...present) };
    }
    if (kind === 'tags') {
      const flat = present.flat().map(String);
      // A list of image names or URLs records what was shown, not an answer.
      if (flat.length && flat.filter((v) => MEDIA_RE.test(v) || /^https?:\/\//.test(v)).length >= flat.length * 0.8) return { ...base, role: 'media_list' };
      return { ...base, role: 'tags' };
    }
    // A JSON object or array saved as text is structure, not an answer.
    if (kind === 'string' && present.every((v) => /^\s*[[{]/.test(v))) return { ...base, role: 'object' };
    if (kind === 'boolean') {
      if (distinct.length === 1) return { ...base, role: 'constant', value: present[0] };
      return { ...base, role: 'category' };
    }
    // Strings.
    if (distinct.length === 1) return { ...base, role: 'constant', value: present[0] };
    const perP = byParticipant(name);
    const fixedPerParticipant = perP.size >= 2 && [...perP.values()].every((s) => s.size === 1);
    const meanLength = present.reduce((s, v) => s + String(v).length, 0) / present.length;
    if (meanLength >= 15) return { ...base, role: 'text' };
    // Few distinct values (or many repeats) are options; a handful of answers can still show 3 of 4 options.
    if (distinct.length <= MAX_CATEGORIES && (distinct.length <= 6 || distinct.length <= present.length * 0.6)) {
      return { ...base, role: fixedPerParticipant ? 'group' : 'category' };
    }
    if (/\s/.test(present.join('')) || /[\u4e00-\u9fff]{4,}/.test(present.join(''))) return { ...base, role: 'text' };
    return { ...base, role: 'id' };
  });
  // Pair fields: scores and tags that belong to one image (ratingA ↔ imageA).
  const media = fields.filter((f) => f.role === 'media');
  const slots = new Map(media.map((f) => [f.name, slotOf(f.name)]).filter(([, s]) => s));
  fields.forEach((f) => {
    if (!['score', 'tags', 'category'].includes(f.role)) return;
    const own = slotOf(f.name);
    if (!own) return;
    const partner = media.find((m) => slots.get(m.name)?.slot === own.slot);
    if (partner) { f.media = partner.name; f.slot = own.slot; f.stem = own.stem; }
  });
  // A category whose values name one of the image slots ("a_safer", "left", or the image itself) is the choice between them.
  const slotMedia = media.filter((m) => slots.has(m.name));
  if (slotMedia.length >= 2) {
    fields.forEach((f) => {
      if (f.role !== 'category' || f.media) return;
      const values = rows.map((row) => row.fields[f.name]).filter((v) => typeof v === 'string' && v);
      const mapped = values.filter((v, i) => pickedSlot(v, slotMedia, slots, rowsWith(rows, f.name)[i]) != null).length;
      if (mapped >= values.length * 0.4 && mapped >= 1) { f.role = 'choice_pair'; f.between = slotMedia.map((m) => m.name); }
    });
  }
  return fields;
}

function rowsWith(rows, name) {
  return rows.filter((row) => typeof row.fields[name] === 'string' && row.fields[name]);
}

/** Which media field a choice value picks, or null for "same" / "can't tell". */
function pickedSlot(value, media, slots, row) {
  const v = String(value);
  if (row) {
    const direct = media.find((m) => row.fields[m.name] && fileName(row.fields[m.name]) === fileName(v));
    if (direct) return direct.name;
  }
  const tokens = v.toLowerCase().split(/[^a-z0-9一-鿿]+/).filter(Boolean);
  const hits = media.filter((m) => {
    const slot = slots.get(m.name)?.slot;
    if (!slot) return false;
    if (tokens.includes(slot)) return true;
    if (slot === 'left' && /左/.test(v)) return true;
    if (slot === 'right' && /右/.test(v)) return true;
    return false;
  });
  return hits.length === 1 ? hits[0].name : null;
}

const participantsOf = (rows) => [...new Set(rows.map((r) => r.participant))];
const fmt = (n, d = 2) => (n == null || !Number.isFinite(n) ? '' : Math.round(n * 10 ** d) / 10 ** d);
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const label = (labels, v) => (labels[v] && labels[v] !== v ? `${labels[v]} (${v})` : String(v));

/**
 * The platform's own analysis of the question: { blocks, coverage, rows }.
 * blocks are normalized blocks (computeAnalysisBlocks runs the statistics);
 * coverage lists every field with what was done with it.
 */
export function autoAnalysis(records, { pageHtml = '', question = null } = {}) {
  const rows = answerRows(records);
  if (!rows.length) return { blocks: [], coverage: [], rows: 0, participants: 0 };
  const labels = choiceLabels(pageHtml, question);
  const fields = profileFields(rows);
  // Answers to the other questions of the same submission (e.g. grade) are groups too.
  const contextNames = [];
  rows.forEach((row) => Object.keys(row.context).forEach((k) => { if (!contextNames.includes(k) && !(k in row.fields)) contextNames.push(k); }));
  contextNames.forEach((name) => {
    const values = [...new Set(rows.map((row) => row.context[name]).filter((v) => v !== null && v !== undefined && v !== '').map(String))];
    if (values.length >= 2 && values.length <= MAX_CATEGORIES) fields.push({ name, role: 'group', fromOtherQuestion: true, distinct: values.length, n: rows.length });
  });
  const valueOf = (row, f) => (f.fromOtherQuestion ? row.context[f.name] : row.fields[f.name]);
  const participants = new Set(rows.map((r) => r.participant)).size;
  const blocks = [];
  const coverage = [];
  const done = (f, what) => coverage.push({ field: f.name, status: 'analysed', what });
  const skip = (f, why) => coverage.push({ field: f.name, status: 'skipped', what: why });
  const byRole = (role) => fields.filter((f) => f.role === role);
  const media = byRole('media');
  const scores = byRole('score');
  const pairedScores = scores.filter((f) => f.media);
  const choice = byRole('choice_pair')[0];

  // 1. The choice between the images: ranking (TrueSkill) + how often each answer was given.
  if (choice) {
    const matches = [];
    const counts = new Map();
    let ties = 0;
    const tieValues = new Set();
    const slotWins = new Map(choice.between.map((m) => [m, 0]));
    rows.forEach((row) => {
      const v = row.fields[choice.name];
      if (typeof v !== 'string' || !v) return;
      counts.set(v, (counts.get(v) || 0) + 1);
      const mediaFields = media.filter((m) => choice.between.includes(m.name));
      const slots = new Map(mediaFields.map((m) => [m.name, slotOf(m.name)]));
      const winnerField = pickedSlot(v, mediaFields, slots, row);
      if (!winnerField) { ties += 1; tieValues.add(v); return; }
      slotWins.set(winnerField, (slotWins.get(winnerField) || 0) + 1);
      const winner = fileName(row.fields[winnerField]);
      choice.between.filter((m) => m !== winnerField).forEach((other) => {
        const loser = fileName(row.fields[other]);
        if (winner && loser && winner !== loser) matches.push({ winner, loser });
      });
    });
    const answered = [...counts.values()].reduce((a, b) => a + b, 0);
    const items = new Set(matches.flatMap((m) => [m.winner, m.loser]));
    const perItem = items.size ? (matches.length * 2) / items.size : 0;
    const sideText = [...slotWins.entries()].map(([m, n]) => `${m} ${n}`).join(' / ');
    if (matches.length) {
      blocks.push({
        type: 'pairwise',
        title: `${choice.name}：两张图里选哪张（TrueSkill 排名）`,
        note: [
          `${matches.length} 次有明确选择。`,
          ties ? `另有 ${ties} 次选了“${[...tieValues].map((v) => labels[v] || v).join('”或“')}”，不计入排名。` : '',
          `按位置：${sideText}。`,
          perItem < 5 ? `每张图平均只比较了 ${fmt(perItem, 1)} 次，排名还不稳定，μ 相同或很接近是正常的；人多了会分开。` : '',
        ].filter(Boolean).join(' '),
        matches,
        platform: true,
      });
    }
    blocks.push({
      type: 'choice',
      title: `${choice.name}：各选项次数`,
      values: rows.map((row) => row.fields[choice.name]).filter((v) => typeof v === 'string' && v).map((v) => label(labels, v)),
      total: answered,
      platform: true,
    });
    done(choice, `两张图（${choice.between.join('、')}）之间的选择：TrueSkill 排名 + 各选项比例${ties ? `（${ties} 次平局/看不出不进排名）` : ''}`);
  }

  // 2. Scores given to one image each: per-image summary.
  // The page's own option labels for the scale (1=很不安全 … 5=很安全), when every score has one.
  const scoreLabelNote = (list) => {
    const values = [...new Set(rows.flatMap((r) => list.map((f) => r.fields[f.name])).filter((v) => typeof v === 'number'))];
    if (!values.length || !values.every((v) => labels[String(v)])) return '';
    const scale = Object.keys(labels).filter((k) => /^-?\d+(\.\d+)?$/.test(k)).map(Number).sort((a, b) => a - b);
    return `分值含义：${scale.map((v) => `${v}=${labels[String(v)]}`).join('，')}。`;
  };
  const scoreStems = new Map();
  pairedScores.forEach((f) => { if (!scoreStems.has(f.stem)) scoreStems.set(f.stem, []); scoreStems.get(f.stem).push(f); });
  scoreStems.forEach((list, stem) => {
    const values = [];
    rows.forEach((row) => list.forEach((f) => {
      const v = row.fields[f.name];
      const item = fileName(row.fields[f.media]);
      if (typeof v === 'number' && Number.isFinite(v) && item) values.push({ item, value: v, rater: row.participant });
    }));
    if (!values.length) return;
    blocks.push({ type: 'per_item', title: `${list.map((f) => f.name).join(' / ')}：每张图的分数`, note: `每个分数算到它对应的那张图上（${list.map((f) => `${f.name}→${f.media}`).join('，')}）。${scoreLabelNote(list)}`, values, measure: 'number', platform: true, stem });
    list.forEach((f) => done(f, `${f.media} 那张图的分数：按图汇总均值、SD`));
  });

  // 3. Does the choice agree with the scores? (picked image scored higher)
  if (choice && pairedScores.length >= 2) {
    const stem = pairedScores[0].stem;
    const sameStem = pairedScores.filter((f) => f.stem === stem && choice.between.includes(f.media));
    if (sameStem.length >= 2) {
      const tally = { higher: 0, equal: 0, lower: 0 };
      const tieTally = { equal: 0, differ: 0 };
      rows.forEach((row) => {
        const v = row.fields[choice.name];
        if (typeof v !== 'string' || !v) return;
        const mediaFields = media.filter((m) => choice.between.includes(m.name));
        const winnerField = pickedSlot(v, mediaFields, new Map(mediaFields.map((m) => [m.name, slotOf(m.name)])), row);
        const scoreOf = (mediaName) => row.fields[sameStem.find((f) => f.media === mediaName)?.name];
        if (!winnerField) {
          const s = sameStem.map((f) => row.fields[f.name]).filter((x) => typeof x === 'number');
          if (s.length >= 2) tieTally[Math.max(...s) === Math.min(...s) ? 'equal' : 'differ'] += 1;
          return;
        }
        const w = scoreOf(winnerField);
        const others = choice.between.filter((m) => m !== winnerField).map(scoreOf).filter((x) => typeof x === 'number');
        if (typeof w !== 'number' || !others.length) return;
        const best = Math.max(...others);
        tally[w > best ? 'higher' : w === best ? 'equal' : 'lower'] += 1;
      });
      const total = tally.higher + tally.equal + tally.lower;
      if (total) {
        blocks.push({
          type: 'table',
          title: `选择和打分是否一致（${choice.name} vs ${sameStem.map((f) => f.name).join('/')}）`,
          note: '“选中的图分数更高”是一致；“更低”说明选择和打分矛盾，可以检查这些作答。',
          columns: ['情况', '次数', '比例'],
          rows: [
            ['选中的图分数更高（一致）', tally.higher, fmt(tally.higher / total * 100, 1)],
            ['两张图分数一样', tally.equal, fmt(tally.equal / total * 100, 1)],
            ['选中的图分数更低（矛盾）', tally.lower, fmt(tally.lower / total * 100, 1)],
            ...(tieTally.equal + tieTally.differ ? [['没选（差不多/看不出）且分数一样', tieTally.equal, ''], ['没选（差不多/看不出）但分数不同', tieTally.differ, '']] : []),
          ],
          platform: true,
        });
      }
    }
  }

  // 4. Tags (multi-select reasons): frequency, and the mean score of the image when the tag was picked.
  const tagFields = byRole('tags');
  const tagStems = new Map();
  tagFields.forEach((f) => { const key = f.media ? f.stem : f.name; if (!tagStems.has(key)) tagStems.set(key, []); tagStems.get(key).push(f); });
  tagStems.forEach((list) => {
    const values = [];
    const scoreByTag = new Map();
    let answers = 0;
    rows.forEach((row) => list.forEach((f) => {
      const tags = row.fields[f.name];
      if (!Array.isArray(tags) || !tags.length) return;
      answers += 1;
      const score = f.media ? row.fields[pairedScores.find((s) => s.media === f.media)?.name] : undefined;
      tags.forEach((t) => {
        const tag = label(labels, t);
        values.push(tag);
        if (typeof score === 'number') { if (!scoreByTag.has(tag)) scoreByTag.set(tag, []); scoreByTag.get(tag).push(score); }
      });
    }));
    if (!values.length) return;
    const names = list.map((f) => f.name).join(' / ');
    blocks.push({ type: 'choice', title: `${names}：标签被选的次数`, note: `多选：比例 = 选了这个标签的作答 / 全部 ${answers} 次作答。`, values, total: answers, multi: true, platform: true });
    if (scoreByTag.size) {
      const scoreName = pairedScores.find((s) => s.media === list[0].media)?.stem || 'score';
      blocks.push({
        type: 'table',
        title: `${names}：选了这个标签时，那张图的平均分`,
        note: `把每个标签和它所描述那张图的分数（${scoreName}）放在一起，看哪些理由对应高分、哪些对应低分。`,
        columns: ['标签', '次数', '平均分', '最低', '最高'],
        rows: [...scoreByTag.entries()].map(([tag, s]) => [tag, s.length, fmt(mean(s)), Math.min(...s), Math.max(...s)]).sort((a, b) => b[2] - a[2]),
        platform: true,
      });
    }
    list.forEach((f) => done(f, f.media ? `${f.media} 那张图的标签：次数 + 对应平均分` : '多选标签：次数和比例'));
  });

  // 5. Single scores and categories that belong to no image.
  scores.filter((f) => !f.media).forEach((f) => {
    const values = rows.map((r) => r.fields[f.name]).filter((v) => typeof v === 'number');
    const shownOne = rows.every((r) => r.shown.length === 1);
    if (shownOne) {
      blocks.push({ type: 'per_item', title: `${f.name}：每张图的分数`, note: `每次作答只显示一张图，分数算到那张图上。${scoreLabelNote([f])}`, values: rows.filter((r) => typeof r.fields[f.name] === 'number').map((r) => ({ item: r.shown[0], value: r.fields[f.name], rater: r.participant })), measure: 'number', platform: true });
      done(f, '分数，按显示的那张图汇总');
    } else {
      blocks.push({ type: 'rating', title: `${f.name}：分数分布`, note: scoreLabelNote([f]), values, platform: true });
      done(f, '数值：均值、SD、中位数、95% CI');
    }
  });
  byRole('category').filter((f) => !f.media).forEach((f) => {
    blocks.push({ type: 'choice', title: `${f.name}：各选项次数`, values: rows.map((r) => r.fields[f.name]).filter((v) => v !== null && v !== undefined && v !== '').map((v) => label(labels, String(v))), platform: true });
    done(f, '选项：次数和比例（Wilson 95% CI）');
  });
  byRole('category').filter((f) => f.media).forEach((f) => skip(f, '属于某张图的选项，平台暂不按图汇总，可让模型补充'));

  // 6. Time spent on each trial.
  byRole('duration').forEach((f) => {
    const seconds = rows.map((r) => r.fields[f.name]).filter((v) => typeof v === 'number' && v >= 0).map((v) => (f.unit === 'ms' ? v / 1000 : v));
    if (!seconds.length) return;
    const fast = seconds.filter((s) => s < 2).length;
    // A page that keeps one start time for the whole task records the time since the page opened, not per trial.
    const sameStart = byRole('time').some((t) => /start|begin|open/i.test(t.name) && participantsOf(rows).every((p) => new Set(rows.filter((r) => r.participant === p).map((r) => r.fields[t.name])).size === 1) && rows.length > participantsOf(rows).length);
    const growing = participantsOf(rows).every((p) => {
      const list = rows.filter((r) => r.participant === p).sort((a, b) => (Number(a.fields.round ?? a.trial) - Number(b.fields.round ?? b.trial))).map((r) => r.fields[f.name]).filter((v) => typeof v === 'number');
      return list.length >= 2 && list.every((v, i) => i === 0 || v > list[i - 1]);
    });
    const cumulative = sameStart && growing;
    blocks.push({ type: 'rating', title: `${f.name}：每次作答用时（秒）`, note: `${cumulative ? '注意：每个人所有轮次的开始时间都一样，用时逐轮变长，看起来是“从打开页面到这一轮”的累计时间，不是每轮各自的用时；要每轮用时，页面需要在每轮开始时重新记开始时间。' : ''}${f.unit === 'ms' ? '原始单位毫秒，已换算成秒。' : ''}${fast ? `${fast} 次少于 2 秒，可能没认真看。` : '没有少于 2 秒的作答。'}`, values: seconds.map((s) => fmt(s, 2)), platform: true });
    done(f, cumulative ? '用时：分布（看起来是累计时间，见说明）' : '用时：均值、中位数、分布，标出过快作答');
  });

  // 7. Groups (e.g. grade): the main results split by group.
  const groups = byRole('group');
  const mainScoreFields = pairedScores.length ? pairedScores : scores;
  groups.forEach((g) => {
    const levels = [...new Set(rows.map((r) => valueOf(r, g)).filter((v) => v !== null && v !== undefined && v !== '').map(String))].sort();
    const columns = ['组', '人数', '作答次数'];
    if (mainScoreFields.length) columns.push('平均分');
    const choiceValues = choice ? [...new Set(rows.map((r) => r.fields[choice.name]).filter((v) => typeof v === 'string' && v))] : [];
    choiceValues.forEach((v) => columns.push(`${labels[v] || v} %`));
    const tableRows = levels.map((level) => {
      const inGroup = rows.filter((r) => String(valueOf(r, g)) === level);
      const people = new Set(inGroup.map((r) => r.participant)).size;
      const row = [label(labels, level), people, inGroup.length];
      if (mainScoreFields.length) row.push(fmt(mean(inGroup.flatMap((r) => mainScoreFields.map((f) => r.fields[f.name]).filter((v) => typeof v === 'number')))));
      if (choice) {
        const answered = inGroup.filter((r) => typeof r.fields[choice.name] === 'string' && r.fields[choice.name]);
        choiceValues.forEach((v) => row.push(answered.length ? fmt(answered.filter((r) => r.fields[choice.name] === v).length / answered.length * 100, 1) : ''));
      }
      return row;
    });
    blocks.push({ type: 'table', title: `按 ${g.name} 分组`, note: `${g.fromOtherQuestion ? `${g.name} 来自同一份答卷里的另一道题。` : `${g.name} 在每个人的所有作答里都一样，当作分组。`}每组人数少时差异不可靠。`, columns, rows: tableRows, platform: true });
    done(g, `分组：${levels.length} 组，各组的平均分${choice ? '和选择比例' : ''}`);
  });

  // Everything else is listed with the reason it was not analysed.
  fields.forEach((f) => {
    if (coverage.some((c) => c.field === f.name)) return;
    if (f.fromOtherQuestion) return;
    if (f.role === 'media') skip(f, '图片名：用来把分数、选择和标签对应到图上');
    else if (f.role === 'media_list') skip(f, '显示过的图片列表：不是作答内容');
    else if (f.role === 'time') skip(f, '时间戳：不是作答内容');
    else if (f.role === 'order') skip(f, '顺序号（第几轮）：不是作答内容');
    else if (f.role === 'constant') skip(f, `所有作答都是同一个值（${label(labels, String(f.value))}），没法比较${participants < 2 ? '；人多了如果有不同取值会自动分组' : ''}`);
    else if (f.role === 'empty') skip(f, '没有值');
    else if (f.role === 'id') skip(f, '几乎每条都不同的编号，不是作答内容');
    else if (f.role === 'text') {
      const values = rows.map((r) => r.fields[f.name]).filter((v) => typeof v === 'string' && v.trim());
      blocks.push({ type: 'text', title: `${f.name}：文字回答`, values, platform: true });
      done(f, '文字：词频和长度');
    } else if (f.role === 'object') skip(f, '结构太复杂（嵌套对象/列表），平台没有展开，可让模型补充');
    else if (f.role === 'score' && f.media) skip(f, '没有找到同名的图片字段');
    else skip(f, '平台不认识这种字段');
  });
  // Show coverage in the field order of the answer.
  const order = new Map(fields.map((f, i) => [f.name, i]));
  coverage.sort((a, b) => (order.get(a.field) ?? 999) - (order.get(b.field) ?? 999));
  return { blocks, coverage, rows: rows.length, participants };
}

/** The coverage as a block: shown first, exported as a CSV. */
export function coverageBlock(auto) {
  if (!auto?.coverage?.length) return null;
  const analysed = auto.coverage.filter((c) => c.status === 'analysed');
  const skipped = auto.coverage.filter((c) => c.status === 'skipped');
  return {
    type: 'coverage',
    title: '平台分析了哪些字段',
    note: `${auto.participants} 人 · ${auto.rows} 条作答。已分析 ${analysed.length} 个字段，跳过 ${skipped.length} 个。这部分完全由平台代码完成，不经过模型，每次结果一样。`,
    analysed,
    skipped,
    columns: ['field', 'status', 'what'],
    rows: auto.coverage.map((c) => [c.field, c.status === 'analysed' ? '已分析' : '跳过', c.what]),
    platform: true,
  };
}

/** One line per platform block, for the model: these are done, do not repeat them. */
export function autoAnalysisSummary(auto) {
  if (!auto?.coverage?.length) return '';
  const lines = auto.blocks.map((b) => `- ${b.type}: ${b.title}`);
  lines.push('Fields already analysed: ' + auto.coverage.filter((c) => c.status === 'analysed').map((c) => c.field).join(', '));
  const skipped = auto.coverage.filter((c) => c.status === 'skipped');
  if (skipped.length) lines.push('Fields the platform skipped: ' + skipped.map((c) => `${c.field} (${c.what})`).join('; '));
  return lines.join('\n');
}

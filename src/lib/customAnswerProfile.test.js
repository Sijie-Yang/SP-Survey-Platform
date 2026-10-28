import { answerRows, autoAnalysis, choiceLabels, coverageBlock, profileFields, slotOf } from './customAnswerProfile';
import { enrichSurveyResponses } from './enrichSurveyResponses';
import { buildAnalysisRecords, evaluateAnalysis, generateQuestionAnalysis, runAnalysisUnsandboxed } from './aiQuestionAnalysis';

// The 儿童环境公平 SP-Scheme page: one entry per round, sent with
// SPSite.answer('pair_task', payload, { key, shown }). Real answers from the diagnosis package.
const TRIALS = [
  { grade: '二年级', round: 1, imageA: '13622_103.902555433244_1.37472455010882.jpg', imageB: '37294_103.769215923953_1.39020049185026.jpg', compare: 'a_safer', ratingA: 4, ratingB: 2, savedAt: 1793174906097, reasonsA: ['人太多', '感觉舒服'], reasonsB: ['看不清前面', '人车分开'], startedAt: 1793174875928, durationMs: 30169 },
  { grade: '二年级', round: 2, imageA: '66921_103.713139746607_1.44484489143752.jpg', imageB: '50827_103.955790914933_1.35370691267708.jpg', compare: 'b_safer', ratingA: 4, ratingB: 1, savedAt: 1793174911215, reasonsA: ['有人行道', '人太多'], reasonsB: ['看不清前面', '树很多'], startedAt: 1793174875928, durationMs: 35287 },
  { grade: '二年级', round: 3, imageA: '11485_103.88617259338_1.39464939975589.jpg', imageB: '4973_103.875856549526_1.37726533469775.jpg', compare: 'similar', ratingA: 5, ratingB: 2, savedAt: 1793174915916, reasonsA: ['有人行道', '感觉舒服'], reasonsB: ['路太窄', '看得清楚'], startedAt: 1793174875928, durationMs: 39988 },
  { grade: '二年级', round: 4, imageA: '58994_103.833713381805_1.34983445777133.jpg', imageB: '10396_103.687376020797_1.32301216979197.jpg', compare: 'b_safer', ratingA: 5, ratingB: 2, savedAt: 1793174920616, reasonsA: ['不好玩', '感觉舒服'], reasonsB: ['路太窄', '看得清楚'], startedAt: 1793174875928, durationMs: 44688 },
];
const PAGE_HTML = `<script>
  var RATE = [ {value:1,label:'很不安全'}, {value:2,label:'不太安全'}, {value:3,label:'一般'}, {value:4,label:'比较安全'}, {value:5,label:'很安全'} ];
  var COMPARE = [ {value:'a_safer',label:'A 更安全'}, {value:'b_safer',label:'B 更安全'}, {value:'similar',label:'差不多'}, {value:'unclear',label:'看不出来'} ];
</script>`;
const QUESTION = { name: 'pair_task', type: 'custom', title: '儿童街景安全感比较任务' };

function row(participant, trials, grade) {
  return {
    participant_id: participant,
    created_at: '2026-10-28T06:00:00Z',
    responses: {
      consent: true,
      grade,
      pair_task: { trials: trials.map((value, i) => ({ key: `round_${i + 1}`, value: { ...value, grade }, shown_images: [value.imageA, value.imageB], shown_media_ids: [value.imageA, value.imageB] })) },
    },
  };
}

const ONE = [row('p_1793174875557_43cxkusef', TRIALS, '二年级')];
// What a submitted row really holds: SurveyApp stores enrichSurveyResponses(...) output.
function submittedRow(participant, trials, grade) {
  const raw = row(participant, trials, grade);
  const { enrichedResponses } = enrichSurveyResponses({ responses: raw.responses, questionTypeMap: { consent: 'boolean', grade: 'radiogroup', pair_task: 'custom' } });
  return { ...raw, responses: enrichedResponses, raw_responses: raw.responses };
}
// A second, invented participant in another grade who answers the other way round, to check grouping.
const flipped = TRIALS.map((t) => ({ ...t, compare: t.compare === 'a_safer' ? 'b_safer' : t.compare === 'b_safer' ? 'a_safer' : 'unclear', ratingA: t.ratingB, ratingB: t.ratingA }));
const TWO = [...ONE, row('p_second', flipped, '五年级')];

const byTitle = (blocks, re) => blocks.find((b) => re.test(b.title || ''));

describe('custom answer profile', () => {
  test('reads slots and the page labels', () => {
    expect(slotOf('imageA')).toEqual({ stem: 'image', slot: 'a' });
    expect(slotOf('reasonsB')).toEqual({ stem: 'reasons', slot: 'b' });
    expect(slotOf('image_2')).toEqual({ stem: 'image', slot: '2' });
    expect(slotOf('durationMs')).toBeNull();
    expect(slotOf('grade')).toBeNull();
    const labels = choiceLabels(PAGE_HTML);
    expect(labels.a_safer).toBe('A 更安全');
    expect(labels['5']).toBe('很安全');
  });

  test('every field of the real answer gets a role', () => {
    const records = buildAnalysisRecords(ONE, QUESTION);
    const fields = Object.fromEntries(profileFields(answerRows(records)).map((f) => [f.name, f]));
    expect(fields.imageA.role).toBe('media');
    expect(fields.compare.role).toBe('choice_pair');
    expect(fields.ratingA).toMatchObject({ role: 'score', media: 'imageA' });
    expect(fields.reasonsB).toMatchObject({ role: 'tags', media: 'imageB' });
    expect(fields.durationMs).toMatchObject({ role: 'duration', unit: 'ms' });
    expect(fields.savedAt.role).toBe('time');
    expect(fields.startedAt.role).toBe('time');
    expect(fields.round.role).toBe('order');
    expect(fields.grade.role).toBe('constant');
  });

  test('the real package: compare, ratings, reasons, consistency and duration are all analysed, the rest is explained', () => {
    const records = buildAnalysisRecords(ONE, QUESTION);
    const auto = autoAnalysis(records, { pageHtml: PAGE_HTML, question: QUESTION });
    const status = Object.fromEntries(auto.coverage.map((c) => [c.field, c.status]));
    expect(status).toMatchObject({ compare: 'analysed', ratingA: 'analysed', ratingB: 'analysed', reasonsA: 'analysed', reasonsB: 'analysed', durationMs: 'analysed', grade: 'skipped', round: 'skipped', savedAt: 'skipped', imageA: 'skipped' });
    // Every field is listed once.
    expect(auto.coverage.map((c) => c.field).sort()).toEqual(Object.keys(TRIALS[0]).sort());

    const pairwise = auto.blocks.find((b) => b.type === 'pairwise');
    expect(pairwise.matches).toEqual([
      { winner: TRIALS[0].imageA, loser: TRIALS[0].imageB },
      { winner: TRIALS[1].imageB, loser: TRIALS[1].imageA },
      { winner: TRIALS[3].imageB, loser: TRIALS[3].imageA },
    ]);
    expect(pairwise.note).toMatch(/1 次选了“差不多”/);
    expect(pairwise.note).toMatch(/排名还不稳定/);

    const options = byTitle(auto.blocks, /compare：各选项次数/);
    expect(options.values).toEqual(['A 更安全 (a_safer)', 'B 更安全 (b_safer)', '差不多 (similar)', 'B 更安全 (b_safer)']);

    const perImage = auto.blocks.find((b) => b.type === 'per_item');
    expect(perImage.values).toHaveLength(8);
    expect(perImage.values).toContainEqual({ item: TRIALS[1].imageB, value: 1, rater: 'p_1793174875557_43cxkusef' });
    expect(perImage.note).toMatch(/1=很不安全/);

    // Two of three clear choices picked the image the child scored lower.
    const consistency = byTitle(auto.blocks, /选择和打分是否一致/);
    expect(consistency.rows[0].slice(0, 2)).toEqual(['选中的图分数更高（一致）', 1]);
    expect(consistency.rows[2].slice(0, 2)).toEqual(['选中的图分数更低（矛盾）', 2]);

    const tags = byTitle(auto.blocks, /标签被选的次数/);
    expect(tags.total).toBe(8);
    expect(tags.values.filter((t) => t === '感觉舒服')).toHaveLength(3);
    const tagScores = byTitle(auto.blocks, /那张图的平均分/);
    expect(tagScores.rows.find((r) => r[0] === '看不清前面')).toEqual(['看不清前面', 2, 1.5, 1, 2]);

    // The page sets one start time for all rounds, so durationMs grows: flagged, in seconds.
    const duration = byTitle(auto.blocks, /用时/);
    expect(duration.values).toEqual([30.17, 35.29, 39.99, 44.69]);
    expect(duration.note).toMatch(/累计时间/);
  });

  test('a field that differs between participants becomes a group', () => {
    const records = buildAnalysisRecords(TWO, QUESTION);
    const auto = autoAnalysis(records, { pageHtml: PAGE_HTML, question: QUESTION });
    const group = byTitle(auto.blocks, /按 grade 分组/);
    expect(group.columns).toEqual(expect.arrayContaining(['组', '人数', '作答次数', '平均分', 'A 更安全 %']));
    expect(group.rows.map((r) => r[0])).toEqual(['二年级', '五年级']);
    expect(group.rows[0][3]).toBe(3.13);
    expect(auto.coverage.find((c) => c.field === 'grade').status).toBe('analysed');
    // consent is the same everywhere: not offered as a group.
    expect(auto.blocks.some((b) => /consent/.test(b.title))).toBe(false);
  });

  test('the coverage block lists analysed and skipped fields', () => {
    const auto = autoAnalysis(buildAnalysisRecords(ONE, QUESTION), { pageHtml: PAGE_HTML });
    const block = coverageBlock(auto);
    expect(block.type).toBe('coverage');
    expect(block.note).toMatch(/已分析 6 个字段，跳过 6 个/);
    expect(block.rows.find((r) => r[0] === 'savedAt')).toEqual(['savedAt', '跳过', '时间戳：不是作答内容']);
  });

  test('answers that are not objects give no platform analysis', () => {
    expect(autoAnalysis([{ participant_id: 'a', answer: 'yes' }]).blocks).toEqual([]);
    expect(autoAnalysis([{ participant_id: 'a', page_state: { x: '{}' } }]).coverage).toEqual([]);
  });
});

describe('platform analysis with the model', () => {
  const runner = async (code, records) => runAnalysisUnsandboxed(code, records);
  // What the free model wrote for this question before: TrueSkill on compare and per-image ratings only.
  const OLD_CODE = `function analyze(records, helpers) {
    var matches = [], values = [];
    records.forEach(function (r) { (r.answer && r.answer.trials || []).forEach(function (t) {
      var v = t.value || {};
      if (v.compare === 'a_safer') matches.push({ winner: v.imageA, loser: v.imageB });
      if (v.compare === 'b_safer') matches.push({ winner: v.imageB, loser: v.imageA });
      values.push({ item: v.imageA, value: v.ratingA, rater: r.participant_id });
      values.push({ item: v.imageB, value: v.ratingB, rater: r.participant_id });
    }); });
    return { blocks: [{ type: 'pairwise', title: 'TS', matches: matches }, { type: 'per_item', title: 'ratings', values: values, measure: 'number' }] };
  }`;

  test('without any code the platform part stands on its own', async () => {
    const run = await evaluateAnalysis('', buildAnalysisRecords(ONE, QUESTION), runner, { pageHtml: PAGE_HTML, question: QUESTION });
    expect(run.ok).toBe(true);
    expect(run.modelBlocks).toEqual([]);
    expect(run.platformBlocks[0].type).toBe('coverage');
    expect(run.platformBlocks.map((b) => b.type)).toEqual(expect.arrayContaining(['pairwise', 'per_item', 'choice', 'table', 'rating']));
  });

  test('a saved analysis that repeats the platform is not shown twice', async () => {
    const run = await evaluateAnalysis(OLD_CODE, buildAnalysisRecords(ONE, QUESTION), runner, { pageHtml: PAGE_HTML, question: QUESTION });
    expect(run.ok).toBe(true);
    expect(run.modelBlocks).toEqual([]);
    expect(run.blocks.filter((b) => b.type === 'pairwise')).toHaveLength(1);
  });

  test('broken model code does not hide the platform analysis', async () => {
    const run = await evaluateAnalysis('function analyze() { throw new Error("boom"); }', buildAnalysisRecords(ONE, QUESTION), runner, { pageHtml: PAGE_HTML, question: QUESTION });
    expect(run.ok).toBe(true);
    expect(run.error).toMatch(/boom/);
    expect(run.platformBlocks.length).toBeGreaterThan(5);
  });

  test('the model is told what is done; "nothing to add" is saved; failing code is not kept', async () => {
    const bodies = [];
    const result = await generateQuestionAnalysis({
      question: QUESTION,
      records: buildAnalysisRecords(ONE, QUESTION),
      pageHtml: PAGE_HTML,
      request: async (body) => { bodies.push(body); return { code: 'function analyze() { return { blocks: [] }; }', model: 'm' }; },
      runner,
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].platformDone).toMatch(/Fields already analysed: compare, ratingA/);
    expect(result.ok).toBe(true);
    expect(result.modelBlocks).toEqual([]);
    expect(result.saved.code).toMatch(/analyze/);

    const failing = await generateQuestionAnalysis({
      question: QUESTION,
      records: buildAnalysisRecords(ONE, QUESTION),
      pageHtml: PAGE_HTML,
      request: async () => ({ code: 'function analyze() { throw new Error("bad"); }', model: 'm' }),
      runner,
    });
    expect(failing.attempts).toBe(2);
    expect(failing.ok).toBe(true);
    expect(failing.modelError).toMatch(/bad/);
    expect(failing.saved.code).toBe('');
  });
});

describe('model blocks next to the platform', () => {
  const runner = async (code, records) => runAnalysisUnsandboxed(code, records);
  test('a model block on different data (e.g. hotspot clicks per image) is kept even if the platform has the same block type', async () => {
    const rows = ONE.map((r) => ({ ...r, responses: { ...r.responses, pair_task: { trials: r.responses.pair_task.trials.map((t, i) => ({ ...t, value: { ...t.value, clicks: [{ x: i, y: 1, image: t.value.imageA }] } })) } } }));
    const code = `function analyze(records) {
      var values = [];
      records.forEach(function (r) { r.answer.trials.forEach(function (t) { t.value.clicks.forEach(function (c) { values.push({ item: c.image, value: c.x, rater: r.participant_id }); }); }); });
      return { blocks: [{ type: 'per_item', title: 'click x per image', values: values, measure: 'number' }] };
    }`;
    const records = buildAnalysisRecords(rows, QUESTION);
    const run = await evaluateAnalysis(code, records, runner, { pageHtml: PAGE_HTML, question: QUESTION });
    expect(run.modelBlocks.map((b) => b.title)).toEqual(['click x per image']);
    // The platform lists the click list as a field it could not read, which is what the model is asked to cover.
    expect(run.platformBlocks[0].skipped.map((c) => c.field)).toContain('clicks');
  });
});

test('a model copy keyed by URL and without raters is still recognised as a repeat', async () => {
  const runner = async (code, records) => runAnalysisUnsandboxed(code, records);
  const code = `function analyze(records, helpers) {
    var values = [], matches = [];
    records.forEach(function (r) { r.answer.trials.forEach(function (t) {
      var v = t.value;
      values.push({ item: 'https://media.sp-survey.org/x/' + v.imageA, value: v.ratingA });
      values.push({ item: 'https://media.sp-survey.org/x/' + v.imageB, value: v.ratingB });
      if (v.compare === 'a_safer') matches.push({ winner: 'https://m/x/' + v.imageA, loser: v.imageB, category: 'safe' });
      if (v.compare === 'b_safer') matches.push({ winner: v.imageB, loser: v.imageA });
    }); });
    return { blocks: [{ type: 'per_item', title: '评分', values: values, measure: 'number' }, { type: 'pairwise', title: '比较', matches: matches }] };
  }`;
  const run = await evaluateAnalysis(code, buildAnalysisRecords(ONE, QUESTION), runner, { pageHtml: PAGE_HTML, question: QUESTION });
  expect(run.modelBlocks).toEqual([]);
});

test('submitted (enriched) rows give the same platform analysis, and other questions become groups', () => {
  const stored = autoAnalysis(buildAnalysisRecords(ONE, QUESTION), { pageHtml: PAGE_HTML });
  const submitted = autoAnalysis(buildAnalysisRecords([submittedRow('p_1793174875557_43cxkusef', TRIALS, '二年级')], QUESTION), { pageHtml: PAGE_HTML });
  expect(submitted.coverage).toEqual(stored.coverage);
  expect(submitted.blocks.map((b) => b.title)).toEqual(stored.blocks.map((b) => b.title));
  // grade as its own question (not inside the trial objects): still found as a group.
  const noGrade = TRIALS.map(({ grade, ...rest }) => rest);
  const rows = [submittedRow('p1', noGrade, '二年级'), submittedRow('p2', noGrade, '五年级')];
  const records = buildAnalysisRecords(rows, QUESTION);
  expect(records[0].context).toMatchObject({ grade: '二年级', consent: true });
  const auto = autoAnalysis(records.map((r) => ({ ...r, answer: { trials: r.answer.trials.map((t) => ({ ...t, answer: { ...t.answer, grade: undefined } })) } })), { pageHtml: PAGE_HTML });
  expect(auto.blocks.some((b) => b.title === '按 grade 分组')).toBe(true);
});

test('a model choice block with the raw codes repeats the platform option counts', async () => {
  const runner = async (code, records) => runAnalysisUnsandboxed(code, records);
  const code = `function analyze(records) {
    var values = [];
    records.forEach(function (r) { r.answer.trials.forEach(function (t) { values.push(t.value.compare); }); });
    return { blocks: [{ type: 'choice', title: 'compare', values: values }] };
  }`;
  const run = await evaluateAnalysis(code, buildAnalysisRecords(ONE, QUESTION), runner, { pageHtml: PAGE_HTML, question: QUESTION });
  expect(run.modelBlocks).toEqual([]);
});

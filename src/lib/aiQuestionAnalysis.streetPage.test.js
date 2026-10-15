import fs from 'fs';
import path from 'path';
import {
  buildAnalysisRecords, generateQuestionAnalysis, mediaSummary, pageCodeExcerpt, runAnalysisUnsandboxed,
} from './aiQuestionAnalysis';

// A real converted page: 24 generated scenes S01..S24; the platform fills its
// PHOTO_URLS from the media library and scene i shows PHOTO_URLS[i]. Answers
// name scenes, never images.
const HTML = fs.readFileSync(path.join(__dirname, '__fixtures__/streetPerceptionSurvey.html'), 'utf8');
const LIBRARY = Array.from({ length: 40 }, (_, i) => ({ name: `street_${String(i + 1).padStart(3, '0')}.jpg`, url: `https://media.sp-survey.org/p/streets/street_${String(i + 1).padStart(3, '0')}.jpg`, folder: 'streets' }));
const POOL = [1, 2, 4, 5, 8, 9, 12, 13, 16, 20].map((i) => `S${String(i + 1).padStart(2, '0')}`);
const DIMS = ['safe', 'lively', 'beautiful', 'wealthy', 'boring', 'depressing'];
function row(p) {
  const pairs = Array.from({ length: 18 }, (_, t) => {
    const a = POOL[(t + p) % 10];
    const b = POOL[(t * 3 + p + 1) % 10];
    const better = POOL.indexOf(a) < POOL.indexOf(b);
    return { dim: DIMS[t % 6], left: a, right: b, choice: a === b ? 'E' : better ? 'L' : 'R', rt: 900 + t };
  }).filter((t) => t.left !== t.right);
  const state = { v: 1, done: true, pairs, flash: [0, 3, 7, 11, 15, 19].map((i, k) => ({ scene: `S${String(i + 1).padStart(2, '0')}`, rating: (k + p) % 7 + 1, rt: 500 })) };
  return {
    participant_id: `P${p}`,
    responses: { __sp_page_state: { 'sp-media:PHOTO_URLS': LIBRARY, 'streetscape-survey-v1': JSON.stringify(state), 'svp-theme': 'dark' } },
  };
}
const ROWS = Array.from({ length: 6 }, (_, i) => row(i + 1));
const QUESTION = { name: '__page__pairs', pageName: 'pairs', title: '两条街，选一条：哪条街道看起来更安全/有活力/美丽/富裕/无聊/压抑？', type: 'imagepicker', pageOnly: true };

// What the model should write once it sees the page code.
const CODE = `function analyze(records, helpers) {
  var matches = [];
  records.forEach(function (r) {
    var s = helpers.get(r, 'page_state.streetscape-survey-v1') || {};
    var photos = helpers.media(r);
    var img = function (id) { var n = parseInt(String(id).slice(1), 10) - 1; return photos[n] ? photos[n].name : id; };
    helpers.list(s.pairs).forEach(function (t) {
      if (t.choice !== 'L' && t.choice !== 'R') return;
      var w = t.choice === 'L' ? t.left : t.right, l = t.choice === 'L' ? t.right : t.left;
      matches.push({ winner: img(w), loser: img(l), category: t.dim });
    });
  });
  return { blocks: [{ type: 'pairwise', title: '成对比较（按维度）', matches: matches }] };
}`;

test('the page code excerpt shows how scenes take their pictures from the media list', () => {
  const excerpt = pageCodeExcerpt(HTML, ['PHOTO_URLS']);
  expect(excerpt).toMatch(/const PHOTO_URLS = \[\];/);
  expect(excerpt).toMatch(/id:'S'\+String\(i\+1\)/);
  expect(excerpt).toMatch(/const SCENES=Array\.from\(\{length:24\}/);
  expect(excerpt).toMatch(/PHOTO_URLS\.forEach\(\(u,i\)=>\{if\(SCENES\[i\]&&u\)SCENES\[i\]\.img=u\}\)/);
  expect(excerpt.length).toBeLessThan(5000);
});

test('the model is sent the excerpt, the media list size and the other fields', async () => {
  const records = buildAnalysisRecords(ROWS, QUESTION, { site: true });
  expect(mediaSummary(records)).toMatch(/helpers\.media\(r\); 40 images/);
  let sent;
  const result = await generateQuestionAnalysis({
    question: QUESTION, records, pageHtml: HTML,
    request: async (body) => { sent = body; return { code: CODE, model: 'm' }; },
    runner: async (code, recs) => runAnalysisUnsandboxed(code, recs),
  });
  expect(sent.pageCode).toMatch(/SCENES\[i\]\.img=u/);
  expect(result.ok).toBe(true);
  const [block] = result.blocks;
  // Items are media library images, split by dimension; only the 10 pool scenes are ever compared.
  expect(block.boards.map((b) => b.label).sort()).toEqual([...DIMS].sort());
  const items = new Set(block.boards.flatMap((b) => b.rankings.map((r) => r.imageKey)));
  expect([...items].every((k) => /^street_0\d\d\.jpg$/.test(k))).toBe(true);
  expect(items.size).toBe(10);
  expect(items.has('street_002.jpg')).toBe(true); // S02 = PHOTO_URLS[1]
});

import { applyConversion, candidateHosts, convertSurveyHtml, isolateAdapter, restoreDataUris, tokenizeDataUris } from './spSchemeConvert';
import { extractEmbeddedScheme } from './spSite';
import { LEGACY_SURVEY_CONVERSION, LEGACY_SURVEY_HTML } from './__fixtures__/legacySurvey';

test('long data URIs are swapped for tokens and restored', () => {
  const uri = `data:image/png;base64,${'A'.repeat(400)}`;
  const { html, tokens } = tokenizeDataUris(`<img src="${uri}"><img src="data:image/png;base64,AAAA">`);
  expect(html).toContain('data:sp-token/0');
  expect(html).toContain('base64,AAAA');
  expect(restoreDataUris(html, tokens)).toContain(uri);
});

test('applies patches, embeds the questions and the adapter', () => {
  const out = applyConversion(LEGACY_SURVEY_HTML, LEGACY_SURVEY_CONVERSION);
  expect(out.problems).toEqual([]);
  expect(out.html).toContain('Street study (SP-Survey)');
  expect(out.html).toMatch(/<script data-sp-adapter>[\s\S]*SPSite\.onSubmit[\s\S]*<\/script>\s*<\/body>/);
  expect(extractEmbeddedScheme(out.html).survey.pages[0].elements[0].name).toBe('safety');
});

test('reports patches that do not match', () => {
  const out = applyConversion(LEGACY_SURVEY_HTML, { ...LEGACY_SURVEY_CONVERSION, replacements: [{ find: 'nope', replace: 'x' }] });
  expect(out.problems[0]).toMatch(/not found/);
});

test('hosts the page loads from are needed; result endpoints are not', () => {
  const hosts = candidateHosts(LEGACY_SURVEY_HTML, LEGACY_SURVEY_CONVERSION);
  const byHost = Object.fromEntries(hosts.map((h) => [h.host, h.needed]));
  expect(byHost['cdn.legacy-lab.org']).toBe(true);
  expect(byHost['api.legacy-lab.org']).toBe(false);
});

test('the model gets one pass: what it gets wrong is not sent back for fixing', async () => {
  const broken = { ...LEGACY_SURVEY_CONVERSION, adapterScript: 'SPSite.onReady(function () {});' };
  const request = jest.fn()
    .mockResolvedValueOnce({ result: broken, model: 'm' })
    .mockResolvedValueOnce({ result: LEGACY_SURVEY_CONVERSION, model: 'm' });
  const out = await convertSurveyHtml(LEGACY_SURVEY_HTML, { request });
  expect(request).toHaveBeenCalledTimes(1);
  expect(out.rounds).toBe(1);
  expect(request.mock.calls[0][0].reference).toContain('SPSite');
});

test('the adapter runs in its own scope and is followed by a check that reports when it stopped early', () => {
  const out = applyConversion(LEGACY_SURVEY_HTML, LEGACY_SURVEY_CONVERSION);
  expect(out.html).toMatch(/<script data-sp-adapter>\n\(function \(\) \{\n/);
  expect(out.html).toMatch(/window\.__spAdapterRan = true;\n\}\)\.call\(window\);\n<\/script>\n<script data-sp-adapter-check>/);
});

test('adapter names the page also declares do not collide; names the replaced page code calls stay global', () => {
  const page = '<script>let imageReady = false; function show() {}</script>';
  const wrapped = isolateAdapter('let imageReady = true;\nfunction spImageUrl(q) { return q; }\nfunction show() {}', [{ find: 'x', replace: 'img.src = spImageUrl(q); show();' }], page);
  expect(wrapped.startsWith('(function () {')).toBe(true);
  expect(wrapped).toContain('window.spImageUrl = spImageUrl');
  expect(wrapped).not.toContain('window.show');
  expect(wrapped).not.toContain('window.imageReady');
});

test('when the declared questions cannot be used, the page is offered as it is (raw records)', async () => {
  const broken = { ...LEGACY_SURVEY_CONVERSION, adapterScript: '' };
  const request = jest.fn(async () => ({ success: true, result: broken }));
  const out = await convertSurveyHtml(LEGACY_SURVEY_HTML, { request });
  expect(out.ok).toBe(false);
  expect(out.raw).toBeTruthy();
  expect(out.raw.pkg.survey.pages).toEqual([]);
  expect(out.raw.report.ok).toBe(true);
  expect(out.raw.report.summary.match).toBe('none');
  expect(out.raw.html).toContain('id="sp-scheme"');
  expect(out.raw.html).not.toContain('data-sp-adapter');
});

test('the raw page keeps an adapter that still runs, so the page\'s own server requests stay answered', async () => {
  const bad = JSON.parse(JSON.stringify(LEGACY_SURVEY_CONVERSION));
  bad.survey.pages[0].elements.push({ type: 'text', name: 'safety' }); // duplicate name: not a per-question problem
  const request = jest.fn(async () => ({ success: true, result: bad }));
  const out = await convertSurveyHtml(LEGACY_SURVEY_HTML, { request });
  expect(out.ok).toBe(false);
  expect(out.raw.pkg.survey.pages).toEqual([]);
  expect(out.raw.html).toContain('data-sp-adapter');
});

test('the media library mirrors the zip folders and the page may draw from all of them', () => {
  const files = [{ path: 'img/1.jpg', bytes: new Uint8Array([1]) }, { path: 'app/logo.png', bytes: new Uint8Array([1]) }];
  const declared = applyConversion('<html><head></head><body></body></html>', { survey: { pages: [], mediaFolders: ['img'] }, adapterScript: '', replacements: [], mediaGroups: [{ folder: 'task_a', files: ['img/1.jpg'] }] }, [], { mediaFiles: files, mediaBase: 'sp-scheme/study' });
  expect(declared.problems).toEqual([]);
  expect(declared.pkg.survey.mediaFolders).toEqual(['sp-scheme/study/img']);
  expect([...declared.mediaPlan.folders.keys()].sort()).toEqual(['app', 'img']);
  const implicit = applyConversion('<html><head></head><body></body></html>', { survey: { pages: [] }, adapterScript: '', replacements: [] }, [], { mediaFiles: files, mediaBase: 'sp-scheme/study' });
  expect(implicit.pkg.survey.mediaFolders.sort()).toEqual(['sp-scheme/study/app', 'sp-scheme/study/img']);
});

test('questions the checks reject are recorded as custom instead of failing the conversion', async () => {
  const bad = JSON.parse(JSON.stringify(LEGACY_SURVEY_CONVERSION));
  bad.survey.pages[0].elements.push({ type: 'imagepicker', name: 'single', title: 'One image', imageCount: 1 });
  const request = jest.fn(async () => ({ success: true, result: bad }));
  const out = await convertSurveyHtml(LEGACY_SURVEY_HTML, { request });
  expect(out.ok).toBe(true);
  expect(out.degraded).toEqual([{ name: 'single', reason: expect.stringMatching(/imagerating with imageCount 1/) }]);
  const single = out.pkg.survey.pages[0].elements.find((el) => el.name === 'single');
  expect(single).toEqual({ type: 'custom', name: 'single', title: 'One image' });
  expect(out.report.summary.match).toBe('partial');
});

test('when the model call fails, the page is imported as it is instead of failing', async () => {
  const request = jest.fn(async () => ({ success: false, error: 'The model did not return a usable conversion.' }));
  const out = await convertSurveyHtml(LEGACY_SURVEY_HTML, { request });
  expect(request).toHaveBeenCalledTimes(1);
  expect(out.ok).toBe(false);
  expect(out.failure).toMatch(/usable conversion/);
  expect(out.raw.pkg.survey.pages).toEqual([]);
  expect(out.raw.report.ok).toBe(true);
});

test('the study\'s data files travel with the page; server code does not', () => {
  const out = applyConversion('<html><head></head><body></body></html>', { survey: { pages: [] }, adapterScript: 'var c = SPSite.getData("config.json");', replacements: [] }, [], {
    dataFiles: [{ name: 'app/config.json', text: '{"tasks":[]}' }, { name: 'app/server.py', text: 'secret = 1' }],
  });
  expect(out.html).toContain('<script type="application/json" id="sp-data">');
  expect(out.html).toContain('app/config.json');
  expect(out.html).not.toContain('server.py');
});

test('the questions the model saw are kept for display when the page is imported as it is', () => {
  const { modelQuestionList } = require('./spSchemeConvert');
  expect(modelQuestionList({ pages: [{ elements: [
    { type: 'html', name: 'intro' },
    { type: 'radiogroup', name: 'safe', title: { zh: '安全吗', en: 'Safe?' } },
    { type: 'custom', name: 'pairs', title: 'Pairwise' },
  ] }] })).toEqual([
    { name: 'safe', title: '安全吗', type: 'radiogroup' },
    { name: 'pairs', title: 'Pairwise', type: 'custom' },
  ]);
  expect(modelQuestionList(null)).toEqual([]);
});

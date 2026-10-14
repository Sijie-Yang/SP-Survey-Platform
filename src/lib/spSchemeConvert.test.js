import { applyConversion, candidateHosts, convertSurveyHtml, restoreDataUris, tokenizeDataUris } from './spSchemeConvert';
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

test('retries with the validation errors until the page passes', async () => {
  const broken = { ...LEGACY_SURVEY_CONVERSION, adapterScript: 'SPSite.onReady(function () {});' };
  const request = jest.fn()
    .mockResolvedValueOnce({ result: broken, model: 'm' })
    .mockResolvedValueOnce({ result: LEGACY_SURVEY_CONVERSION, model: 'm' });
  const out = await convertSurveyHtml(LEGACY_SURVEY_HTML, { request });
  expect(out.ok).toBe(true);
  expect(out.rounds).toBe(2);
  expect(request.mock.calls[1][0].feedback.join(' ')).toMatch(/SPSite\.answer/);
  expect(request.mock.calls[1][0].previous).toBe(broken);
  expect(request.mock.calls[0][0].reference).toContain('SPSite');
});

test('a page that fails when it loads goes back to the model', async () => {
  const request = jest.fn(async () => ({ success: true, result: LEGACY_SURVEY_CONVERSION }));
  const smokeTest = jest.fn()
    .mockResolvedValueOnce({ ran: true, problems: ['GET /api/state was still waiting after 9 s'] })
    .mockResolvedValueOnce({ ran: true, problems: [] });
  const out = await convertSurveyHtml(LEGACY_SURVEY_HTML, { request, smokeTest });
  expect(out.ok).toBe(true);
  expect(out.rounds).toBe(2);
  expect(request.mock.calls[1][0].feedback).toEqual(['When the page loads: GET /api/state was still waiting after 9 s']);
  expect(smokeTest.mock.calls[0][1].questions.map((q) => q.name)).toContain('safety');
});

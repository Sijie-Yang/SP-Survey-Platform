import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { handleSpSchemeConvert, normalizeConvertResult } from './spSchemeConvert.mjs';

const settings = async () => ({ assistant_provider: 'deepseek', assistant_model: 'deepseek-v4-pro' });

describe('SP-Scheme page conversion', () => {
  it('keeps only well-formed fields from the model', () => {
    const out = normalizeConvertResult({
      survey: { pages: [{ elements: [{ type: 'rating', name: 'q1' }] }] },
      adapterScript: 'SPSite.onReady(function(){})',
      replacements: [{ find: 'a', replace: 'b' }, { find: '', replace: 'x' }, 'junk'],
      externalHosts: ['api.example.com', { host: 'cdn.example.org', why: 'styles' }, 3],
      originalImages: ['https://x.org/1.jpg'],
      notes: ['ok', 5],
    });
    assert.equal(out.replacements.length, 1);
    assert.deepEqual(out.externalHosts.map((h) => h.host), ['api.example.com', 'cdn.example.org']);
    assert.equal(out.originalImages[0].url, 'https://x.org/1.jpg');
    assert.deepEqual(out.notes, ['ok']);
    assert.equal(normalizeConvertResult({ survey: {} }), null);
  });

  it('does not call the model without a usable route', async () => {
    const chat = mock.fn(async () => ({ content: '{}' }));
    await assert.rejects(
      () => handleSpSchemeConvert({}, 'user', { html: '<html></html>' }, {
        loadUserAiSettings: settings,
        listProviderProfiles: async () => [],
        resolveAssistantBinding: async () => ({ credential: null }),
        chatCompletions: chat,
      }),
      (error) => error.code === 'CREDENTIALS_MISSING',
    );
    assert.equal(chat.mock.calls.length, 0);
  });

  it('rejects empty pages and keys in the body', async () => {
    await assert.rejects(() => handleSpSchemeConvert({}, 'user', { html: ' ' }), (e) => e.code === 'NOTHING_TO_CONVERT');
    await assert.rejects(() => handleSpSchemeConvert({}, 'user', { html: '<p>', apiKey: 'sk' }), (e) => e.status === 400);
  });

  it('sends the page, reference and feedback and parses fenced JSON', async () => {
    const chat = mock.fn(async () => ({
      content: '```json\n{"survey":{"pages":[{"elements":[{"type":"text","name":"age"}]}]},"adapterScript":"x"}\n```',
    }));
    const res = await handleSpSchemeConvert({}, 'user', {
      html: '<form id="f"></form>',
      reference: 'REF',
      feedback: ['age is missing'],
      previous: { survey: { pages: [] } },
    }, {
      loadUserAiSettings: settings,
      listProviderProfiles: async () => [],
      resolveAssistantBinding: async () => ({ credential: { apiKey: 'k' } }),
      chatCompletions: chat,
    });
    assert.equal(res.result.survey.pages[0].elements[0].name, 'age');
    const user = chat.mock.calls[0].arguments[0].messages[1].content;
    assert.match(user, /REFERENCE \(SP-Scheme\)\nREF/);
    assert.match(user, /<form id="f"><\/form>/);
    assert.match(user, /FEEDBACK\n- age is missing/);
  });
});

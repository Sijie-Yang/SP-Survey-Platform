import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildExampleSite } from '../../src/lib/spScheme.js';
import {
  checkGeneratedPage,
  extractHtml,
  extractReply,
  handleSpSchemeGenerate,
  normalizeGenerateRequest,
} from './spSchemeGenerate.mjs';

const GOOD = buildExampleSite().trim();
const PLAIN = '<!doctype html><html><head><title>x</title></head><body><p>Hello</p></body></html>';

function deps({ answers, settings = {}, ownKey = false, subsidyRoutes = [{ provider: 'deepseek', model: 'deepseek-flash' }] }) {
  const calls = [];
  return {
    calls,
    deps: {
      credentials: {
        loadUserAiSettings: async () => settings,
        listProviderProfiles: async () => [],
        resolveAssistantBinding: async (_env, _user, provider, model) => {
          if (ownKey && provider === settings.assistant_provider) {
            return { source: 'user', credential: { apiKey: 'sk-own' }, profile: {} };
          }
          if (subsidyRoutes.some((r) => r.provider === provider && r.model === model)) {
            return { source: 'subsidy', credential: { apiKey: 'sk-shared' }, profile: {} };
          }
          throw Object.assign(new Error('missing'), { code: 'CREDENTIALS_MISSING' });
        },
      },
      subsidy: {
        loadActiveSubsidy: async () => (subsidyRoutes.length ? { allowed_routes: subsidyRoutes } : null),
        normalizeSubsidyRoutes: (routes) => routes || [],
      },
      chatCompletions: async (options) => {
        calls.push(options);
        const next = answers[Math.min(calls.length - 1, answers.length - 1)];
        return { content: next };
      },
    },
  };
}

describe('built-in SP-Scheme AI', () => {
  it('pulls the page out of a fenced answer', () => {
    assert.equal(extractHtml(`Here you go:\n\`\`\`html\n${PLAIN}\n\`\`\`\nDone.`), PLAIN);
    assert.equal(extractHtml(`sure ${PLAIN} trailing`), PLAIN);
    assert.equal(extractHtml('no page here'), '');
  });

  it('checks pages with the Studio import check', () => {
    const good = checkGeneratedPage(GOOD);
    assert.equal(good.ok, true);
    assert.equal(good.asIs, false);
    assert.equal(checkGeneratedPage(PLAIN).asIs, true);
  });

  it('rejects an empty request', () => {
    assert.throws(() => normalizeGenerateRequest({ request: '  ' }), /Describe/);
  });

  it('sends problems back and returns the repaired page on the shared model', async () => {
    const { deps: d, calls } = deps({ answers: [`\`\`\`html\n${PLAIN}\n\`\`\``, `\`\`\`html\n${GOOD}\n\`\`\``] });
    const out = await handleSpSchemeGenerate({}, 'user-1', { request: 'Rate street safety' }, d);
    assert.equal(out.rounds, 2);
    assert.equal(out.shared, true);
    assert.equal(out.model, 'deepseek-flash');
    assert.equal(out.check.ok, true);
    assert.equal(out.check.asIs, false);
    assert.equal(out.html, GOOD);
    assert.equal(calls[1].messages.at(-1).role, 'user');
    assert.match(calls[1].messages.at(-1).content, /found these problems/);
    assert.match(calls[0].messages[0].content, /SP-Scheme/);
  });

  it('stops after the repair rounds and keeps the best page with its problems', async () => {
    const { deps: d, calls } = deps({ answers: [`\`\`\`html\n${PLAIN}\n\`\`\``] });
    const out = await handleSpSchemeGenerate({}, 'user-1', { request: 'x' }, d);
    assert.equal(calls.length, 3);
    assert.equal(out.check.asIs, true);
    assert.ok(out.check.problems.length > 0);
  });

  it('edits the current page when one is given', async () => {
    const { deps: d, calls } = deps({ answers: [`\`\`\`html\n${GOOD}\n\`\`\``] });
    await handleSpSchemeGenerate({}, 'user-1', { request: 'Make the button green', currentHtml: GOOD }, d);
    assert.equal(calls.length, 1);
    assert.match(calls[0].messages[1].content, /current index\.html/);
    assert.match(calls[0].messages[1].content, /Make the button green/);
  });

  it('keeps the short note before the page as the reply', () => {
    assert.equal(extractReply(`Added an age question.\n\`\`\`html\n${PLAIN}\n\`\`\``), 'Added an age question.');
    assert.equal(extractReply(PLAIN), '');
  });

  it('sends earlier turns as text and answers a question without a new page', async () => {
    const { deps: d, calls } = deps({ answers: ['It has 3 questions.'] });
    const out = await handleSpSchemeGenerate({}, 'user-1', {
      request: 'How many questions are there?',
      currentHtml: GOOD,
      history: [
        { role: 'user', text: 'Make a cycling study' },
        { role: 'assistant', text: 'Made it.' },
        { role: 'system', text: 'ignored' },
      ],
    }, d);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].messages.slice(1, 3), [
      { role: 'user', content: 'Make a cycling study' },
      { role: 'assistant', content: 'Made it.' },
    ]);
    assert.equal(calls[0].messages.length, 4);
    assert.equal(out.html, '');
    assert.equal(out.reply, 'It has 3 questions.');
    assert.equal(out.check, null);
  });

  it('prefers the researcher\'s own model and fails plainly when no model exists', async () => {
    const own = deps({
      answers: [`\`\`\`html\n${GOOD}\n\`\`\``],
      settings: { assistant_provider: 'deepseek', assistant_model: 'deepseek-v4-pro' },
      ownKey: true,
    });
    const out = await handleSpSchemeGenerate({}, 'user-1', { request: 'x' }, own.deps);
    assert.equal(out.shared, false);
    assert.equal(own.calls[0].apiKey, 'sk-own');

    const none = deps({ answers: [''], subsidyRoutes: [] });
    await assert.rejects(handleSpSchemeGenerate({}, 'user-1', { request: 'x' }, none.deps), (e) => e.code === 'CREDENTIALS_MISSING');
  });
});

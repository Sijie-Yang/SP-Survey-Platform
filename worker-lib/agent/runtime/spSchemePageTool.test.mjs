import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildExampleSite } from '../../../src/lib/spScheme.js';
import { getAssistantModePolicy, normalizeAssistantMode } from './modes.mjs';
import { nextRequiredTool } from './loop.mjs';
import { createSpSchemePageTool } from './spSchemePageTool.mjs';

const GOOD = buildExampleSite().trim();
const PLAIN = '<!doctype html><html><body><p>Hello</p></body></html>';
const ROUTE = { apiKey: 'sk', provider: 'deepseek', baseUrl: 'https://x', model: 'deepseek-flash', modelRecord: {} };

function setup({ answers, html = '', media = [] }) {
  const saved = [];
  const asked = [];
  const tool = createSpSchemePageTool({
    env: {},
    accessToken: 'token',
    userId: 'u1',
    getProjectId: () => 'proj_1',
    request: null,
    route: ROUTE,
    chat: async (options) => {
      asked.push(options);
      return { content: answers.length > 1 ? answers.shift() : answers[0] };
    },
    io: {
      loadOwned: async () => ({ user_id: 'u1', draft_updated_at: '2026-11-25T00:00:00Z', survey_config_draft: html ? { spSite: { html } } : {}, preloaded_images: media }),
      importSpScheme: async (_env, ctx, args) => {
        saved.push({ ctx, args });
        return { imported: true, draftUpdatedAt: '2026-11-25T00:01:00Z', summary: {} };
      },
      getDraft: async () => ({ draftUpdatedAt: '2026-11-25T00:01:00Z', surveyConfig: { title: 'x', spSite: { note: 'page' } } }),
    },
  });
  return { tool, saved, asked };
}

describe('SP-Scheme assistant mode', () => {
  it('is a write mode of its own', () => {
    assert.equal(normalizeAssistantMode('spscheme'), 'spscheme');
    const policy = getAssistantModePolicy('spscheme', { goalRequiresDraftChange: true });
    assert.equal(policy.readOnly, false);
    assert.equal(policy.requireDraftChange, true);
    assert.match(policy.systemPrompt, /sp_scheme_write_page/);
  });

  it('does not force survey_capabilities when capabilities are not required', () => {
    assert.equal(nextRequiredTool({ requireDraftChange: true, latestDraft: null, loadedCapabilities: true, loadedDraft: true, lastRetryAction: '' }), '');
  });

  it('saves a page that passes the check, with the draft stamp it read', async () => {
    const { tool, saved } = setup({ answers: [`Changed the title.\n\`\`\`html\n${GOOD}\n\`\`\``], html: GOOD });
    const out = await tool.execute({ request: 'Change the title' });
    assert.equal(out.saved, true);
    assert.equal(out.note, 'Changed the title.');
    assert.equal(out.changed, 'page_changed');
    assert.equal(out.draftUpdatedAt, '2026-11-25T00:01:00Z');
    assert.ok(out.surveyConfig);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].args.projectId, 'proj_1');
    assert.equal(saved[0].args.html, GOOD);
    assert.equal(saved[0].args.expectedDraftUpdatedAt, '2026-11-25T00:00:00Z');
    assert.equal(saved[0].ctx.accessToken, 'token');
  });

  it('saves nothing when the page still fails after the repair rounds', async () => {
    const { tool, saved } = setup({ answers: [`\`\`\`html\n${PLAIN}\n\`\`\``] });
    const out = await tool.execute({ request: 'Make a study' });
    assert.equal(out.saved, false);
    assert.equal(out.code, 'SP_SCHEME_PAGE_PROBLEMS');
    assert.ok(out.problems.length > 0);
    assert.equal(out.surveyConfig, undefined);
    assert.equal(saved.length, 0);
  });

  it('shows the page writer the study media library and passes on what the page still lacks', async () => {
    const media = [{ url: 'https://media.test/u1/proj_1/streets/a__236a3465-ef58-4c35-9ee7-7e1a3a4fc833.jpg', key: 'u1/proj_1/streets/a__236a3465-ef58-4c35-9ee7-7e1a3a4fc833.jpg', name: 'a__236a3465-ef58-4c35-9ee7-7e1a3a4fc833.jpg' }];
    const misfit = GOOD.replace('</body>', "<script>var extra = SPSite.getMedia('photos');</script></body>");
    const { tool, saved, asked } = setup({ answers: [`Done.\n\`\`\`html\n${misfit}\n\`\`\``], html: GOOD, media });
    const out = await tool.execute({ request: 'Fit the page to my images' });
    assert.match(asked[0].messages[1].content, /folder "streets", 1 image: a\.jpg/);
    assert.equal(out.saved, true);
    assert.equal(saved.length, 1);
    assert.equal(out.mediaNotes.length, 1);
    assert.match(out.mediaNotes[0], /"photos"/);
  });

  it('asks for a request', async () => {
    const { tool } = setup({ answers: [''] });
    await assert.rejects(tool.execute({ request: ' ' }), /request is required/);
  });
});

describe('switching mode in one conversation', () => {
  it('tells the model when the researcher switched mode since the last message', async () => {
    const { previousMessageMode, modeSwitchNote } = await import('./modes.mjs');
    const events = [
      { type: 'user.message', run_id: 'r1', payload: { assistantMode: 'spscheme' } },
      { type: 'run.status', run_id: 'r1', payload: { assistantMode: 'spscheme' } },
      { type: 'user.message', run_id: 'r2', payload: { assistantMode: 'agent' } },
    ];
    assert.equal(previousMessageMode(events, 'r2'), 'spscheme');
    assert.equal(previousMessageMode(events.slice(0, 2), 'r2'), 'spscheme');
    assert.equal(previousMessageMode([], 'r1'), '');
    assert.match(modeSwitchNote('spscheme', 'agent'), /switched this conversation to Classic mode/);
    assert.match(modeSwitchNote('agent', 'spscheme'), /switched this conversation to SP-Scheme mode/);
    assert.equal(modeSwitchNote('spscheme', 'spscheme'), '');
    assert.equal(modeSwitchNote('', 'agent'), '');
  });
});

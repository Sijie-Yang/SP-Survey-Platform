import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportResponses } from './resultsHandlers.mjs';
import { syntheticResponses, syntheticSurveyConfig } from '../../src/lib/__fixtures__/syntheticResults.js';

const PROJECT_ID = '11111111-2222-4333-8444-555555555555';

function stubFetch({ project, responses }) {
  const original = globalThis.fetch;
  let served = false;
  globalThis.fetch = async (url) => {
    const u = String(url);
    let body = [];
    if (u.includes('/rest/v1/projects')) body = [project];
    else if (u.includes('/rest/v1/survey_responses') || u.includes('/rest/v1/responses')) {
      body = served ? [] : responses;
      served = true;
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return () => { globalThis.fetch = original; };
}

describe('dataset_package export (Agent API / MCP / Python SDK)', () => {
  it('returns the same citable package files as the Results page', async () => {
    const config = syntheticSurveyConfig({ images: 6 });
    const responses = syntheticResponses(12, { config }).map((r, i) => ({ ...r, id: `r${i}`, project_id: PROJECT_ID, created_at: new Date(Date.UTC(2026, 8, 1, i)).toISOString() }));
    const project = {
      id: PROJECT_ID,
      name: 'Street study',
      user_id: 'u1',
      survey_config: config,
      metadata: { datasetRelease: { title: 'Street perception 2026', license: 'CC0-1.0', authors: [{ name: 'Sijie Yang' }], doi: '10.5281/zenodo.42' } },
    };
    const restore = stubFetch({ project, responses });
    try {
      const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'k', SUPABASE_ANON_KEY: 'a' };
      const result = await exportResponses(env, { userId: 'u1', serviceRole: true }, PROJECT_ID, { format: 'dataset_package' });
      assert.match(result.datasetPackage.folder, /^street-perception-2026_v1\.0_/);
      const paths = result.datasetPackage.files.map((f) => f.path);
      for (const p of ['README.md', 'LICENSE', 'CITATION.cff', 'datapackage.json', 'stimuli/manifest.csv', 'survey/survey.json', 'data/responses_wide.csv', 'data/references.bib']) {
        assert.ok(paths.includes(p), `missing ${p}`);
      }
      const cff = result.datasetPackage.files.find((f) => f.path === 'CITATION.cff').content;
      assert.match(cff, /10\.5281\/zenodo\.42/);
      const wide = result.datasetPackage.files.find((f) => f.path === 'data/responses_wide.csv').content;
      assert.match(wide, /P0001/);
    } finally {
      restore();
    }
  });
});

describe('MCP tools used by the Python SDK', () => {
  it('lists the read-only silicon tools and the dataset_package format', async () => {
    const { handleMcpRequest } = await import('../mcp/server.mjs');
    const req = new Request('https://sp-survey.org/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    const res = await handleMcpRequest(req, {}, { kind: 'mcp', userId: 'u1', scopes: [] });
    const { result } = await res.json();
    const names = result.tools.map((t) => t.name);
    assert.ok(names.includes('silicon_list_runs'));
    assert.ok(names.includes('silicon_run_responses'));
    const exp = result.tools.find((t) => t.name === 'survey_export_responses');
    assert.ok(exp.inputSchema.properties.format.enum.includes('dataset_package'));
  });

  it('silicon tools need the results:read scope', async () => {
    const { handleMcpRequest } = await import('../mcp/server.mjs');
    const req = new Request('https://sp-survey.org/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'silicon_list_runs', arguments: { projectId: PROJECT_ID } } }) });
    const res = await handleMcpRequest(req, {}, { kind: 'mcp', userId: 'u1', scopes: ['surveys:read'] });
    const { result } = await res.json();
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /results:read/);
  });
});

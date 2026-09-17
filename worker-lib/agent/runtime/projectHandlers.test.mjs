import assert from 'node:assert/strict';
import test from 'node:test';
import { saveDraft } from '../projectHandlers.mjs';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('fails closed when save_project_draft is missing or still uses gen_random_bytes', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    if (requests.length === 1) {
      return response([{
        id: 'project-1',
        user_id: 'user-1',
        name: 'Survey',
        survey_config_draft: {
          title: 'Survey',
          pages: [{ name: 'page1', elements: [] }],
        },
        draft_updated_at: '2026-09-15T00:00:00.000Z',
      }]);
    }
    if (requests.length === 2) {
      return response({
        message: 'function gen_random_bytes(integer) does not exist',
      }, 400);
    }
    return response([{ id: 'project-1' }]);
  };
  try {
    await saveDraft(
      {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'anon',
      },
      'user-jwt',
      'project-1',
      {
        expectedDraftUpdatedAt: '2026-09-15T00:00:00.000Z',
        surveyConfig: {
          title: 'Updated',
          pages: [{ name: 'page1', elements: [] }],
        },
      },
      'assistant',
    );
    assert.fail('saveDraft must not silently PATCH when the RPC is stale');
  } catch (error) {
    assert.equal(error.code, 'DRAFT_SAVE_RPC_MISSING');
    assert.equal(error.status, 503);
    assert.match(requests[1].url, /rpc\/save_project_draft/);
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

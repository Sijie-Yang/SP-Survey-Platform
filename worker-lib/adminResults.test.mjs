import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { handleAdminResultsRoutes } from './adminResults.mjs';

const env = { SUPABASE_URL: 'https://database.example', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-server' };
const request = (query = '?project=project-a', method = 'GET', authenticated = true) => new Request(`https://app.example/api/admin/project-responses${query}`, {
  method, headers: authenticated ? { Authorization: 'Bearer test-user' } : {},
});
function mockDatabase(t, { admin = true, project = true, failAdmin = false, failResponses = false, validUser = true } = {}) {
  return t.mock.method(globalThis, 'fetch', async (url) => {
    const path = new URL(url).pathname;
    if (path === '/auth/v1/user') return Response.json(validUser ? { id: 'admin-user' } : {}, { status: validUser ? 200 : 401 });
    if (path === '/rest/v1/admins') return Response.json(failAdmin ? { message: 'private database failure' } : admin ? [{ user_id: 'admin-user' }] : [], { status: failAdmin ? 500 : 200 });
    if (path === '/rest/v1/projects') return Response.json(project ? [{ id: 'project-a' }] : []);
    if (path === '/rest/v1/survey_responses') {
      if (failResponses) return Response.json({ message: 'secret row body' }, { status: 500 });
      const select = new URL(url).searchParams.get('select') || '';
      if (select === 'id,created_at,project_id') {
        return Response.json([{ id: 'response-a', created_at: '2026-01-01T00:00:00Z', project_id: 'project-a' }]);
      }
      return Response.json([{ id: 'response-a', project_id: 'project-a', responses: { q: 1 } }]);
    }
    throw new Error(`Unexpected path ${path}`);
  });
}

test('anonymous and invalid sessions cannot read responses', async (t) => {
  const db = mockDatabase(t, { validUser: false });
  assert.equal((await handleAdminResultsRoutes(request('', 'GET', false), env)).status, 401);
  assert.equal(db.mock.calls.length, 0);
  assert.equal((await handleAdminResultsRoutes(request(), env)).status, 401);
  assert.equal(db.mock.calls.length, 1);
});

test('a non-admin session is denied before projects or responses are queried', async (t) => {
  const db = mockDatabase(t, { admin: false });
  assert.equal((await handleAdminResultsRoutes(request(), env)).status, 403);
  assert.equal(db.mock.calls.length, 2);
});

test('admin lookup failures fail closed and do not expose database errors', async (t) => {
  const db = mockDatabase(t, { failAdmin: true });
  const result = await handleAdminResultsRoutes(request(), env);
  const body = await result.json();
  assert.equal(result.status, 500);
  assert.equal(body.stage, 'admin');
  assert.equal(body.code, 'ADMIN_RESULTS_ADMIN_QUERY');
  assert.match(body.requestId, /./);
  assert.doesNotMatch(JSON.stringify(body), /private database failure|test-server|Bearer|eyJ/);
  assert.equal(db.mock.calls.length, 2);
});

test('admin access is scoped to the requested project and bounded page', async (t) => {
  const db = mockDatabase(t);
  const result = await handleAdminResultsRoutes(request('?project=project-a&offset=1000'), env);
  assert.equal(result.status, 200);
  assert.match(result.headers.get('cache-control') || '', /no-store/);
  assert.equal((await result.json()).responses.length, 1);
  const responseUrls = db.mock.calls
    .map((call) => new URL(call.arguments[0]))
    .filter((url) => url.pathname === '/rest/v1/survey_responses');
  assert.equal(responseUrls[0].searchParams.get('project_id'), 'eq.project-a');
  assert.equal(responseUrls[0].searchParams.get('select'), 'id,created_at,project_id');
  assert.equal(responseUrls[0].searchParams.get('limit'), '40');
  assert.equal(responseUrls[0].searchParams.get('offset'), '1000');
  assert.equal(responseUrls[0].searchParams.get('order'), 'created_at.desc.nullslast,id.desc');
  assert.ok(responseUrls.some((url) => url.searchParams.get('select') === '*'));
});

test('missing projects produce a clear not-found result', async (t) => {
  const db = mockDatabase(t, { project: false });
  const result = await handleAdminResultsRoutes(request(), env);
  const body = await result.json();
  assert.equal(result.status, 404);
  assert.equal(body.stage, 'project');
  assert.match(body.requestId, /./);
  assert.equal(db.mock.calls.length, 3);
});

test('invalid paging and missing project cannot trigger a response query', async (t) => {
  const db = mockDatabase(t);
  for (const query of ['', '?project=p&offset=-1', '?project=p&offset=1.5', '?project=p&offset=Infinity', '?project=p&offset=1000001']) {
    assert.equal((await handleAdminResultsRoutes(request(query), env)).status, 400);
  }
  assert.ok(db.mock.calls.every(c => !String(c.arguments[0]).includes('/survey_responses')));
});

test('the endpoint offers no mutation operation', async (t) => {
  const db = mockDatabase(t);
  for (const method of ['POST', 'DELETE', 'PATCH']) {
    assert.equal((await handleAdminResultsRoutes(request('', method), env)).status, 405);
  }
  assert.equal(db.mock.calls.length, 0);
});

test('response query failures keep a stage and request id without leaking row bodies', async (t) => {
  mockDatabase(t, { failResponses: true });
  const result = await handleAdminResultsRoutes(request(), env);
  const body = await result.json();
  assert.equal(result.status, 500);
  assert.equal(body.stage, 'responses');
  assert.equal(body.code, 'ADMIN_RESULTS_RESPONSE_QUERY');
  assert.match(body.requestId, /./);
  assert.doesNotMatch(JSON.stringify(body), /secret row body/);
});

test('unrelated routes remain available to other handlers', async () => {
  assert.equal(await handleAdminResultsRoutes(new Request('https://app.example/api/other'), env), null);
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { handleAdminResultsRoutes } from './adminResults.mjs';

const env = { SUPABASE_URL: 'https://database.example', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-server' };
const request = (query = '?project=project-a', method = 'GET', authenticated = true) => new Request(`https://app.example/api/admin/project-responses${query}`, {
  method, headers: authenticated ? { Authorization: 'Bearer test-user' } : {},
});
function mockDatabase(t, { admin = true, project = true, failAdmin = false, validUser = true } = {}) {
  return t.mock.method(globalThis, 'fetch', async (url) => {
    const path = new URL(url).pathname;
    if (path === '/auth/v1/user') return Response.json(validUser ? { id: 'admin-user' } : {}, { status: validUser ? 200 : 401 });
    if (path === '/rest/v1/admins') return Response.json(failAdmin ? { message: 'private database failure' } : admin ? [{ user_id: 'admin-user' }] : [], { status: failAdmin ? 500 : 200 });
    if (path === '/rest/v1/projects') return Response.json(project ? [{ id: 'project-a' }] : []);
    if (path === '/rest/v1/survey_responses') return Response.json([{ id: 'response-a', project_id: 'project-a' }]);
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
  assert.equal(result.status, 500);
  assert.doesNotMatch(await result.text(), /private database failure|test-server/);
  assert.equal(db.mock.calls.length, 2);
});

test('admin access is scoped to the requested project and bounded page', async (t) => {
  const db = mockDatabase(t);
  const result = await handleAdminResultsRoutes(request('?project=project-a&offset=1000'), env);
  assert.equal(result.status, 200);
  assert.match(result.headers.get('cache-control') || '', /no-store/);
  assert.equal((await result.json()).responses.length, 1);
  const url = new URL(db.mock.calls.at(-1).arguments[0]);
  assert.equal(url.searchParams.get('project_id'), 'eq.project-a');
  assert.equal(url.searchParams.get('limit'), '1000');
  assert.equal(url.searchParams.get('offset'), '1000');
  assert.equal(url.searchParams.get('order'), 'created_at.desc.nullslast,id.desc');
});

test('missing projects produce a clear not-found result', async (t) => {
  const db = mockDatabase(t, { project: false });
  assert.equal((await handleAdminResultsRoutes(request(), env)).status, 404);
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

test('unrelated routes remain available to other handlers', async () => {
  assert.equal(await handleAdminResultsRoutes(new Request('https://app.example/api/other'), env), null);
});

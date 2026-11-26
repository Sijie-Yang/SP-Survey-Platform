/**
 * MCP: SP-Scheme import, publish links, data download, template publishing and
 * draft trimming, against an in-memory Supabase and R2.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { buildExampleSite } from '../../src/lib/spScheme.js';
import { handleAgentAndMcpRoutes } from '../agent/router.mjs';
import { baseEnv, callTool, fakeSupabase, projectRow } from './fakePlatform.testkit.mjs';

const AS_IS_PAGE = '<!doctype html><html><head><title>Walk</title></head><body><img id="a"><script>const PHOTOS = []; localStorage.setItem("answers", "{}");</script></body></html>';

let db = null;
afterEach(() => { db?.restore(); db = null; });

// Like curl --data-binary: the body goes with its Content-Length.
function route(method, url, body, headers = {}) {
  const sized = body != null && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-length')
    ? { 'content-length': String(typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength) }
    : {};
  return handleAgentAndMcpRoutes(new Request(url, { method, body, headers: { ...sized, ...headers } }), globalThis.__env);
}

async function stageZip(env, files) {
  globalThis.__env = env;
  const link = await callTool(env, 'sp_scheme_upload_url');
  assert.equal(link.isError, false, JSON.stringify(link.body));
  const put = await route('PUT', link.body.uploadUrl, zipSync(files));
  assert.equal(put.status, 200, await put.clone().text());
  return link.body.uploadId;
}

function projectKeys(env, prefix = 'u1/proj_1_abc/') {
  return [...env.R2_BUCKET.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
}

async function callAs(env, auth, name, args = {}) {
  const { handleMcpRequest } = await import('./server.mjs');
  const req = new Request('https://sp-survey.org/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const { result } = await (await handleMcpRequest(req, env, auth)).json();
  return { isError: result.isError, body: JSON.parse(result.content[0].text) };
}

function projectPatches() {
  return db.calls.filter((c) => c.method === 'PATCH' && c.path === '/rest/v1/projects');
}

describe('sp_scheme_spec and survey_capabilities', () => {
  it('returns the spec text and the five-step recipe, and capabilities lead with it', async () => {
    const env = baseEnv();
    const spec = await callTool(env, 'sp_scheme_spec');
    assert.equal(spec.isError, false);
    assert.equal(spec.body.version, '2.0');
    assert.match(spec.body.text, /^# SP-Scheme 2\.0/);
    assert.match(spec.body.text, /sp_scheme_import/);
    assert.equal(spec.body.steps.length, 5);
    assert.match(spec.body.steps[1], /sp_scheme_upload_url/);
    assert.match(spec.body.steps[4], /survey_download_url/);

    const caps = await callTool(env, 'survey_capabilities');
    const keys = Object.keys(caps.body);
    assert.ok(keys.indexOf('spSchemeWorkflow') < keys.indexOf('workflow'));
    assert.deepEqual(caps.body.spSchemeWorkflow.tools, ['sp_scheme_spec', 'sp_scheme_upload_url', 'sp_scheme_import', 'survey_publish', 'survey_download_url']);
    assert.match(caps.body.workflow, /^Recommended: build the whole study as one SP-Scheme web page/);
  });

  it('lists the new tools; import needs media:write and the download needs results:read', async () => {
    const { handleMcpRequest } = await import('./server.mjs');
    const res = await handleMcpRequest(new Request('https://sp-survey.org/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), {}, { kind: 'mcp', userId: 'u1', scopes: [] });
    const names = (await res.json()).result.tools.map((t) => t.name);
    for (const name of ['sp_scheme_spec', 'sp_scheme_upload_url', 'sp_scheme_import', 'survey_download_url']) assert.ok(names.includes(name), name);
    assert.ok(!names.includes('template_publish'), 'admin tools are hidden when the admin check cannot run');
    assert.equal(names[1], 'sp_scheme_spec');

    const env = baseEnv();
    const denied = await callTool(env, 'sp_scheme_import', { html: AS_IS_PAGE }, { scopes: ['surveys:write'] });
    assert.equal(denied.isError, true);
    assert.match(denied.body.error, /media:write/);
    const noLink = await callTool(env, 'sp_scheme_upload_url', {}, { scopes: ['surveys:write'] });
    assert.match(noLink.body.error, /media:write/);
    const noResults = await callTool(env, 'survey_download_url', { projectId: 'proj_1_abc' }, { scopes: ['surveys:read'] });
    assert.match(noResults.body.error, /results:read/);
  });
});

describe('sp_scheme_upload_url and PUT /api/mcp/upload/<token>', () => {
  it('stages the bytes for this user only, and rejects bad, expired and oversize uploads', async () => {
    const env = baseEnv();
    globalThis.__env = env;
    const link = await callTool(env, 'sp_scheme_upload_url');
    assert.equal(link.isError, false, JSON.stringify(link.body));
    assert.equal(link.body.method, 'PUT');
    assert.equal(link.body.maxBytes, 25 * 1024 * 1024);
    assert.equal(link.body.maxUnzippedBytes, 60 * 1024 * 1024);
    assert.equal(link.body.maxMediaFiles, 500);
    assert.match(link.body.uploadUrl, /^https:\/\/sp-survey\.org\/api\/mcp\/upload\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(link.body.curl, `curl -X PUT --data-binary @study.zip '${link.body.uploadUrl}'`);
    assert.doesNotMatch(JSON.stringify(link.body), /service-role-secret/);

    const ok = await route('PUT', link.body.uploadUrl, strToU8(AS_IS_PAGE));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, uploadId: link.body.uploadId, bytes: AS_IS_PAGE.length });
    assert.ok(env.R2_BUCKET.objects.has(`_mcp-staging/u1/${link.body.uploadId}`));

    const wrongMethod = await route('POST', link.body.uploadUrl, 'x');
    assert.equal(wrongMethod.status, 405);
    const forged = await route('PUT', `${link.body.uploadUrl.slice(0, -3)}AAA`, 'x');
    assert.equal(forged.status, 401);
    const tooBig = await route('PUT', link.body.uploadUrl, 'x', { 'content-length': String(25 * 1024 * 1024 + 1) });
    assert.equal(tooBig.status, 413);
    assert.equal((await tooBig.json()).code, 'UPLOAD_TOO_LARGE');
    const empty = await route('PUT', link.body.uploadUrl, new Uint8Array(0));
    assert.equal(empty.status, 400);
    // The size must be declared, and the body must match it.
    const unsized = await handleAgentAndMcpRoutes(new Request(link.body.uploadUrl, { method: 'PUT', body: 'abc' }), env);
    assert.equal(unsized.status, 411);
    assert.match((await unsized.json()).error, /Content-Length/);
    const short = await route('PUT', link.body.uploadUrl, 'abc', { 'content-length': '10' });
    assert.equal(short.status, 400);
    const long = await route('PUT', link.body.uploadUrl, 'abcdef', { 'content-length': '3' });
    assert.equal(long.status, 400);
    assert.equal(env.R2_BUCKET.objects.get(`_mcp-staging/u1/${link.body.uploadId}`).bytes.length, AS_IS_PAGE.length);

    // A download token cannot be used to upload.
    const { signTransferToken } = await import('./transferTokens.mjs');
    const down = await signTransferToken(env, { kind: 'download', userId: 'u1', projectId: 'proj_1_abc' }, 60);
    assert.equal((await route('PUT', `https://sp-survey.org/api/mcp/upload/${down.token}`, 'x')).status, 401);
    const expired = await signTransferToken(env, { kind: 'upload', userId: 'u1', uploadId: 'abcdefgh' }, 1, Date.now() - 10_000);
    const late = await route('PUT', `https://sp-survey.org/api/mcp/upload/${expired.token}`, 'x');
    assert.equal(late.status, 401);
    assert.match((await late.json()).error, /expired/);
  });
});

describe('sp_scheme_import', () => {
  it('imports an SP-Scheme page given inline into a new project', async () => {
    db = fakeSupabase();
    const env = baseEnv();
    const res = await callTool(env, 'sp_scheme_import', { html: buildExampleSite() });
    assert.equal(res.isError, false, JSON.stringify(res.body));
    assert.equal(res.body.imported, true);
    assert.equal(res.body.created, true);
    assert.equal(res.body.summary.matchLevel, 'full');
    assert.equal(res.body.summary.asIs, false);
    const [project] = db.tables.projects;
    assert.equal(project.id, res.body.projectId);
    assert.equal(project.user_id, 'u1');
    assert.equal(project.name, 'Street perception study');
    assert.match(project.survey_config_draft.spSite.html, /SPSite\.onReady/);
    assert.equal(project.survey_config_draft.spSite.convertedFrom, undefined);
    assert.equal(project.survey_config_draft.pages.length, 3);
    assert.equal(res.body.draftUpdatedAt, project.draft_updated_at);
    assert.deepEqual(res.body.links, {
      studio: `https://sp-survey.org/studio/${project.id}`,
      preview: `https://sp-survey.org/studio/${project.id}`,
      participant: `https://sp-survey.org/survey?project=${project.id}`,
    });
    assert.equal(res.body.media.uploaded, 0);
  });

  it('imports any other page as it is, recorded but not analysed', async () => {
    db = fakeSupabase();
    const res = await callTool(baseEnv(), 'sp_scheme_import', { html: AS_IS_PAGE, name: 'Walkability pilot' });
    assert.equal(res.body.imported, true);
    assert.equal(res.body.summary.asIs, true);
    assert.match(res.body.next[0], /imported as it is/);
    const [project] = db.tables.projects;
    assert.equal(project.name, 'Walkability pilot');
    assert.equal(project.survey_config_draft.spSite.convertedFrom, 'index.html');
    assert.deepEqual(project.survey_config_draft.pages, []);
  });

  it('imports a staged zip: media under the browser key scheme, one library write, staging removed', async () => {
    db = fakeSupabase({ projects: [projectRow({ preloaded_images: [{ url: 'https://media.example/old.jpg', name: 'old.jpg', key: 'u1/proj_1_abc/old.jpg', folder: '' }] })] });
    const env = baseEnv();
    globalThis.__env = env;
    const zip = zipSync({
      'study/index.html': strToU8(AS_IS_PAGE),
      'study/images/a.jpg': new Uint8Array([1, 2, 3]),
      'study/images/b b.png': new Uint8Array([4, 5]),
    });
    const link = await callTool(env, 'sp_scheme_upload_url');
    assert.equal((await route('PUT', link.body.uploadUrl, zip)).status, 200);

    const res = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', uploadId: link.body.uploadId });
    assert.equal(res.isError, false, JSON.stringify(res.body));
    assert.equal(res.body.created, false);
    assert.equal(res.body.media.uploaded, 2);
    assert.deepEqual(res.body.summary.media.folders, [{ folder: 'images', full: 'images', count: 2 }]);

    const keys = [...env.R2_BUCKET.objects.keys()].filter((k) => k.startsWith('u1/proj_1_abc/')).sort();
    assert.equal(keys.length, 2);
    assert.match(keys[0], /^u1\/proj_1_abc\/images\/a__[0-9a-f-]{36}\.jpg$/);
    assert.match(keys[1], /^u1\/proj_1_abc\/images\/b_b__[0-9a-f-]{36}\.png$/);
    assert.equal(env.R2_BUCKET.objects.has(`_mcp-staging/u1/${link.body.uploadId}`), false);

    const libraryWrites = projectPatches().filter((c) => c.body.preloaded_images);
    assert.equal(libraryWrites.length, 1);
    assert.equal(libraryWrites[0].body.preloaded_source, 'r2');
    assert.match(libraryWrites[0].query, /draft_updated_at=eq\./);
    const [project] = db.tables.projects;
    assert.equal(project.preloaded_images.length, 3);
    const entry = project.preloaded_images.find((e) => e.name === 'a.jpg');
    assert.deepEqual(Object.keys(entry).sort(), ['folder', 'image_compressed', 'key', 'logicalFolder', 'media_id', 'name', 'original_bytes', 'type', 'uploaded_bytes', 'url']);
    assert.equal(entry.url, `https://media.example/${entry.key}`);
    assert.equal(entry.media_id, entry.key);
    assert.equal(entry.folder, 'images');
    assert.equal(entry.type, 'image');
    assert.equal(entry.image_compressed, false);
    assert.deepEqual(project.survey_config_draft.spSite.mediaFolders, ['images']);
    assert.equal(project.survey_config_draft.spSite.convertedFrom, 'upload.zip');
  });

  it('writes nothing when a media upload fails, and removes what it wrote', async () => {
    db = fakeSupabase({ projects: [projectRow()] });
    const env = baseEnv();
    globalThis.__env = env;
    const zip = zipSync({ 'index.html': strToU8(AS_IS_PAGE), 'images/a.jpg': new Uint8Array([1]), 'images/b.jpg': new Uint8Array([2]) });
    const link = await callTool(env, 'sp_scheme_upload_url');
    await route('PUT', link.body.uploadUrl, zip);
    env.R2_BUCKET.failPut = (key) => /\/b__/.test(key);
    const before = JSON.stringify(db.tables.projects);

    const res = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', uploadId: link.body.uploadId });
    assert.equal(res.isError, true);
    assert.equal(res.body.code, 'MEDIA_UPLOAD_FAILED');
    assert.equal([...env.R2_BUCKET.objects.keys()].filter((k) => k.startsWith('u1/proj_1_abc/')).length, 0);
    assert.equal(JSON.stringify(db.tables.projects), before);
    assert.equal(projectPatches().length, 0);
    // The staged upload stays for a retry.
    assert.ok(env.R2_BUCKET.objects.has(`_mcp-staging/u1/${link.body.uploadId}`));

    // A new project made for the import is removed again.
    const fresh = await callTool(env, 'sp_scheme_import', { uploadId: link.body.uploadId });
    assert.equal(fresh.isError, true);
    assert.equal(db.tables.projects.length, 1);
  });

  it('takes its library entries and files back when the draft save fails', async () => {
    const old = [{ url: 'https://media.example/old.jpg', name: 'old.jpg', key: 'u1/proj_1_abc/old.jpg', folder: '' }];
    db = fakeSupabase({ projects: [projectRow({ preloaded_images: old })], failPatch: (body) => Boolean(body?.survey_config_draft) });
    const env = baseEnv();
    globalThis.__env = env;
    const link = await callTool(env, 'sp_scheme_upload_url');
    await route('PUT', link.body.uploadUrl, zipSync({ 'index.html': strToU8(AS_IS_PAGE), 'images/a.jpg': new Uint8Array([1]) }));
    const res = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', uploadId: link.body.uploadId });
    assert.equal(res.isError, true);
    assert.deepEqual(db.tables.projects[0].preloaded_images, old);
    assert.equal(db.tables.projects[0].survey_config_draft.spSite, undefined);
    assert.equal([...env.R2_BUCKET.objects.keys()].filter((k) => k.startsWith('u1/proj_1_abc/')).length, 0);
  });

  it('imports a manifest-only package with the standard look, as Studio does', async () => {
    db = fakeSupabase();
    const { SP_SCHEME_EXAMPLE_PACKAGE } = await import('../../src/lib/spScheme.js');
    const res = await callTool(baseEnv(), 'sp_scheme_import', { html: JSON.stringify(SP_SCHEME_EXAMPLE_PACKAGE) });
    assert.equal(res.isError, false, JSON.stringify(res.body));
    assert.equal(res.body.summary.hasSite, false);
    assert.equal(db.tables.projects[0].survey_config_draft.spSite, undefined);
    assert.ok(db.tables.projects[0].survey_config_draft.pages.length > 0);
    const junk = await callTool(baseEnv(), 'sp_scheme_import', { html: 'hello' });
    assert.equal(junk.isError, true);
    assert.equal(junk.body.code, 'UNREADABLE_UPLOAD');
  });

  it('refuses a page that fails the check without writing anything, and says what to fix', async () => {
    db = fakeSupabase();
    const env = baseEnv();
    const html = buildExampleSite().replace('</head>', '<script src="https://cdn.example.org/lib.js"></script></head>');
    const res = await callTool(env, 'sp_scheme_import', { html, allowHosts: [] });
    assert.equal(res.isError, false);
    assert.equal(res.body.imported, false);
    assert.equal(res.body.summary.ok, false);
    assert.match(res.body.fixHint.problems[0].message, /cdn\.example\.org/);
    assert.match(res.body.fixHint.text, /Problems to fix/);
    assert.equal(db.tables.projects.length, 0);
    assert.equal(db.calls.filter((c) => c.method !== 'GET').length, 0);
    assert.equal(env.R2_BUCKET.objects.size, 0);

    // With the host allowed, the same page imports.
    const allowed = await callTool(env, 'sp_scheme_import', { html, allowHosts: ['https://cdn.example.org/'] });
    assert.equal(allowed.body.imported, true);
    assert.deepEqual(db.tables.projects[0].survey_config_draft.spSite.allowedHosts, ['cdn.example.org']);
  });

  it('works the same for a browser session (Supabase JWT), saving through save_project_draft', async () => {
    const saves = [];
    db = fakeSupabase({
      projects: [projectRow()],
      rpc: {
        save_project_draft: (body, tables) => {
          saves.push(body);
          const row = tables.projects.find((p) => p.id === body.p_project_id);
          if (row.draft_updated_at !== body.p_expected_draft_updated_at) throw new Error('conflict');
          Object.assign(row, { survey_config_draft: body.p_survey_config, draft_updated_at: '2026-11-02T00:00:00.000Z' });
          return { draftUpdatedAt: row.draft_updated_at };
        },
      },
    });
    const { handleMcpRequest } = await import('./server.mjs');
    const req = new Request('https://sp-survey.org/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'sp_scheme_import', arguments: { projectId: 'proj_1_abc', html: AS_IS_PAGE } } }) });
    const res = await handleMcpRequest(req, baseEnv(), { kind: 'supabase', userId: 'u1', accessToken: 'jwt' });
    const { result } = await res.json();
    const body = JSON.parse(result.content[0].text);
    assert.equal(result.isError, false, result.content[0].text);
    assert.equal(body.draftUpdatedAt, '2026-11-02T00:00:00.000Z');
    assert.equal(saves.length, 1);
    assert.equal(saves[0].p_expected_draft_updated_at, '2026-11-01T00:00:00.000Z');
    assert.equal(db.tables.projects[0].survey_config_draft.spSite.convertedFrom, 'index.html');
  });

  it('checks its arguments and ownership', async () => {
    db = fakeSupabase({ projects: [projectRow({ user_id: 'someone-else' })] });
    const env = baseEnv();
    const both = await callTool(env, 'sp_scheme_import', { html: AS_IS_PAGE, uploadId: 'abcdefgh' });
    assert.equal(both.body.code, 'ONE_SOURCE_REQUIRED');
    const none = await callTool(env, 'sp_scheme_import', {});
    assert.equal(none.body.code, 'ONE_SOURCE_REQUIRED');
    const traversal = await callTool(env, 'sp_scheme_import', { uploadId: '../../u2/abcdefgh' });
    assert.equal(traversal.body.code, 'BAD_UPLOAD_ID');
    const missing = await callTool(env, 'sp_scheme_import', { uploadId: 'abcdefgh-0000' });
    assert.equal(missing.body.code, 'UPLOAD_NOT_FOUND');
    // Another user's staged file is never found: the key is built from the caller's id.
    env.R2_BUCKET.objects.set('_mcp-staging/u2/abcdefgh-1111', { bytes: strToU8(AS_IS_PAGE), uploaded: new Date() });
    const foreign = await callTool(env, 'sp_scheme_import', { uploadId: 'abcdefgh-1111' });
    assert.equal(foreign.body.code, 'UPLOAD_NOT_FOUND');
    const notMine = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', html: AS_IS_PAGE });
    assert.equal(notMine.isError, true);
    assert.match(notMine.body.error, /Project not found/);
    assert.equal(db.tables.projects[0].survey_config_draft.spSite, undefined);
  });
});

describe('survey_publish and survey_preview_urls links', () => {
  it('returns the slug link and the Studio link after a release', async () => {
    db = fakeSupabase({
      projects: [projectRow({ public_slug: 'street-study' })],
      rpc: { release_project_version: () => ({ publishedVersion: 1, publishedAt: 'now', releaseManaged: true }) },
    });
    const env = baseEnv();
    const res = await callTool(env, 'survey_publish', { projectId: 'proj_1_abc', expectedDraftUpdatedAt: '2026-11-01T00:00:00.000Z', confirm: true });
    assert.equal(res.isError, false, JSON.stringify(res.body));
    assert.equal(res.body.publishedVersion, 1);
    assert.deepEqual(res.body.links, { participant: 'https://sp-survey.org/s/street-study', studio: 'https://sp-survey.org/studio/proj_1_abc' });

    const urls = await callTool(env, 'survey_preview_urls', { projectId: 'proj_1_abc' });
    assert.equal(urls.body.urls.participant, 'https://sp-survey.org/s/street-study');
    assert.equal(urls.body.urls.studio, 'https://sp-survey.org/studio/proj_1_abc');
    assert.equal(urls.body.urls.liveSurvey, 'https://sp-survey.org/survey?project=proj_1_abc');
  });

  it('falls back to the id link when the database has no slug column', async () => {
    db = fakeSupabase({ projects: [projectRow()], missingColumns: ['public_slug'] });
    const urls = await callTool(baseEnv(), 'survey_preview_urls', { projectId: 'proj_1_abc' });
    assert.equal(urls.isError, false, JSON.stringify(urls.body));
    assert.equal(urls.body.urls.participant, 'https://sp-survey.org/survey?project=proj_1_abc');
  });

  it('names supabase/release_site_pages.sql when a page cannot be released', async () => {
    const draft = { pages: [], spSite: { id: 'site-1', html: AS_IS_PAGE, convertedFrom: 'index.html' } };
    db = fakeSupabase({
      projects: [projectRow({ survey_config_draft: draft })],
      rpc: { release_project_version: () => { throw new Error('draft has no pages'); } },
    });
    const res = await callTool(baseEnv(), 'survey_publish', { projectId: 'proj_1_abc', expectedDraftUpdatedAt: 'x', confirm: true });
    assert.equal(res.isError, true);
    assert.equal(res.body.code, 'SITE_PAGES_SQL_REQUIRED');
    assert.match(res.body.error, /supabase\/release_site_pages\.sql/);
  });
});

describe('survey_publish with an empty media library', () => {
  const picker = { pages: [{ name: 'p1', elements: [{ type: 'imagepicker', name: 'safer', imageCount: 2, imageSelectionMode: 'huggingface_random', randomImageSelection: true }] }] };
  it('refuses to publish questions that draw images while the library is empty', async () => {
    let released = false;
    db = fakeSupabase({
      projects: [projectRow({ survey_config_draft: picker, preloaded_images: [] })],
      rpc: { release_project_version: () => { released = true; return { publishedVersion: 1 }; } },
    });
    const res = await callTool(baseEnv(), 'survey_publish', { projectId: 'proj_1_abc', expectedDraftUpdatedAt: 'x', confirm: true });
    assert.equal(res.isError, true);
    assert.equal(res.body.code, 'MEDIA_LIBRARY_EMPTY');
    assert.deepEqual(res.body.questions, ['safer']);
    assert.equal(released, false);
  });

  it('publishes once the library has images', async () => {
    db = fakeSupabase({
      projects: [projectRow({ survey_config_draft: picker, preloaded_images: [{ url: 'https://media.example/a.jpg', name: 'a.jpg' }] })],
      rpc: { release_project_version: () => ({ publishedVersion: 1, publishedAt: 'now', releaseManaged: true }) },
    });
    const res = await callTool(baseEnv(), 'survey_publish', { projectId: 'proj_1_abc', expectedDraftUpdatedAt: 'x', confirm: true });
    assert.equal(res.isError, false, JSON.stringify(res.body));
  });
});

describe('survey_download_url and GET /api/mcp/download/<token>', () => {
  const rows = [
    { id: 'r1', project_id: 'proj_1_abc', participant_id: 'P1', created_at: '2026-11-02T00:00:00Z', responses: { __sp_page_state: { answers: { q1: 3 } } }, survey_metadata: { survey_revision: 'rev1' } },
    { id: 'r2', project_id: 'proj_1_abc', participant_id: 'P2', created_at: '2026-11-03T00:00:00Z', responses: { __sp_page_state: { answers: { q1: 5 } } }, survey_metadata: { practice_mode: true } },
    { id: 'r3', project_id: 'proj_1_abc', participant_id: 'S1', created_at: '2026-11-04T00:00:00Z', responses: {}, survey_metadata: { silicon_run_id: 'run1' } },
  ];
  const site = { pages: [], title: 'Walk', spSite: { id: 'site-1', html: AS_IS_PAGE, convertedFrom: 'index.html', mediaFolders: ['images'] } };
  const library = [{ url: 'https://media.example/u1/proj_1_abc/images/a__1.jpg', name: 'a.jpg', key: 'u1/proj_1_abc/images/a__1.jpg', folder: 'images', type: 'image' }];

  it('builds the ZIP for a page imported as it is, with the default filters', async () => {
    db = fakeSupabase({ projects: [projectRow({ survey_config_draft: site, preloaded_images: library })], responses: rows });
    const env = baseEnv();
    globalThis.__env = env;
    const link = await callTool(env, 'survey_download_url', { projectId: 'proj_1_abc' });
    assert.equal(link.isError, false, JSON.stringify(link.body));
    assert.match(link.body.downloadUrl, /^https:\/\/sp-survey\.org\/api\/mcp\/download\//);
    assert.equal(link.body.curl, `curl -L -o data.zip '${link.body.downloadUrl}'`);
    assert.deepEqual(link.body.files, ['README.txt', 'responses_wide.csv', 'responses_raw.json', 'stimuli.csv', 'survey.json', 'page.html', 'references.bib', 'CITATION.cff']);

    const res = await route('GET', link.body.downloadUrl);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(files).map((n) => n.split('/').slice(1).join('/')).sort();
    assert.deepEqual(names, [...link.body.files].sort());
    const read = (name) => strFromU8(files[Object.keys(files).find((n) => n.endsWith(`/${name}`))]);
    assert.match(read('responses_wide.csv').replace(/^﻿/, ''), /^participant_id,created_at,/);
    const raw = JSON.parse(read('responses_raw.json'));
    assert.deepEqual(raw.map((r) => r.id), ['r1']);
    assert.match(read('README.txt'), /stimuli\.csv/);
    assert.match(read('README.txt'), /Submissions: 1 /);
    assert.match(read('stimuli.csv').replace(/^﻿/, ''), /^folder,name,url,type\r?\nimages,a\.jpg,https:\/\/media\.example\/u1\/proj_1_abc\/images\/a__1\.jpg,image/);
    const survey = JSON.parse(read('survey.json'));
    assert.equal(survey.spSite.html, undefined);
    assert.equal(survey.spSite.id, 'site-1');
    assert.equal(read('page.html'), AS_IS_PAGE);
  });

  it('includes practice runs when asked, and builds the plain set for a classic survey', async () => {
    const classic = { title: 'Q', pages: [{ name: 'p1', elements: [{ type: 'rating', name: 'q1', rateMax: 5 }] }] };
    const answered = rows.map((r) => ({ ...r, responses: { q1: 4 } }));
    db = fakeSupabase({ projects: [projectRow({ survey_config_draft: classic })], responses: answered });
    const env = baseEnv();
    globalThis.__env = env;
    const link = await callTool(env, 'survey_download_url', { projectId: 'proj_1_abc', includePractice: true });
    assert.deepEqual(link.body.files, ['README.txt', 'responses_wide.csv', 'responses_raw.json', 'stimuli.csv', 'survey.json', 'references.bib', 'CITATION.cff']);
    const files = unzipSync(new Uint8Array(await (await route('GET', link.body.downloadUrl)).arrayBuffer()));
    const read = (name) => strFromU8(files[Object.keys(files).find((n) => n.endsWith(`/${name}`))]);
    assert.deepEqual(JSON.parse(read('responses_raw.json')).map((r) => r.id).sort(), ['r1', 'r2']);
    assert.match(read('responses_wide.csv'), /,q1(,|\r?\n)/);
    assert.match(read('README.txt'), /Columns of responses_wide\.csv/);
    assert.match(read('README.txt'), /practice runs are included/);
  });

  it('checks the owner again and refuses bad links', async () => {
    db = fakeSupabase({ projects: [projectRow({ user_id: 'u2' })], responses: rows });
    const env = baseEnv();
    globalThis.__env = env;
    const notMine = await callTool(env, 'survey_download_url', { projectId: 'proj_1_abc' });
    assert.equal(notMine.isError, true);
    const { signTransferToken } = await import('./transferTokens.mjs');
    const { token } = await signTransferToken(env, { kind: 'download', userId: 'u1', projectId: 'proj_1_abc' }, 60);
    const res = await route('GET', `https://sp-survey.org/api/mcp/download/${token}`);
    assert.equal(res.status, 404);
    const bad = await route('GET', `https://sp-survey.org/api/mcp/download/${token.slice(0, -4)}AAAA`);
    assert.equal(bad.status, 401);
  });
});

describe('template_publish', () => {
  const library = [
    { url: 'https://media.example/u1/proj_1_abc/images/a__1.jpg', name: 'a.jpg', key: 'u1/proj_1_abc/images/a__1.jpg', media_id: 'u1/proj_1_abc/images/a__1.jpg', folder: 'images', type: 'image' },
    { url: 'https://example.org/external.jpg', name: 'external.jpg', folder: 'web' },
  ];
  const args = { projectId: 'proj_1_abc', name: 'Street perception', author: 'Sijie Yang', year: '2026', confirm: true };

  it('sends everyone who is not an admin to the review queue', async () => {
    db = fakeSupabase({ projects: [projectRow()] });
    const res = await callTool(baseEnv(), 'template_publish', args);
    assert.equal(res.isError, true);
    assert.equal(res.body.code, 'ADMIN_ONLY');
    assert.match(res.body.error, /survey_save_as_template/);
    assert.equal(db.tables.templates.length, 0);
    const unconfirmed = await callTool(baseEnv(), 'template_publish', { ...args, confirm: false });
    assert.match(unconfirmed.body.error, /confirm:true/);
  });

  it('publishes an approved template with its own copy of the media, then overwrites it', async () => {
    db = fakeSupabase({
      projects: [projectRow({ preloaded_images: library, survey_config_draft: { title: 'S', pages: [], ownResponseSupabase: { anonKey: 'secret' } } })],
      admins: [{ user_id: 'u1' }],
    });
    const env = baseEnv();
    env.R2_BUCKET.objects.set('u1/proj_1_abc/images/a__1.jpg', { bytes: new Uint8Array([9]), uploaded: new Date() });
    const res = await callTool(env, 'template_publish', { ...args, tags: ['streets'] });
    assert.equal(res.isError, false, JSON.stringify(res.body));
    assert.equal(res.body.templateId, '2026-sijie-street');
    assert.equal(res.body.created, true);
    assert.equal(res.body.url, 'https://sp-survey.org/');
    const [tpl] = db.tables.templates;
    assert.equal(tpl.is_approved, true);
    assert.equal(tpl.show_on_landing, true);
    assert.equal(tpl.is_active, true);
    assert.deepEqual(tpl.tags, ['streets']);
    assert.equal(JSON.stringify(tpl.survey_config).includes('secret'), false);
    assert.ok(env.R2_BUCKET.objects.has('templates/2026-sijie-street/images/a__1.jpg'));
    assert.deepEqual(tpl.preloaded_images[0], { ...library[0], key: 'templates/2026-sijie-street/images/a__1.jpg', media_id: 'templates/2026-sijie-street/images/a__1.jpg', url: 'https://media.example/templates/2026-sijie-street/images/a__1.jpg' });
    assert.deepEqual(tpl.preloaded_images[1], library[1]);

    // Overwriting a template must be said explicitly.
    const unsure = await callTool(env, 'template_publish', { ...args, templateId: '2026-sijie-street', name: 'Street perception v2' });
    assert.equal(unsure.body.code, 'OVERWRITE_REQUIRED');
    assert.match(unsure.body.error, /overwrite:true/);
    assert.equal(db.tables.templates[0].name, 'Street perception');

    const again = await callTool(env, 'template_publish', { ...args, templateId: '2026-sijie-street', overwrite: true, name: 'Street perception v2', showOnLanding: false });
    assert.equal(again.isError, false, JSON.stringify(again.body));
    assert.equal(again.body.created, false);
    assert.equal(db.tables.templates.length, 1);
    assert.equal(db.tables.templates[0].name, 'Street perception v2');
    assert.equal(db.tables.templates[0].show_on_landing, false);
    assert.deepEqual(db.tables.templates[0].tags, ['streets']);

    const unknown = await callTool(env, 'template_publish', { ...args, templateId: 'no-such-template', overwrite: true });
    assert.equal(unknown.body.code, 'TEMPLATE_NOT_FOUND');
    const badId = await callTool(env, 'template_publish', { ...args, templateId: '../x', overwrite: true });
    assert.equal(badId.body.code, 'INVALID_TEMPLATE_ID');
    const noPublishScope = await callTool(env, 'template_publish', args, { scopes: ['surveys:read', 'surveys:write'] });
    assert.match(noPublishScope.body.error, /surveys:publish/);
  });
});

describe('survey_get_draft and survey_replace_draft with a page', () => {
  const html = `${AS_IS_PAGE}<!-- ${'x'.repeat(5000)} -->`;
  const draft = { title: 'Walk', pages: [], spSite: { id: 'site-abc', version: '1.0', html, convertedFrom: 'index.html' } };

  it('leaves the page HTML out of reads and keeps it on a round trip', async () => {
    db = fakeSupabase({ projects: [projectRow({ survey_config_draft: draft, survey_config: draft })] });
    const env = baseEnv();
    const read = await callTool(env, 'survey_get_draft', { projectId: 'proj_1_abc' });
    assert.equal(read.isError, false, JSON.stringify(read.body));
    assert.deepEqual(Object.keys(read.body.surveyConfig.spSite.html), ['id', 'bytes', 'note']);
    assert.equal(read.body.surveyConfig.spSite.html.bytes, Buffer.byteLength(html));
    assert.match(read.body.surveyConfig.spSite.html.note, /sp_scheme_import/);
    assert.ok(JSON.stringify(read.body).length < 4000);
    assert.equal(read.body.urls.studio, 'https://sp-survey.org/studio/proj_1_abc');

    const next = { ...read.body.surveyConfig, title: 'Walk 2' };
    const saved = await callTool(env, 'survey_replace_draft', { projectId: 'proj_1_abc', surveyConfig: next, expectedDraftUpdatedAt: read.body.draftUpdatedAt });
    assert.equal(saved.isError, false, JSON.stringify(saved.body));
    assert.equal(typeof saved.body.surveyConfig.spSite.html, 'object');
    const stored = db.tables.projects[0].survey_config_draft;
    assert.equal(stored.title, 'Walk 2');
    assert.equal(stored.spSite.html, html);

    const other = { ...next, spSite: { ...next.spSite, id: 'site-other' } };
    const refused = await callTool(env, 'survey_replace_draft', { projectId: 'proj_1_abc', surveyConfig: other, expectedDraftUpdatedAt: db.tables.projects[0].draft_updated_at });
    assert.equal(refused.isError, true);
    assert.equal(refused.body.code, 'SITE_HTML_MISSING');
    assert.equal(db.tables.projects[0].survey_config_draft.spSite.html, html);

    // Removing spSite removes the page, as in the Builder.
    const { spSite, ...withoutPage } = next;
    void spSite;
    const removed = await callTool(env, 'survey_replace_draft', { projectId: 'proj_1_abc', surveyConfig: withoutPage, expectedDraftUpdatedAt: db.tables.projects[0].draft_updated_at });
    assert.equal(removed.isError, false, JSON.stringify(removed.body));
    assert.equal(db.tables.projects[0].survey_config_draft.spSite, undefined);
  });
});

describe('sp_scheme_import: re-import, limits and rollback', () => {
  const twoImages = () => ({ 'index.html': strToU8(AS_IS_PAGE), 'images/a.jpg': new Uint8Array([1, 2, 3]), 'images/b.jpg': new Uint8Array([4, 5]) });
  const jwt = { kind: 'supabase', userId: 'u1', accessToken: 'jwt' };

  it('importing the same zip three times keeps one entry and one object per file', async () => {
    db = fakeSupabase({ projects: [projectRow()] });
    const env = baseEnv();
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const uploadId = await stageZip(env, twoImages());
      // eslint-disable-next-line no-await-in-loop
      const res = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', uploadId, expectedDraftUpdatedAt: db.tables.projects[0].draft_updated_at });
      assert.equal(res.body.imported, true, JSON.stringify(res.body));
      results.push(res.body.media);
    }
    const lib = db.tables.projects[0].preloaded_images;
    assert.deepEqual(lib.map((e) => `${e.folder}/${e.name}`).sort(), ['images/a.jpg', 'images/b.jpg']);
    assert.deepEqual(projectKeys(env), lib.map((e) => e.key).sort());
    assert.equal(projectKeys(env).length, 2);
    assert.deepEqual([results[0].new, results[0].uploaded, results[0].unchanged], [2, 2, 0]);
    assert.deepEqual([results[2].new, results[2].replaced, results[2].unchanged, results[2].uploaded], [0, 0, 2, 0]);
  });

  it('a changed file replaces the old entry; its old file goes after the save', async () => {
    db = fakeSupabase({ projects: [projectRow()] });
    const env = baseEnv();
    await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', uploadId: await stageZip(env, twoImages()) });
    const oldA = db.tables.projects[0].preloaded_images.find((e) => e.name === 'a.jpg').key;
    const changed = { ...twoImages(), 'images/a.jpg': new Uint8Array([9, 9, 9, 9, 9]) };
    const res = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', uploadId: await stageZip(env, changed) });
    assert.equal(res.isError, false, JSON.stringify(res.body));
    assert.deepEqual([res.body.media.new, res.body.media.replaced, res.body.media.unchanged, res.body.media.uploaded], [0, 1, 1, 1]);
    const lib = db.tables.projects[0].preloaded_images;
    assert.equal(lib.length, 2);
    const a = lib.find((e) => e.name === 'a.jpg');
    assert.notEqual(a.key, oldA);
    assert.equal(a.original_bytes, 5);
    assert.equal(env.R2_BUCKET.objects.has(oldA), false);
    assert.deepEqual(projectKeys(env), lib.map((e) => e.key).sort());
  });

  it('an entry without a recorded size counts as replaced, and every entry of that name goes', async () => {
    const old = (n) => ({ url: `https://media.example/u1/proj_1_abc/images/a__${n}.jpg`, name: 'a.jpg', key: `u1/proj_1_abc/images/a__${n}.jpg`, folder: 'images' });
    db = fakeSupabase({ projects: [projectRow({ preloaded_images: [old(1), old(2)] })] });
    const env = baseEnv();
    [1, 2].forEach((n) => env.R2_BUCKET.objects.set(old(n).key, { bytes: new Uint8Array([1, 2, 3]), uploaded: new Date() }));
    const res = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', uploadId: await stageZip(env, { 'index.html': strToU8(AS_IS_PAGE), 'images/a.jpg': new Uint8Array([1, 2, 3]), 'Images/a.jpg': new Uint8Array([7]) }) });
    assert.equal(res.isError, false, JSON.stringify(res.body));
    // Folder and name are compared exactly: Images/ is another folder.
    assert.deepEqual([res.body.media.new, res.body.media.replaced, res.body.media.unchanged], [1, 1, 0]);
    const lib = db.tables.projects[0].preloaded_images;
    assert.deepEqual(lib.map((e) => `${e.folder}/${e.name}`).sort(), ['Images/a.jpg', 'images/a.jpg']);
    assert.equal(env.R2_BUCKET.objects.has(old(1).key), false);
    assert.equal(env.R2_BUCKET.objects.has(old(2).key), false);
  });

  it('keeps an old file the published version still uses, and deletes nothing when that cannot be read', async () => {
    const old = { url: 'https://media.example/u1/proj_1_abc/images/a__1.jpg', name: 'a.jpg', key: 'u1/proj_1_abc/images/a__1.jpg', folder: 'images', original_bytes: 1 };
    db = fakeSupabase({ projects: [projectRow({ preloaded_images: [old], release_managed: true, published_media: { preloadedImages: [old] } })] });
    const env = baseEnv();
    env.R2_BUCKET.objects.set(old.key, { bytes: new Uint8Array([1]), uploaded: new Date() });
    const zip = { 'index.html': strToU8(AS_IS_PAGE), 'images/a.jpg': new Uint8Array([2, 2]) };
    const res = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', uploadId: await stageZip(env, zip), expectedDraftUpdatedAt: '2026-11-01T00:00:00.000Z' });
    assert.equal(res.isError, false, JSON.stringify(res.body));
    assert.equal(res.body.media.replaced, 1);
    assert.equal(db.tables.projects[0].preloaded_images.some((e) => e.key === old.key), false);
    assert.ok(env.R2_BUCKET.objects.has(old.key));

    // An older database without the release columns: nothing is deleted.
    db.restore();
    db = fakeSupabase({ projects: [projectRow({ preloaded_images: [old] })], missingColumns: ['published_media'] });
    const env2 = baseEnv();
    env2.R2_BUCKET.objects.set(old.key, { bytes: new Uint8Array([1]), uploaded: new Date() });
    const again = await callTool(env2, 'sp_scheme_import', { projectId: 'proj_1_abc', uploadId: await stageZip(env2, zip) });
    assert.equal(again.body.media.replaced, 1, JSON.stringify(again.body));
    assert.ok(env2.R2_BUCKET.objects.has(old.key));
  });

  it('keeps the old page\'s folders when the new page names none and brings no images', async () => {
    const draft = { title: 'Walk', pages: [], spSite: { id: 'site-old', html: AS_IS_PAGE, convertedFrom: 'index.html', mediaFolders: ['streets'] } };
    db = fakeSupabase({ projects: [projectRow({ survey_config_draft: draft, survey_config: draft })] });
    const env = baseEnv();
    const res = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', html: AS_IS_PAGE.replace('Walk', 'Walk 2') });
    assert.equal(res.isError, false, JSON.stringify(res.body));
    assert.deepEqual(db.tables.projects[0].survey_config_draft.spSite.mediaFolders, ['streets']);
    // A zip with images links its own folders instead.
    const withImages = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', uploadId: await stageZip(env, twoImages()) });
    assert.equal(withImages.isError, false, JSON.stringify(withImages.body));
    assert.deepEqual(db.tables.projects[0].survey_config_draft.spSite.mediaFolders, ['images']);
  });

  it('writes the library and the page in one write, guarded on the draft and the library', async () => {
    db = fakeSupabase({ projects: [projectRow()] });
    const env = baseEnv();
    const res = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', uploadId: await stageZip(env, twoImages()) });
    assert.equal(res.isError, false, JSON.stringify(res.body));
    const patches = projectPatches();
    assert.equal(patches.length, 1);
    assert.ok(patches[0].body.preloaded_images && patches[0].body.survey_config_draft);
    assert.match(patches[0].query, /draft_updated_at=eq\./);
    assert.match(patches[0].query, /&updated_at=eq\./);
  });

  it('does not overwrite library changes made while it uploaded, and removes its files', async () => {
    db = fakeSupabase({ projects: [projectRow()] });
    const env = baseEnv();
    const uploadId = await stageZip(env, twoImages());
    const put = env.R2_BUCKET.put.bind(env.R2_BUCKET);
    env.R2_BUCKET.put = async (key, body, opts) => {
      if (key.startsWith('u1/proj_1_abc/')) {
        Object.assign(db.tables.projects[0], { preloaded_images: [{ name: 'other.jpg', key: 'u1/proj_1_abc/other.jpg', folder: '' }], updated_at: '2026-11-03T00:00:00.000Z' });
      }
      return put(key, body, opts);
    };
    const res = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', uploadId });
    assert.equal(res.body.code, 'CONFLICT');
    assert.match(res.body.error, /nothing was imported/);
    assert.deepEqual(db.tables.projects[0].preloaded_images.map((e) => e.name), ['other.jpg']);
    assert.equal(projectKeys(env).length, 0);
  });

  it('browser session: puts the library back when the draft save fails', async () => {
    const old = [{ url: 'https://media.example/u1/proj_1_abc/images/a__old.jpg', name: 'a.jpg', key: 'u1/proj_1_abc/images/a__old.jpg', folder: 'images', original_bytes: 1 }];
    db = fakeSupabase({ projects: [projectRow({ preloaded_images: old })], rpc: { save_project_draft: () => { throw new Error('database unavailable'); } } });
    const env = baseEnv();
    env.R2_BUCKET.objects.set(old[0].key, { bytes: new Uint8Array([1]), uploaded: new Date() });
    const uploadId = await stageZip(env, twoImages());
    const res = await callAs(env, jwt, 'sp_scheme_import', { projectId: 'proj_1_abc', uploadId });
    assert.equal(res.isError, true);
    assert.doesNotMatch(res.body.error, /Cleanup incomplete/);
    assert.deepEqual(db.tables.projects[0].preloaded_images, old);
    assert.deepEqual(projectKeys(env), [old[0].key]);
  });

  it('refuses too many media files before creating or uploading anything', async () => {
    db = fakeSupabase();
    const env = baseEnv();
    const files = { 'index.html': strToU8(AS_IS_PAGE) };
    for (let i = 0; i <= 500; i += 1) files[`images/p${i}.jpg`] = new Uint8Array([1]);
    const res = await callTool(env, 'sp_scheme_import', { uploadId: await stageZip(env, files) });
    assert.equal(res.body.code, 'TOO_MANY_MEDIA_FILES');
    assert.match(res.body.error, /501 media files/);
    assert.equal(db.tables.projects.length, 0);
    assert.equal(db.calls.filter((c) => c.method !== 'GET').length, 0);
    assert.equal(projectKeys(env, 'u1/').length, 0);
  });

  it('uploads at most four files at a time', async () => {
    db = fakeSupabase({ projects: [projectRow()] });
    const env = baseEnv();
    const files = { 'index.html': strToU8(AS_IS_PAGE) };
    for (let i = 0; i < 12; i += 1) files[`images/p${i}.jpg`] = new Uint8Array([i + 1]);
    const uploadId = await stageZip(env, files);
    const put = env.R2_BUCKET.put.bind(env.R2_BUCKET);
    let active = 0;
    let peak = 0;
    env.R2_BUCKET.put = async (key, body, opts) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      try {
        return await put(key, body, opts);
      } finally {
        active -= 1;
      }
    };
    const res = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', uploadId });
    assert.equal(res.body.media.uploaded, 12, JSON.stringify(res.body));
    assert.equal(peak, 4);
  });

  it('removes a project it created when the save fails, and says "cleanup incomplete" when removal fails', async () => {
    db = fakeSupabase({ failPatch: (body) => Boolean(body?.survey_config_draft) });
    const env = baseEnv();
    const failed = await callTool(env, 'sp_scheme_import', { uploadId: await stageZip(env, twoImages()) });
    assert.equal(failed.isError, true);
    assert.doesNotMatch(failed.body.error, /Cleanup incomplete/);
    assert.equal(db.tables.projects.length, 0);
    assert.equal(projectKeys(env, 'u1/').length, 0);

    db.restore();
    db = fakeSupabase();
    const env2 = baseEnv();
    const uploadId = await stageZip(env2, twoImages());
    env2.R2_BUCKET.failPut = (key) => /\/b__/.test(key);
    env2.R2_BUCKET.delete = async () => { throw new Error('bucket offline'); };
    const res = await callTool(env2, 'sp_scheme_import', { uploadId });
    assert.equal(res.body.code, 'MEDIA_UPLOAD_FAILED');
    assert.match(res.body.error, /Cleanup incomplete/);
    assert.match(res.body.error, /bucket offline/);
  });

  it('takes expectedDraftUpdatedAt, and needs it once the project is published', async () => {
    db = fakeSupabase({ projects: [projectRow({ release_managed: true })] });
    const env = baseEnv();
    const missing = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', html: AS_IS_PAGE });
    assert.equal(missing.body.code, 'MISSING_EXPECTED_DRAFT_UPDATED_AT');
    const stale = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', html: AS_IS_PAGE, expectedDraftUpdatedAt: '2026-10-01T00:00:00.000Z' });
    assert.equal(stale.body.code, 'CONFLICT');
    assert.match(stale.body.error, /survey_get_draft/);
    assert.equal(db.calls.filter((c) => c.method !== 'GET').length, 0);
    // The same time written another way is the same stamp.
    const ok = await callTool(env, 'sp_scheme_import', { projectId: 'proj_1_abc', html: AS_IS_PAGE, expectedDraftUpdatedAt: '2026-11-01T00:00:00+00:00' });
    assert.equal(ok.body.imported, true, JSON.stringify(ok.body));
  });

  it('keeps at most five staged uploads per user, and drops ones older than 2 hours', async () => {
    const env = baseEnv();
    globalThis.__env = env;
    const ids = [];
    for (let i = 0; i < 7; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const link = await callTool(env, 'sp_scheme_upload_url');
      ids.push(link.body.uploadId);
      // eslint-disable-next-line no-await-in-loop
      assert.equal((await route('PUT', link.body.uploadUrl, strToU8(AS_IS_PAGE))).status, 200);
      env.R2_BUCKET.objects.get(`_mcp-staging/u1/${link.body.uploadId}`).uploaded = new Date(Date.now() - (10 - i) * 1000);
    }
    const staged = () => [...env.R2_BUCKET.objects.keys()].filter((k) => k.startsWith('_mcp-staging/u1/')).sort();
    assert.deepEqual(staged(), ids.slice(2).map((id) => `_mcp-staging/u1/${id}`).sort());
    env.R2_BUCKET.objects.get(`_mcp-staging/u1/${ids[2]}`).uploaded = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await callTool(env, 'sp_scheme_upload_url');
    assert.equal(staged().length, 4);
    assert.equal(staged().includes(`_mcp-staging/u1/${ids[2]}`), false);
  });
});

describe('survey_download_url limits and ownership', () => {
  const rows = [
    { id: 'r1', project_id: 'proj_1_abc', participant_id: 'P1', created_at: '2026-11-02T00:00:00Z', responses: { q1: 4 }, survey_metadata: {} },
    { id: 'r2', project_id: 'proj_1_abc', participant_id: 'P2', created_at: '2026-11-03T00:00:00Z', responses: { q1: 5 }, survey_metadata: { practice_mode: true } },
  ];
  const classic = { title: 'Q', pages: [{ name: 'p1', elements: [{ type: 'rating', name: 'q1', rateMax: 5 }] }] };
  const bodyReads = () => db.calls.filter((c) => c.path === '/rest/v1/survey_responses' && /select=\*/.test(c.query)).length;

  it('gives a link only to the project owner, also with a browser session', async () => {
    db = fakeSupabase({ projects: [projectRow({ user_id: 'owner-1', survey_config_draft: classic })], responses: rows });
    const env = baseEnv();
    globalThis.__env = env;
    // The fake has no row-level security: a session read stands in for "RLS lets a collaborator or admin read it".
    for (const userId of ['collab-2', 'admin-3']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await callAs(env, { kind: 'supabase', userId, accessToken: 'jwt' }, 'survey_download_url', { projectId: 'proj_1_abc' });
      assert.equal(res.isError, true);
      assert.equal(res.body.code, 'FORBIDDEN');
      assert.match(res.body.error, /owner/);
    }
    const owner = await callAs(env, { kind: 'supabase', userId: 'owner-1', accessToken: 'jwt' }, 'survey_download_url', { projectId: 'proj_1_abc' });
    assert.equal(owner.isError, false, JSON.stringify(owner.body));
    assert.equal((await route('GET', owner.body.downloadUrl)).status, 200);
  });

  it('answers HEAD from the count without reading any rows', async () => {
    db = fakeSupabase({ projects: [projectRow({ survey_config_draft: classic })], responses: rows });
    const env = baseEnv();
    globalThis.__env = env;
    const link = await callTool(env, 'survey_download_url', { projectId: 'proj_1_abc' });
    const head = await route('HEAD', link.body.downloadUrl);
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), 'application/zip');
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(bodyReads(), 0);
  });

  it('refuses more responses than one download holds before loading them', async () => {
    db = fakeSupabase({ projects: [projectRow({ survey_config_draft: classic })], responses: rows, responseCount: 20001 });
    const env = baseEnv();
    globalThis.__env = env;
    const link = await callTool(env, 'survey_download_url', { projectId: 'proj_1_abc' });
    assert.equal((await route('HEAD', link.body.downloadUrl)).status, 413);
    const res = await route('GET', link.body.downloadUrl);
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.code, 'DOWNLOAD_TOO_LARGE');
    assert.match(body.error, /20001 responses/);
    assert.match(body.error, /Results page/);
    assert.equal(bodyReads(), 0);
  });

  it('stops loading at the row cap + 1 and at the byte budget', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, project_id: 'proj_1_abc', created_at: `2026-11-0${i + 1}T00:00:00Z`, responses: { x: 'y'.repeat(100) } }));
    db = fakeSupabase({ responses: many });
    const env = baseEnv();
    const { fetchAllResponses } = await import('../agent/resultsHandlers.mjs');
    assert.equal((await fetchAllResponses(env, 'proj_1_abc', { maxRows: 5 })).length, 5);
    const before = db.calls.length;
    await assert.rejects(fetchAllResponses(env, 'proj_1_abc', { maxRows: 3 }), (err) => err.code === 'TOO_MANY_RESPONSES' && err.status === 413);
    const asked = db.calls.slice(before).map((c) => Number(new URLSearchParams(c.query).get('limit')));
    assert.deepEqual(asked, [4]);
    await assert.rejects(fetchAllResponses(env, 'proj_1_abc', { maxBytes: 300 }), (err) => err.code === 'PAYLOAD_TOO_LARGE');
    assert.equal((await fetchAllResponses(env, 'proj_1_abc', { maxBytes: 100000 })).length, 5);
    assert.equal((await fetchAllResponses(env, 'proj_1_abc')).length, 5);
  });

  it('includes practice runs when the survey itself includes them', async () => {
    db = fakeSupabase({ projects: [projectRow({ survey_config_draft: { ...classic, includeResearcherPractice: true } })], responses: rows });
    const env = baseEnv();
    globalThis.__env = env;
    const link = await callTool(env, 'survey_download_url', { projectId: 'proj_1_abc' });
    const files = unzipSync(new Uint8Array(await (await route('GET', link.body.downloadUrl)).arrayBuffer()));
    const raw = strFromU8(files[Object.keys(files).find((n) => n.endsWith('/responses_raw.json'))]);
    assert.deepEqual(JSON.parse(raw).map((r) => r.id).sort(), ['r1', 'r2']);
  });

  it('streams responses_raw.json exactly as JSON.stringify writes it, and the ZIP without breaking characters', async () => {
    const { rawJsonPieces, zipDataStream } = await import('../agent/resultsDownload.mjs');
    const sample = [{ id: 'a', n: 1, nested: { list: [1, { x: '雨 "q"\n' }], empty: {}, arr: [] } }, { id: 'b' }];
    assert.equal([...rawJsonPieces(sample, 10)].join(''), `${JSON.stringify(sample, null, 2)}\n`);
    assert.equal([...rawJsonPieces([])].join(''), `${JSON.stringify([], null, 2)}\n`);
    // Slices fall on surrogate pairs here (an odd offset before the emoji).
    const big = `a${'😀'.repeat(400000)}end`;
    const stream = zipDataStream('f', [{ path: 'a.txt', content: big }, { path: 'b.txt', content: () => ['x', 'y'] }]);
    const files = unzipSync(new Uint8Array(await new Response(stream).arrayBuffer()));
    assert.equal(strFromU8(files['f/a.txt']), big);
    assert.equal(strFromU8(files['f/b.txt']), 'xy');
  });
});

describe('template_publish ownership with a browser session', () => {
  it('publishes only a project the admin owns, with media copied from the owner\'s folder', async () => {
    const library = [{ url: 'https://media.example/owner-1/proj_1_abc/images/a__1.jpg', name: 'a.jpg', key: 'owner-1/proj_1_abc/images/a__1.jpg', folder: 'images' }];
    db = fakeSupabase({ projects: [projectRow({ user_id: 'owner-1', preloaded_images: library })], admins: [{ user_id: 'admin-3' }, { user_id: 'owner-1' }] });
    const env = baseEnv();
    env.R2_BUCKET.objects.set(library[0].key, { bytes: new Uint8Array([9]), uploaded: new Date() });
    const args = { projectId: 'proj_1_abc', name: 'Street perception', author: 'Sijie Yang', year: '2026', confirm: true };
    const other = await callAs(env, { kind: 'supabase', userId: 'admin-3', accessToken: 'jwt' }, 'template_publish', args);
    assert.equal(other.body.code, 'FORBIDDEN');
    assert.match(other.body.error, /project owner/);
    assert.equal(db.tables.templates.length, 0);
    const own = await callAs(env, { kind: 'supabase', userId: 'owner-1', accessToken: 'jwt' }, 'template_publish', args);
    assert.equal(own.isError, false, JSON.stringify(own.body));
    const [tpl] = db.tables.templates;
    assert.equal(tpl.preloaded_images[0].key, `templates/${own.body.templateId}/images/a__1.jpg`);
    assert.ok(env.R2_BUCKET.objects.has(tpl.preloaded_images[0].key));
  });
});

describe('survey_replace_draft keeps the page as stored', () => {
  const html = `${AS_IS_PAGE}<!-- page -->`;
  const stored = { title: 'Walk', pages: [], spSite: { id: 'site-abc', version: '1.0', html, allowedHosts: ['cdn.example.org'], convertedFrom: 'index.html' } };

  it('answers a stale draft with CONFLICT before checking the page, for both token kinds', async () => {
    db = fakeSupabase({ projects: [projectRow({ survey_config_draft: stored, survey_config: stored })] });
    const env = baseEnv();
    const stale = { projectId: 'proj_1_abc', surveyConfig: { ...stored, spSite: { id: 'site-other' } }, expectedDraftUpdatedAt: '2026-10-01T00:00:00.000Z' };
    assert.equal((await callTool(env, 'survey_replace_draft', stale)).body.code, 'CONFLICT');
    assert.equal((await callAs(env, { kind: 'supabase', userId: 'u1', accessToken: 'jwt' }, 'survey_replace_draft', stale)).body.code, 'CONFLICT');
  });

  it('refuses new page HTML and keeps the stored hosts', async () => {
    db = fakeSupabase({ projects: [projectRow({ survey_config_draft: stored, survey_config: stored })] });
    const env = baseEnv();
    const changed = await callTool(env, 'survey_replace_draft', {
      projectId: 'proj_1_abc', surveyConfig: { ...stored, spSite: { ...stored.spSite, html: '<html><body>new</body></html>' } }, expectedDraftUpdatedAt: '2026-11-01T00:00:00.000Z',
    });
    assert.equal(changed.body.code, 'SITE_HTML_CHANGED');
    assert.match(changed.body.error, /sp_scheme_import/);

    const read = await callTool(env, 'survey_get_draft', { projectId: 'proj_1_abc' });
    const widened = { ...read.body.surveyConfig, spSite: { ...read.body.surveyConfig.spSite, allowedHosts: ['evil.example'], mediaFolders: ['images'] } };
    const saved = await callTool(env, 'survey_replace_draft', { projectId: 'proj_1_abc', surveyConfig: widened, expectedDraftUpdatedAt: read.body.draftUpdatedAt });
    assert.equal(saved.isError, false, JSON.stringify(saved.body));
    const site = db.tables.projects[0].survey_config_draft.spSite;
    assert.equal(site.html, html);
    assert.deepEqual(site.allowedHosts, ['cdn.example.org']);
    assert.deepEqual(site.mediaFolders, ['images']);
  });
});

function httpPut(port, path, body, type) {
  return new Promise((resolve, reject) => {
    const headers = { 'content-length': body.length, ...(type ? { 'content-type': type } : {}) };
    const req = http.request({ host: '127.0.0.1', port, path, method: 'PUT', headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(Buffer.from(body));
  });
}

describe('local server (server.js) and upload links', () => {
  it('stores the zip byte for byte, whatever content type the client sends', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET_NAME: 'bucket', R2_PUBLIC_URL: 'https://media.example', SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    });
    delete process.env.REMOTE_AGENT_BASE_URL;
    delete process.env.MCP_SIGNING_SECRET;
    const stored = new Map();
    const original = globalThis.fetch;
    // R2 over its S3 API, in memory.
    globalThis.fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (!url.hostname.endsWith('r2.cloudflarestorage.com')) return original(input, init);
      if (req.method === 'PUT') {
        stored.set(decodeURIComponent(url.pathname), new Uint8Array(await req.arrayBuffer()));
        return new Response('');
      }
      if (req.method === 'GET' && url.searchParams.get('list-type')) return new Response('<ListBucketResult></ListBucketResult>');
      return new Response('', { status: 404 });
    };
    const { app } = createRequire(import.meta.url)('../../server.js');
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => { server.once('listening', resolve); });
    try {
      const { signTransferToken } = await import('./transferTokens.mjs');
      const zip = zipSync({ 'index.html': strToU8('<html><body>hi</body></html>'), 'images/a.jpg': new Uint8Array([0xff, 0xd8, 0x26, 0x3d, 0x25, 0x00, 0x01]) });
      const types = ['application/x-www-form-urlencoded', 'application/octet-stream', 'application/zip', 'application/json', null];
      for (let i = 0; i < types.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const { token } = await signTransferToken({ SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' }, { kind: 'upload', userId: 'u1', uploadId: `upload-${i}` }, 60);
        // eslint-disable-next-line no-await-in-loop
        const res = await httpPut(server.address().port, `/api/mcp/upload/${token}`, zip, types[i]);
        assert.equal(res.status, 200, `${types[i]}: ${res.body}`);
        assert.deepEqual(stored.get(`/bucket/_mcp-staging/u1/upload-${i}`), zip, String(types[i]));
      }
    } finally {
      await new Promise((resolve) => { server.close(resolve); });
      globalThis.fetch = original;
      Object.keys(process.env).forEach((key) => { if (!(key in saved)) delete process.env[key]; });
      Object.assign(process.env, saved);
    }
  });
});

describe('tools/list for the Claude connector directory', () => {
  async function listAs(userId) {
    const { handleMcpRequest } = await import('./server.mjs');
    const res = await handleMcpRequest(new Request('https://sp-survey.org/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), baseEnv(), { kind: 'mcp', userId, scopes: [] });
    return (await res.json()).result.tools;
  }

  it('gives every tool a title and read-only / destructive hints, with short names', async () => {
    db = fakeSupabase({ admins: [{ user_id: 'admin-1' }] });
    const tools = await listAs('admin-1');
    assert.ok(tools.length > 40);
    for (const tool of tools) {
      assert.ok(tool.name.length <= 64, tool.name);
      assert.ok(tool.title && tool.annotations?.title === tool.title, `${tool.name} has a title`);
      assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', tool.name);
      assert.equal(typeof tool.annotations.destructiveHint, 'boolean', tool.name);
      assert.equal(tool.annotations.openWorldHint, false, tool.name);
      if (tool.annotations.readOnlyHint) assert.equal(tool.annotations.destructiveHint, false, tool.name);
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    for (const name of ['survey_delete_project', 'media_delete', 'survey_delete_response', 'survey_replace_draft', 'survey_rollback', 'sp_scheme_import']) {
      assert.equal(byName[name].destructiveHint, true, name);
    }
    for (const name of ['survey_list_projects', 'survey_results_summary', 'survey_get_draft', 'sp_scheme_spec']) {
      assert.equal(byName[name].readOnlyHint, true, name);
    }
  });

  it('shows admin-only tools to platform admins only', async () => {
    db = fakeSupabase({ admins: [{ user_id: 'admin-1' }] });
    const { ADMIN_ONLY_TOOLS } = await import('./server.mjs');
    const adminNames = (await listAs('admin-1')).map((t) => t.name);
    const userNames = (await listAs('user-2')).map((t) => t.name);
    for (const name of ADMIN_ONLY_TOOLS) {
      assert.ok(adminNames.includes(name), `admin sees ${name}`);
      assert.ok(!userNames.includes(name), `user does not see ${name}`);
    }
    assert.ok(userNames.includes('sp_scheme_import'));
    const denied = await callTool(baseEnv(), 'paper_list', {}, { userId: 'user-2', scopes: ['surveys:read'] });
    assert.equal(denied.isError, true);
    assert.equal(denied.body.code, 'ADMIN_ONLY');
  });

  it('answers initialize with a supported protocol version', async () => {
    const { handleMcpRequest } = await import('./server.mjs');
    const init = async (protocolVersion) => (await (await handleMcpRequest(new Request('https://sp-survey.org/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion } }) }), {}, { kind: 'mcp', userId: 'u1', scopes: [] })).json()).result;
    assert.equal((await init('2025-06-18')).protocolVersion, '2025-06-18');
    assert.equal((await init('2025-11-25')).protocolVersion, '2025-11-25');
    assert.equal((await init('1999-01-01')).protocolVersion, '2025-06-18');
    assert.equal((await init('2025-06-18')).serverInfo.title, 'SP-Survey');
  });

  it('returns OAuth errors from the token endpoint (invalid_grant for a bad refresh token)', async () => {
    db = fakeSupabase({ extraTables: { mcp_refresh_tokens: [] } });
    globalThis.__env = baseEnv();
    const res = await route('POST', 'https://sp-survey.org/oauth/token', 'grant_type=refresh_token&refresh_token=nope&client_id=c1', { 'content-type': 'application/x-www-form-urlencoded' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'invalid_grant');
    assert.match(body.error_description, /refresh token/i);
    const missing = await (await route('POST', 'https://sp-survey.org/oauth/token', 'grant_type=authorization_code', { 'content-type': 'application/x-www-form-urlencoded' })).json();
    assert.equal(missing.error, 'invalid_request');
    const odd = await (await route('POST', 'https://sp-survey.org/oauth/token', 'grant_type=client_credentials', { 'content-type': 'application/x-www-form-urlencoded' })).json();
    assert.equal(odd.error, 'unsupported_grant_type');
  });
});

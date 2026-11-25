/**
 * MCP: SP-Scheme import, publish links, data download, template publishing and
 * draft trimming, against an in-memory Supabase and R2.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { buildExampleSite } from '../../src/lib/spScheme.js';
import { handleAgentAndMcpRoutes } from '../agent/router.mjs';
import { baseEnv, callTool, fakeSupabase, projectRow } from './fakePlatform.testkit.mjs';

const AS_IS_PAGE = '<!doctype html><html><head><title>Walk</title></head><body><img id="a"><script>const PHOTOS = []; localStorage.setItem("answers", "{}");</script></body></html>';

let db = null;
afterEach(() => { db?.restore(); db = null; });

function route(method, url, body, headers = {}) {
  return handleAgentAndMcpRoutes(new Request(url, { method, body, headers }), globalThis.__env);
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
    for (const name of ['sp_scheme_spec', 'sp_scheme_upload_url', 'sp_scheme_import', 'survey_download_url', 'template_publish']) assert.ok(names.includes(name), name);
    assert.equal(names[1], 'sp_scheme_spec');

    const env = baseEnv();
    const denied = await callTool(env, 'sp_scheme_import', { html: AS_IS_PAGE }, { scopes: ['surveys:write'] });
    assert.equal(denied.isError, true);
    assert.match(denied.body.error, /media:write/);
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
    assert.equal(link.body.maxBytes, 50 * 1024 * 1024);
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
    const tooBig = await route('PUT', link.body.uploadUrl, 'x', { 'content-length': String(50 * 1024 * 1024 + 1) });
    assert.equal(tooBig.status, 413);
    const empty = await route('PUT', link.body.uploadUrl, new Uint8Array(0));
    assert.equal(empty.status, 400);

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
    assert.deepEqual(JSON.parse(read('responses_raw.json')).map((r) => r.id), ['r1', 'r2']);
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

    const again = await callTool(env, 'template_publish', { ...args, templateId: '2026-sijie-street', name: 'Street perception v2', showOnLanding: false });
    assert.equal(again.isError, false, JSON.stringify(again.body));
    assert.equal(again.body.created, false);
    assert.equal(db.tables.templates.length, 1);
    assert.equal(db.tables.templates[0].name, 'Street perception v2');
    assert.equal(db.tables.templates[0].show_on_landing, false);
    assert.deepEqual(db.tables.templates[0].tags, ['streets']);

    const unknown = await callTool(env, 'template_publish', { ...args, templateId: 'no-such-template' });
    assert.equal(unknown.body.code, 'TEMPLATE_NOT_FOUND');
    const badId = await callTool(env, 'template_publish', { ...args, templateId: '../x' });
    assert.equal(badId.body.code, 'INVALID_TEMPLATE_ID');
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

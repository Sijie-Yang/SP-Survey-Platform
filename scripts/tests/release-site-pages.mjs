// release_site_pages.sql: an SP-Scheme page (spSite.html) can be released without
// question pages; empty drafts still cannot. Run twice on pglite; no remote database.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role', true) $$;
  GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated;
  CREATE TABLE public.projects (
    id text PRIMARY KEY, user_id uuid, name text, survey_config jsonb, survey_config_draft jsonb,
    survey_config_published jsonb, draft_updated_at timestamptz, updated_at timestamptz, last_writer jsonb,
    image_dataset_config jsonb, preloaded_images jsonb, preloaded_at timestamptz, preloaded_source text,
    release_managed boolean NOT NULL DEFAULT false, published_media jsonb, published_at timestamptz,
    published_version integer NOT NULL DEFAULT 0
  );
  CREATE TABLE public.project_config_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id text, version integer, config jsonb,
    media_snapshot jsonb, published_by uuid, change_summary text, published_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE FUNCTION public.is_project_collaborator(p_project_id text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  GRANT EXECUTE ON FUNCTION public.is_project_collaborator(text) TO authenticated;
`);

const sql = await readFile(new URL('../../supabase/release_site_pages.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec(sql);

const STAMP = '2026-11-25T00:00:00Z';
const page = '<!doctype html><html><body><script>localStorage.setItem("a", "1")</script></body></html>';
async function project(id, draft) {
  await db.query('INSERT INTO projects(id, user_id, survey_config, survey_config_draft, draft_updated_at, preloaded_images) VALUES($1, $2, $3, $3, $4, $5)',
    [id, OWNER, draft, STAMP, [{ key: 'k', url: 'https://media.example/k', folder: 'images' }]]);
}
async function as(role, uid) {
  await db.exec(`SELECT set_config('test.role', '${role}', false); SELECT set_config('test.uid', '${uid || ''}', false);`);
}
const release = async (id, owner = null) => (await db.query('SELECT release_project_version($1, $2, $3, NULL, $4) AS result', [id, STAMP, 'test', owner])).rows[0].result;

await project('site', { pages: [], spSite: { id: 'site-1', html: page, convertedFrom: 'index.html' } });
await project('site-no-pages-key', { spSite: { id: 'site-2', html: page } });
await project('native', { pages: [{ name: 'p', elements: [{ type: 'rating', name: 'q' }] }] });
await project('empty', { pages: [] });
await project('empty-html', { pages: [], spSite: { id: 'site-3', html: '' } });
await project('object-html', { pages: [], spSite: { id: 'site-4', html: { bytes: 10 } } });
await project('pages-object', { pages: { name: 'p' } });

await as('service_role');
const first = await release('site', OWNER);
assert.equal(first.publishedVersion, 1);
const row = (await db.query("SELECT release_managed, survey_config_published, published_media FROM projects WHERE id = 'site'")).rows[0];
assert.equal(row.release_managed, true);
assert.equal(row.survey_config_published.spSite.html, page);
assert.equal(row.published_media.preloadedImages[0].folder, 'images');
assert.equal((await release('site-no-pages-key', OWNER)).publishedVersion, 1);

await as('authenticated', OWNER);
assert.equal((await release('native')).publishedVersion, 1);
for (const id of ['empty', 'empty-html', 'object-html', 'pages-object']) {
  await assert.rejects(release(id), /draft has no pages/, id);
}

await as('authenticated', OTHER);
await assert.rejects(release('site'), /project not found/);
await as('anon', '');
await db.exec('SET ROLE anon');
await assert.rejects(release('site'), /permission denied/);
await db.exec('RESET ROLE');
await db.close();
console.log('PASS: SP-Scheme pages release without question pages; empty drafts, empty or non-text pages still fail; owner checks and grants unchanged; re-runnable.');

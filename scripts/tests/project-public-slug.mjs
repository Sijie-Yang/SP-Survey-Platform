// Apply the custom-link SQL twice. Temporary @electric-sql/pglite, no remote DB.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const owner = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';

await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
    SELECT NULLIF(current_setting('test.uid', true), '')::uuid
  $$;
  CREATE TABLE public.projects (
    id text PRIMARY KEY,
    user_id uuid,
    name text,
    updated_at timestamptz
  );
  ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.projects FROM anon, authenticated;
  SELECT set_config('test.uid', '${owner}', false);
`);

const sql = await readFile('supabase/project_public_slug.sql', 'utf8');
await db.exec(sql);
await db.exec(sql);

await db.exec(`
  INSERT INTO public.projects (id, user_id, name) VALUES
    ('legacy', '${owner}', 'Legacy'),
    ('owned', '${owner}', 'Owned'),
    ('other', '${other}', 'Other');
`);

const setSlug = (id, slug) => db.query(
  'SELECT set_project_public_slug($1, $2) AS result',
  [id, slug],
);

const saved = (await setSlug('owned', 'Campus-Study')).rows[0].result;
assert.equal(saved.publicSlug, 'campus-study');
assert.equal((await db.query(`SELECT id FROM public.projects WHERE id = 'legacy'`)).rows[0].id, 'legacy');
assert.equal((await db.query(`SELECT public_slug FROM public.projects WHERE id = 'legacy'`)).rows[0].public_slug, null);
assert.equal((await db.query(`SELECT resolve_survey_slug('legacy') AS id`)).rows[0].id, null);
assert.equal((await db.query(`SELECT resolve_survey_slug('Campus-Study') AS id`)).rows[0].id, 'owned');
assert.equal((await db.query(`SELECT id FROM public.projects WHERE id = 'owned'`)).rows[0].id, 'owned');

await assert.rejects(setSlug('owned', 'admin'), /slug_reserved/);
await assert.rejects(setSlug('owned', 'API'), /slug_reserved/);
await assert.rejects(setSlug('owned', 's'), /slug_reserved/);
await assert.rejects(setSlug('owned', 'survey'), /slug_reserved/);
await assert.rejects(setSlug('owned', 'login'), /slug_reserved/);
await assert.rejects(setSlug('owned', 'a'), /slug_invalid/);
await assert.rejects(setSlug('owned', 'my--study'), /slug_invalid/);
await assert.rejects(setSlug('other', 'mine'), /not_owner/);

await db.exec(`SELECT set_config('test.uid', '${other}', false)`);
await assert.rejects(setSlug('other', 'campus-study'), /slug_taken/);
const second = (await setSlug('other', 'second-study')).rows[0].result;
assert.equal(second.publicSlug, 'second-study');

await db.exec(`SELECT set_config('test.uid', '${owner}', false)`);
const cleared = (await setSlug('owned', '  ')).rows[0].result;
assert.equal(cleared.publicSlug, null);
assert.equal((await db.query(`SELECT resolve_survey_slug('campus-study') AS id`)).rows[0].id, null);
await setSlug('owned', 'campus-study');

await db.exec(`SELECT set_config('test.uid', '', false); SET ROLE anon;`);
assert.equal((await db.query(`SELECT resolve_survey_slug('campus-study') AS id`)).rows[0].id, 'owned');
await assert.rejects(setSlug('owned', 'hijack'), /not_authenticated|permission denied/);
await db.exec('RESET ROLE');
assert.equal((await db.query(`SELECT id, public_slug FROM public.projects WHERE id = 'owned'`)).rows[0].public_slug, 'campus-study');

await db.close();
console.log('PASS: custom slugs are unique, reserved names are blocked, owners only can set them, anonymous resolve works, and project ids remain addressable.');

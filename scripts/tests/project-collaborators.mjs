// Collaborator SQL: membership is per project. Re-run the script twice on pglite.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();

const OWNER = '11111111-1111-1111-1111-111111111111';
const FRIEND = '22222222-2222-2222-2222-222222222222';
const STRANGER = '33333333-3333-3333-3333-333333333333';

await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (
    id uuid PRIMARY KEY,
    email text,
    raw_user_meta_data jsonb
  );
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
    SELECT NULLIF(current_setting('test.uid', true), '')::uuid
  $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$
    SELECT current_setting('test.role', true)
  $$;
  GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated;

  CREATE TABLE public.projects (
    id text PRIMARY KEY,
    user_id uuid,
    name text,
    description text,
    survey_config jsonb,
    survey_config_draft jsonb,
    survey_config_published jsonb,
    draft_updated_at timestamptz,
    updated_at timestamptz,
    revision_id text,
    last_writer jsonb,
    image_dataset_config jsonb,
    preloaded_images jsonb,
    preloaded_at timestamptz,
    preloaded_source text,
    template_id text,
    metadata jsonb,
    release_managed boolean NOT NULL DEFAULT false,
    published_media jsonb,
    published_at timestamptz,
    published_version integer NOT NULL DEFAULT 0
  );
  CREATE TABLE public.project_config_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id text,
    version integer,
    config jsonb,
    media_snapshot jsonb,
    published_by uuid,
    change_summary text,
    published_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.survey_responses (
    id bigserial PRIMARY KEY,
    project_id text,
    responses jsonb
  );
  CREATE OR REPLACE FUNCTION public.write_audit_event(
    p_action text, p_project_id text, p_resource_type text, p_resource_id text, p_metadata jsonb
  ) RETURNS uuid LANGUAGE plpgsql AS $$
  BEGIN
    RETURN gen_random_uuid();
  END;
  $$;
  CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;

  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('${OWNER}', 'owner@example.com', '{"full_name":"周宁"}'),
    ('${FRIEND}', 'lin@example.com', '{"name":"林夏"}'),
    ('${STRANGER}', 'stranger@example.com', '{}');

  INSERT INTO public.projects (id, user_id, name, survey_config, survey_config_draft, draft_updated_at, image_dataset_config, preloaded_images)
  VALUES
    ('p1', '${OWNER}', 'Shared study', '{"title":"Old"}', '{"title":"Old","pages":[{"name":"p"}]}', '2026-10-08T00:00:00Z', '{}', '[]'),
    ('p2', '${STRANGER}', 'Private study', '{"title":"Secret"}', '{"title":"Secret","pages":[{"name":"p"}]}', '2026-10-08T00:00:00Z', '{}', '[]');

  INSERT INTO public.survey_responses (project_id, responses) VALUES
    ('p1', '{"q":1}'),
    ('p2', '{"q":2}');

  ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users manage their own projects" ON public.projects
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  CREATE POLICY "survey_responses_owner_select" ON public.survey_responses
    FOR SELECT TO authenticated
    USING (
      project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = survey_responses.project_id AND p.user_id = auth.uid()
      )
    );
`);

const sql = await readFile(new URL('../../supabase/project_collaborators.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec(sql);

await db.exec(`
  ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.survey_responses FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.project_collaborators FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.project_presence FORCE ROW LEVEL SECURITY;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
  GRANT SELECT, DELETE ON public.survey_responses TO authenticated;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
`);

async function asUser(id) {
  await db.exec('RESET ROLE');
  await db.exec(`SELECT set_config('test.uid', '${id}', false)`);
  await db.exec(`SELECT set_config('test.role', 'authenticated', false)`);
  await db.exec('SET ROLE authenticated');
}

async function asSuper() {
  await db.exec('RESET ROLE');
  await db.exec(`SELECT set_config('test.role', 'service_role', false)`);
}

function rejects(promise, pattern) {
  return promise.then(
    () => { throw new Error(`expected failure matching ${pattern}`); },
    (error) => {
      assert.match(String(error?.message || error), pattern);
    },
  );
}

await asUser(OWNER);
const added = await db.query(`SELECT public.add_project_collaborator('p1', ' Lin@Example.com ') AS member`);
const member = added.rows[0].member;
assert.equal(member.email, 'lin@example.com');
assert.equal(member.displayName, '林夏');
assert.equal(member.userId, FRIEND);

await rejects(
  db.exec(`SELECT public.add_project_collaborator('p1', 'missing@example.com')`),
  /no account for that email/,
);
await asUser(OWNER);
await rejects(
  db.exec(`SELECT public.add_project_collaborator('p1', 'owner@example.com')`),
  /already own this project/,
);

await asUser(FRIEND);
await rejects(
  db.exec(`SELECT public.add_project_collaborator('p1', 'stranger@example.com')`),
  /only the project owner can add a collaborator/,
);
await rejects(
  db.exec(`SELECT public.add_project_collaborator('p2', 'owner@example.com')`),
  /only the project owner can add a collaborator/,
);

await asUser(FRIEND);
await db.exec(`SELECT public.save_project_draft('p1', '{"title":"A","pages":[{"name":"p"}]}'::jsonb, NULL, '{"source":"human"}'::jsonb, NULL)`);
await db.exec(`SELECT public.save_project_draft('p1', '{"title":"B","pages":[{"name":"p"}]}'::jsonb, NULL, '{"source":"human"}'::jsonb, NULL)`);
await rejects(
  db.exec(`SELECT public.save_project_draft('p2', '{"title":"Stolen","pages":[{"name":"p"}]}'::jsonb, NULL, '{}'::jsonb, NULL)`),
  /project not found/,
);

await asUser(STRANGER);
await rejects(
  db.exec(`SELECT public.save_project_draft('p1', '{"title":"Nope","pages":[{"name":"p"}]}'::jsonb, NULL, '{}'::jsonb, NULL)`),
  /project not found/,
);

await asSuper();
const saved = await db.query(`SELECT user_id, survey_config->>'title' AS title FROM public.projects WHERE id = 'p1'`);
assert.equal(saved.rows[0].user_id, OWNER);
assert.equal(saved.rows[0].title, 'B');
const untouched = await db.query(`SELECT survey_config->>'title' AS title FROM public.projects WHERE id = 'p2'`);
assert.equal(untouched.rows[0].title, 'Secret');

await asUser(FRIEND);
const sharedProjects = await db.query(`SELECT id FROM public.projects ORDER BY id`);
assert.deepEqual(sharedProjects.rows.map((row) => row.id), ['p1']);
const sharedResponses = await db.query(`SELECT project_id FROM public.survey_responses ORDER BY project_id`);
assert.deepEqual(sharedResponses.rows.map((row) => row.project_id), ['p1']);
await db.exec(`UPDATE public.projects SET name = 'Edited by collaborator' WHERE id = 'p1'`);
await rejects(
  db.exec(`UPDATE public.projects SET user_id = '${FRIEND}' WHERE id = 'p1'`),
  /only the project owner can transfer this project/,
);

await asUser(STRANGER);
const strangerProjects = await db.query(`SELECT id FROM public.projects ORDER BY id`);
assert.deepEqual(strangerProjects.rows.map((row) => row.id), ['p2']);
const strangerResponses = await db.query(`SELECT project_id FROM public.survey_responses ORDER BY project_id`);
assert.deepEqual(strangerResponses.rows.map((row) => row.project_id), ['p2']);

await asUser(OWNER);
const ownerResponses = await db.query(`SELECT project_id FROM public.survey_responses ORDER BY project_id`);
assert.deepEqual(ownerResponses.rows.map((row) => row.project_id), ['p1']);
const ownerPresent = await db.query(`SELECT public.touch_project_presence('p1') AS present`);
assert.deepEqual(ownerPresent.rows[0].present, []);

await asUser(FRIEND);
const friendPresent = await db.query(`SELECT public.touch_project_presence('p1') AS present`);
assert.equal(friendPresent.rows[0].present.length, 1);
assert.equal(friendPresent.rows[0].present[0].displayName, '周宁');
await db.exec(`SELECT public.clear_project_presence('p1')`);

await asUser(OWNER);
const afterLeave = await db.query(`SELECT public.touch_project_presence('p1') AS present`);
assert.deepEqual(afterLeave.rows[0].present, []);

await asSuper();
const renamed = await db.query(`SELECT name, user_id FROM public.projects WHERE id = 'p1'`);
assert.equal(renamed.rows[0].name, 'Edited by collaborator');
assert.equal(renamed.rows[0].user_id, OWNER);

console.log('project collaborators: invite, scoped write, responses, presence');

// Apply incremental launch SQL twice. Temporary @electric-sql/pglite, no remote DB.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();

await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
    SELECT NULLIF(current_setting('test.uid', true), '')::uuid
  $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$
    SELECT current_setting('test.role', true)
  $$;
  CREATE TABLE public.projects (
    id text PRIMARY KEY,
    user_id uuid,
    name text,
    survey_config jsonb,
    survey_config_draft jsonb,
    draft_updated_at timestamptz,
    last_writer jsonb,
    updated_at timestamptz
  );
  CREATE TABLE public.project_config_audit (
    id bigserial PRIMARY KEY,
    project_id text,
    writer jsonb,
    created_at timestamptz DEFAULT now()
  );
  CREATE TABLE public.ai_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    project_id text,
    mode text NOT NULL DEFAULT 'designer',
    title text,
    status text NOT NULL DEFAULT 'active',
    provider text,
    model text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.ai_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    project_id text,
    status text NOT NULL DEFAULT 'queued',
    provider text,
    model text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.ai_agent_inbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    target text NOT NULL CHECK (target IN ('next-turn', 'next-step')),
    kind text NOT NULL DEFAULT 'followup',
    content text NOT NULL,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'claimed', 'discarded')),
    created_at timestamptz NOT NULL DEFAULT now(),
    claimed_at timestamptz
  );
  CREATE TABLE public.silicon_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id text,
    user_id uuid,
    status text NOT NULL DEFAULT 'draft',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.silicon_responses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid REFERENCES public.silicon_runs(id) ON DELETE CASCADE
  );
  SELECT set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  SELECT set_config('test.role', 'authenticated', false);
`);

const incremental = [
  'supabase/ai_agent_inbox_after_run.sql',
  'supabase/ai_agent_inbox_payload.sql',
  'supabase/save_project_draft_revision_id.sql',
  'supabase/silicon_background_runs.sql',
  'supabase/platform_assistant_subsidy.sql',
];

for (let repeat = 0; repeat < 2; repeat += 1) {
  for (const file of incremental) {
    await db.exec(await readFile(file, 'utf8'));
  }
}

const inboxCols = await db.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'ai_agent_inbox'
`);
assert.equal(inboxCols.rows.some((row) => row.column_name === 'payload'), true);

const runCols = await db.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'ai_runs'
`);
assert.equal(runCols.rows.some((row) => row.column_name === 'parent_run_id'), true);
assert.equal(runCols.rows.some((row) => row.column_name === 'inbox_id'), true);

const siliconCols = await db.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'silicon_runs'
`);
assert.equal(siliconCols.rows.some((row) => row.column_name === 'claimed_by'), true);
assert.equal(siliconCols.rows.some((row) => row.column_name === 'execution_plan'), true);

const units = await db.query(`SELECT to_regclass('public.silicon_answer_units') AS name`);
assert.equal(units.rows[0].name, 'silicon_answer_units');

const subsidy = await db.query(`SELECT to_regclass('public.platform_assistant_subsidy') AS name`);
assert.equal(subsidy.rows[0].name, 'platform_assistant_subsidy');

const fns = await db.query(`
  SELECT proname FROM pg_proc
  WHERE proname IN ('claim_silicon_run', 'claim_silicon_unit', 'save_project_draft')
`);
assert.deepEqual(
  fns.rows.map((row) => row.proname).sort(),
  ['claim_silicon_run', 'claim_silicon_unit', 'save_project_draft'],
);

console.log('incremental SQL re-ran twice');

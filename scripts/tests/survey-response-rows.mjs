// survey_response_rows RPC: rows restored from it equal `select *`; contracts sent once; RLS still applies.
// Run with a temporary @electric-sql/pglite install; no remote database access.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { restoreResponseContracts } from '../../src/lib/slimResponses.js';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE public.projects (id text PRIMARY KEY, user_id uuid);
  CREATE TABLE public.survey_responses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz DEFAULT now(),
    participant_id text,
    responses jsonb,
    displayed_images jsonb,
    survey_metadata jsonb
  );
  GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role, anon;
  GRANT SELECT ON public.projects, public.survey_responses TO authenticated, service_role, anon;
`);
await db.exec(await readFile('supabase/survey_responses_owner_read.sql', 'utf8'));
for (let i = 0; i < 2; i += 1) await db.exec(await readFile('supabase/survey_response_rows.sql', 'utf8'));

const contract = (title) => ({ version: 2, title, questions: [{ name: 'safe', type: 'imagepicker', selectedImageUrls: ['https://m/1.jpg', 'https://m/2.jpg'], conditionVariants: [{ condition: 'B', title: 'Less safe?' }] }] });
await db.query(`INSERT INTO projects VALUES ('p', $1), ('q', $2)`, [OWNER, OTHER]);
for (let i = 0; i < 6; i += 1) {
  await db.query(
    `INSERT INTO survey_responses (created_at, project_id, participant_id, responses, displayed_images, survey_metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), i === 5 ? 'q' : 'p', `p${i}`,
      { safe: { trials: [{ value: 'https://m/1.jpg', shown_images: ['https://m/1.jpg', 'https://m/2.jpg'], shown_at: '2026-10-01T00:00:00Z' }] } },
      { safe: ['https://m/1.jpg', 'https://m/2.jpg'] },
      {
        survey_revision: i < 3 ? 'v1' : 'v2', condition: i % 2 ? 'B' : 'A', url_params: { site: 'S1' }, completion_code: `c${i}`,
        ...(i === 4 ? {} : { survey_response_contract: contract(i < 3 ? 'one' : 'two') }),
      },
    ],
  );
}

const ids = (await db.query(`SELECT id::text FROM survey_responses WHERE project_id = 'p' ORDER BY created_at DESC`)).rows.map((r) => r.id);
const plain = async () => (await db.query(`SELECT coalesce(json_agg(t), '[]')::text AS j FROM (SELECT * FROM survey_responses WHERE project_id = 'p' ORDER BY created_at DESC) t`)).rows[0].j;
const rpc = async (known = []) => JSON.parse((await db.query(`SELECT survey_response_rows('p', $1, $2)::text AS j`, [ids, known])).rows[0].j);

await db.exec(`SELECT set_config('test.uid', '${OWNER}', false); SET ROLE authenticated;`);
const expected = await plain();
const page = await rpc();
assert.equal(page.rows.length, 5);
assert.equal(Object.keys(page.contracts).length, 2, 'two distinct contracts, sent once each');
assert.equal(page.refs.filter((ref) => ref === null).length, 1, 'row without a contract keeps no reference');
assert.ok(page.rows.every((row) => !('survey_response_contract' in row.survey_metadata)));
const byId = new Map(page.rows.map((row, i) => [row.id, { ...row, ...(page.refs[i] ? { _contract_ref: page.refs[i] } : {}) }]));
const restored = restoreResponseContracts(ids.map((id) => byId.get(id)), page.contracts);
assert.equal(JSON.stringify(restored), JSON.stringify(JSON.parse(expected)), 'restored rows equal select *');

const knownKey = Object.keys(page.contracts)[0];
const again = await rpc([knownKey]);
assert.deepEqual(Object.keys(again.contracts), Object.keys(page.contracts).filter((key) => key !== knownKey));

const otherIds = (await db.query(`SELECT id::text FROM survey_responses`)).rows.map((r) => r.id);
await db.exec(`SELECT set_config('test.uid', '${OTHER}', false);`);
assert.equal((await rpc()).rows.length, 0, 'RLS hides another owner\'s rows');
assert.equal(JSON.parse((await db.query(`SELECT survey_response_rows('p', $1)::text AS j`, [otherIds])).rows[0].j).rows.length, 0);

await db.exec(`RESET ROLE; SET ROLE anon;`);
await assert.rejects(() => db.query(`SELECT survey_response_rows('p', $1)`, [ids]), /permission denied/);
await db.exec('RESET ROLE');
console.log('survey_response_rows SQL test passed');

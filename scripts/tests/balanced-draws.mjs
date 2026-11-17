// Apply the balanced-draws SQL twice and exercise handing out participant numbers:
// gap-free numbers, abandoned starts handed out again, a saved response marks its number used.
// Temporary @electric-sql/pglite, no remote DB.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const sql = await readFile('supabase/balanced_draws.sql', 'utf8');
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE TABLE public.projects (id TEXT PRIMARY KEY);
  CREATE TABLE public.survey_responses (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id TEXT, participant_id TEXT,
    responses JSONB, displayed_images JSONB, survey_metadata JSONB, created_at TIMESTAMPTZ DEFAULT now());
  INSERT INTO public.projects VALUES ('p1'), ('p2');
`);
await db.exec(sql);
await db.exec(sql); // safe to run again
const claim = async (p = 'p1') => (await db.query('SELECT public.claim_balance_number($1) AS r', [p])).rows[0].r;
await assert.rejects(() => claim('nope'), /unknown project/);
const a = await claim(), b = await claim(), c = await claim();
assert.deepEqual([a.n, b.n, c.n], [0, 1, 2]);
assert.equal((await claim('p2')).n, 0, 'projects are independent');
// 1 finishes; 0 and 2 walk away
assert.equal((await db.query('SELECT public.complete_balance_claim($1) AS ok', [b.claim_id])).rows[0].ok, true);
assert.equal((await db.query('SELECT public.complete_balance_claim($1) AS ok', ['00000000-0000-0000-0000-000000000000'])).rows[0].ok, false);
assert.equal((await claim()).n, 3, 'numbers still held are not reused');
await db.query(`UPDATE public.balance_claims SET claimed_at = now() - INTERVAL '31 minutes' WHERE id IN ($1, $2)`, [a.claim_id, c.claim_id]);
const d = await claim(), e = await claim(), f = await claim();
assert.deepEqual([d.n, e.n, f.n], [0, 2, 4], 'abandoned numbers are handed out again, smallest first');
// the response insert marks the number finished
await db.query(`INSERT INTO public.survey_responses (project_id, participant_id, responses, survey_metadata) VALUES ('p1','x','{}', $1)`,
  [JSON.stringify({ balanced_draw: { n: d.n, claim: 'server', claim_id: d.claim_id } })]);
assert.ok((await db.query('SELECT completed_at FROM public.balance_claims WHERE id = $1', [d.claim_id])).rows[0].completed_at);
// a claim id from another project is not completed
await db.query(`INSERT INTO public.survey_responses (project_id, participant_id, responses, survey_metadata) VALUES ('p2','x','{}', $1)`,
  [JSON.stringify({ balanced_draw: { n: 2, claim: 'server', claim_id: e.claim_id } })]);
assert.equal((await db.query('SELECT completed_at FROM public.balance_claims WHERE id = $1', [e.claim_id])).rows[0].completed_at, null);
// nothing in a response can stop it from being saved
for (const meta of [{ balanced_draw: { claim_id: 'not-a-uuid' } }, { balanced_draw: 'text' }, { balanced_draw: { n: 5, claim: 'local', claim_id: null } }, { balanced_draw: null }, {}, null]) {
  await db.query(`INSERT INTO public.survey_responses (project_id, participant_id, responses, survey_metadata) VALUES ('p1','y','{}', $1)`, [meta === null ? null : JSON.stringify(meta)]);
}
assert.equal(Number((await db.query(`SELECT COUNT(*) AS c FROM public.survey_responses WHERE participant_id = 'y'`)).rows[0].c), 6);
// very old abandoned starts are cleaned up
await db.query(`UPDATE public.balance_claims SET claimed_at = now() - INTERVAL '2 days' WHERE id = $1`, [c.claim_id]);
await claim();
assert.equal(Number((await db.query('SELECT COUNT(*) AS c FROM public.balance_claims WHERE id = $1', [c.claim_id])).rows[0].c), 0);
// 300 claims in a row stay gap-free and fast
const t0 = Date.now();
const seen = new Set();
for (let i = 0; i < 300; i += 1) seen.add((await claim('p2')).n);
assert.equal(seen.size, 300);
assert.equal(Math.max(...seen), 300);
console.log(`balanced draws SQL: ok (300 claims in ${Date.now() - t0} ms)`);

// Apply the SP-Forum SQL twice and exercise posting, closing and moderation.
// Temporary @electric-sql/pglite, no remote DB.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const alice = '11111111-1111-1111-1111-111111111111';
const bob = '22222222-2222-2222-2222-222222222222';
const admin = '33333333-3333-3333-3333-333333333333';

await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
    SELECT NULLIF(current_setting('test.uid', true), '')::uuid
  $$;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
  INSERT INTO auth.users VALUES
    ('${alice}', 'alice@example.org', '{"full_name": "Alice Tan"}'),
    ('${bob}', 'bob@example.org', '{}'),
    ('${admin}', 'admin@example.org', '{"full_name": "SP team"}');
  CREATE TABLE public.admins (user_id uuid PRIMARY KEY);
  INSERT INTO public.admins VALUES ('${admin}');
  CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid())
  $$;
`);

const sql = await readFile('supabase/forum.sql', 'utf8');
await db.exec(sql);
await db.exec(sql);

const as = async (uid) => db.exec(`SELECT set_config('test.uid', '${uid || ''}', false)`);
const one = async (q, params = []) => (await db.query(q, params)).rows[0];
const fails = async (q, params, pattern) => {
  await assert.rejects(db.query(q, params), (err) => pattern.test(err.message));
};

// Anonymous visitors cannot post.
await as('');
await fails('SELECT forum_create_thread($1, $2)', ['Hello', 'Body'], /sign in/);

// Alice opens a thread; her profile name is used, never the e-mail.
await as(alice);
const { forum_create_thread: t1 } = await one('SELECT forum_create_thread($1, $2, $3) ', ['How many images per participant?', 'Is 12 pairs enough?', 'help']);
let thread = await one('SELECT * FROM forum_threads WHERE id = $1', [t1]);
assert.equal(thread.author_name, 'Alice Tan');
assert.equal(thread.category, 'help');
assert.equal(thread.status, 'open');
// A double click returns the same thread.
assert.equal((await one('SELECT forum_create_thread($1, $2, $3) AS id', ['How many images per participant?', 'Is 12 pairs enough?', 'help'])).id, t1);
// Only admins post announcements.
await fails('SELECT forum_create_thread($1, $2, $3)', ['News', 'x', 'announcements'], /platform team/);

// Bob (no profile name) replies; his name falls back to "Researcher xxxx".
await as(bob);
const { id: p1 } = await one('SELECT forum_reply($1, $2) AS id', [t1, 'Twelve is the usual minimum.']);
const post = await one('SELECT * FROM forum_posts WHERE id = $1', [p1]);
assert.match(post.author_name, /^Researcher 2222$/);
assert.equal((await one('SELECT reply_count FROM forum_threads WHERE id = $1', [t1])).reply_count, 1);
// A typed display name wins; an e-mail address is refused as a name.
const { id: p2 } = await one('SELECT forum_reply($1, $2, $3) AS id', [t1, 'Another reply', 'Bob L.']);
assert.equal((await one('SELECT author_name FROM forum_posts WHERE id = $1', [p2])).author_name, 'Bob L.');
const { id: p3 } = await one('SELECT forum_reply($1, $2, $3) AS id', [t1, 'Third', 'bob@example.org']);
assert.match((await one('SELECT author_name FROM forum_posts WHERE id = $1', [p3])).author_name, /^Researcher/);

// Bob cannot close or edit Alice's thread, but can delete his own reply.
await fails(`SELECT forum_moderate('thread', $1, 'close')`, [t1], /author or the platform team/);
await fails(`SELECT forum_edit('thread', $1, 'hijack')`, [t1], /own posts/);
await one(`SELECT forum_moderate('post', $1, 'delete')`, [p3]);
assert.equal((await one('SELECT reply_count FROM forum_threads WHERE id = $1', [t1])).reply_count, 2);

// Alice closes her thread; replies are refused until she reopens it.
await as(alice);
await one(`SELECT forum_moderate('thread', $1, 'close')`, [t1]);
thread = await one('SELECT * FROM forum_threads WHERE id = $1', [t1]);
assert.equal(thread.status, 'closed');
assert.ok(thread.closed_at);
await as(bob);
await fails('SELECT forum_reply($1, $2)', [t1, 'late reply'], /closed/);
await as(alice);
await one(`SELECT forum_moderate('thread', $1, 'reopen')`, [t1]);
await one(`SELECT forum_edit('thread', $1, $2, $3)`, [t1, 'Is 12 pairs enough? (edited)', 'Images per participant']);
thread = await one('SELECT * FROM forum_threads WHERE id = $1', [t1]);
assert.equal(thread.title, 'Images per participant');
assert.ok(thread.edited_at);
// Only admins pin.
await fails(`SELECT forum_moderate('thread', $1, 'pin')`, [t1], /platform team/);

// Admin pins and hides; hidden threads disappear for the public.
await as(admin);
await one(`SELECT forum_moderate('thread', $1, 'pin')`, [t1]);
assert.equal((await one('SELECT pinned FROM forum_threads WHERE id = $1', [t1])).pinned, true);
const { id: t2 } = await one('SELECT forum_create_thread($1, $2, $3) AS id', ['Spam thread', 'buy now', 'general']);
await one(`SELECT forum_moderate('thread', $1, 'hide')`, [t2]);

await db.exec(`GRANT USAGE ON SCHEMA public TO anon, authenticated`);
await as('');
await db.exec('SET ROLE anon');
const visible = (await db.query('SELECT id FROM forum_threads')).rows.map((r) => r.id);
assert.deepEqual(visible, [t1]);
const replies = (await db.query('SELECT id FROM forum_posts WHERE thread_id = $1', [t1])).rows.map((r) => r.id).sort();
assert.deepEqual(replies, [p1, p2].sort());
await assert.rejects(db.query(`INSERT INTO forum_threads (author_name, title, body) VALUES ('x', 'direct', 'insert')`));
await assert.rejects(db.query(`UPDATE forum_threads SET status = 'closed'`));
await db.exec('RESET ROLE');

await as(admin);
await db.exec('SET ROLE authenticated');
assert.equal((await db.query('SELECT id FROM forum_threads')).rows.length, 2);
await db.exec('RESET ROLE');

console.log('forum.sql OK');

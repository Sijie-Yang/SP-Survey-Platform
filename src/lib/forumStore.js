import { supabase } from './supabase';

// SP-Forum (supabase/forum.sql). Everyone reads visible threads; signed-in
// users post through the forum_* RPCs, which validate, rate-limit and attach
// the author on the server. E-mail addresses are never stored on posts.

export const FORUM_CATEGORIES = ['announcements', 'general', 'help', 'methods', 'showcase', 'ideas'];
export const FORUM_TITLE_MAX = 200;
export const FORUM_BODY_MAX = 20000;
export const FORUM_NAME_MAX = 40;
export const FORUM_PAGE_SIZE = 30;

const NAME_KEY = 'sp_forum_display_name';

export function isMissingForumSql(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === '42P01'
    || error?.code === 'PGRST202'
    || error?.code === 'PGRST205'
    || (msg.includes('forum_') && (msg.includes('does not exist') || msg.includes('could not find') || msg.includes('schema cache')));
}

function wrapError(error) {
  const err = new Error(error?.message || String(error));
  err.code = error?.code;
  err.missingTable = isMissingForumSql(error);
  err.rateLimited = /too many/i.test(error?.message || '');
  err.closed = /thread is closed/i.test(error?.message || '');
  return err;
}

function db() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

export function rowToThread(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || '',
    body: row.body || '',
    category: FORUM_CATEGORIES.includes(row.category) ? row.category : 'general',
    status: row.status === 'closed' ? 'closed' : 'open',
    pinned: !!row.pinned,
    hidden: !!row.hidden,
    authorId: row.author_id || null,
    authorName: row.author_name || '',
    replyCount: Number(row.reply_count) || 0,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at || row.created_at,
    closedAt: row.closed_at || null,
    editedAt: row.edited_at || null,
  };
}

export function rowToPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    threadId: row.thread_id,
    body: row.body || '',
    hidden: !!row.hidden,
    authorId: row.author_id || null,
    authorName: row.author_name || '',
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
  };
}

/** Characters that would break a PostgREST ilike filter are dropped. */
export function searchPattern(text) {
  const clean = String(text || '').replace(/[%_,()*\\]/g, ' ').trim().replace(/\s+/g, ' ');
  return clean ? `%${clean}%` : '';
}

/**
 * Pinned threads first, then the most recently active.
 * `status`: 'all' | 'open' | 'closed'. Returns { threads, hasMore }.
 */
export async function listForumThreads({ category = '', status = 'all', search = '', page = 0, pageSize = FORUM_PAGE_SIZE } = {}) {
  let q = db().from('forum_threads')
    .select('id,title,category,status,pinned,hidden,author_id,author_name,reply_count,created_at,last_activity_at,closed_at')
    .order('pinned', { ascending: false })
    .order('last_activity_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize);
  if (FORUM_CATEGORIES.includes(category)) q = q.eq('category', category);
  if (status === 'open' || status === 'closed') q = q.eq('status', status);
  const pattern = searchPattern(search);
  if (pattern) q = q.or(`title.ilike.${pattern},body.ilike.${pattern}`);
  const { data, error } = await q;
  if (error) throw wrapError(error);
  const rows = data || [];
  return { threads: rows.slice(0, pageSize).map(rowToThread), hasMore: rows.length > pageSize };
}

export async function getForumThread(id) {
  const client = db();
  const [{ data: thread, error: e1 }, { data: posts, error: e2 }] = await Promise.all([
    client.from('forum_threads').select('*').eq('id', id).maybeSingle(),
    client.from('forum_posts').select('*').eq('thread_id', id).order('created_at', { ascending: true }).limit(1000),
  ]);
  if (e1) throw wrapError(e1);
  if (e2) throw wrapError(e2);
  return { thread: rowToThread(thread), posts: (posts || []).map(rowToPost) };
}

async function rpc(name, args) {
  const { data, error } = await db().rpc(name, args);
  if (error) throw wrapError(error);
  return data;
}

export function createForumThread({ title, body, category = 'general', authorName = '' }) {
  return rpc('forum_create_thread', {
    p_title: String(title || '').trim().slice(0, FORUM_TITLE_MAX),
    p_body: String(body || '').trim().slice(0, FORUM_BODY_MAX),
    p_category: FORUM_CATEGORIES.includes(category) ? category : 'general',
    p_author_name: String(authorName || '').trim().slice(0, FORUM_NAME_MAX),
  });
}

export function replyToForumThread(threadId, { body, authorName = '' }) {
  return rpc('forum_reply', {
    p_thread_id: threadId,
    p_body: String(body || '').trim().slice(0, FORUM_BODY_MAX),
    p_author_name: String(authorName || '').trim().slice(0, FORUM_NAME_MAX),
  });
}

export function editForumItem(kind, id, { body, title = null }) {
  return rpc('forum_edit', { p_kind: kind, p_id: id, p_body: String(body || '').trim(), p_title: title == null ? null : String(title).trim() });
}

/** action: close | reopen | delete | hide | restore | pin | unpin */
export function moderateForumItem(kind, id, action) {
  return rpc('forum_moderate', { p_kind: kind, p_id: id, p_action: action });
}

export async function isForumAdmin() {
  try {
    return !!(await rpc('forum_is_admin', {}));
  } catch {
    return false;
  }
}

export function readDisplayName() {
  try { return window.localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}

export function saveDisplayName(name) {
  try { window.localStorage.setItem(NAME_KEY, String(name || '').slice(0, FORUM_NAME_MAX)); } catch { /* ignore */ }
}

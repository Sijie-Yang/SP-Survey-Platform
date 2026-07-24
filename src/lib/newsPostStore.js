/**
 * Supabase store for news_posts (RLS: is_platform_admin write; public read published).
 */
import { supabase } from './supabase';

export const NEWS_STATUSES = ['draft', 'published', 'archived'];

function requireSupabase() {
  if (!supabase) throw new Error('Supabase not configured');
  return supabase;
}

export function isMissingNewsPostsTable(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return (
    msg.includes('news_posts')
    && (
      msg.includes('does not exist')
      || msg.includes('could not find')
      || msg.includes('schema cache')
      || error?.code === '42P01'
      || error?.code === 'PGRST205'
    )
  );
}

function wrapError(error) {
  const err = new Error(error?.message || String(error));
  err.code = error?.code;
  err.missingTable = isMissingNewsPostsTable(error);
  return err;
}

export function slugifyNewsTitle(title) {
  const base = String(title || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || `post-${Date.now().toString(36)}`;
}

function rowToPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    titleEn: row.title_en || '',
    titleZh: row.title_zh || '',
    summaryEn: row.summary_en || '',
    summaryZh: row.summary_zh || '',
    bodyEn: row.body_en || '',
    bodyZh: row.body_zh || '',
    coverUrl: row.cover_url || '',
    status: row.status || 'draft',
    publishedAt: row.published_at || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Pick localized fields for public UI (`language` = 'en' | 'zh'). */
export function localizeNewsPost(post, language = 'en') {
  if (!post) return null;
  const zh = language === 'zh';
  const title = (zh && post.titleZh) || post.titleEn || post.titleZh || '';
  const summary = (zh && post.summaryZh) || post.summaryEn || post.summaryZh || '';
  const body = (zh && post.bodyZh) || post.bodyEn || post.bodyZh || '';
  return { ...post, title, summary, body };
}

export async function listPublicNewsPosts() {
  const db = requireSupabase();
  const { data, error } = await db
    .from('news_posts')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw wrapError(error);
  return (data || []).map(rowToPost);
}

export async function getPublicNewsPostBySlug(slug) {
  const db = requireSupabase();
  const key = String(slug || '').trim();
  if (!key) return null;
  const { data, error } = await db
    .from('news_posts')
    .select('*')
    .eq('status', 'published')
    .ilike('slug', key)
    .maybeSingle();
  if (error) throw wrapError(error);
  return rowToPost(data);
}

export async function listAllNewsPosts() {
  const db = requireSupabase();
  const { data, error } = await db
    .from('news_posts')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw wrapError(error);
  return (data || []).map(rowToPost);
}

export async function upsertNewsPost(input = {}) {
  const db = requireSupabase();
  const { data: { user } } = await db.auth.getUser();

  const titleEn = String(input.titleEn || '').trim();
  if (!titleEn) throw new Error('English title is required');

  let slug = String(input.slug || '').trim() || slugifyNewsTitle(titleEn);
  slug = slugifyNewsTitle(slug);

  const status = NEWS_STATUSES.includes(input.status) ? input.status : 'draft';
  const now = new Date().toISOString();

  const row = {
    slug,
    title_en: titleEn,
    title_zh: String(input.titleZh || '').trim() || null,
    summary_en: String(input.summaryEn || '').trim() || null,
    summary_zh: String(input.summaryZh || '').trim() || null,
    body_en: String(input.bodyEn || ''),
    body_zh: String(input.bodyZh || '').trim() || null,
    cover_url: String(input.coverUrl || '').trim() || null,
    status,
    updated_at: now,
  };

  if (status === 'published') {
    if (input.publishedAt) row.published_at = input.publishedAt;
    else if (!input.id || input.forcePublishedAt) row.published_at = now;
    // else: omit published_at on update so an existing date is preserved
  } else if (input.clearPublishedAt) {
    row.published_at = null;
  }

  if (input.id) {
    const { data, error } = await db
      .from('news_posts')
      .update(row)
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) throw wrapError(error);
    return rowToPost(data);
  }

  row.created_by = user?.id || null;
  if (status === 'published' && !row.published_at) row.published_at = now;

  const { data, error } = await db
    .from('news_posts')
    .insert(row)
    .select('*')
    .single();
  if (error) throw wrapError(error);
  return rowToPost(data);
}

export async function updateNewsPostStatus(id, status) {
  if (!NEWS_STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
  const db = requireSupabase();
  const patch = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === 'published') {
    patch.published_at = new Date().toISOString();
  }
  const { data, error } = await db
    .from('news_posts')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw wrapError(error);
  return rowToPost(data);
}

export async function deleteNewsPost(id) {
  const db = requireSupabase();
  const { error } = await db.from('news_posts').delete().eq('id', id);
  if (error) throw wrapError(error);
}

/**
 * News drafts and SP-Wiki submissions for platform admins over MCP.
 *
 * Nothing here goes live by itself: news is saved as a draft (published in
 * 平台管理 → News), and a wiki page is saved as a pending submission (approved in
 * 平台管理 → Doc / News 审核, which writes the page and its revision).
 */

import { supabaseRest } from '../supabaseUserClient.mjs';

function fail(message, status = 400, code = 'BAD_REQUEST') {
  return Object.assign(new Error(message), { status, code });
}

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

async function rows(env, path, query) {
  const result = await supabaseRest(env, { path, serviceRole: true, query });
  return Array.isArray(result) ? result : [];
}

/** Same rule as the admin news editor: lower-case words joined by "-". */
export function slugifyNews(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const NEWS_COLUMNS = 'id,slug,title_en,title_zh,summary_en,summary_zh,status,published_at,updated_at';

export async function listNews(env, args = {}) {
  const status = args.status ? text(args.status, 20) : '';
  if (status && !['draft', 'published', 'archived'].includes(status)) throw fail('status must be draft, published or archived.');
  const limit = Math.min(100, Math.max(1, Number(args.limit) || 30));
  const posts = await rows(env, '/rest/v1/news_posts', `?select=${NEWS_COLUMNS}${status ? `&status=eq.${status}` : ''}&order=updated_at.desc&limit=${limit}`);
  return { success: true, posts, count: posts.length };
}

/**
 * Save a news post as a draft (both languages in one post). With id or an
 * existing slug, that post is updated; a published or archived post only with
 * confirmLive:true (Peter asked for the edit), and it keeps its status.
 */
export async function saveNewsDraft(env, ctx, input = {}) {
  const titleEn = text(input.titleEn, 300);
  const bodyEn = String(input.bodyEn ?? '').trim();
  if (!titleEn || bodyEn.length < 20) throw fail('titleEn and bodyEn (at least 20 characters) are required.');
  const slug = slugifyNews(input.slug || titleEn);
  if (!slug) throw fail('slug must contain letters or digits.');
  const coverUrl = text(input.coverUrl, 500);
  if (coverUrl && !/^https:\/\//i.test(coverUrl)) throw fail('coverUrl must start with https://');
  const row = {
    slug,
    title_en: titleEn,
    title_zh: text(input.titleZh, 300) || null,
    summary_en: text(input.summaryEn, 1000) || null,
    summary_zh: text(input.summaryZh, 1000) || null,
    body_en: bodyEn.slice(0, 80000),
    body_zh: String(input.bodyZh ?? '').trim().slice(0, 80000) || null,
    cover_url: coverUrl || null,
    status: 'draft',
    updated_at: new Date().toISOString(),
  };

  const existingLookup = input.id
    ? (await rows(env, '/rest/v1/news_posts', `?id=eq.${encodeURIComponent(text(input.id, 64))}&select=id,slug,status`))[0]
    : (await rows(env, '/rest/v1/news_posts', `?slug=eq.${encodeURIComponent(slug)}&select=id,slug,status`))[0];
  const existing = existingLookup;
  if (existing && input.id && !input.slug) row.slug = existing.slug;
  if (input.id && !existing) throw fail(`No news post with id "${text(input.id, 64)}".`, 404, 'NOT_FOUND');
  const live = existing && existing.status !== 'draft';
  if (live && input.confirmLive !== true) {
    throw fail(`The post "${existing.slug}" is ${existing.status}. Change it only when Peter asked for this edit, with confirmLive:true; it stays ${existing.status}. Otherwise use another slug for a new draft.`, 409, 'NOT_A_DRAFT');
  }
  if (live) row.status = existing.status;

  const write = async (withFormat) => {
    const body = withFormat ? { ...row, content_format: 'markdown' } : row;
    if (existing) {
      return supabaseRest(env, {
        path: '/rest/v1/news_posts',
        method: 'PATCH',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(existing.id)}`,
        body,
        prefer: 'return=representation',
      });
    }
    return supabaseRest(env, {
      path: '/rest/v1/news_posts',
      method: 'POST',
      serviceRole: true,
      body: { ...body, created_by: ctx.userId || null },
      prefer: 'return=representation',
    });
  };
  let saved;
  try {
    saved = await write(true);
  } catch (err) {
    // content_format comes with supabase/wiki_submissions.sql; without it the
    // body is shown as plain text.
    if (!/content_format/.test(String(err?.message || ''))) throw err;
    saved = await write(false);
  }
  const post = Array.isArray(saved) ? saved[0] : saved;
  return {
    success: true,
    result: existing ? 'updated' : 'inserted',
    id: post?.id || existing?.id || null,
    slug: row.slug,
    status: row.status,
    next: live ? `Changed in place; it is still ${row.status} at /news/${row.slug}` : `Draft only. An admin publishes it in 平台管理 → News; then it is at /news/${row.slug}`,
  };
}

/** Wiki pages online (community and edited built-in pages), newest first. */
export async function listWiki(env) {
  const pages = await rows(env, '/rest/v1/wiki_pages', '?select=page_key,language,title,summary,template_id,revision,updated_at&order=updated_at.desc&limit=500');
  const builtin = await rows(env, '/rest/v1/wiki_builtin_pages', '?select=page_key,is_template&limit=500');
  const submissions = await listWikiSubmissions(env);
  return {
    success: true,
    pages,
    submissions,
    builtinPageKeys: builtin.map((b) => b.page_key),
    note: 'Pages are at /docs/<page_key>. Built-in pages are written in the code; wiki_submit with pageKey proposes an edit of one.',
  };
}

/**
 * Propose a wiki page: a new page, or an edit of an existing one (pageKey).
 * It is saved as a pending submission, exactly like one sent from the site.
 */
export async function submitWiki(env, ctx, input = {}) {
  const language = input.language === 'zh' ? 'zh' : input.language === 'en' ? 'en' : '';
  if (!language) throw fail('language must be "en" or "zh".');
  const title = text(input.title, 200);
  const body = String(input.body ?? '').trim();
  const changeReason = text(input.changeReason, 2000);
  if (title.length < 3) throw fail('title needs at least 3 characters.');
  if (body.length < 20 || body.length > 80000) throw fail('body must be 20 to 80,000 characters (Markdown).');
  if (changeReason.length < 10) throw fail('changeReason needs at least 10 characters: why this page or edit is needed.');
  const pageKey = text(input.pageKey, 120);
  const submissionId = text(input.submissionId, 64);
  if (submissionId) return reviseWikiSubmission(env, ctx, submissionId, { language, title, body, changeReason, input });
  const id = crypto.randomUUID();
  let kind = 'doc_new';
  let target = `community-${id}`;
  let baseRevision = 0;
  let baseContent = {};
  if (pageKey) {
    const live = (await rows(env, '/rest/v1/wiki_pages', `?page_key=eq.${encodeURIComponent(pageKey)}&language=eq.${language}&select=title,summary,body,revision`))[0];
    const builtin = (await rows(env, '/rest/v1/wiki_builtin_pages', `?page_key=eq.${encodeURIComponent(pageKey)}&select=page_key`))[0];
    if (!live && !builtin) throw fail(`No wiki page "${pageKey}" in ${language}. Leave pageKey out to propose a new page.`, 404, 'NOT_FOUND');
    kind = 'doc_edit';
    target = pageKey;
    baseRevision = live?.revision || 0;
    baseContent = live ? { title: live.title, summary: live.summary, body: live.body } : {};
  }
  let templateId = text(input.templateId, 120) || null;
  if (templateId) {
    const known = (await rows(env, '/rest/v1/wiki_builtin_pages', `?page_key=eq.${encodeURIComponent(templateId)}&is_template=eq.true&select=page_key`))[0];
    if (!known) templateId = null;
  }
  const row = {
    id,
    user_id: ctx.userId,
    kind,
    target_key: target,
    language,
    title,
    summary: text(input.summary, 1000),
    body,
    contributor_name: text(input.contributorName, 100) || 'SP-Survey',
    change_reason: changeReason,
    source_notes: text(input.sourceNotes, 5000),
    template_id: templateId,
    rights_confirmed: true,
    base_revision: baseRevision,
    base_content: baseContent,
  };
  const saved = await supabaseRest(env, {
    path: '/rest/v1/content_submissions',
    method: 'POST',
    serviceRole: true,
    body: row,
    prefer: 'return=representation',
  });
  const submission = Array.isArray(saved) ? saved[0] : saved;
  await supabaseRest(env, {
    path: '/rest/v1/content_submission_events',
    method: 'POST',
    serviceRole: true,
    body: { submission_id: id, actor_id: ctx.userId, action: 'submitted', snapshot: submission || row },
    prefer: 'return=minimal',
  });
  return {
    success: true,
    id,
    kind,
    pageKey: target,
    status: 'pending',
    next: `Pending review. An admin approves it in 平台管理 → Doc / News 审核; then it is at /docs/${target}`,
  };
}

/** Change a submission that is still waiting (pending or returned for changes). */
async function reviseWikiSubmission(env, ctx, id, { language, title, body, changeReason, input }) {
  const old = (await rows(env, '/rest/v1/content_submissions', `?id=eq.${encodeURIComponent(id)}&select=*`))[0];
  if (!old || old.kind === 'news') throw fail(`No wiki submission with id "${id}".`, 404, 'NOT_FOUND');
  if (!['pending', 'changes_requested'].includes(old.status)) {
    throw fail(`That submission is ${old.status}. Propose a new edit of /docs/${old.target_key} with pageKey instead.`, 409, 'NOT_PENDING');
  }
  if (old.language !== language) throw fail(`That submission is in ${old.language}; the language cannot change.`);
  const patch = {
    title,
    summary: 'summary' in input ? text(input.summary, 1000) : old.summary,
    body,
    change_reason: changeReason,
    source_notes: 'sourceNotes' in input ? text(input.sourceNotes, 5000) : old.source_notes,
    status: 'pending',
    version: (old.version || 1) + 1,
    review_note: '',
    reviewed_by: null,
    reviewed_at: null,
    updated_at: new Date().toISOString(),
  };
  const saved = await supabaseRest(env, {
    path: '/rest/v1/content_submissions',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(id)}&version=eq.${old.version}`,
    body: patch,
    prefer: 'return=representation',
  });
  const submission = Array.isArray(saved) ? saved[0] : saved;
  if (!submission) throw fail('The submission changed while saving; read it again and retry.', 409, 'CONFLICT');
  await supabaseRest(env, {
    path: '/rest/v1/content_submission_events',
    method: 'POST',
    serviceRole: true,
    body: { submission_id: id, actor_id: ctx.userId, action: 'submitted', snapshot: submission },
    prefer: 'return=minimal',
  });
  return {
    success: true,
    id,
    kind: old.kind,
    pageKey: old.target_key,
    status: 'pending',
    next: `Revised and pending review in 平台管理 → Doc / News 审核; then it is at /docs/${old.target_key}`,
  };
}

/** Wiki submissions (not news), newest first: to find one to revise. */
export async function listWikiSubmissions(env, args = {}) {
  const status = args.status ? text(args.status, 30) : '';
  const filter = status ? `&status=eq.${encodeURIComponent(status)}` : '';
  const items = await rows(env, '/rest/v1/content_submissions', `?select=id,kind,target_key,language,title,status,review_note,version,updated_at&kind=in.(doc_new,doc_edit)${filter}&order=updated_at.desc&limit=100`);
  return items;
}

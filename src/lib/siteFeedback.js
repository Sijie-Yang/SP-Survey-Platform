import { supabase } from './supabase';

// Homepage suggestions box (supabase/site_feedback.sql). Anyone can submit
// through the submit_site_feedback RPC; signed-in users' account is attached
// on the server. Only platform admins can list, update or delete.

export const FEEDBACK_CATEGORIES = ['suggestion', 'feature', 'bug', 'other'];
export const FEEDBACK_STATUSES = ['new', 'read', 'planned', 'done', 'archived'];
export const FEEDBACK_MESSAGE_MAX = 5000;

const LAST_SENT_KEY = 'sp_feedback_last_sent';
const CLIENT_COOLDOWN_MS = 15 * 1000;

function isMissingFeedbackSql(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === '42P01'
    || error?.code === 'PGRST202'
    || error?.code === 'PGRST205'
    || ((msg.includes('site_feedback') || msg.includes('submit_site_feedback'))
      && (msg.includes('does not exist') || msg.includes('could not find') || msg.includes('schema cache')));
}

function wrapError(error) {
  const err = new Error(error?.message || String(error));
  err.missingTable = isMissingFeedbackSql(error);
  err.rateLimited = /too many suggestions/i.test(error?.message || '');
  return err;
}

function readTimestamp(storageKey) {
  try { return Number(window.localStorage.getItem(storageKey)) || 0; } catch { return 0; }
}

export async function submitSiteFeedback(input) {
  if (!supabase) throw new Error('Supabase is not configured');
  const message = String(input?.message || '').trim();
  if (message.length < 2) throw new Error('empty');
  // A light client-side pause between sends; the server enforces the real limits.
  if (Date.now() - readTimestamp(LAST_SENT_KEY) < CLIENT_COOLDOWN_MS) {
    const err = new Error('Too many suggestions in a short time');
    err.rateLimited = true;
    throw err;
  }
  const payload = {
    message: message.slice(0, FEEDBACK_MESSAGE_MAX),
    category: FEEDBACK_CATEGORIES.includes(input?.category) ? input.category : 'suggestion',
    contact_name: input?.contactName || '',
    contact_email: input?.contactEmail || '',
    contact_wechat: input?.contactWechat || '',
    contact_other: input?.contactOther || '',
    website: input?.website || '',
    page_url: typeof window !== 'undefined' ? window.location.href.slice(0, 500) : '',
    language: input?.language || '',
    user_agent: typeof navigator !== 'undefined' ? String(navigator.userAgent || '').slice(0, 400) : '',
  };
  const { data, error } = await supabase.rpc('submit_site_feedback', { p_input: payload });
  if (error) throw wrapError(error);
  try { window.localStorage.setItem(LAST_SENT_KEY, String(Date.now())); } catch { /* ignore */ }
  return data;
}

function rowToFeedback(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userId: row.user_id,
    userEmail: row.user_email || '',
    category: row.category,
    message: row.message || '',
    contactName: row.contact_name || '',
    contactEmail: row.contact_email || '',
    contactWechat: row.contact_wechat || '',
    contactOther: row.contact_other || '',
    pageUrl: row.page_url || '',
    language: row.language || '',
    userAgent: row.user_agent || '',
    status: row.status,
    adminNote: row.admin_note || '',
  };
}

export async function listSiteFeedback() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('site_feedback')
    .select('id, created_at, updated_at, user_id, user_email, category, message, contact_name, contact_email, contact_wechat, contact_other, page_url, language, user_agent, status, admin_note')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw wrapError(error);
  return (data || []).map(rowToFeedback);
}

export async function updateSiteFeedback(id, { status, adminNote } = {}) {
  const patch = { updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (adminNote !== undefined) patch.admin_note = adminNote;
  const { data, error } = await supabase
    .from('site_feedback')
    .update(patch)
    .eq('id', id)
    .select('id, updated_at, status, admin_note')
    .single();
  if (error) throw wrapError(error);
  return { updatedAt: data.updated_at, status: data.status, adminNote: data.admin_note || '' };
}

export async function deleteSiteFeedback(id) {
  const { error } = await supabase.from('site_feedback').delete().eq('id', id);
  if (error) throw wrapError(error);
}

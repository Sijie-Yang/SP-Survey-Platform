import { supabase } from './supabase';

export function contentError(error) {
  const result = new Error(error?.message || String(error));
  result.code = error?.code;
  result.missingSchema = ['42P01', 'PGRST205', 'PGRST202', '42883'].includes(error?.code);
  return result;
}
function database() { if (!supabase) throw contentError({ message: 'Contribution service is unavailable.', code: 'PGRST205' }); return supabase; }
async function checked(query) { const { data, error } = await query; if (error) throw contentError(error); return data; }
export async function listWikiPages() {
  if (!supabase) return [];
  return (await checked(supabase.from('wiki_pages').select('page_key,language,title,summary,template_id,contributor_name,revision,updated_at').order('updated_at', { ascending: false }))) || [];
}
export async function getWikiPage(key, language) {
  if (!supabase) return null;
  return checked(supabase.from('wiki_pages').select('*').eq('page_key', key).eq('language', language).maybeSingle());
}
export async function wikiHistory(key, language) {
  return (await checked(database().from('wiki_page_revisions').select('revision,title,contributor_name,published_at').eq('page_key', key).eq('language', language).order('revision', { ascending: false }))) || [];
}
export async function listSubmissions({ userId, status } = {}) {
  let query = database().from('content_submissions').select('*').order('updated_at', { ascending: false }).limit(200);
  if (userId) query = query.eq('user_id', userId);
  if (status && status !== 'all') query = query.eq('status', status);
  return (await checked(query)) || [];
}
export function saveSubmission(id, version, input) {
  return checked(database().rpc('save_content_submission', { p_id: id, p_expected_version: version, p_input: input }));
}
export function reviewSubmission(row, decision, note) {
  return checked(database().rpc('review_content_submission', { p_id: row.id, p_expected_version: row.version, p_decision: decision, p_note: note }));
}
export async function submissionHistory(id) {
  return (await checked(database().from('content_submission_events').select('action,snapshot,created_at').eq('submission_id', id).order('created_at', { ascending: false }))) || [];
}

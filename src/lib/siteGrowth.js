import { supabase } from './supabase';

// Public growth numbers for the homepage (supabase/site_growth_stats.sql).
// Visits are counted once per browser tab session; a "visitor" is a browser's
// first visit on a UTC day. Nothing identifying is sent: only that boolean.

const SESSION_KEY = 'sp_site_visit_recorded';
const DAY_KEY = 'sp_site_visitor_day';

function safeGet(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

function safeSet(storage, key, value) {
  try { storage?.setItem(key, value); return true; } catch { return false; }
}

let visitRecorded = false;

export function recordSiteVisit() {
  if (visitRecorded || !supabase || typeof window === 'undefined') return;
  visitRecorded = true;
  if (safeGet(window.sessionStorage, SESSION_KEY)) return;
  // Without session storage every page load would count; skip rather than inflate.
  if (!safeSet(window.sessionStorage, SESSION_KEY, '1')) return;
  const today = new Date().toISOString().slice(0, 10);
  const newVisitor = safeGet(window.localStorage, DAY_KEY) !== today;
  if (newVisitor) safeSet(window.localStorage, DAY_KEY, today);
  Promise.resolve(supabase.rpc('record_site_visit', { p_new_visitor: newVisitor }))
    .catch(() => {});
}

/** Turn per-month "new" counts into running totals, oldest first. */
export function cumulativeSeries(months, key, before = 0) {
  let total = Number(before) || 0;
  return (months || []).map((row) => {
    total += Number(row?.[key]) || 0;
    return { month: row?.month, value: total };
  });
}

export async function getSiteGrowthStats() {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_site_growth_stats');
  if (error || !data || typeof data !== 'object') return null;
  return data;
}

import { supabase } from './supabase';

// Admin dashboard data (supabase/platform_dashboard.sql → get_platform_dashboard()).
// Admin-only; the homepage never shows these numbers.

// Fixed rate for a rough CNY hint next to USD (DeepSeek prices are in USD in the catalog).
export const USD_TO_CNY = 7.2;

export const FEATURE_LABELS = {
  assistant: 'Assistant（经典模式）',
  'assistant-spscheme': 'Assistant（SP-Scheme 模式）',
  'sp-scheme-page': 'SP-Scheme 写页面',
  review: '审阅',
  'results-analysis': '结果「生成分析」',
  translate: '翻译',
};

export async function getPlatformDashboard() {
  if (!supabase) return { data: null, error: 'Supabase 未配置' };
  const { data, error } = await supabase.rpc('get_platform_dashboard');
  if (error) return { data: null, error: error.message || String(error), missing: /get_platform_dashboard|does not exist|PGRST202/i.test(`${error.code} ${error.message}`) };
  if (!data || typeof data !== 'object') return { data: null, error: '没有数据' };
  return { data, error: null };
}

const num = (v) => Number(v) || 0;

/** Change vs the previous period as a whole percent, or null when there is no base. */
export function percentChange(current, previous) {
  const prev = num(previous);
  if (prev <= 0) return null;
  return Math.round(((num(current) - prev) / prev) * 100);
}

/** Running totals from per-period "new" counts. */
export function runningTotal(rows, key, before = 0) {
  let total = num(before);
  return (rows || []).map((row) => {
    total += num(row?.[key]);
    return total;
  });
}

/** Funnel steps with the share of all registered users. */
export function funnelSteps(funnel = {}) {
  const users = num(funnel.users);
  const steps = [
    { key: 'users', label: '注册用户', value: users },
    { key: 'with_project', label: '建过项目', value: num(funnel.with_project) },
    { key: 'published', label: '发布过问卷', value: num(funnel.published) },
    { key: 'with_responses', label: '收到真实回答', value: num(funnel.with_responses) },
    { key: 'with_50', label: '回答 ≥ 50 份', value: num(funnel.with_50) },
  ];
  return steps.map((step) => ({ ...step, share: users ? step.value / users : 0 }));
}

export function formatUsd(value) {
  const v = num(value);
  if (v === 0) return '$0';
  if (v < 0.01) return '<$0.01';
  return `$${v.toFixed(v < 100 ? 2 : 0)}`;
}

export function formatCny(value) {
  const v = num(value) * USD_TO_CNY;
  if (v === 0) return '¥0';
  if (v < 0.1) return '<¥0.1';
  return `¥${v.toFixed(v < 100 ? 1 : 0)}`;
}

export function formatTokens(value) {
  const v = num(value);
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

/** Share of prompt tokens served from DeepSeek's cache (cheaper), or null. */
export function cacheHitShare(promptTokens, cacheReadTokens) {
  const p = num(promptTokens);
  return p > 0 ? num(cacheReadTokens) / p : null;
}

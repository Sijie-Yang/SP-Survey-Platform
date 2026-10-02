// Between-participant conditions (S1) and URL parameter capture (S2).
// Both are opt-in project settings; projects without them get no variables and no metadata.
// A question may reword itself per condition via conditionVariants: [{ condition, title, reverseCoded }].

import { Serializer } from 'survey-core';

export const CONDITION_VARIABLE = 'sp_condition';
export const URL_VARIABLE_PREFIX = 'url_';
export const URL_PARAM_MAX_LENGTH = 64;
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

if (!Serializer.findProperty('question', 'conditionVariants')) {
  Serializer.addProperty('question', { name: 'conditionVariants', default: null, category: 'general', visible: false });
}

export function normalizeConditions(config) {
  const list = Array.isArray(config?.conditions) ? config.conditions : [];
  const seen = new Set();
  return list
    .map((c) => (typeof c === 'string' ? { id: c } : c))
    .filter((c) => c && typeof c.id === 'string' && c.id.trim() && !seen.has(c.id.trim()) && seen.add(c.id.trim()))
    .map((c) => ({
      id: c.id.trim(),
      label: typeof c.label === 'string' && c.label.trim() ? c.label.trim() : c.id.trim(),
      weight: Number.isFinite(Number(c.weight)) && Number(c.weight) > 0 ? Number(c.weight) : 1,
    }));
}

export function hasConditions(config) {
  return normalizeConditions(config).length > 1;
}

/** Fewest completed responses relative to weight; ties broken at random. */
/**
 * Random assignment for each new session. With completed counts, a smaller group is
 * proportionally more likely (weight ÷ (1 + completed)), so groups stay close without
 * ever making the next assignment predictable.
 */
export function chooseCondition(conditions, counts = null, rand = Math.random) {
  if (!conditions.length) return null;
  const hasCounts = counts && typeof counts === 'object';
  const odds = conditions.map((c) => c.weight / (hasCounts ? 1 + (Number(counts[c.id]) || 0) : 1));
  const total = odds.reduce((s, o) => s + o, 0);
  let r = rand() * total;
  for (let i = 0; i < conditions.length; i += 1) {
    r -= odds[i];
    if (r < 0) return conditions[i].id;
  }
  return conditions[conditions.length - 1].id;
}

export function captureParamNames(config) {
  const list = Array.isArray(config?.captureUrlParams) ? config.captureUrlParams : [];
  return [...new Set(list.map((n) => String(n || '').trim()).filter((n) => NAME_RE.test(n)))];
}

/** Only allow-listed parameters, trimmed to 64 characters; others are ignored. */
export function captureUrlParams(config, search = '') {
  const names = captureParamNames(config);
  if (!names.length) return null;
  const params = new URLSearchParams(search || '');
  const out = {};
  names.forEach((name) => {
    const v = params.get(name);
    if (v != null && v.trim() !== '') out[name] = v.trim().slice(0, URL_PARAM_MAX_LENGTH);
  });
  return out;
}

const storageKey = (projectId) => `sp_condition_${projectId || 'default'}`;

export function storedCondition(projectId, conditions) {
  try {
    const v = localStorage.getItem(storageKey(projectId));
    return conditions.some((c) => c.id === v) ? v : null;
  } catch { return null; }
}

export function rememberCondition(projectId, condition) {
  try { if (condition) localStorage.setItem(storageKey(projectId), condition); } catch { /* private mode */ }
}

export function forgetCondition(projectId) {
  try { localStorage.removeItem(storageKey(projectId)); } catch { /* private mode */ }
}

/**
 * Resolve the runtime context for one participant session.
 * `override` (Researcher Practice / preview) wins; then a stored assignment; then balanced assignment.
 */
export async function resolveRuntimeContext(config, { projectId, search = '', override = null, fetchCounts = null, persist = false, rand = Math.random } = {}) {
  const conditions = normalizeConditions(config);
  let condition = null;
  if (conditions.length > 1) {
    if (override && conditions.some((c) => c.id === override)) condition = override;
    else {
      condition = persist ? storedCondition(projectId, conditions) : null;
      if (!condition) {
        let counts = null;
        if (fetchCounts) { try { counts = await fetchCounts(); } catch { counts = null; } }
        condition = chooseCondition(conditions, counts, rand);
        if (persist) rememberCondition(projectId, condition);
      }
    }
  }
  return { condition, urlParams: captureUrlParams(config, search) };
}

/** Valid per-condition variants of a question (empty titles fall back to the question title). */
export function conditionVariants(question) {
  const list = Array.isArray(question?.conditionVariants) ? question.conditionVariants : [];
  return list.filter((v) => v && typeof v.condition === 'string' && v.condition.trim());
}

export function conditionVariant(question, conditionId) {
  if (!conditionId) return null;
  return conditionVariants(question).find((v) => v.condition === conditionId) || null;
}

/** Condition ids whose answers to this question are reverse-coded in analysis. */
export function reverseCodedConditions(question) {
  return conditionVariants(question).filter((v) => v.reverseCoded === true).map((v) => v.condition);
}

/** Question JSON as participants in this condition see it. */
export function withConditionWording(questionJson, conditionId) {
  const title = conditionVariant(questionJson, conditionId)?.title;
  return typeof title === 'string' && title.trim() ? { ...questionJson, title } : questionJson;
}

/** Condition forced by the link (?sp_condition=id), for researcher testing or fixed per-condition links. */
export function conditionFromUrl(search) {
  const v = new URLSearchParams(search || '').get(CONDITION_VARIABLE);
  return v && v.trim() ? v.trim() : null;
}

export function applyConditionWording(model, conditionId) {
  if (!model || !conditionId) return;
  model.getAllQuestions(false, false, true).forEach((q) => {
    const title = conditionVariant(q, conditionId)?.title;
    if (typeof title === 'string' && title.trim()) q.title = title;
  });
}

export function applyRuntimeVariables(model, context) {
  if (!model || !context) return;
  applyConditionWording(model, context.condition);
  if (context.condition) model.setVariable(CONDITION_VARIABLE, context.condition);
  Object.entries(context.urlParams || {}).forEach(([k, v]) => model.setVariable(`${URL_VARIABLE_PREFIX}${k}`, v));
}

export function runtimeMetadata(context) {
  const out = {};
  if (context?.condition) out.condition = context.condition;
  if (context?.urlParams && Object.keys(context.urlParams).length) out.url_params = { ...context.urlParams };
  return out;
}

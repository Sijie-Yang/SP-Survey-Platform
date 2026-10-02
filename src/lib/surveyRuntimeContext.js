// Between-participant conditions (S1) and URL parameter capture (S2).
// Both are opt-in project settings; projects without them get no variables and no metadata.

export const CONDITION_VARIABLE = 'sp_condition';
export const URL_VARIABLE_PREFIX = 'url_';
export const URL_PARAM_MAX_LENGTH = 64;
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

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
export function chooseCondition(conditions, counts = null, rand = Math.random) {
  if (!conditions.length) return null;
  if (counts && typeof counts === 'object') {
    const load = conditions.map((c) => (Number(counts[c.id]) || 0) / c.weight);
    const min = Math.min(...load);
    const tied = conditions.filter((_, i) => load[i] - min < 1e-9);
    return tied[Math.min(tied.length - 1, Math.floor(rand() * tied.length))].id;
  }
  const total = conditions.reduce((s, c) => s + c.weight, 0);
  let r = rand() * total;
  for (const c of conditions) {
    r -= c.weight;
    if (r < 0) return c.id;
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

const CONDITION_RULE = /^\s*\{sp_condition\}\s*=\s*'([^']+)'\s*$/;

/** Condition id when visibleIf is exactly "{sp_condition} = 'id'", '' when empty, null for any other rule. */
export function conditionFromVisibleIf(visibleIf) {
  if (!visibleIf || !String(visibleIf).trim()) return '';
  const m = String(visibleIf).match(CONDITION_RULE);
  return m ? m[1] : null;
}

export function visibleIfForCondition(conditionId) {
  return conditionId ? `{sp_condition} = '${String(conditionId).replace(/'/g, '')}'` : undefined;
}

export function applyRuntimeVariables(model, context) {
  if (!model || !context) return;
  if (context.condition) model.setVariable(CONDITION_VARIABLE, context.condition);
  Object.entries(context.urlParams || {}).forEach(([k, v]) => model.setVariable(`${URL_VARIABLE_PREFIX}${k}`, v));
}

export function runtimeMetadata(context) {
  const out = {};
  if (context?.condition) out.condition = context.condition;
  if (context?.urlParams && Object.keys(context.urlParams).length) out.url_params = { ...context.urlParams };
  return out;
}

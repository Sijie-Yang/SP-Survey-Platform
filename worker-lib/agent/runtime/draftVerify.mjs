function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

export function normalizeDraftTimestamp(value) {
  if (value == null || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : String(value);
}

export function surveySignature(config) {
  const pages = Array.isArray(config?.pages) ? config.pages : [];
  return pages.map((page) => ({
    name: page?.name || '',
    questions: (page?.elements || []).map((element) => `${element?.name || ''}:${element?.type || ''}`),
  }));
}

export function draftsMatch(intended, verified) {
  const intendedTime = normalizeDraftTimestamp(intended?.draftUpdatedAt);
  const verifiedTime = normalizeDraftTimestamp(verified?.draftUpdatedAt);
  const timeEqual = intendedTime != null && intendedTime === verifiedTime;
  const verifiedNotOlder = intendedTime == null
    || verifiedTime == null
    || (typeof intendedTime === 'number' && typeof verifiedTime === 'number' && verifiedTime >= intendedTime);
  const exact = JSON.stringify(canonicalJson(intended?.surveyConfig || null))
    === JSON.stringify(canonicalJson(verified?.surveyConfig || null));
  const structural = JSON.stringify(surveySignature(intended?.surveyConfig))
    === JSON.stringify(surveySignature(verified?.surveyConfig));
  const verifiedHasSurvey = (verified?.surveyConfig?.pages || []).length > 0;
  const intendedHasSurvey = (intended?.surveyConfig?.pages || []).length > 0;

  if (exact && (timeEqual || verifiedNotOlder)) return { ok: true, reason: 'exact' };
  if (structural && verifiedHasSurvey && (timeEqual || verifiedNotOlder)) return { ok: true, reason: 'structural' };
  if (intendedHasSurvey && !verifiedHasSurvey) return { ok: false, reason: 'missing' };
  if (structural && !verifiedNotOlder) return { ok: false, reason: 'stale' };
  return { ok: false, reason: 'mismatch' };
}

export async function verifySavedDraft({
  readDraft,
  intended,
  retries = 5,
  delayMs = 250,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!intended?.surveyConfig) return { ok: false, draft: null, reason: 'missing-intended' };
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    last = await readDraft();
    const match = draftsMatch(intended, last);
    if (match.ok) return { ok: true, draft: last, reason: match.reason };
    if (attempt < retries) await sleep(delayMs * (attempt + 1));
  }
  const match = draftsMatch(intended, last);
  if (match.reason === 'stale' && JSON.stringify(surveySignature(intended.surveyConfig))
    === JSON.stringify(surveySignature(last?.surveyConfig))) {
    return { ok: true, draft: last, reason: 'structural-stale' };
  }
  return { ok: false, draft: last, reason: match.reason };
}

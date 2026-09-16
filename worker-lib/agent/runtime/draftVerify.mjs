import { postProcessAiConfig, sanitizeForAgent } from '../../designProtocol.mjs';

export const IGNORABLE_EMPTY_TOP_LEVEL = Object.freeze(['logo']);

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

function stripIgnorable(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  const next = { ...config };
  for (const key of IGNORABLE_EMPTY_TOP_LEVEL) {
    if (next[key] == null || next[key] === '') delete next[key];
  }
  return next;
}

export function normalizeSurveyForCompare(config) {
  return canonicalJson(stripIgnorable(sanitizeForAgent(postProcessAiConfig(config || {}))));
}

export function draftsMatch(intended, verified) {
  const intendedTime = normalizeDraftTimestamp(intended?.draftUpdatedAt);
  const verifiedTime = normalizeDraftTimestamp(verified?.draftUpdatedAt);
  const timeEqual = intendedTime != null && intendedTime === verifiedTime;
  const verifiedNotOlder = intendedTime == null
    || verifiedTime == null
    || (typeof intendedTime === 'number' && typeof verifiedTime === 'number' && verifiedTime >= intendedTime);
  const intendedRevision = intended?.revisionId || intended?.revision_id || null;
  const verifiedRevision = verified?.revisionId || verified?.revision_id || null;
  const revisionOk = !intendedRevision || !verifiedRevision || intendedRevision === verifiedRevision;
  const exact = JSON.stringify(normalizeSurveyForCompare(intended?.surveyConfig))
    === JSON.stringify(normalizeSurveyForCompare(verified?.surveyConfig));
  const verifiedHasSurvey = (verified?.surveyConfig?.pages || []).length > 0;
  const intendedHasSurvey = (intended?.surveyConfig?.pages || []).length > 0;

  if (exact && revisionOk && (timeEqual || verifiedNotOlder)) return { ok: true, reason: 'exact' };
  if (intendedHasSurvey && !verifiedHasSurvey) return { ok: false, reason: 'missing' };
  if (exact && (!verifiedNotOlder || !revisionOk)) return { ok: false, reason: 'stale' };
  if (!exact && verifiedHasSurvey) return { ok: false, reason: 'mismatch' };
  return { ok: false, reason: 'missing' };
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
    if (match.ok) return { ok: true, draft: last, reason: match.reason, verified: true };
    if (match.reason === 'mismatch') {
      return { ok: false, draft: last, reason: 'mismatch', verified: false };
    }
    if (attempt < retries) await sleep(delayMs * (attempt + 1));
  }
  const match = draftsMatch(intended, last);
  if (match.ok) return { ok: true, draft: last, reason: match.reason, verified: true };
  if (match.reason === 'mismatch') {
    return { ok: false, draft: last, reason: 'mismatch', verified: false };
  }
  return { ok: false, draft: last, reason: 'unverified', verified: false };
}

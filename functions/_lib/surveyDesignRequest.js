/**
 * Shared helpers for public "Request Survey Design" submissions.
 * Uses Supabase REST + service role so guests can insert without auth.
 */

export const MAX_MEDIA_FILES = 200;
export const MAX_SUPPLEMENTARY_FILES = 20;

const STIMULUS_TYPES = new Set(['image', 'video', 'audio', 'mixed', 'other']);

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
}

export function getSupabaseRest(env = {}) {
  const url = (env.SUPABASE_URL || env.REACT_APP_SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) return null;
  return { url, key };
}

export function surveyDesignMediaPrefix(requestId) {
  return `survey-design-requests/${requestId}/`;
}

function randomEditKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeEmail(raw) {
  const email = String(raw || '').trim();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  return email;
}

function firstSlug(s, fallback) {
  const word = (s || fallback).trim().split(/\s+/)[0]
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  return word || fallback;
}

export function buildRequestIdBase({ contactName, studyTitle }) {
  const year = String(new Date().getFullYear());
  return `sdr-${year}-${firstSlug(contactName, 'guest')}-${firstSlug(studyTitle, 'study')}`;
}

function normalizeStimulusTypes(raw) {
  const list = Array.isArray(raw)
    ? raw
    : (typeof raw === 'string' && raw.trim() ? [raw.trim()] : []);
  return [...new Set(
    list.map((t) => String(t || '').trim().toLowerCase()).filter((t) => STIMULUS_TYPES.has(t)),
  )];
}

function normalizeMedia(files) {
  if (!Array.isArray(files)) return [];
  return files.slice(0, MAX_MEDIA_FILES).map((f) => ({
    url: f.url,
    name: f.name || (f.url || '').split('/').pop() || 'file',
    key: f.key || null,
    type: f.type || 'image',
    media_id: f.media_id || f.key || f.name || f.url,
    folder: f.folder || 'media',
  })).filter((f) => !!f.url);
}

function normalizeSupplementary(files) {
  if (!Array.isArray(files)) return [];
  return files.slice(0, MAX_SUPPLEMENTARY_FILES).map((f) => ({
    url: f.url,
    name: f.name || (f.url || '').split('/').pop() || 'file',
    key: f.key || null,
    contentType: f.contentType || f.type || 'application/octet-stream',
    size: typeof f.size === 'number' ? f.size : null,
  })).filter((f) => !!f.url);
}

async function supabaseFetch(rest, path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${rest.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: rest.key,
      Authorization: `Bearer ${rest.key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { res, data };
}

async function findAvailableRequestId(rest, baseId) {
  const { res, data } = await supabaseFetch(
    rest,
    `survey_design_requests?select=id&id=like.${encodeURIComponent(`${baseId}*`)}`,
  );
  if (!res.ok) return baseId;
  const taken = new Set((Array.isArray(data) ? data : []).map((r) => r.id));
  if (!taken.has(baseId)) return baseId;
  let n = 2;
  while (taken.has(`${baseId}-${n}`)) n++;
  return `${baseId}-${n}`;
}

async function loadGuestRequestRow(rest, requestId, editKey) {
  const { res: getRes, data: rows } = await supabaseFetch(
    rest,
    `survey_design_requests?id=eq.${encodeURIComponent(requestId)}&select=id,status,edit_key,media_files,supplementary_files`,
  );
  if (!getRes.ok) {
    return { error: { success: false, error: 'Failed to load request', status: 502 } };
  }
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { error: { success: false, error: 'Request not found', status: 404 } };
  if (row.status !== 'pending') {
    return { error: { success: false, error: 'Request is no longer editable', status: 403 } };
  }
  if (!row.edit_key || row.edit_key !== editKey) {
    return { error: { success: false, error: 'Invalid editKey', status: 403 } };
  }
  return { row };
}

/**
 * Create a pending survey-design help request.
 */
export async function createSurveyDesignRequest(body, env) {
  const rest = getSupabaseRest(env);
  if (!rest) {
    return {
      success: false,
      error: 'Supabase is not configured on the server (need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)',
      status: 503,
    };
  }

  const contactName = String(body?.contactName || body?.contact_name || '').trim();
  const studyTitle = String(body?.studyTitle || body?.study_title || '').trim();
  const researchBrief = String(body?.researchBrief || body?.research_brief || '').trim();
  const affiliation = String(body?.affiliation || '').trim();
  const timeline = String(body?.timeline || '').trim();
  const notes = String(body?.notes || '').trim();
  const relatedUrl = String(body?.relatedUrl || body?.related_url || '').trim();
  const emailRaw = normalizeEmail(body?.email);
  const stimulusTypes = normalizeStimulusTypes(body?.stimulusTypes || body?.stimulus_types);

  if (!contactName) return { success: false, error: 'Contact name is required', status: 400 };
  if (!emailRaw) return { success: false, error: 'Email is required', status: 400 };
  if (emailRaw === false) return { success: false, error: 'email must be a valid address', status: 400 };
  if (!studyTitle) return { success: false, error: 'Study title is required', status: 400 };
  if (!researchBrief) return { success: false, error: 'Research brief is required', status: 400 };
  if (researchBrief.length < 40) {
    return {
      success: false,
      error: 'Please describe your study in a bit more detail (at least ~40 characters)',
      status: 400,
    };
  }
  if (relatedUrl) {
    try {
      // eslint-disable-next-line no-new
      new URL(relatedUrl);
    } catch {
      return { success: false, error: 'Related link must be a valid URL', status: 400 };
    }
  }

  const mediaFiles = normalizeMedia(body?.mediaFiles || body?.media_files || body?.images);
  const supplementaryFiles = normalizeSupplementary(
    body?.supplementaryFiles || body?.supplementary_files,
  );
  const editKey = randomEditKey();
  const baseId = buildRequestIdBase({ contactName, studyTitle });
  let attemptId = await findAvailableRequestId(rest, baseId);
  const now = new Date().toISOString();

  for (let attempt = 0; attempt < 5; attempt++) {
    const row = {
      id: attemptId,
      contact_name: contactName,
      email: emailRaw,
      affiliation: affiliation || null,
      study_title: studyTitle,
      research_brief: researchBrief,
      stimulus_types: stimulusTypes,
      timeline: timeline || null,
      related_url: relatedUrl || null,
      notes: notes || null,
      media_files: mediaFiles,
      supplementary_files: supplementaryFiles,
      status: 'pending',
      edit_key: editKey,
      created_at: now,
      updated_at: now,
    };
    const { res, data } = await supabaseFetch(rest, 'survey_design_requests', {
      method: 'POST',
      body: row,
      headers: { Prefer: 'return=representation' },
    });
    if (res.ok) {
      return {
        success: true,
        requestId: attemptId,
        editKey,
        mediaCount: mediaFiles.length,
        supplementaryCount: supplementaryFiles.length,
      };
    }
    // Table missing / schema not applied
    if (res.status === 404 || data?.code === '42P01' || /does not exist/i.test(String(data?.message || ''))) {
      return {
        success: false,
        error: 'survey_design_requests table is missing — run supabase/survey_design_requests.sql',
        status: 503,
      };
    }
    const code = data?.code || data?.error;
    if (code === '23505' || res.status === 409) {
      const m = /^(.+?)(?:-(\d+))?$/.exec(attemptId);
      const stem = m ? m[1] : attemptId;
      const next = (m && m[2]) ? parseInt(m[2], 10) + 1 : 2;
      attemptId = `${stem}-${next}`;
      continue;
    }
    return {
      success: false,
      error: data?.message || data?.error || `Supabase insert failed (HTTP ${res.status})`,
      status: 502,
    };
  }
  return {
    success: false,
    error: `Could not allocate a unique request id (last tried: ${attemptId})`,
    status: 500,
  };
}

/**
 * Attach media / supplementary files after create (editKey gated).
 */
export async function attachSurveyDesignFiles(body, env) {
  const rest = getSupabaseRest(env);
  if (!rest) {
    return { success: false, error: 'Supabase is not configured on the server', status: 503 };
  }
  const requestId = String(body?.requestId || body?.id || '').trim();
  const editKey = String(body?.editKey || '').trim();
  if (!requestId || !editKey) {
    return { success: false, error: 'requestId and editKey are required', status: 400 };
  }
  const mediaFiles = normalizeMedia(body?.mediaFiles || body?.media_files || body?.images);
  const supplementaryFiles = normalizeSupplementary(
    body?.supplementaryFiles || body?.supplementary_files,
  );
  if (!mediaFiles.length && !supplementaryFiles.length) {
    return { success: false, error: 'mediaFiles[] or supplementaryFiles[] is required', status: 400 };
  }

  const loaded = await loadGuestRequestRow(rest, requestId, editKey);
  if (loaded.error) return loaded.error;
  const { row } = loaded;
  const now = new Date().toISOString();
  const patch = { updated_at: now };

  if (mediaFiles.length) {
    const existing = Array.isArray(row.media_files) ? row.media_files : [];
    patch.media_files = [...existing, ...mediaFiles].slice(0, MAX_MEDIA_FILES);
  }
  if (supplementaryFiles.length) {
    const existing = Array.isArray(row.supplementary_files) ? row.supplementary_files : [];
    patch.supplementary_files = [...existing, ...supplementaryFiles].slice(0, MAX_SUPPLEMENTARY_FILES);
  }

  const { res: upRes, data: upData } = await supabaseFetch(
    rest,
    `survey_design_requests?id=eq.${encodeURIComponent(requestId)}`,
    {
      method: 'PATCH',
      body: patch,
      headers: { Prefer: 'return=minimal' },
    },
  );
  if (!upRes.ok) {
    return {
      success: false,
      error: upData?.message || upData?.error || `Update failed (HTTP ${upRes.status})`,
      status: 502,
    };
  }
  return {
    success: true,
    requestId,
    mediaCount: patch.media_files?.length
      ?? (Array.isArray(row.media_files) ? row.media_files.length : 0),
    supplementaryCount: patch.supplementary_files?.length
      ?? (Array.isArray(row.supplementary_files) ? row.supplementary_files.length : 0),
  };
}

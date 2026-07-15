/**
 * Shared helpers for public "Request a Template for Your Paper" submissions.
 * Uses Supabase REST + service role so guests can insert pending templates
 * without auth (RLS on templates typically blocks anon inserts).
 */

export const PAPER_REQUEST_TAG = 'paper-request';
export const MAX_DATASET_IMAGES = 1000;
export const MAX_SUPPLEMENTARY_FILES = 20;

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

export function buildTemplateIdBase({ name, author, year }) {
  const safeYear = (year || String(new Date().getFullYear())).toString().trim();
  const firstWord = (s, fallback) => {
    const word = (s || fallback).trim().split(/\s+/)[0]
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    return word || fallback;
  };
  return `${safeYear}-${firstWord(author, 'author')}-${firstWord(name, 'paper')}`;
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

function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images.slice(0, MAX_DATASET_IMAGES).map((img) => ({
    url: img.url,
    name: img.name || (img.url || '').split('/').pop() || 'image.jpg',
    key: img.key || null,
    type: img.type || 'image',
    media_id: img.media_id || img.key || img.name || img.url,
    folder: img.folder || 'dataset',
  })).filter((img) => !!img.url);
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

async function findAvailableTemplateId(rest, baseId) {
  const { res, data } = await supabaseFetch(
    rest,
    // PostgREST like/ilike use * as the wildcard (mapped to SQL %)
    `templates?select=id&id=like.${encodeURIComponent(`${baseId}*`)}`,
  );
  if (!res.ok) return baseId;
  const taken = new Set((Array.isArray(data) ? data : []).map((r) => r.id));
  if (!taken.has(baseId)) return baseId;
  let n = 2;
  while (taken.has(`${baseId}-${n}`)) n++;
  return `${baseId}-${n}`;
}

async function loadGuestRequestRow(rest, templateId, editKey) {
  const { res: getRes, data: rows } = await supabaseFetch(
    rest,
    `templates?id=eq.${encodeURIComponent(templateId)}&select=id,tags,user_id,is_approved,survey_config,preloaded_images`,
  );
  if (!getRes.ok) {
    return { error: { success: false, error: 'Failed to load template', status: 502 } };
  }
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { error: { success: false, error: 'Template not found', status: 404 } };
  if (row.is_approved) {
    return { error: { success: false, error: 'Template is already approved and cannot be edited this way', status: 403 } };
  }
  const tags = Array.isArray(row.tags) ? row.tags : [];
  if (!tags.includes(PAPER_REQUEST_TAG) || row.user_id) {
    return { error: { success: false, error: 'Not a guest paper-request template', status: 403 } };
  }
  const storedKey = row.survey_config?._paperRequest?.editKey;
  if (!storedKey || storedKey !== editKey) {
    return { error: { success: false, error: 'Invalid editKey', status: 403 } };
  }
  return { row };
}

function buildRow({
  id, name, author, year, paperUrl, notes, email, images, supplementaryFiles, editKey,
}) {
  const now = new Date().toISOString();
  const descParts = [
    notes?.trim() || '',
    'Submitted via public paper-template request (pending review).',
  ].filter(Boolean);
  return {
    id,
    name: name.trim(),
    description: descParts.join('\n\n'),
    author: author.trim(),
    year: year || '',
    category: 'Academic Research',
    tags: [PAPER_REQUEST_TAG],
    paper_url: paperUrl?.trim() || null,
    huggingface_dataset: null,
    survey_config: {
      title: name.trim(),
      description: notes?.trim() || `Paper template request: ${name.trim()}`,
      pages: [],
      _paperRequest: {
        editKey,
        createdAt: now,
        contactEmail: email || null,
        supplementaryFiles: supplementaryFiles || [],
      },
    },
    preloaded_images: images,
    preloaded_at: images.length ? now : null,
    preloaded_source: images.length ? 'paper-request' : null,
    image_dataset_config: {},
    user_id: null,
    submitter_email: email || 'paper-request (guest)',
    is_approved: false,
    show_on_landing: false,
    is_pinned: false,
    is_active: false,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Create a pending template from a public paper request.
 */
export async function createPaperTemplateRequest(body, env) {
  const rest = getSupabaseRest(env);
  if (!rest) {
    return {
      success: false,
      error: 'Supabase is not configured on the server (need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)',
      status: 503,
    };
  }

  const name = String(body?.name || '').trim();
  const author = String(body?.author || '').trim();
  const paperUrl = String(body?.paperUrl || body?.paper_url || '').trim();
  const notes = String(body?.notes || '').trim();
  const year = String(body?.year || '').trim();
  const emailRaw = normalizeEmail(body?.email || body?.submitter_email);
  if (emailRaw === false) {
    return { success: false, error: 'email must be a valid address', status: 400 };
  }
  if (year && !/^\d{4}$/.test(year)) {
    return { success: false, error: 'year must be a 4-digit year', status: 400 };
  }
  if (!name) return { success: false, error: 'Paper title is required', status: 400 };
  if (!author) return { success: false, error: 'Author name(s) are required', status: 400 };
  if (!paperUrl) return { success: false, error: 'Paper link is required', status: 400 };
  try {
    // eslint-disable-next-line no-new
    new URL(paperUrl);
  } catch {
    return { success: false, error: 'Paper link must be a valid URL', status: 400 };
  }

  const images = normalizeImages(body?.images);
  const supplementaryFiles = normalizeSupplementary(
    body?.supplementaryFiles || body?.supplementary_files,
  );
  const editKey = randomEditKey();
  const baseId = buildTemplateIdBase({ name, author, year });
  let attemptId = await findAvailableTemplateId(rest, baseId);

  for (let attempt = 0; attempt < 5; attempt++) {
    const row = buildRow({
      id: attemptId,
      name,
      author,
      year,
      paperUrl,
      notes,
      email: emailRaw,
      images,
      supplementaryFiles,
      editKey,
    });
    const { res, data } = await supabaseFetch(rest, 'templates', {
      method: 'POST',
      body: row,
      headers: { Prefer: 'return=representation' },
    });
    if (res.ok) {
      return {
        success: true,
        templateId: attemptId,
        editKey,
        imageCount: images.length,
        supplementaryCount: supplementaryFiles.length,
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
    error: `Could not allocate a unique template id (last tried: ${attemptId})`,
    status: 500,
  };
}

/**
 * Attach dataset images and/or supplementary files to a guest paper-request template.
 */
export async function attachPaperTemplateImages(body, env) {
  const rest = getSupabaseRest(env);
  if (!rest) {
    return { success: false, error: 'Supabase is not configured on the server', status: 503 };
  }
  const templateId = String(body?.templateId || body?.id || '').trim();
  const editKey = String(body?.editKey || '').trim();
  if (!templateId || !editKey) {
    return { success: false, error: 'templateId and editKey are required', status: 400 };
  }
  const images = normalizeImages(body?.images);
  const supplementaryFiles = normalizeSupplementary(
    body?.supplementaryFiles || body?.supplementary_files,
  );
  if (!images.length && !supplementaryFiles.length) {
    return { success: false, error: 'images[] or supplementaryFiles[] is required', status: 400 };
  }

  const loaded = await loadGuestRequestRow(rest, templateId, editKey);
  if (loaded.error) return loaded.error;
  const { row } = loaded;

  const now = new Date().toISOString();
  const patch = { updated_at: now };

  if (images.length) {
    const existing = Array.isArray(row.preloaded_images) ? row.preloaded_images : [];
    patch.preloaded_images = [...existing, ...images].slice(0, MAX_DATASET_IMAGES);
    patch.preloaded_at = now;
    patch.preloaded_source = 'paper-request';
  }

  if (supplementaryFiles.length) {
    const prevCfg = row.survey_config && typeof row.survey_config === 'object' ? row.survey_config : {};
    const prevReq = prevCfg._paperRequest && typeof prevCfg._paperRequest === 'object'
      ? prevCfg._paperRequest
      : {};
    const existingSupp = Array.isArray(prevReq.supplementaryFiles) ? prevReq.supplementaryFiles : [];
    patch.survey_config = {
      ...prevCfg,
      _paperRequest: {
        ...prevReq,
        supplementaryFiles: [...existingSupp, ...supplementaryFiles].slice(0, MAX_SUPPLEMENTARY_FILES),
      },
    };
  }

  const { res: upRes, data: upData } = await supabaseFetch(
    rest,
    `templates?id=eq.${encodeURIComponent(templateId)}`,
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
    templateId,
    imageCount: patch.preloaded_images?.length ?? (row.preloaded_images?.length || 0),
    supplementaryCount: patch.survey_config?._paperRequest?.supplementaryFiles?.length
      ?? (row.survey_config?._paperRequest?.supplementaryFiles?.length || 0),
  };
}

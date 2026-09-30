/**
 * Client for the researcher's local `sp-streetlevel` helper (127.0.0.1 only).
 * The helper downloads imagery on the researcher's machine and uploads the
 * finished files through the normal media upload API; nothing here fetches imagery.
 */

export const HELPER_PORT = 47821;
export const HELPER_BASE = `http://127.0.0.1:${HELPER_PORT}`;
export const HELPER_PACKAGE = 'git+https://github.com/Sijie-Yang/SP-Survey-Platform@main#subdirectory=tools/streetlevel-helper';
export const DONE_ITEM_STATUSES = new Set(['done', 'no-image']);
export const ACTIVE_JOB_STATES = new Set(['queued', 'running']);

export const DEFAULT_CAPTURE = {
  preset: 'current',
  headingCount: 4,
  pitch: 0,
  fov: 90,
  width: 1024,
  zoom: 3,
  radius: 50,
  folder: 'street-level',
  folderMode: 'category',
  minInterval: 1.5,
};

export const PRESETS = ['current', 'pano', 'headings', 'road'];
export const FOLDER_MODES = ['single', 'category', 'set-per-point'];

export function installCommand() {
  return `pipx install "${HELPER_PACKAGE}"`;
}

export function serveCommand(origin) {
  const extra = origin && !/^https:\/\/sp-survey\.org$/.test(origin)
    && !/^http:\/\/(localhost|127\.0\.0\.1):3000$/.test(origin) ? ` --allow-origin ${origin}` : '';
  return `sp-streetlevel serve${extra}`;
}

export function runCommand({ projectId, apiBase, capture = {} }) {
  const c = { ...DEFAULT_CAPTURE, ...capture };
  const parts = ['sp-streetlevel run', `--project ${projectId}`];
  if (apiBase && apiBase !== 'https://sp-survey.org') parts.push(`--api ${apiBase}`);
  parts.push(`--preset ${c.preset}`);
  if (c.preset === 'headings') parts.push(`--heading-count ${c.headingCount}`);
  parts.push(`--zoom ${c.zoom}`, `--folder ${c.folder}`, `--folder-mode ${c.folderMode}`);
  return parts.join(' ');
}

async function call(path, { method = 'GET', body, timeoutMs = 8000, fetchImpl = fetch } = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${HELPER_BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl?.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw Object.assign(new Error(data?.error || `Helper HTTP ${res.status}`), { status: res.status });
    }
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** { running: true, version, streetlevel } or { running: false }. */
export async function helperHealth(opts = {}) {
  try {
    const data = await call('/health', { timeoutMs: 2500, ...opts });
    return { running: true, version: data.version, streetlevel: data.streetlevel };
  } catch {
    return { running: false };
  }
}

export function startJob({ apiBase, projectId, mediaPrefix, publicBase, token, points, options }, opts = {}) {
  return call('/jobs', { method: 'POST', body: { apiBase, projectId, mediaPrefix, publicBase, token, points, options }, ...opts });
}

export function getJob(jobId, since = 0, opts = {}) {
  return call(`/jobs/${encodeURIComponent(jobId)}?since=${since}`, opts);
}

export function sendToken(jobId, token, opts = {}) {
  return call(`/jobs/${encodeURIComponent(jobId)}/token`, { method: 'POST', body: { token }, ...opts });
}

export function cancelJob(jobId, opts = {}) {
  return call(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: {}, ...opts });
}

export function resumeJob(jobId, token, opts = {}) {
  return call(`/jobs/${encodeURIComponent(jobId)}/resume`, { method: 'POST', body: { token }, ...opts });
}

/** Merge helper-reported uploads into preloadedImages by key. */
export function mergeMediaEntries(existing = [], incoming = []) {
  const byKey = new Map();
  existing.forEach((e) => byKey.set(e?.key || e?.media_id || e?.url, e));
  incoming.forEach((e) => { if (e?.key) byKey.set(e.key, { ...(byKey.get(e.key) || {}), ...e }); });
  return [...byKey.values()];
}

/** Per-point status for the panel; points not in the job are "not in run". */
export function summarizeItems(points = [], items = {}) {
  const counts = { total: 0, done: 0, noImage: 0, failed: 0, pending: 0, running: 0, files: 0 };
  const files = new Set();
  points.forEach((p) => {
    const it = items[p.id];
    if (!it) return;
    counts.total += 1;
    if (it.status === 'done') { counts.done += 1; (it.keys || []).forEach((k) => files.add(k)); }
    else if (it.status === 'no-image') counts.noImage += 1;
    else if (it.status === 'failed') counts.failed += 1;
    else if (it.status === 'running') counts.running += 1;
    else counts.pending += 1;
  });
  counts.files = files.size;
  return counts;
}

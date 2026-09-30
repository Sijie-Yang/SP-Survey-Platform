/**
 * Bulk street-level capture: point → nearest provider image → planned views →
 * R2 upload + media entries + metadata rows. Network, image processing and
 * storage are injected so the runner is testable and resumable.
 */

import { asyncPool } from '../asyncPool';
import { objectsToCsv } from '../csvUtil';
import { normalizeFolderPath, joinFolderPath, buildProjectMediaKey } from '../mediaUtils';
import {
  MAPILLARY_PROVIDER,
  captureFileName,
  chooseBestImage,
  imageCompass,
  imageLocation,
  imageSourceUrl,
  isPanoImage,
  mapillaryAttribution,
  planViews,
} from './mapillary';

export const STREET_LEVEL_CSV_MODEL = 'street_level_v1';
export const FOLDER_MODES = ['single', 'category', 'set-per-point'];
export const DONE_STATUSES = new Set(['done', 'no-image']);

export const STREET_LEVEL_CSV_HEADERS = [
  'media_id', 'name', 'folder', 'provider', 'image_id', 'sequence_id', 'captured_at',
  'lat', 'lng', 'compass_angle', 'is_pano', 'view_kind', 'heading', 'pitch', 'fov', 'road_offset',
  'point_id', 'point_label', 'point_lat', 'point_lng', 'point_heading', 'point_pitch', 'point_fov',
  'point_pano_id', 'point_source', 'point_source_url', 'distance_m',
  'creator', 'license', 'attribution_url', 'run_id', 'downloaded_at',
];

export const DEFAULT_CAPTURE_OPTIONS = {
  provider: MAPILLARY_PROVIDER,
  preset: 'current',
  radius: 30,
  headingCount: 4,
  pitch: 0,
  fov: 90,
  width: 1024,
  folder: 'street-level',
  folderMode: 'category',
  concurrency: 3,
  maxAttempts: 3,
};

export function newRunId() {
  return `slr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newJobState(options = {}) {
  return {
    id: newRunId(),
    createdAt: new Date().toISOString(),
    updatedAt: null,
    status: 'pending',
    options: { ...DEFAULT_CAPTURE_OPTIONS, ...options },
    items: {},
  };
}

export function summarizeJob(state, points = []) {
  const counts = { total: points.length, done: 0, noImage: 0, failed: 0, pending: 0, files: 0 };
  points.forEach((p) => {
    const item = state?.items?.[p.id];
    if (!item) counts.pending += 1;
    else if (item.status === 'done') { counts.done += 1; counts.files += (item.keys || []).length; }
    else if (item.status === 'no-image') counts.noImage += 1;
    else if (item.status === 'failed') counts.failed += 1;
    else counts.pending += 1;
  });
  return counts;
}

const safeSegment = (s) => String(s || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

export function folderForPoint(point, options, index = 0) {
  const base = normalizeFolderPath(options.folder || '');
  if (options.folderMode !== 'set-per-point') return base;
  const name = safeSegment(point.label) || `p${String(index + 1).padStart(4, '0')}_${safeSegment(point.id).slice(-6)}`;
  return normalizeFolderPath(joinFolderPath(base, name));
}

/** Folder tags to apply for the chosen folder mode. */
export function folderTagsFor(folders, options) {
  const tags = {};
  const base = normalizeFolderPath(options.folder || '');
  if (options.folderMode === 'category' && base) tags[base] = 'category';
  if (options.folderMode === 'set-per-point') folders.forEach((f) => { if (f && f !== base) tags[f] = 'set'; });
  return tags;
}

function isRetryable(err) {
  if (err?.name === 'AbortError') return false;
  if (typeof err?.retryable === 'boolean') return err.retryable;
  return true;
}

export async function withRetry(fn, { attempts = 3, baseDelayMs = 500, sleep, signal } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) break;
      await wait(baseDelayMs * 2 ** i);
    }
  }
  throw lastErr;
}

function metadataRow({ key, name, folder, image, view, point, distance, runId, now }) {
  const loc = imageLocation(image) || {};
  const attribution = mapillaryAttribution(image);
  const capturedAt = Number(image.captured_at);
  return {
    media_id: key,
    name,
    folder,
    provider: MAPILLARY_PROVIDER,
    image_id: image.id,
    sequence_id: typeof image.sequence === 'object' ? image.sequence?.id : image.sequence,
    captured_at: Number.isFinite(capturedAt) ? new Date(capturedAt).toISOString() : '',
    lat: loc.lat,
    lng: loc.lng,
    compass_angle: imageCompass(image),
    is_pano: isPanoImage(image),
    view_kind: view.kind,
    heading: view.heading == null ? '' : Math.round(view.heading * 100) / 100,
    pitch: view.pitch ?? '',
    fov: view.fov ?? '',
    road_offset: view.roadOffset ?? '',
    point_id: point.id,
    point_label: point.label || '',
    point_lat: point.lat,
    point_lng: point.lng,
    point_heading: point.heading ?? '',
    point_pitch: point.pitch ?? '',
    point_fov: point.fov ?? '',
    point_pano_id: point.panoId || '',
    point_source: point.source || '',
    point_source_url: point.sourceUrl || '',
    distance_m: Math.round(distance * 10) / 10,
    creator: attribution.creator,
    license: attribution.license,
    attribution_url: attribution.url,
    run_id: runId,
    downloaded_at: now,
  };
}

/**
 * Run (or resume) a capture job.
 *
 * deps: {
 *   search(point, { radius, signal }) → image[]
 *   fetchImage(url, { signal }) → Blob
 *   reproject(blob, { heading, pitch, fov, width, panoCompass }) → Blob
 *   prepare?(blob, name, view) → Blob            // e.g. compression
 *   upload(blob, key) → { url, key }
 *   existingKeys: Set<string>                    // R2 keys already present
 *   sleep?(ms)
 * }
 */
export async function runCaptureJob({
  points = [],
  state,
  prefix,
  deps,
  onProgress,
  onCheckpoint,
  checkpointEvery = 10,
  signal,
}) {
  if (!prefix) throw new Error('Project media prefix is required');
  const job = state?.items ? { ...state, items: { ...state.items } } : newJobState(state?.options);
  const options = { ...DEFAULT_CAPTURE_OPTIONS, ...job.options };
  job.options = options;
  job.status = 'running';
  const claimed = new Set(deps.existingKeys || []);
  const inflight = new Map();
  const entries = [];
  const rows = [];
  const folders = new Set();
  const pending = points
    .map((p, index) => ({ point: p, index }))
    .filter(({ point }) => !DONE_STATUSES.has(job.items[point.id]?.status));
  let sinceCheckpoint = 0;

  const report = () => onProgress?.({ ...summarizeJob(job, points), runId: job.id });
  const checkpoint = async (force = false) => {
    if (!onCheckpoint || (!force && sinceCheckpoint < checkpointEvery)) return;
    sinceCheckpoint = 0;
    job.updatedAt = new Date().toISOString();
    await onCheckpoint({ state: job, entries: entries.splice(0), rows: rows.splice(0), folders: [...folders] });
  };

  report();
  await asyncPool(Math.max(1, options.concurrency), pending, async ({ point, index }) => {
    if (signal?.aborted) return;
    const prev = job.items[point.id] || {};
    const item = { status: 'running', attempts: (prev.attempts || 0) + 1, keys: [], error: null };
    try {
      const images = await withRetry(
        () => deps.search(point, { radius: options.radius, signal }),
        { attempts: options.maxAttempts, sleep: deps.sleep, signal },
      );
      const picked = chooseBestImage(images, point, {
        radius: options.radius,
        preferPano: options.preset !== 'current',
      });
      if (!picked) {
        job.items[point.id] = { ...item, status: 'no-image' };
        return;
      }
      const { image, distance } = picked;
      const folder = folderForPoint(point, options, index);
      const views = planViews(point, image, options.preset, options);
      const now = new Date().toISOString();
      for (const view of views) {
        const name = captureFileName(image, view);
        const key = buildProjectMediaKey(prefix, folder, name);
        if (inflight.has(key)) {
          await inflight.get(key);
          item.keys.push(key);
          continue;
        }
        const alreadyStored = claimed.has(key);
        let url = null;
        if (!alreadyStored) {
          const sourceUrl = imageSourceUrl(image, view);
          if (!sourceUrl) throw Object.assign(new Error('Image has no downloadable rendition'), { retryable: false });
          const download = withRetry(async () => {
            let blob = await deps.fetchImage(sourceUrl, { signal });
            if (view.kind === 'view') {
              blob = await deps.reproject(blob, {
                heading: view.heading, pitch: view.pitch, fov: view.fov,
                width: options.width, panoCompass: imageCompass(image) ?? 0,
              });
            }
            if (deps.prepare) blob = await deps.prepare(blob, name, view);
            const res = await deps.upload(blob, key);
            return res?.url || null;
          }, { attempts: options.maxAttempts, sleep: deps.sleep, signal });
          inflight.set(key, download);
          try {
            url = await download;
          } catch (err) {
            inflight.delete(key);
            throw err;
          }
        } else {
          inflight.set(key, Promise.resolve(null));
        }
        claimed.add(key);
        item.keys.push(key);
        if (folder) folders.add(folder);
        const attribution = mapillaryAttribution(image);
        entries.push({
          url: url || deps.publicUrl?.(key) || '',
          name,
          key,
          media_id: key,
          folder,
          type: 'image',
          attribution: { text: attribution.text, url: attribution.url, license: attribution.license },
          streetLevel: { provider: MAPILLARY_PROVIDER, imageId: String(image.id), pointId: point.id, runId: job.id },
        });
        rows.push(metadataRow({ key, name, folder, image, view, point, distance, runId: job.id, now }));
      }
      job.items[point.id] = { ...item, status: 'done', imageId: String(image.id) };
    } catch (err) {
      if (err?.name === 'AbortError') {
        job.items[point.id] = prev.status ? prev : undefined;
        if (!prev.status) delete job.items[point.id];
        return;
      }
      job.items[point.id] = { ...item, status: 'failed', error: String(err?.message || err).slice(0, 300) };
    } finally {
      sinceCheckpoint += 1;
      report();
      await checkpoint();
    }
  });

  const counts = summarizeJob(job, points);
  job.status = signal?.aborted ? 'cancelled' : counts.failed || counts.pending ? 'partial' : 'done';
  await checkpoint(true);
  report();
  return { state: job, counts };
}

/** Merge metadata rows by media_id (incoming wins) and serialize. */
export function mergeStreetLevelRows(existing = [], incoming = []) {
  const byId = new Map();
  existing.forEach((r) => { if (r?.media_id) byId.set(r.media_id, r); });
  incoming.forEach((r) => { if (r?.media_id) byId.set(r.media_id, r); });
  return [...byId.values()];
}

export function streetLevelRowsToCsv(rows = []) {
  return objectsToCsv(STREET_LEVEL_CSV_HEADERS, rows);
}

/** Merge new media entries into the project's preloadedImages (by key). */
export function mergeMediaEntries(existing = [], incoming = []) {
  const byKey = new Map();
  existing.forEach((e) => byKey.set(e?.key || e?.media_id || e?.url, e));
  incoming.forEach((e) => byKey.set(e.key, { ...(byKey.get(e.key) || {}), ...e }));
  return [...byKey.values()];
}

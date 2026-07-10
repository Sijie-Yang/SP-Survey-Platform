/**
 * Join survey perception scores with image features (L0 / streetscape seg / SAM preannot).
 */
import { getMediaId, normalizeMediaEntry } from './mediaUtils';
import { featureStorageKey, getFeaturesMap } from './imageFeaturesStore';
import { L0_MODEL } from './imageFeaturesL0';
import { SEG_MODEL } from './falInference';
import { SAM_PREANNOT_MODEL } from './imageFeaturesR2';

export { L0_MODEL, SEG_MODEL, SAM_PREANNOT_MODEL };

/** Resolve media_ids for a response question payload. */
export function resolveShownMediaIds(qData, pool = []) {
  if (Array.isArray(qData?.shown_media_ids) && qData.shown_media_ids.length) {
    return qData.shown_media_ids.filter(Boolean);
  }
  const shown = qData?.shown_images || [];
  return shown.map((u) => {
    if (!u) return null;
    const hit = (pool || []).find((img) => img.url === u || img.name === u || img.key === u || img.media_id === u);
    return hit ? getMediaId(hit) : String(u).split('?')[0].split('/').pop() || u;
  }).filter(Boolean);
}

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0; let sy = 0; let sxx = 0; let syy = 0; let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const x = xs[i];
    const y = ys[i];
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (!den) return null;
  return num / den;
}

/**
 * Build per-media perception aggregates from rating-like questions.
 * @returns {{ mediaId, url, name, meanScore, n, scores }[]}
 */
export function aggregatePerceptionByMedia(responses, questions, pool = []) {
  const ratingTypes = new Set([
    'imagerating', 'image_rating', 'mediarating',
  ]);
  const byMedia = {};

  for (const row of responses || []) {
    for (const q of questions || []) {
      if (!ratingTypes.has(q.type)) continue;
      const qData = row.responses?.[q.name];
      if (!qData) continue;
      const answer = (typeof qData === 'object' && qData && 'answer' in qData) ? qData.answer : qData;
      const score = Number(answer);
      if (Number.isNaN(score)) continue;
      const ids = resolveShownMediaIds(
        typeof qData === 'object' ? qData : { shown_images: row.displayed_images?.[q.name] },
        pool,
      );
      for (const mediaId of ids) {
        if (!byMedia[mediaId]) {
          const hit = pool.find((m) => getMediaId(m) === mediaId);
          byMedia[mediaId] = {
            mediaId,
            url: hit?.url || null,
            name: hit?.name || mediaId,
            scores: [],
          };
        }
        byMedia[mediaId].scores.push(score);
      }
    }
  }

  return Object.values(byMedia).map((row) => {
    const mean = row.scores.reduce((a, b) => a + b, 0) / row.scores.length;
    return { ...row, meanScore: mean, n: row.scores.length };
  });
}

/**
 * Wide join: one row per media with perception + L0 + seg features.
 * @param {object} [featureMapOverride] — prefer R2-loaded map; falls back to project JSON.
 */
export function buildImagePerceptionRows(project, responses, questions, featureMapOverride = null) {
  const pool = (project?.preloadedImages || []).map(normalizeMediaEntry).filter(Boolean);
  const featureMap = featureMapOverride && typeof featureMapOverride === 'object'
    ? featureMapOverride
    : getFeaturesMap(project);
  const perception = aggregatePerceptionByMedia(responses, questions, pool);
  const perceptionById = Object.fromEntries(perception.map((p) => [p.mediaId, p]));

  // Include all media that have features or perception
  const ids = new Set([
    ...perception.map((p) => p.mediaId),
    ...Object.keys(featureMap).map((k) => k.split('::')[0]),
  ]);

  const rows = [];
  for (const mediaId of ids) {
    if (!mediaId) continue;
    const hit = pool.find((m) => getMediaId(m) === mediaId);
    const perc = perceptionById[mediaId];
    const l0 = featureMap[featureStorageKey(mediaId, L0_MODEL)];
    const seg = featureMap[featureStorageKey(mediaId, SEG_MODEL)];
    const sam = featureMap[featureStorageKey(mediaId, SAM_PREANNOT_MODEL)];
    rows.push({
      media_id: mediaId,
      name: hit?.name || perc?.name || mediaId,
      url: hit?.url || perc?.url || null,
      mean_score: perc?.meanScore ?? null,
      n_ratings: perc?.n ?? 0,
      l0_status: l0?.status || (l0?.features ? 'ready' : 'missing'),
      seg_status: seg?.status || (seg?.features ? 'ready' : 'missing'),
      sam_status: sam?.status || (sam?.features ? 'ready' : 'missing'),
      ...(l0?.features || {}),
      ...(seg?.features || {}),
      ...(sam?.features || {}),
    });
  }
  return rows.sort((a, b) => (b.n_ratings || 0) - (a.n_ratings || 0));
}

/**
 * Pearson correlations between mean_score and numeric feature columns.
 */
export function correlateFeaturesWithPerception(rows) {
  const scored = (rows || []).filter((r) => r.mean_score != null && r.n_ratings > 0);
  if (scored.length < 3) return [];
  const skip = new Set(['media_id', 'name', 'url', 'mean_score', 'n_ratings', 'l0_status', 'seg_status', 'sam_status', 'seg_vocab']);
  const keys = new Set();
  scored.forEach((r) => {
    Object.keys(r).forEach((k) => {
      if (!skip.has(k) && typeof r[k] === 'number' && Number.isFinite(r[k])) keys.add(k);
    });
  });
  const ys = scored.map((r) => r.mean_score);
  return [...keys]
    .map((key) => {
      const xs = scored.map((r) => r[key]);
      const valid = xs.map((x, i) => (Number.isFinite(x) ? i : -1)).filter((i) => i >= 0);
      if (valid.length < 3) return null;
      const r = pearson(valid.map((i) => xs[i]), valid.map((i) => ys[i]));
      return r == null ? null : { feature: key, r, n: valid.length };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}

export function exportImagePerceptionCsv(rows) {
  if (!rows?.length) return;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const header = keys.join(',');
  const lines = rows.map((r) => keys.map((k) => {
    const v = r[k];
    if (v == null) return '';
    if (typeof v === 'object') return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','));
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `image_x_perception_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Mapillary (CC BY-SA 4.0) provider: nearest-image search, view planning,
 * deterministic file names and attribution. Network access is injected.
 *
 * API: https://www.mapillary.com/developer/api-documentation/
 */

import { bearingDegrees, distanceMeters } from './points';

export const MAPILLARY_PROVIDER = 'mapillary';
export const MAPILLARY_LICENSE = 'CC BY-SA 4.0';
export const MAPILLARY_MAX_RADIUS_M = 50;
export const MAPILLARY_IMAGE_FIELDS = [
  'id', 'geometry', 'computed_geometry', 'compass_angle', 'computed_compass_angle',
  'captured_at', 'is_pano', 'camera_type', 'creator', 'sequence', 'quality_score',
  'width', 'height', 'thumb_2048_url', 'thumb_original_url',
].join(',');

export const CAPTURE_PRESETS = ['current', 'pano', 'headings', 'road'];

const angleDiff = (a, b) => {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return Number.isFinite(d) ? d : 180;
};

export function imageLocation(image) {
  const coords = image?.computed_geometry?.coordinates || image?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  return { lat: Number(coords[1]), lng: Number(coords[0]) };
}

export function imageCompass(image) {
  const c = image?.computed_compass_angle ?? image?.compass_angle;
  return Number.isFinite(Number(c)) ? Number(c) : null;
}

export function isPanoImage(image) {
  return Boolean(image?.is_pano)
    || ['equirectangular', 'spherical'].includes(String(image?.camera_type || '').toLowerCase());
}

export function buildMapillarySearchUrl({ lat, lng, radius = 30, limit = 20, token }) {
  const params = new URLSearchParams({
    access_token: token,
    fields: MAPILLARY_IMAGE_FIELDS,
    lat: String(lat),
    lng: String(lng),
    radius: String(Math.max(1, Math.min(MAPILLARY_MAX_RADIUS_M, Math.round(radius)))),
    limit: String(Math.max(1, Math.min(100, Math.round(limit)))),
  });
  return `https://graph.mapillary.com/images?${params.toString()}`;
}

export class ProviderError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

/** Radius search around a point. Returns raw image records. */
export async function searchMapillaryNearby({ lat, lng, radius, limit, token, fetchImpl = fetch, signal }) {
  if (!token) throw new ProviderError('Mapillary access token is required');
  const res = await fetchImpl(buildMapillarySearchUrl({ lat, lng, radius, limit, token }), { signal });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
    throw new ProviderError(`Mapillary search HTTP ${res.status}${detail ? `: ${detail}` : ''}`, {
      status: res.status,
      retryable: res.status === 429 || res.status >= 500,
    });
  }
  const body = await res.json();
  return Array.isArray(body?.data) ? body.data : [];
}

/**
 * Pick the best image for a point. Distance dominates; when the point has a
 * heading, perspective images facing away are penalized (panoramas can be
 * re-projected to any heading, so they are not).
 */
export function chooseBestImage(images = [], point, { preferPano = false, radius = MAPILLARY_MAX_RADIUS_M } = {}) {
  let best = null;
  images.forEach((image) => {
    const loc = imageLocation(image);
    if (!loc || !image?.id) return;
    const distance = distanceMeters(point, loc);
    if (distance > radius + 1) return;
    const pano = isPanoImage(image);
    let score = distance;
    if (point.heading != null && !pano) {
      const compass = imageCompass(image);
      score += compass == null ? 30 : angleDiff(compass, point.heading) * 0.5;
    }
    if (pano && (preferPano || point.heading != null)) score -= 5;
    if (Number.isFinite(image.quality_score)) score -= image.quality_score * 5;
    if (!best || score < best.score) best = { image, distance, score };
  });
  return best ? { image: best.image, distance: best.distance } : null;
}

function roadBearingFor(point, image) {
  if (point.roadBearing != null) return point.roadBearing;
  if (point.heading != null) return point.heading;
  return imageCompass(image) ?? 0;
}

/**
 * Views to capture for one image.
 * kind: 'view' (re-projected from a panorama), 'pano' (equirectangular), 'original' (as uploaded).
 */
export function planViews(point, image, preset = 'current', { headingCount = 4, pitch = 0, fov = 90 } = {}) {
  const pano = isPanoImage(image);
  const basePitch = point.pitch ?? pitch;
  const baseFov = point.fov ?? fov;
  if (preset === 'pano') return [{ kind: pano ? 'pano' : 'original' }];
  if (!pano) return [{ kind: 'original' }];
  if (preset === 'headings') {
    const n = Math.max(1, Math.min(12, Math.round(headingCount)));
    const start = point.heading ?? 0;
    return Array.from({ length: n }, (_, i) => ({
      kind: 'view', heading: (start + (360 / n) * i) % 360, pitch: basePitch, fov: baseFov,
    }));
  }
  if (preset === 'road') {
    const road = roadBearingFor(point, image);
    return [0, 90, 180, 270].map((offset) => ({
      kind: 'view', heading: (road + offset) % 360, pitch: basePitch, fov: baseFov, roadOffset: offset,
    }));
  }
  const loc = imageLocation(image);
  const heading = point.heading ?? (loc ? bearingDegrees(loc, point) : imageCompass(image) ?? 0);
  return [{ kind: 'view', heading, pitch: basePitch, fov: baseFov }];
}

const pad3 = (n) => String(Math.round(((n % 360) + 360) % 360)).padStart(3, '0');
const signed = (n) => `${n < 0 ? 'm' : 'p'}${String(Math.abs(Math.round(n))).padStart(2, '0')}`;

/** Deterministic file name → natural dedup and resume across runs. */
export function captureFileName(image, view) {
  const id = String(image.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  if (view.kind === 'pano') return `mly-${id}-pano.jpg`;
  if (view.kind === 'original') return `mly-${id}-orig.jpg`;
  return `mly-${id}-h${pad3(view.heading)}-${signed(view.pitch || 0)}-f${String(Math.round(view.fov || 90)).padStart(3, '0')}.jpg`;
}

/** Re-projected views sample the full-resolution original; stored files use the 2048 px rendition. */
export function imageSourceUrl(image, view) {
  if (view.kind === 'view') return image.thumb_original_url || image.thumb_2048_url || null;
  return image.thumb_2048_url || image.thumb_original_url || null;
}

export function mapillaryAttribution(image) {
  const user = image?.creator?.username || '';
  return {
    creator: user,
    license: MAPILLARY_LICENSE,
    url: `https://www.mapillary.com/app/?pKey=${encodeURIComponent(image.id)}`,
    text: `${user ? `${user} / ` : ''}Mapillary, ${MAPILLARY_LICENSE}`,
  };
}

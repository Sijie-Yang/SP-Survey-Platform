/** Browser calls for the street-level panel (Worker / Express bridge + Mapillary). */

import { authHeaders, getR2ServerUrl } from '../r2';
import { ProviderError, searchMapillaryNearby } from './mapillary';

async function describe(res, label) {
  let detail = '';
  try { detail = (await res.json())?.error || ''; } catch { /* ignore */ }
  return new ProviderError(`${label} HTTP ${res.status}${detail ? `: ${detail}` : ''}`, {
    status: res.status,
    retryable: res.status === 429 || res.status >= 500,
  });
}

/** Resolve maps.app.goo.gl links server-side (redirect headers only). */
export async function expandShortLinks(urls) {
  const res = await fetch(`${getR2ServerUrl()}/api/street-level/expand`, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ urls }),
  });
  if (!res.ok) throw await describe(res, 'Short link expansion');
  const body = await res.json();
  return Array.isArray(body?.results) ? body.results : [];
}

export async function fetchMapillaryImageBlob(url, { signal } = {}) {
  const res = await fetch(
    `${getR2ServerUrl()}/api/street-level/mapillary-image?url=${encodeURIComponent(url)}`,
    { headers: await authHeaders(), signal },
  );
  if (!res.ok) throw await describe(res, 'Mapillary image');
  return res.blob();
}

export function mapillarySearch(token) {
  return (point, { radius, signal } = {}) => searchMapillaryNearby({
    lat: point.lat, lng: point.lng, radius, limit: 30, token, signal,
  });
}

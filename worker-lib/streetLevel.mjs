/**
 * Street-level helpers for the Worker (and the local Express bridge).
 *
 * POST /api/street-level/expand          { urls: string[] } → resolve maps.app.goo.gl / goo.gl/maps
 *   short links by reading redirect Location headers only. The final Google Maps
 *   page is never requested, and no imagery is fetched.
 * GET  /api/street-level/mapillary-image?url=…  → stream a Mapillary CDN rendition
 *   (host-allowlisted) so the browser can re-project and upload it to R2.
 */

const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);
const GOOGLE_MAPS_HOST_RE = /^(?:www\.|maps\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/i;
const CONSENT_HOST_RE = /^consent\.google\.[a-z.]+$/i;
const MAPILLARY_IMAGE_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:fbcdn\.net|mapillary\.com)$/i;
const MAX_EXPAND_URLS = 50;
const MAX_HOPS = 5;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

function parseUrl(raw) {
  try { return new URL(String(raw || '').trim()); } catch { return null; }
}

export function isShortMapsUrl(raw) {
  const url = parseUrl(raw);
  if (!url || url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  if (!SHORT_HOSTS.has(host)) return false;
  return host === 'maps.app.goo.gl' || url.pathname.startsWith('/maps');
}

export function isGoogleMapsUrl(raw) {
  const url = parseUrl(raw);
  return Boolean(url && url.protocol === 'https:' && GOOGLE_MAPS_HOST_RE.test(url.hostname)
    && (url.pathname.startsWith('/maps') || url.hostname.toLowerCase().startsWith('maps.')));
}

/**
 * Follow a short Maps link hop by hop (redirect: 'manual') until the Location
 * points at a Google Maps URL. Every hop must stay on an allowlisted host.
 */
export async function expandShortMapsUrl(raw, { fetchImpl = fetch, maxHops = MAX_HOPS } = {}) {
  if (!isShortMapsUrl(raw)) return { ok: false, input: raw, error: 'Not a maps.app.goo.gl or goo.gl/maps link' };
  let current = parseUrl(raw);
  current.protocol = 'https:';
  for (let hop = 0; hop < maxHops; hop += 1) {
    let res;
    try {
      res = await fetchImpl(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SP-Survey link expander)', Accept: 'text/html' },
      });
    } catch (err) {
      return { ok: false, input: raw, error: `Fetch failed: ${err?.message || err}` };
    }
    try { await res.body?.cancel?.(); } catch { /* ignore */ }
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) {
      return { ok: false, input: raw, error: `Short link did not redirect (HTTP ${res.status})` };
    }
    let next = parseUrl(new URL(location, current).toString());
    if (next && CONSENT_HOST_RE.test(next.hostname) && next.searchParams.get('continue')) {
      next = parseUrl(next.searchParams.get('continue'));
    }
    if (!next) return { ok: false, input: raw, error: 'Invalid redirect target' };
    if (isGoogleMapsUrl(next.toString())) return { ok: true, input: raw, url: next.toString() };
    if (!SHORT_HOSTS.has(next.hostname.toLowerCase())) {
      return { ok: false, input: raw, error: `Redirected to an unexpected host (${next.hostname})` };
    }
    current = next;
  }
  return { ok: false, input: raw, error: 'Too many redirects' };
}

export async function expandShortMapsUrls(urls, opts = {}) {
  const list = (Array.isArray(urls) ? urls : []).slice(0, MAX_EXPAND_URLS);
  const results = [];
  for (const u of list) {
    results.push(await expandShortMapsUrl(u, opts));
  }
  return results;
}

export function isAllowedMapillaryImageUrl(raw) {
  const url = parseUrl(raw);
  return Boolean(url && url.protocol === 'https:' && MAPILLARY_IMAGE_HOST_RE.test(url.hostname));
}

async function proxyMapillaryImage(rawUrl, fetchImpl) {
  if (!isAllowedMapillaryImageUrl(rawUrl)) {
    return json({ success: false, error: 'Only Mapillary image URLs are allowed' }, { status: 400 });
  }
  const upstream = await fetchImpl(rawUrl, { redirect: 'follow' });
  if (!upstream.ok) {
    return json({ success: false, error: `Upstream HTTP ${upstream.status}` }, { status: upstream.status === 404 ? 404 : 502 });
  }
  const contentType = upstream.headers.get('content-type') || 'image/jpeg';
  if (!/^image\//i.test(contentType)) {
    return json({ success: false, error: 'Upstream did not return an image' }, { status: 502 });
  }
  const length = Number(upstream.headers.get('content-length') || 0);
  if (length > MAX_IMAGE_BYTES) {
    return json({ success: false, error: 'Image too large' }, { status: 413 });
  }
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_IMAGE_BYTES) {
    return json({ success: false, error: 'Image too large' }, { status: 413 });
  }
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'private, no-store' },
  });
}

/**
 * Route handler. Returns null when the path is not a street-level route.
 * `authorize(request)` must resolve truthy for signed-in users.
 */
export async function handleStreetLevelRoutes(request, env, { authorize, fetchImpl = fetch } = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/street-level/')) return null;
  if (authorize && !(await authorize(request))) {
    return json({ success: false, error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  if (url.pathname === '/api/street-level/expand' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const urls = Array.isArray(body?.urls) ? body.urls : (body?.url ? [body.url] : []);
    if (!urls.length) return json({ success: false, error: '"urls" is required' }, { status: 400 });
    if (urls.length > MAX_EXPAND_URLS) {
      return json({ success: false, error: `At most ${MAX_EXPAND_URLS} links per request` }, { status: 400 });
    }
    const results = await expandShortMapsUrls(urls, { fetchImpl });
    return json({ success: true, results });
  }
  if (url.pathname === '/api/street-level/mapillary-image' && request.method === 'GET') {
    return proxyMapillaryImage(url.searchParams.get('url'), fetchImpl);
  }
  return json({ success: false, error: 'Not found' }, { status: 404 });
}

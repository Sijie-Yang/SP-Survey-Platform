import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandShortMapsUrl,
  expandShortMapsUrls,
  handleStreetLevelRoutes,
  isAllowedMapillaryImageUrl,
  isShortMapsUrl,
} from './streetLevel.mjs';

const FINAL = 'https://www.google.com/maps/@48.85,2.29,3a,75y,90h,95t/data=!3m6!1e1!3m4!1sPANO!2e0';

function redirectingFetch(map, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    const next = map[url];
    if (next === undefined) return new Response('not found', { status: 404 });
    if (typeof next === 'number') return new Response('', { status: next });
    return new Response(null, { status: 302, headers: { Location: next } });
  };
}

test('expands a maps.app.goo.gl link without requesting the Google Maps page', async () => {
  const calls = [];
  const fetchImpl = redirectingFetch({ 'https://maps.app.goo.gl/abc': FINAL }, calls);
  const r = await expandShortMapsUrl('https://maps.app.goo.gl/abc', { fetchImpl });
  assert.deepEqual(r, { ok: true, input: 'https://maps.app.goo.gl/abc', url: FINAL });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'manual');
});

test('follows multiple short-link hops, relative Locations and consent continue URLs', async () => {
  const fetchImpl = redirectingFetch({
    'https://goo.gl/maps/xyz': '/maps/hop2',
    'https://goo.gl/maps/hop2': 'https://maps.app.goo.gl/final',
    'https://maps.app.goo.gl/final': `https://consent.google.com/ml?continue=${encodeURIComponent(FINAL)}`,
  });
  const r = await expandShortMapsUrl('http://goo.gl/maps/xyz', { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.url, FINAL);
});

test('rejects non-short links, off-allowlist redirects, loops and non-redirects', async () => {
  assert.equal((await expandShortMapsUrl('https://example.com/a')).ok, false);
  const evil = await expandShortMapsUrl('https://maps.app.goo.gl/e', {
    fetchImpl: redirectingFetch({ 'https://maps.app.goo.gl/e': 'https://evil.example/x' }),
  });
  assert.match(evil.error, /unexpected host/);
  const loop = await expandShortMapsUrl('https://maps.app.goo.gl/l', {
    fetchImpl: redirectingFetch({ 'https://maps.app.goo.gl/l': 'https://maps.app.goo.gl/l' }),
  });
  assert.match(loop.error, /Too many redirects/);
  const dead = await expandShortMapsUrl('https://maps.app.goo.gl/d', {
    fetchImpl: redirectingFetch({ 'https://maps.app.goo.gl/d': 200 }),
  });
  assert.match(dead.error, /did not redirect/);
  const thrown = await expandShortMapsUrl('https://maps.app.goo.gl/t', { fetchImpl: async () => { throw new Error('offline'); } });
  assert.match(thrown.error, /offline/);
});

test('batch expansion keeps order and caps input', async () => {
  const fetchImpl = redirectingFetch({ 'https://maps.app.goo.gl/1': FINAL });
  const results = await expandShortMapsUrls(['https://maps.app.goo.gl/1', 'https://example.com'], { fetchImpl });
  assert.deepEqual(results.map((r) => r.ok), [true, false]);
});

test('host checks', () => {
  assert.equal(isShortMapsUrl('https://goo.gl/other'), false);
  assert.equal(isAllowedMapillaryImageUrl('https://scontent-arn2-1.xx.fbcdn.net/m1/v/t6/a.jpg'), true);
  assert.equal(isAllowedMapillaryImageUrl('https://maps.googleapis.com/maps/api/streetview?x'), false);
  assert.equal(isAllowedMapillaryImageUrl('http://scontent.xx.fbcdn.net/a.jpg'), false);
});

test('route handler: auth, expand, and the Mapillary proxy allowlist', async () => {
  const deny = await handleStreetLevelRoutes(
    new Request('https://x/api/street-level/expand', { method: 'POST', body: '{}' }),
    {},
    { authorize: async () => null },
  );
  assert.equal(deny.status, 401);

  const fetchImpl = async (url) => {
    if (url === 'https://maps.app.goo.gl/abc') return new Response(null, { status: 301, headers: { Location: FINAL } });
    if (url.startsWith('https://scontent.xx.fbcdn.net/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    throw new Error(`unexpected fetch ${url}`);
  };
  const expand = await handleStreetLevelRoutes(
    new Request('https://x/api/street-level/expand', { method: 'POST', body: JSON.stringify({ urls: ['https://maps.app.goo.gl/abc'] }) }),
    {},
    { authorize: async () => ({ userId: 'u' }), fetchImpl },
  );
  assert.equal((await expand.json()).results[0].url, FINAL);

  const img = await handleStreetLevelRoutes(
    new Request(`https://x/api/street-level/mapillary-image?url=${encodeURIComponent('https://scontent.xx.fbcdn.net/a.jpg')}`),
    {}, { fetchImpl },
  );
  assert.equal(img.status, 200);
  assert.equal((await img.arrayBuffer()).byteLength, 3);

  const blocked = await handleStreetLevelRoutes(
    new Request(`https://x/api/street-level/mapillary-image?url=${encodeURIComponent('https://maps.googleapis.com/maps/api/streetview')}`),
    {}, { fetchImpl },
  );
  assert.equal(blocked.status, 400);

  assert.equal(await handleStreetLevelRoutes(new Request('https://x/api/other'), {}), null);
});

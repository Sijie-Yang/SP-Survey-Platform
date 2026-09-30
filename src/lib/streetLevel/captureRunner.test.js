import {
  folderTagsFor,
  mergeMediaEntries,
  mergeStreetLevelRows,
  runCaptureJob,
  streetLevelRowsToCsv,
  withRetry,
} from './captureRunner';
import {
  buildMapillarySearchUrl,
  captureFileName,
  chooseBestImage,
  planViews,
} from './mapillary';
import { renderPerspective } from './reproject';
import { normalizePoint } from './points';

const img = (id, lat, lng, extra = {}) => ({
  id,
  geometry: { type: 'Point', coordinates: [lng, lat] },
  computed_compass_angle: 0,
  captured_at: Date.UTC(2024, 4, 1),
  creator: { username: 'mapper' },
  thumb_2048_url: `https://scontent.example.fbcdn.net/${id}-2048.jpg`,
  thumb_original_url: `https://scontent.example.fbcdn.net/${id}-orig.jpg`,
  ...extra,
});

describe('Mapillary selection and planning', () => {
  const point = normalizePoint({ id: 'p1', lat: 1, lng: 2 });

  it('builds a radius search URL capped at 50 m', () => {
    const u = new URL(buildMapillarySearchUrl({ lat: 1, lng: 2, radius: 80, token: 'MLY|x' }));
    expect(u.origin + u.pathname).toBe('https://graph.mapillary.com/images');
    expect(u.searchParams.get('radius')).toBe('50');
    expect(u.searchParams.get('fields')).toContain('thumb_original_url');
  });

  it('prefers the nearest image and ignores images outside the radius', () => {
    const near = img('near', 1.0001, 2);
    const far = img('far', 1.001, 2);
    expect(chooseBestImage([far, near], point, { radius: 50 }).image.id).toBe('near');
    expect(chooseBestImage([far], point, { radius: 50 })).toBeNull();
  });

  it('prefers a perspective image facing the pasted heading', () => {
    const p = { ...point, heading: 180 };
    const facingNorth = img('n', 1.00005, 2, { computed_compass_angle: 0 });
    const facingSouth = img('s', 1.0001, 2, { computed_compass_angle: 178 });
    expect(chooseBestImage([facingNorth, facingSouth], p).image.id).toBe('s');
  });

  it('plans views per preset', () => {
    const pano = img('pano', 1, 2, { is_pano: true, computed_compass_angle: 10 });
    const persp = img('persp', 1, 2);
    expect(planViews(point, persp, 'headings')).toEqual([{ kind: 'original' }]);
    expect(planViews(point, pano, 'pano')).toEqual([{ kind: 'pano' }]);
    expect(planViews(point, pano, 'headings', { headingCount: 4 }).map((v) => v.heading)).toEqual([0, 90, 180, 270]);
    expect(planViews({ ...point, roadBearing: 30 }, pano, 'road').map((v) => v.heading)).toEqual([30, 120, 210, 300]);
    expect(planViews({ ...point, heading: 45, pitch: 5, fov: 60 }, pano, 'current')).toEqual([{ kind: 'view', heading: 45, pitch: 5, fov: 60 }]);
  });

  it('names captures deterministically', () => {
    expect(captureFileName({ id: '123' }, { kind: 'view', heading: 5.4, pitch: -3, fov: 60 })).toBe('mly-123-h005-m03-f060.jpg');
    expect(captureFileName({ id: '123' }, { kind: 'pano' })).toBe('mly-123-pano.jpg');
  });
});

describe('renderPerspective', () => {
  it('maps the view center to the pano direction of the requested heading', () => {
    const W = 8; const H = 4;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let x = 0; x < W; x += 1) {
      for (let y = 0; y < H; y += 1) {
        const o = (y * W + x) * 4;
        data[o] = x * 30; data[o + 3] = 255;
      }
    }
    const src = { data, width: W, height: H };
    const center = (rgba, w, h) => rgba[((Math.floor(h / 2)) * w + Math.floor(w / 2)) * 4];
    const ahead = renderPerspective(src, { heading: 0, panoCompass: 0, width: 2, height: 2, fov: 10 });
    const east = renderPerspective(src, { heading: 90, panoCompass: 0, width: 2, height: 2, fov: 10 });
    const eastOfRotatedPano = renderPerspective(src, { heading: 180, panoCompass: 90, width: 2, height: 2, fov: 10 });
    expect(Math.abs(center(ahead, 2, 2) - 3.5 * 30)).toBeLessThan(20);
    expect(Math.abs(center(east, 2, 2) - 5.5 * 30)).toBeLessThan(20);
    expect(center(eastOfRotatedPano, 2, 2)).toBe(center(east, 2, 2));
  });
});

describe('runCaptureJob', () => {
  const prefix = 'user1/proj1/';
  const points = [
    normalizePoint({ id: 'a', lat: 1, lng: 2, label: 'Corner A' }),
    normalizePoint({ id: 'b', lat: 1.00001, lng: 2 }),
    normalizePoint({ id: 'c', lat: 5, lng: 5 }),
  ];
  const images = { a: [img('100', 1, 2)], b: [img('100', 1, 2)], c: [] };

  function makeDeps(overrides = {}) {
    const uploads = [];
    return {
      uploads,
      deps: {
        search: async (p) => images[p.id],
        fetchImage: async (url) => ({ url }),
        reproject: async (blob) => blob,
        upload: async (blob, key) => { uploads.push(key); return { url: `https://r2/${key}`, key }; },
        existingKeys: new Set(),
        sleep: async () => {},
        ...overrides,
      },
    };
  }

  it('downloads, dedups shared images, reports no-image points and emits metadata', async () => {
    const { deps, uploads } = makeDeps();
    const checkpoints = [];
    const { state, counts } = await runCaptureJob({
      points,
      prefix,
      state: { options: { folder: 'streets', folderMode: 'category', preset: 'current' } },
      deps,
      onCheckpoint: (c) => checkpoints.push(c),
    });
    expect(uploads).toEqual(['user1/proj1/streets/mly-100-orig.jpg']);
    expect(counts).toMatchObject({ total: 3, done: 2, noImage: 1, failed: 0 });
    expect(state.status).toBe('done');
    const entries = checkpoints.flatMap((c) => c.entries);
    const rows = checkpoints.flatMap((c) => c.rows);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ folder: 'streets', type: 'image', attribution: { license: 'CC BY-SA 4.0' } });
    expect(rows[0]).toMatchObject({ media_id: 'user1/proj1/streets/mly-100-orig.jpg', image_id: '100', point_id: 'a', creator: 'mapper', captured_at: '2024-05-01T00:00:00.000Z' });
    expect(streetLevelRowsToCsv(rows).split('\n')[0]).toContain('point_source_url');
  });

  it('retries transient failures, records permanent ones, and resumes only unfinished points', async () => {
    let calls = 0;
    const flaky = makeDeps({
      fetchImage: async () => {
        calls += 1;
        if (calls === 1) throw new Error('network');
        throw Object.assign(new Error('HTTP 404'), { retryable: false });
      },
    });
    const first = await runCaptureJob({
      points: points.slice(0, 1), prefix, deps: flaky.deps,
      state: { options: { folder: 'streets', maxAttempts: 3, concurrency: 1 } },
    });
    expect(calls).toBe(2);
    expect(first.state.items.a).toMatchObject({ status: 'failed', attempts: 1 });

    const ok = makeDeps();
    const second = await runCaptureJob({ points: points.slice(0, 1), prefix, deps: ok.deps, state: first.state });
    expect(second.state.items.a).toMatchObject({ status: 'done', attempts: 2 });
    expect(ok.uploads).toHaveLength(1);

    const third = makeDeps();
    await runCaptureJob({ points: points.slice(0, 1), prefix, deps: third.deps, state: second.state });
    expect(third.uploads).toHaveLength(0);
  });

  it('skips downloads for keys already in R2 but still records media and metadata', async () => {
    const { deps, uploads } = makeDeps({ existingKeys: new Set(['user1/proj1/streets/mly-100-orig.jpg']), publicUrl: (k) => `https://pub/${k}` });
    const checkpoints = [];
    await runCaptureJob({
      points: points.slice(0, 1), prefix, deps,
      state: { options: { folder: 'streets' } },
      onCheckpoint: (c) => checkpoints.push(c),
    });
    expect(uploads).toHaveLength(0);
    expect(checkpoints.flatMap((c) => c.entries)[0].url).toBe('https://pub/user1/proj1/streets/mly-100-orig.jpg');
  });

  it('puts each point in its own set folder in set-per-point mode', async () => {
    const pano = { a: [img('7', 1, 2, { is_pano: true })] };
    const { deps, uploads } = makeDeps({ search: async (p) => pano[p.id] || [] });
    await runCaptureJob({
      points: points.slice(0, 1), prefix, deps,
      state: { options: { folder: 'sets', folderMode: 'set-per-point', preset: 'headings', headingCount: 2 } },
    });
    expect(uploads).toEqual([
      'user1/proj1/sets/Corner_A/mly-7-h000-p00-f090.jpg',
      'user1/proj1/sets/Corner_A/mly-7-h180-p00-f090.jpg',
    ]);
    expect(folderTagsFor(['sets/Corner_A'], { folder: 'sets', folderMode: 'set-per-point' })).toEqual({ 'sets/Corner_A': 'set' });
    expect(folderTagsFor([], { folder: 'sets', folderMode: 'category' })).toEqual({ sets: 'category' });
  });

  it('stops on cancel without marking unfinished points', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps } = makeDeps();
    const { state } = await runCaptureJob({ points, prefix, deps, signal: controller.signal });
    expect(state.status).toBe('cancelled');
    expect(Object.keys(state.items)).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('withRetry backs off and gives up on non-retryable errors', async () => {
    const waits = [];
    let n = 0;
    await expect(withRetry(async () => { n += 1; throw new Error('x'); }, { attempts: 3, sleep: async (ms) => waits.push(ms) })).rejects.toThrow('x');
    expect(n).toBe(3);
    expect(waits).toEqual([500, 1000]);
    n = 0;
    await expect(withRetry(async () => { n += 1; throw Object.assign(new Error('no'), { retryable: false }); }, { attempts: 3 })).rejects.toThrow('no');
    expect(n).toBe(1);
  });

  it('merges rows and media entries by key', () => {
    expect(mergeStreetLevelRows([{ media_id: 'k', v: 1 }], [{ media_id: 'k', v: 2 }, { media_id: 'j' }])).toEqual([{ media_id: 'k', v: 2 }, { media_id: 'j' }]);
    expect(mergeMediaEntries([{ key: 'k', name: 'old' }], [{ key: 'k', name: 'new' }])).toEqual([{ key: 'k', name: 'new' }]);
  });
});

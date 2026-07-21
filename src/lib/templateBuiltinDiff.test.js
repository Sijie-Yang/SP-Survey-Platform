import {
  stableStringify,
  normalizeBuiltinCompareTags,
  buildBuiltinImportSnapshot,
  buildOnlineImportSnapshot,
  diffBuiltinImportSnapshots,
  collectJsonPathDiffs,
} from './templateBuiltinDiff';

describe('templateBuiltinDiff', () => {
  test('stableStringify ignores object key order', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  test('normalizeBuiltinCompareTags adds official and sorts', () => {
    expect(normalizeBuiltinCompareTags(['user-created', 'official'])).toEqual([
      'official',
      'user-created',
    ]);
    expect(normalizeBuiltinCompareTags(['reference'])).toEqual(['official', 'reference']);
  });

  test('identical snapshots are unchanged', () => {
    const tpl = {
      name: 'A',
      description: 'd',
      author: 'x',
      year: '2026',
      category: 'Academic Research',
      tags: ['official'],
      website: null,
      huggingfaceDataset: null,
      isPinned: false,
      config: { title: 'T', pages: [] },
      imageDatasetConfig: {},
    };
    const online = {
      ...tpl,
      is_pinned: true,
      is_approved: false,
      show_on_landing: false,
      preloadedImages: [],
    };
    const { unchanged, diffs } = diffBuiltinImportSnapshots(
      buildBuiltinImportSnapshot(tpl),
      buildOnlineImportSnapshot(online),
    );
    // Pin / landing / approved flags must not force a content diff.
    expect(unchanged).toBe(true);
    expect(diffs).toEqual([]);
  });

  test('missing official tag on online counts as a diff', () => {
    const { unchanged, diffs } = diffBuiltinImportSnapshots(
      buildBuiltinImportSnapshot({ name: 'A', tags: ['reference'], config: {} }),
      buildOnlineImportSnapshot({
        name: 'A',
        tags: ['reference'],
        config: {},
        is_approved: true,
        show_on_landing: true,
      }),
    );
    expect(unchanged).toBe(false);
    expect(diffs.some((d) => d.field === 'tags')).toBe(true);
  });

  test('reports meta and config path diffs', () => {
    const builtin = buildBuiltinImportSnapshot({
      name: 'New',
      description: '',
      author: 'a',
      year: '2026',
      category: 'AI Template',
      tags: ['official'],
      config: { title: 'B', pages: [{ elements: [{ name: 'q1', type: 'text' }] }] },
    });
    const online = buildOnlineImportSnapshot({
      name: 'Old',
      description: '',
      author: 'a',
      year: '2026',
      category: 'Academic Research',
      tags: ['official'],
      is_approved: true,
      show_on_landing: true,
      is_pinned: false,
      config: { title: 'A', pages: [{ elements: [{ name: 'q1', type: 'text' }] }] },
      preloadedImages: [],
    });
    const { unchanged, diffs } = diffBuiltinImportSnapshots(builtin, online);
    expect(unchanged).toBe(false);
    expect(diffs.map((d) => d.field)).toEqual(expect.arrayContaining(['name', 'category', 'config']));
    const cfg = diffs.find((d) => d.field === 'config');
    expect(cfg.paths.some((p) => p.path.includes('title'))).toBe(true);
  });

  test('image pack alone counts as a diff only when online is missing files', () => {
    const builtin = buildBuiltinImportSnapshot(
      { name: 'A', config: {}, tags: ['official'] },
      { bundledImages: ['study2/a.jpg', 'study2/b.jpg'] },
    );
    const onlineMissing = buildOnlineImportSnapshot({
      name: 'A',
      config: {},
      tags: ['official'],
      is_approved: true,
      show_on_landing: true,
      preloadedImages: [{ name: 'a.jpg', folder: 'study2' }],
    });
    const missing = diffBuiltinImportSnapshots(builtin, onlineMissing);
    expect(missing.unchanged).toBe(false);
    expect(missing.willRefreshImages).toBe(true);
    expect(missing.diffs.some((d) => d.field === 'images')).toBe(true);

    const onlineComplete = buildOnlineImportSnapshot({
      name: 'A',
      config: {},
      tags: ['official'],
      is_approved: true,
      show_on_landing: true,
      preloadedImages: [
        { name: 'a.jpg', folder: 'study2', key: 'templates/t/study2/a.jpg' },
        { name: 'b.jpg', folder: 'study2', key: 'templates/t/study2/b.jpg' },
      ],
    });
    const complete = diffBuiltinImportSnapshots(builtin, onlineComplete);
    expect(complete.willRefreshImages).toBe(false);
    expect(complete.diffs.some((d) => d.field === 'images')).toBe(false);
    expect(complete.unchanged).toBe(true);
  });

  test('collectJsonPathDiffs finds nested changes', () => {
    const paths = collectJsonPathDiffs(
      { pages: [{ elements: [{ allowedTools: ['polygon'] }] }] },
      { pages: [{ elements: [{ allowedTools: ['region'] }] }] },
      { limit: 5 },
    );
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].path).toContain('allowedTools');
  });
});

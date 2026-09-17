import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSiliconMediaSnapshot } from './mediaSource.mjs';

describe('silicon media source freeze', () => {
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    SUPABASE_ANON_KEY: 'anon',
  };
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify([{
      revision: 3,
      preloaded_images: [{ url: 'https://preview/a.jpg', name: 'a.jpg' }],
      image_dataset_config: { mediaFolderTags: {} },
    }]), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('keeps project media when the project already has images', async () => {
    const snap = await resolveSiliconMediaSnapshot(env, {
      projectImages: [{ url: 'https://project/1.jpg' }],
      dataset: { folder: 'street' },
      sourceKind: 'draft',
    });
    assert.equal(snap.source, 'project');
    assert.equal(snap.availableCount, 1);
    assert.equal(snap.images[0].url, 'https://project/1.jpg');
  });

  it('falls back to the preview library for empty draft media', async () => {
    const snap = await resolveSiliconMediaSnapshot(env, {
      projectImages: [],
      sourceKind: 'draft',
    });
    assert.equal(snap.source, 'preview_library');
    assert.equal(snap.availableCount, 1);
    assert.equal(snap.images[0].url, 'https://preview/a.jpg');
  });

  it('does not swap published snapshots onto the current preview library', async () => {
    const snap = await resolveSiliconMediaSnapshot(env, {
      projectImages: [],
      sourceKind: 'published',
    });
    assert.equal(snap.source, 'published');
    assert.equal(snap.availableCount, 0);
  });
});

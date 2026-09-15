import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickMediaForSilicon, seededShuffle } from './mediaAssign.mjs';

describe('silicon media assignment', () => {
  it('is deterministic for the same seed', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    assert.deepEqual(seededShuffle(pool, 7), seededShuffle(pool, 7));
    assert.notDeepEqual(seededShuffle(pool, 7), seededShuffle(pool, 8));
  });

  it('picks a stable subset per question', () => {
    const pool = [{ url: 'https://x/1.jpg' }, { url: 'https://x/2.jpg' }, { url: 'https://x/3.jpg' }];
    const a = pickMediaForSilicon({ pool, question: { name: 'q1', imageCount: 2 }, seed: 42 });
    const b = pickMediaForSilicon({ pool, question: { name: 'q1', imageCount: 2 }, seed: 42 });
    assert.deepEqual(a, b);
    assert.equal(a.length, 2);
  });
});

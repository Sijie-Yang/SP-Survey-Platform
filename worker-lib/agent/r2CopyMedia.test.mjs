/**
 * copyPrefixMedia: parallel copy that skips files already copied and stops
 * starting new copies at a deadline, so a large template is copied over
 * several calls and every call registers what is there.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyObjects, copyPrefixMedia } from './r2AgentMedia.mjs';

function fakeBucket(keys) {
  const store = new Map(keys.map((k) => [k, { size: 10 }]));
  const copies = [];
  return {
    store,
    copies,
    async list({ prefix }) {
      return {
        objects: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.size })),
        truncated: false,
      };
    },
    async get(key) {
      const v = store.get(key);
      return v ? { body: 'x', httpMetadata: {}, size: v.size } : null;
    },
    async put(key) {
      copies.push(key);
      store.set(key, { size: 10 });
    },
    async delete() {},
  };
}

const env = (bucket) => ({ R2_BUCKET: bucket, R2_PUBLIC_URL: 'https://media.example.org' });
const source = Array.from({ length: 12 }, (_, i) => `templates/t1/city/img${i}.jpg`);

describe('copyPrefixMedia', () => {
  it('copies everything and lists every file at the destination', async () => {
    const bucket = fakeBucket(source);
    const res = await copyPrefixMedia(env(bucket), 'templates/t1/', 'u1/p1/');
    assert.equal(res.copied, 12);
    assert.equal(res.remaining, 0);
    assert.equal(res.files.length, 12);
    assert.equal(res.files[0].to, 'u1/p1/city/img0.jpg');
    assert.equal(res.files[0].url, 'https://media.example.org/u1/p1/city/img0.jpg');
  });

  it('skips files already copied, so a cut-short copy can be run again', async () => {
    const bucket = fakeBucket([...source, 'u1/p1/city/img0.jpg', 'u1/p1/city/img1.jpg']);
    const res = await copyPrefixMedia(env(bucket), 'templates/t1/', 'u1/p1/');
    assert.equal(res.skipped, 2);
    assert.equal(res.copied, 10);
    assert.equal(res.files.length, 12);
    assert.ok(!bucket.copies.includes('u1/p1/city/img0.jpg'));
  });

  it('stops starting copies at the deadline and reports what is left', async () => {
    const bucket = fakeBucket(source);
    let clock = 0;
    const res = await copyPrefixMedia(env(bucket), 'templates/t1/', 'u1/p1/', {
      deadlineMs: 5,
      now: () => { clock += 1; return clock; },
    });
    assert.equal(res.copied + res.remaining, 12);
    assert.ok(res.remaining > 0);
    assert.equal(res.files.length, res.copied);
    const again = await copyPrefixMedia(env(bucket), 'templates/t1/', 'u1/p1/');
    assert.equal(again.skipped, res.copied);
    assert.equal(again.remaining, 0);
    assert.equal(again.files.length, 12);
  });
});

describe('copyObjects (template publish)', () => {
  const projectKeys = Array.from({ length: 307 }, (_, i) => `u1/p1/scenes/img${i}.jpg`);
  const pairs = projectKeys.map((from) => ({ from, to: from.replace('u1/p1/', 'templates/t9/') }));
  const opts = { fromPrefix: 'u1/p1/', toPrefix: 'templates/t9/' };

  it('copies a large library in parallel', async () => {
    const bucket = fakeBucket(projectKeys);
    let inFlight = 0;
    let peak = 0;
    const put = bucket.put;
    bucket.put = async (key) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return put(key);
    };
    const res = await copyObjects(env(bucket), pairs, opts);
    assert.equal(res.copied.length, 307);
    assert.equal(res.remaining, 0);
    assert.equal(res.error, null);
    assert.ok(peak > 1, 'copies run concurrently');
  });

  it('stops at the deadline and a second call copies only the rest', async () => {
    const bucket = fakeBucket(projectKeys);
    let clock = 0;
    const first = await copyObjects(env(bucket), pairs, { ...opts, deadlineMs: 100, now: () => { clock += 1; return clock; } });
    assert.ok(first.remaining > 0);
    assert.equal(first.copied.length + first.remaining, 307);
    const second = await copyObjects(env(bucket), pairs, opts);
    assert.equal(second.skipped, first.copied.length);
    assert.equal(second.copied.length, first.remaining);
    assert.equal(second.remaining, 0);
  });

  it('reports the first failure and keeps going without starting new copies', async () => {
    const bucket = fakeBucket(projectKeys.slice(0, 20));
    const res = await copyObjects(env(bucket), pairs.slice(0, 21), opts);
    assert.match(res.error, /img20/);
    assert.equal(res.copied.length + res.remaining, 21);
  });
});

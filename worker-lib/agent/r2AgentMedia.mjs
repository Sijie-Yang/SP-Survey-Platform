/**
 * Minimal R2 list/delete/copy for Agent/MCP (Worker binding or S3 API).
 */

import { AwsClient } from 'aws4fetch';

function encodeS3Key(key) {
  return String(key || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

/** Run `fn` over `items`, at most `limit` at a time. Results keep the input order. */
export async function mapWithConcurrency(items, limit, fn) {
  const list = Array.from(items || []);
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next;
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      results[i] = await fn(list[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), list.length) }, worker));
  return results;
}

const DELETE_BATCH = 1000; // S3 DeleteObjects and the R2 binding take at most 1000 keys
const DELETE_CONCURRENCY = 4;

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function xmlEscape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function xmlUnescape(text) {
  return String(text).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Content-MD5 where the runtime has MD5 (Workers do); S3 asks for it on DeleteObjects.
async function contentMd5(bytes) {
  try {
    const digest = new Uint8Array(await crypto.subtle.digest('MD5', bytes));
    let binary = '';
    digest.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
  } catch {
    return null;
  }
}

function parseListXml(xml) {
  const objects = [];
  const contents = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
  for (const block of contents) {
    const key = (block.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1];
    const size = Number((block.match(/<Size>([\s\S]*?)<\/Size>/) || [])[1] || 0);
    const uploaded = (block.match(/<LastModified>([\s\S]*?)<\/LastModified>/) || [])[1] || null;
    if (key) objects.push({ key: key.replace(/&amp;/g, '&'), size, uploaded });
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml);
  const cursor = (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1];
  return { objects, truncated, cursor };
}

function buildS3Backend(env) {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucketName = env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) return null;

  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const objUrl = (key) => `${endpoint}/${bucketName}/${encodeS3Key(key)}`;

  async function ensureOk(res, label) {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`R2 ${label} ${res.status}: ${text.slice(0, 300)}`);
    }
    return res;
  }

  return {
    async list(prefix) {
      const all = [];
      let token;
      do {
        const u = new URL(`${endpoint}/${bucketName}/`);
        u.searchParams.set('list-type', '2');
        if (prefix) u.searchParams.set('prefix', prefix);
        if (token) u.searchParams.set('continuation-token', token);
        u.searchParams.set('max-keys', '1000');
        const res = await ensureOk(await client.fetch(u.toString()), 'LIST');
        const page = parseListXml(await res.text());
        all.push(...page.objects);
        token = page.truncated ? page.cursor : undefined;
      } while (token);
      return all;
    },
    async delete(keys) {
      const deleteOne = async (k) => {
        const res = await client.fetch(objUrl(k), { method: 'DELETE' });
        if (!res.ok && res.status !== 404) await ensureOk(res, 'DELETE');
      };
      const failed = [];
      for (const batch of chunks(keys, DELETE_BATCH)) {
        let retry = batch;
        if (batch.length > 1) {
          // One DeleteObjects request per 1000 keys; keys it could not delete,
          // or the whole batch if the request fails, go one by one.
          try {
            const xml = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${batch.map((k) => `<Object><Key>${xmlEscape(k)}</Key></Object>`).join('')}</Delete>`;
            const body = new TextEncoder().encode(xml);
            const md5 = await contentMd5(body);
            const res = await client.fetch(`${endpoint}/${bucketName}?delete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/xml', ...(md5 ? { 'Content-MD5': md5 } : {}) },
              body,
            });
            if (res.ok) {
              const text = await res.text();
              const errors = text.match(/<Error>[\s\S]*?<\/Error>/g) || [];
              retry = errors
                .map((block) => (block.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1])
                .filter(Boolean)
                .map(xmlUnescape);
            } else {
              await res.text().catch(() => '');
            }
          } catch {
            retry = batch;
          }
        }
        if (retry.length) {
          // eslint-disable-next-line no-await-in-loop
          await mapWithConcurrency(retry, DELETE_CONCURRENCY, async (k) => {
            try {
              await deleteOne(k);
            } catch (err) {
              failed.push(`${k}: ${err.message || err}`);
            }
          });
        }
      }
      if (failed.length) throw new Error(`R2 DELETE failed for ${failed.length} object(s): ${failed.slice(0, 3).join('; ')}`);
    },
    async copy(from, to) {
      await ensureOk(
        await client.fetch(objUrl(to), {
          method: 'PUT',
          headers: { 'x-amz-copy-source': `/${bucketName}/${encodeS3Key(from)}` },
        }),
        'COPY',
      );
    },
    async put(key, body, contentType) {
      await ensureOk(
        await client.fetch(objUrl(key), {
          method: 'PUT',
          headers: {
            'Content-Type': contentType || 'application/octet-stream',
          },
          body,
        }),
        'PUT',
      );
    },
    async get(key) {
      const res = await client.fetch(objUrl(key));
      if (res.status === 404) return null;
      await ensureOk(res, 'GET');
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

function getR2Backend(env) {
  const s3 = buildS3Backend(env);
  if (s3) return s3;
  if (env.R2_BUCKET && typeof env.R2_BUCKET.put === 'function') {
    const bucket = env.R2_BUCKET;
    return {
      async list(prefix) {
        const all = [];
        let cursor;
        do {
          const page = await bucket.list({ prefix, limit: 1000, cursor });
          for (const o of page.objects) {
            all.push({
              key: o.key,
              size: o.size,
              uploaded: o.uploaded?.toISOString?.() || o.uploaded || null,
            });
          }
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        return all;
      },
      async delete(keys) {
        for (const batch of chunks(keys, DELETE_BATCH)) {
          // eslint-disable-next-line no-await-in-loop
          await bucket.delete(batch);
        }
      },
      async copy(from, to) {
        const src = await bucket.get(from);
        if (!src) throw new Error(`source not found: ${from}`);
        await bucket.put(to, src.body, { httpMetadata: src.httpMetadata });
      },
      async put(key, body, contentType) {
        await bucket.put(key, body, {
          httpMetadata: { contentType: contentType || 'application/octet-stream' },
        });
      },
      async get(key) {
        const obj = await bucket.get(key);
        if (!obj) return null;
        return new Uint8Array(await obj.arrayBuffer());
      },
    };
  }
  return null;
}

export function projectMediaPrefix(userId, projectId) {
  return `${userId}/${projectId}/`;
}

export function templateMediaPrefix(templateId) {
  return `templates/${templateId}/`;
}

export function isR2Ready(env) {
  return Boolean(getR2Backend(env));
}

export async function listPrefixMedia(env, prefix) {
  const backend = getR2Backend(env);
  if (!backend) return { configured: false, objects: [] };
  const objects = await backend.list(prefix);
  const publicBase = String(env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  return {
    configured: true,
    objects: (objects || []).map((o) => ({
      key: o.key,
      size: o.size,
      lastModified: o.uploaded,
      url: publicBase ? `${publicBase}/${o.key}` : '',
      name: String(o.key).split('/').pop(),
    })),
  };
}

export async function deletePrefixMedia(env, prefix, keys = null) {
  const backend = getR2Backend(env);
  if (!backend) return { configured: false, deleted: 0 };
  let toDelete = keys;
  if (!toDelete) {
    const listed = await backend.list(prefix);
    toDelete = listed.map((o) => o.key);
  }
  const safe = (toDelete || []).filter((k) => String(k).startsWith(prefix));
  if (safe.length) await backend.delete(safe);
  return { configured: true, deleted: safe.length };
}

const COPY_CONCURRENCY = 6; // Workers keep at most 6 connections open at a time

/**
 * Copy every object under fromPrefix to toPrefix, a few at a time. A file that
 * is already at the destination with the same size is not copied again, so a
 * copy cut short can simply be run again. With `deadlineMs`, no new copy starts
 * after that time; `remaining` says how many files are still to copy.
 * `files` lists every source file now at the destination (copied now or before).
 */
export async function copyPrefixMedia(env, fromPrefix, toPrefix, { deadlineMs = null, now = () => Date.now() } = {}) {
  const backend = getR2Backend(env);
  if (!backend) return { configured: false, copied: 0, skipped: 0, remaining: 0, files: [], errors: [] };
  const listed = await backend.list(fromPrefix);
  const existing = new Map();
  (await backend.list(toPrefix)).forEach((o) => existing.set(o.key, o.size));
  const publicBase = String(env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  const errors = [];
  let copied = 0;
  let skipped = 0;
  let remaining = 0;
  const results = await mapWithConcurrency(listed, COPY_CONCURRENCY, async (obj) => {
    const rel = obj.key.slice(fromPrefix.length);
    const to = `${toPrefix}${rel}`;
    const file = { from: obj.key, to, url: publicBase ? `${publicBase}/${to}` : '', name: rel.split('/').pop() };
    if (existing.has(to) && (obj.size == null || existing.get(to) === obj.size)) {
      skipped += 1;
      return file;
    }
    if (deadlineMs != null && now() >= deadlineMs) {
      remaining += 1;
      return null;
    }
    try {
      await backend.copy(obj.key, to);
      copied += 1;
      return file;
    } catch (err) {
      errors.push({ from: obj.key, to, error: err.message || String(err) });
      return null;
    }
  });
  return { configured: true, copied, skipped, remaining, files: results.filter(Boolean), errors };
}

/**
 * Put a single object under an owned prefix.
 * @param {ArrayBuffer|Uint8Array|string} body
 */
export async function putPrefixObject(env, key, body, contentType) {
  const backend = getR2Backend(env);
  if (!backend?.put) {
    return { configured: false };
  }
  await backend.put(key, body, contentType);
  const publicBase = String(env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  return {
    configured: true,
    key,
    url: publicBase ? `${publicBase}/${key}` : '',
    contentType: contentType || 'application/octet-stream',
  };
}

/**
 * Read one object's bytes, or null when it does not exist.
 * @returns {Promise<{ configured: boolean, bytes: Uint8Array|null }>}
 */
export async function getPrefixObject(env, key) {
  const backend = getR2Backend(env);
  if (!backend?.get) return { configured: false, bytes: null };
  return { configured: true, bytes: await backend.get(key) };
}

/**
 * Copy single objects (`[{ from, to }]`). Stops at the first failure and
 * reports what was copied so the caller can undo it.
 */
/**
 * Copy the given { from, to } keys, a few at a time. With `fromPrefix` and
 * `toPrefix` (every pair lies under them), a file already at its destination
 * with the source's size is not copied again, so a copy cut short can simply be
 * run again. With `deadlineMs`, no new copy starts after that time.
 * Returns copied (keys copied now), skipped (count), remaining (count not
 * started) and error (the first failure, or null).
 */
export async function copyObjects(env, pairs = [], {
  fromPrefix = null, toPrefix = null, deadlineMs = null, now = () => Date.now(),
} = {}) {
  const backend = getR2Backend(env);
  if (!backend) return { configured: false, copied: [], skipped: 0, remaining: 0, error: null };
  const sourceSize = new Map();
  const existing = new Map();
  if (fromPrefix != null && toPrefix != null && pairs.length) {
    (await backend.list(fromPrefix)).forEach((o) => sourceSize.set(o.key, o.size));
    (await backend.list(toPrefix)).forEach((o) => existing.set(o.key, o.size));
  }
  const copied = [];
  let skipped = 0;
  let remaining = 0;
  let error = null;
  await mapWithConcurrency(pairs, COPY_CONCURRENCY, async ({ from, to }) => {
    if (existing.has(to) && sourceSize.has(from) && existing.get(to) === sourceSize.get(from)) {
      skipped += 1;
      return;
    }
    if (error || (deadlineMs != null && now() >= deadlineMs)) {
      remaining += 1;
      return;
    }
    try {
      await backend.copy(from, to);
      copied.push(to);
    } catch (err) {
      if (!error) error = `${from}: ${err.message || String(err)}`;
      remaining += 1;
    }
  });
  return { configured: true, copied, skipped, remaining, error };
}

/** Objects under a prefix with their upload time (for housekeeping). */
export async function listPrefixObjects(env, prefix) {
  const backend = getR2Backend(env);
  if (!backend) return { configured: false, objects: [] };
  return { configured: true, objects: await backend.list(prefix) };
}

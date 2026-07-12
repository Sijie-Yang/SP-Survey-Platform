// Shared helpers for R2 Pages Functions.
//
// Two backends are supported, picked at runtime:
//   1) Native R2 binding (env.R2_BUCKET) — fastest, no credentials.
//   2) S3-compatible API via aws4fetch, using env vars set on the project:
//        R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
//
// Both backends are mapped to a small uniform interface (put/list/delete/probe)
// so the route files stay simple and don't repeat themselves.

import { AwsClient } from 'aws4fetch';

export const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });

export function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// S3 keys can contain '/'; encode each segment but keep the slashes literal.
function encodeS3Key(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

function decodeXmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseListXml(xml) {
  const objects = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const keyMatch = block.match(/<Key>([\s\S]*?)<\/Key>/);
    if (!keyMatch) continue;
    const sizeMatch = block.match(/<Size>(\d+)<\/Size>/);
    const lmMatch = block.match(/<LastModified>([^<]+)<\/LastModified>/);
    objects.push({
      key: decodeXmlEntities(keyMatch[1]),
      size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
      uploaded: lmMatch ? lmMatch[1] : null,
    });
  }
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const tokenMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
  return { objects, truncated, cursor: tokenMatch ? tokenMatch[1] : undefined };
}

function makeBindingBackend(bucket) {
  return {
    kind: 'binding',
    async put(key, body, contentType) {
      await bucket.put(key, body, { httpMetadata: { contentType } });
    },
    async list(prefix) {
      let cursor;
      const all = [];
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
      await bucket.delete(keys);
    },
    async probe() {
      const r = await bucket.list({ limit: 1 });
      return { ok: true, sample: r.objects?.length ?? 0 };
    },
  };
}

function makeS3Backend({ accountId, accessKeyId, secretAccessKey, bucketName }) {
  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region: 'auto',
  });
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
    kind: 's3',
    bucketName,
    async put(key, body, contentType) {
      await ensureOk(
        await client.fetch(objUrl(key), {
          method: 'PUT',
          body,
          headers: { 'Content-Type': contentType },
        }),
        'PUT'
      );
    },
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
        const xml = await res.text();
        const page = parseListXml(xml);
        all.push(...page.objects);
        token = page.truncated ? page.cursor : undefined;
      } while (token);
      return all;
    },
    async delete(keys) {
      // S3 batch DeleteObjects requires an XML body + content-MD5; doing it
      // one-by-one keeps the function tiny and is plenty fast for our scale.
      for (const k of keys) {
        const res = await client.fetch(objUrl(k), { method: 'DELETE' });
        if (!res.ok && res.status !== 404) {
          await ensureOk(res, 'DELETE');
        }
      }
    },
    async probe() {
      const u = new URL(`${endpoint}/${bucketName}/`);
      u.searchParams.set('list-type', '2');
      u.searchParams.set('max-keys', '1');
      const res = await client.fetch(u.toString());
      if (!res.ok) throw new Error(`R2 probe ${res.status}`);
      return { ok: true, sample: 0 };
    },
  };
}

export function getR2Backend(env) {
  if (env.R2_BUCKET && typeof env.R2_BUCKET.put === 'function') {
    return makeBindingBackend(env.R2_BUCKET);
  }
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucketName = env.R2_BUCKET_NAME;
  if (accountId && accessKeyId && secretAccessKey && bucketName) {
    return makeS3Backend({ accountId, accessKeyId, secretAccessKey, bucketName });
  }
  return null;
}

export function r2NotConfiguredError(env) {
  const missing = [];
  if (!env.R2_BUCKET) {
    if (!env.R2_ACCOUNT_ID) missing.push('R2_ACCOUNT_ID');
    if (!env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
    if (!env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
    if (!env.R2_BUCKET_NAME) missing.push('R2_BUCKET_NAME');
  }
  return missing.length
    ? `Cloudflare R2 is not configured. Either add an R2 bucket binding named R2_BUCKET, or set these env vars: ${missing.join(', ')}.`
    : 'Cloudflare R2 is not configured.';
}

export function publicBaseUrl(env) {
  return String(env.R2_PUBLIC_URL || '').replace(/\/$/, '');
}

export function isTemplateR2Key(key) {
  return typeof key === 'string' && key.startsWith('templates/');
}

/**
 * Only allow deletes under an explicit prefix.
 * Template keys (`templates/…`) are blocked unless allowTemplateKeys=true.
 * Mirrors src/lib/r2.js so Pages Functions cannot rely on client filtering alone.
 */
export function filterDeletableR2Keys(keys, {
  allowedPrefix = null,
  allowTemplateKeys = false,
} = {}) {
  const out = [];
  const skipped = [];
  for (const raw of keys || []) {
    const key = String(raw || '').replace(/^\/+/, '');
    if (!key) continue;
    if (!allowTemplateKeys && isTemplateR2Key(key)) {
      skipped.push(key);
      continue;
    }
    if (allowedPrefix && !key.startsWith(allowedPrefix)) {
      skipped.push(key);
      continue;
    }
    out.push(key);
  }
  return { keys: [...new Set(out)], skipped: [...new Set(skipped)] };
}

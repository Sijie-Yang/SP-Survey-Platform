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
      for (const k of keys) {
        const res = await client.fetch(objUrl(k), { method: 'DELETE' });
        if (!res.ok && res.status !== 404) await ensureOk(res, 'DELETE');
      }
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
        await bucket.delete(keys);
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

export async function copyPrefixMedia(env, fromPrefix, toPrefix) {
  const backend = getR2Backend(env);
  if (!backend) return { configured: false, copied: 0, errors: [] };
  const listed = await backend.list(fromPrefix);
  const publicBase = String(env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  const copied = [];
  const errors = [];
  for (const obj of listed) {
    const rel = obj.key.slice(fromPrefix.length);
    const to = `${toPrefix}${rel}`;
    try {
      await backend.copy(obj.key, to);
      copied.push({
        from: obj.key,
        to,
        url: publicBase ? `${publicBase}/${to}` : '',
        name: rel.split('/').pop(),
      });
    } catch (err) {
      errors.push({ from: obj.key, to, error: err.message || String(err) });
    }
  }
  return { configured: true, copied: copied.length, files: copied, errors };
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

// Cloudflare Workers entry script for the deployed SP-Survey app.
//
// Why this lives in `public/`: Create React App copies everything in `public/`
// verbatim into `build/`. Cloudflare Workers (with Static Assets) recognises a
// `_worker.js` file at the *root of the assets directory* as the dynamic entry
// point — anything not matched by this script falls through to the static
// assets binding (the built React app).
//
// This file is self-contained so it bundles cleanly without reaching into
// `functions/_lib/r2.js`, which would break paths during esbuild.

import { AwsClient } from 'aws4fetch';

// ── helpers ───────────────────────────────────────────────────────────────────

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

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

const publicBaseUrl = (env) => String(env.R2_PUBLIC_URL || '').replace(/\/$/, '');

// ── R2 backend picker (binding > S3 credentials) ──────────────────────────────

function getR2Backend(env) {
  if (env.R2_BUCKET && typeof env.R2_BUCKET.put === 'function') {
    const bucket = env.R2_BUCKET;
    return {
      kind: 'binding',
      bucketName: env.R2_BUCKET_NAME,
      async put(key, body, contentType) {
        await bucket.put(key, body, { httpMetadata: { contentType } });
      },
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
      async probe() {
        await bucket.list({ limit: 1 });
      },
    };
  }

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
      await ensureOk(await client.fetch(u.toString()), 'probe');
    },
  };
}

function r2NotConfiguredError(env) {
  const missing = [];
  if (!env.R2_BUCKET) {
    if (!env.R2_ACCOUNT_ID) missing.push('R2_ACCOUNT_ID');
    if (!env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
    if (!env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
    if (!env.R2_BUCKET_NAME) missing.push('R2_BUCKET_NAME');
  }
  return missing.length
    ? `Cloudflare R2 is not configured. Either bind an R2 bucket as R2_BUCKET, or set: ${missing.join(', ')}.`
    : 'Cloudflare R2 is not configured.';
}

// ── route handlers ────────────────────────────────────────────────────────────

async function handleUpload(request, env) {
  const backend = getR2Backend(env);
  if (!backend) return json({ success: false, error: r2NotConfiguredError(env) }, { status: 503 });
  if (!env.R2_PUBLIC_URL)
    return json({ success: false, error: 'Missing R2_PUBLIC_URL environment variable.' }, { status: 503 });

  const { key, data, contentType } = await request.json();
  if (!key || !data)
    return json({ success: false, error: '"key" and "data" fields are required.' }, { status: 400 });

  await backend.put(key, base64ToArrayBuffer(data), contentType || 'image/jpeg');
  return json({ success: true, url: `${publicBaseUrl(env)}/${key}`, key });
}

const IMAGE_RE = /\.(jpe?g|png|gif|webp)$/i;

async function handleList(request, env) {
  const backend = getR2Backend(env);
  if (!backend) return json({ success: false, error: r2NotConfiguredError(env) }, { status: 503 });

  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix') || '';
  const publicBase = publicBaseUrl(env);
  const objects = await backend.list(prefix);
  const images = objects
    .filter((o) => IMAGE_RE.test(o.key))
    .map((o) => ({
      name: o.key.split('/').pop(),
      key: o.key,
      url: publicBase ? `${publicBase}/${o.key}` : '',
      size: o.size,
      lastModified: o.uploaded,
    }));
  return json({ success: true, images });
}

async function handleDelete(request, env) {
  const backend = getR2Backend(env);
  if (!backend) return json({ success: false, error: r2NotConfiguredError(env) }, { status: 503 });

  const { keys } = await request.json();
  if (!Array.isArray(keys) || keys.length === 0)
    return json({ success: false, error: '"keys" array is required.' }, { status: 400 });

  await backend.delete(keys);
  return json({ success: true });
}

async function handleStatus(_request, env) {
  const backend = getR2Backend(env);
  const configured = !!backend && !!publicBaseUrl(env);
  if (!configured) {
    return json({
      configured: false,
      connected: false,
      error: !backend ? r2NotConfiguredError(env) : 'Missing R2_PUBLIC_URL environment variable.',
    });
  }
  try {
    await backend.probe();
    return json({
      configured: true,
      connected: true,
      mode: backend.kind,
      bucketName: backend.bucketName || env.R2_BUCKET_NAME || undefined,
    });
  } catch (error) {
    return json({
      configured: true,
      connected: false,
      mode: backend.kind,
      error: error.message || String(error),
    });
  }
}

// ── Worker entry ──────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const { pathname } = url;

      if (pathname === '/api/r2/upload' && request.method === 'POST') {
        return await handleUpload(request, env);
      }
      if (pathname === '/api/r2/list' && request.method === 'GET') {
        return await handleList(request, env);
      }
      if (pathname === '/api/r2/delete' && request.method === 'DELETE') {
        return await handleDelete(request, env);
      }
      if (pathname === '/api/r2/status' && request.method === 'GET') {
        return await handleStatus(request, env);
      }

      // Anything else: defer to the static React app served as Workers Assets.
      // The binding is named ASSETS by default; if a custom name is configured
      // in wrangler.jsonc, prefer that and fall back to ASSETS.
      const assets = env.ASSETS || env.assets;
      if (assets && typeof assets.fetch === 'function') {
        return await assets.fetch(request);
      }
      return new Response('Not found', { status: 404 });
    } catch (error) {
      return json({ success: false, error: error.message || String(error) }, { status: 500 });
    }
  },
};

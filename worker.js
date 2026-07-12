// Cloudflare Workers entry script for the deployed SP-Survey app.
//
// Why this lives at the project root (NOT in `public/` or `build/`):
// Wrangler refuses to upload a `_worker.js` file that sits inside the assets
// directory, because that would expose server-side code as a static download.
// Instead, `wrangler.jsonc` references this file via `main`, esbuild bundles
// it (resolving npm imports like `aws4fetch`), and Cloudflare wires it up as
// the dynamic entry — anything this script doesn't handle falls through to
// the static assets binding (the built React app under `build/`).
//
// This file is self-contained so esbuild can bundle it without reaching into
// other source paths.

import { AwsClient } from 'aws4fetch';
import {
  PRESET_QUERIES,
  searchBothProviders,
  mergeCandidates,
} from './functions/_lib/researchProviders.js';

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

const R2_COPY_CONCURRENCY = 32;

async function asyncPool(concurrency, items, fn) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Math.min(Math.max(1, concurrency), items.length);
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

// ── R2 backend picker (S3 credentials > binding — S3 enables fast server-side copy) ──

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
    async copy(from, to) {
      await ensureOk(
        await client.fetch(objUrl(to), {
          method: 'PUT',
          headers: {
            'x-amz-copy-source': `/${bucketName}/${encodeS3Key(from)}`,
          },
        }),
        'COPY'
      );
    },
    async probe() {
      const u = new URL(`${endpoint}/${bucketName}/`);
      u.searchParams.set('list-type', '2');
      u.searchParams.set('max-keys', '1');
      await ensureOk(await client.fetch(u.toString()), 'probe');
    },
  };
}

function getR2Backend(env) {
  const s3 = buildS3Backend(env);
  if (s3) return s3;

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
      // R2 bindings don't expose a native copy op, so we round-trip through
      // get/put. Streaming the body avoids buffering the whole object in
      // memory which keeps us under the Workers heap limit on big images.
      async copy(from, to) {
        const src = await bucket.get(from);
        if (!src) throw new Error(`source not found: ${from}`);
        await bucket.put(to, src.body, {
          httpMetadata: src.httpMetadata,
        });
      },
      async probe() {
        await bucket.list({ limit: 1 });
      },
    };
  }

  return null;
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

const MEDIA_FILE_RE = /\.(jpe?g|png|gif|webp|mp4|webm|mov|mp3|wav|m4a|ogg)$/i;

function inferMediaType(name) {
  const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return 'audio';
  return 'image';
}

async function handleList(request, env) {
  const backend = getR2Backend(env);
  if (!backend) return json({ success: false, error: r2NotConfiguredError(env) }, { status: 503 });

  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix') || '';
  const publicBase = publicBaseUrl(env);
  const objects = await backend.list(prefix);
  const images = objects
    .filter((o) => MEDIA_FILE_RE.test(o.key))
    .map((o) => {
      const name = o.key.split('/').pop();
      const prefixNorm = String(prefix || '').replace(/\/?$/, '/');
      let rel = o.key;
      if (prefixNorm && rel.startsWith(prefixNorm)) {
        rel = rel.slice(prefixNorm.length);
      }
      const relParts = rel.split('/').filter(Boolean);
      const folder = relParts.length > 1 ? relParts.slice(0, -1).join('/') : '';
      return {
        name,
        folder,
        key: o.key,
        url: publicBase ? `${publicBase}/${o.key}` : '',
        size: o.size,
        lastModified: o.uploaded,
        type: inferMediaType(name),
        media_id: o.key,
      };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' }));
  return json({ success: true, images });


async function handleDelete(request, env) {
  const backend = getR2Backend(env);
  if (!backend) return json({ success: false, error: r2NotConfiguredError(env) }, { status: 503 });

  const body = await request.json();
  const { keys, allowTemplateKeys = false, allowedPrefix = null } = body || {};
  if (!Array.isArray(keys) || keys.length === 0)
    return json({ success: false, error: '"keys" array is required.' }, { status: 400 });

  const safeKeys = [];
  let blocked = 0;
  for (const raw of keys) {
    const key = String(raw || '').replace(/^\/+/, '');
    if (!key) continue;
    if (!allowTemplateKeys && key.startsWith('templates/')) {
      blocked += 1;
      continue;
    }
    if (allowedPrefix && !key.startsWith(allowedPrefix)) {
      blocked += 1;
      continue;
    }
    safeKeys.push(key);
  }
  if (blocked) console.warn(`R2 delete blocked ${blocked} key(s) outside allowed scope`);
  if (safeKeys.length) await backend.delete(safeKeys);
  return json({ success: true, deleted: safeKeys.length, blocked });
}

// POST /api/r2/copy  — body: { copies: [{ from, to }, ...] }
// Mirrors the Express /api/r2/copy route. Used by the "Save as Template"
// flow to carry a project's images into the template's R2 prefix.
async function runR2Copy(copies, backend, publicBase, onItem) {
  const total = copies.length;
  let finished = 0;
  const copied = [];
  const errors = [];

  await asyncPool(R2_COPY_CONCURRENCY, copies, async ({ from, to }) => {
    if (!from || !to) {
      finished += 1;
      const err = { from, to, error: 'from/to required' };
      errors.push(err);
      onItem?.({ type: 'item', ok: false, finished, total, ...err });
      return { ok: false, ...err };
    }
    try {
      await backend.copy(from, to);
      finished += 1;
      const item = { from, to, url: publicBase ? `${publicBase}/${to}` : '' };
      copied.push(item);
      onItem?.({ type: 'item', ok: true, finished, total, ...item });
      return { ok: true, ...item };
    } catch (err) {
      finished += 1;
      const item = { from, to, error: err.message || String(err) };
      errors.push(item);
      onItem?.({ type: 'item', ok: false, finished, total, ...item });
      return { ok: false, ...item };
    }
  });

  return { success: errors.length === 0, copied, errors };
}

async function handleCopy(request, env) {
  const backend = getR2Backend(env);
  if (!backend) return json({ success: false, error: r2NotConfiguredError(env) }, { status: 503 });
  if (!env.R2_PUBLIC_URL)
    return json({ success: false, error: 'Missing R2_PUBLIC_URL environment variable.' }, { status: 503 });

  const { copies, stream } = await request.json();
  if (!Array.isArray(copies) || copies.length === 0)
    return json({ success: false, error: '"copies" array is required.' }, { status: 400 });

  const publicBase = publicBaseUrl(env);

  if (stream) {
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    (async () => {
      try {
        const result = await runR2Copy(copies, backend, publicBase, async (msg) => {
          await writer.write(encoder.encode(`${JSON.stringify(msg)}\n`));
        });
        await writer.write(encoder.encode(`${JSON.stringify({ type: 'done', ...result })}\n`));
      } catch (error) {
        await writer.write(encoder.encode(`${JSON.stringify({
          type: 'done',
          success: false,
          copied: [],
          errors: [],
          error: error.message || String(error),
        })}\n`));
      } finally {
        await writer.close();
      }
    })();
    return new Response(readable, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
      },
    });
  }

  const result = await runR2Copy(copies, backend, publicBase);
  return json(result);
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

async function handleImageProxy(request, env) {
  const reqUrl = new URL(request.url);
  const rawUrl = String(reqUrl.searchParams.get('url') || '').trim();
  if (!rawUrl) return json({ success: false, error: 'url is required' }, { status: 400 });
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return json({ success: false, error: 'Invalid url' }, { status: 400 });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return json({ success: false, error: 'Only http(s) URLs allowed' }, { status: 400 });
  }
  const base = publicBaseUrl(env);
  if (base) {
    const allowedHost = new URL(base).host;
    if (parsed.host !== allowedHost) {
      return json({ success: false, error: `Proxy only allows images from ${allowedHost}` }, { status: 403 });
    }
  }
  const upstream = await fetch(rawUrl);
  if (!upstream.ok) {
    return json({ success: false, error: `Upstream fetch failed (${upstream.status})` }, { status: upstream.status });
  }
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ── Research Deep Search ──────────────────────────────────────────────────────

async function handleResearchPresets() {
  return json({
    success: true,
    presets: Object.entries(PRESET_QUERIES).map(([id, query]) => ({ id, query })),
  });
}

async function handleResearchStatus(_request, env) {
  const hasS2 = Boolean(env.SEMANTIC_SCHOLAR_API_KEY);
  const hasMailto = Boolean(env.CROSSREF_MAILTO);
  return json({
    success: true,
    semanticScholarConfigured: hasS2,
    crossrefMailtoConfigured: hasMailto,
    note: hasS2
      ? 'Semantic Scholar API key present.'
      : 'SEMANTIC_SCHOLAR_API_KEY not set — unauthenticated S2 calls may be rate-limited.',
  });
}

async function handleResearchSearch(request, env) {
  try {
    const body = await request.json();
    const { query, limit = 20, yearFrom = null, yearTo = null } = body || {};
    if (!query || !String(query).trim()) {
      return json({ success: false, error: 'query is required' }, { status: 400 });
    }
    const result = await searchBothProviders({
      query: String(query).trim(),
      limit: Number(limit) || 20,
      yearFrom: yearFrom == null || yearFrom === '' ? null : Number(yearFrom),
      yearTo: yearTo == null || yearTo === '' ? null : Number(yearTo),
      semanticScholarApiKey: env.SEMANTIC_SCHOLAR_API_KEY || '',
      crossrefMailto: env.CROSSREF_MAILTO || '',
    });
    return json({
      success: true,
      papers: result.papers,
      sourcesUsed: result.sourcesUsed,
      warnings: result.errors,
      count: result.papers.length,
    });
  } catch (error) {
    return json({
      success: false,
      error: error.message || String(error),
      errors: error.errors || [],
    }, { status: 502 });
  }
}

async function handleResearchScan(request, env) {
  try {
    const body = await request.json();
    const {
      preset = 'streetscape_perception',
      query: customQuery = null,
      limit = 15,
      yearFrom = null,
      yearTo = null,
      mode = 'latest',
    } = body || {};

    const queries = customQuery
      ? [String(customQuery).trim()]
      : (preset === 'all'
        ? Object.values(PRESET_QUERIES)
        : [PRESET_QUERIES[preset] || PRESET_QUERIES.streetscape_perception]);

    let yFrom = yearFrom == null || yearFrom === '' ? null : Number(yearFrom);
    let yTo = yearTo == null || yearTo === '' ? null : Number(yearTo);
    const nowY = new Date().getFullYear();
    if (mode === 'latest' && yFrom == null) yFrom = nowY - 5;
    if (mode === 'classic' && yTo == null) yTo = nowY - 6;

    const allPapers = [];
    const sourcesUsed = new Set();
    const warnings = [];
    const providerOpts = {
      semanticScholarApiKey: env.SEMANTIC_SCHOLAR_API_KEY || '',
      crossrefMailto: env.CROSSREF_MAILTO || '',
    };

    for (const q of queries) {
      try {
        const result = await searchBothProviders({
          query: q,
          limit: Number(limit) || 15,
          yearFrom: yFrom,
          yearTo: yTo,
          ...providerOpts,
        });
        allPapers.push(...result.papers);
        result.sourcesUsed.forEach((s) => sourcesUsed.add(s));
        warnings.push(...(result.errors || []));
      } catch (err) {
        warnings.push(`${q}: ${err.message}`);
      }
    }

    const papers = mergeCandidates([allPapers]);
    return json({
      success: true,
      papers,
      sourcesUsed: [...sourcesUsed],
      warnings,
      count: papers.length,
      queries,
      yearFrom: yFrom,
      yearTo: yTo,
      mode,
      preset,
    });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 502 });
  }
}

async function handleResearchDraftTemplate(request, env) {
  try {
    const body = await request.json();
    const { paper, apiKey } = body || {};
    if (!apiKey) return json({ success: false, error: 'apiKey is required (BYOK)' }, { status: 400 });
    if (!paper?.title) return json({ success: false, error: 'paper.title is required' }, { status: 400 });

    const isOpenRouter = String(apiKey).startsWith('sk-or-');
    const baseURL = isOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
    const model = isOpenRouter ? 'openai/gpt-4o' : 'gpt-4o';
    const system = `You are an expert survey designer specialising in urban / streetscape perception research.
Given paper metadata, produce COMPLETE survey JSON for SP-Survey.
No standalone streetscape text questions. Image questions need imageSelectionMode huggingface_random, imageCount, choices: [].
Return ONLY valid JSON: {"title":"...","description":"...","pages":[...]}`;
    const userPayload = [
      `Title: ${paper.title}`,
      paper.authors?.length ? `Authors: ${paper.authors.join(', ')}` : null,
      paper.year ? `Year: ${paper.year}` : null,
      paper.venue ? `Venue: ${paper.venue}` : null,
      paper.doi ? `DOI: ${paper.doi}` : null,
      '',
      'Abstract:',
      paper.abstract || '(no abstract — conservative visual perception survey)',
    ].filter(Boolean).join('\n');

    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(isOpenRouter ? {
          'HTTP-Referer': env.APP_URL || 'https://sp-survey.org',
          'X-Title': env.APP_NAME || 'SP-Survey-Platform',
        } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPayload },
        ],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({ success: false, error: data?.error?.message || `AI HTTP ${res.status}` }, { status: 502 });
    }
    const raw = data.choices?.[0]?.message?.content || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return json({ success: false, error: 'Model did not return JSON' }, { status: 502 });
    const surveyConfig = JSON.parse(jsonMatch[0]);
    if (!surveyConfig.pages) return json({ success: false, error: 'missing pages[]' }, { status: 502 });
    const author = Array.isArray(paper.authors) && paper.authors.length
      ? paper.authors.slice(0, 3).join(', ')
      : 'Unknown';
    return json({
      success: true,
      surveyConfig,
      templateMeta: {
        name: surveyConfig.title || paper.title,
        description: surveyConfig.description || `Draft survey inspired by: ${paper.title}`,
        author,
        year: paper.year ? String(paper.year) : String(new Date().getFullYear()),
        category: 'Academic Research',
        tags: ['deep-search', 'urban-perception', ...(paper.keywords || []).slice(0, 5)],
        website: paper.paper_url || (paper.doi ? `https://doi.org/${paper.doi}` : null),
      },
    });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
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
      if (pathname === '/api/r2/copy' && request.method === 'POST') {
        return await handleCopy(request, env);
      }
      if (pathname === '/api/r2/status' && request.method === 'GET') {
        return await handleStatus(request, env);
      }
      if (pathname === '/api/r2/image-proxy' && request.method === 'GET') {
        return await handleImageProxy(request, env);
      }
      if (pathname === '/api/research/presets' && request.method === 'GET') {
        return await handleResearchPresets();
      }
      if (pathname === '/api/research/status' && request.method === 'GET') {
        return await handleResearchStatus(request, env);
      }
      if (pathname === '/api/research/search' && request.method === 'POST') {
        return await handleResearchSearch(request, env);
      }
      if (pathname === '/api/research/scan' && request.method === 'POST') {
        return await handleResearchScan(request, env);
      }
      if (pathname === '/api/research/draft-template' && request.method === 'POST') {
        return await handleResearchDraftTemplate(request, env);
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

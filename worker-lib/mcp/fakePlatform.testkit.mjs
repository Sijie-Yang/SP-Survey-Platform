/**
 * Test kit for the MCP tests: an in-memory Supabase (a fetch stub that speaks
 * the small PostgREST subset the handlers use) and an in-memory R2 bucket.
 * Not imported by any production module.
 */

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/** An R2 binding with put/get/list/delete/head over a Map. */
export function memoryBucket() {
  const objects = new Map();
  const toBytes = async (body) => {
    if (body == null) return new Uint8Array(0);
    if (body instanceof Uint8Array) return new Uint8Array(body);
    if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
    if (typeof body === 'string') return new TextEncoder().encode(body);
    if (typeof body.arrayBuffer === 'function') return new Uint8Array(await body.arrayBuffer());
    return new Uint8Array(await new Response(body).arrayBuffer());
  };
  const view = (key, obj) => ({
    key,
    size: obj.bytes.byteLength,
    uploaded: obj.uploaded,
    httpMetadata: obj.httpMetadata,
    body: new Response(obj.bytes).body,
    arrayBuffer: async () => obj.bytes.slice().buffer,
  });
  return {
    objects,
    failPut: null,
    async put(key, body, opts = {}) {
      if (this.failPut && this.failPut(key)) throw new Error(`put failed: ${key}`);
      objects.set(key, { bytes: await toBytes(body), uploaded: new Date(), httpMetadata: opts.httpMetadata || {} });
    },
    async get(key) {
      const obj = objects.get(key);
      return obj ? view(key, obj) : null;
    },
    async head(key) {
      const obj = objects.get(key);
      return obj ? { key, size: obj.bytes.byteLength, uploaded: obj.uploaded } : null;
    },
    async list({ prefix = '' } = {}) {
      return {
        objects: [...objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, obj]) => ({ key, size: obj.bytes.byteLength, uploaded: obj.uploaded })),
        truncated: false,
      };
    },
    async delete(keys) {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => objects.delete(key));
    },
  };
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'or']);

function matches(row, params) {
  for (const [key, raw] of params) {
    if (RESERVED.has(key)) continue;
    const value = String(raw);
    const field = row[key];
    if (value.startsWith('eq.')) {
      if (field == null || String(field) !== value.slice(3)) return false;
    } else if (value === 'is.null') {
      if (field != null) return false;
    } else if (value.startsWith('in.(')) {
      const list = value.slice(4, -1).split(',');
      if (!list.includes(String(field))) return false;
    }
  }
  return true;
}

function pick(row, select) {
  if (!select || select === '*') return clone(row);
  const out = {};
  select.split(',').map((s) => s.trim()).filter(Boolean).forEach((col) => {
    if (col in row) out[col] = clone(row[col]);
  });
  return out;
}

/**
 * Install a fetch stub over in-memory tables. Returns the state and restore().
 * `rpc[name](body)` may be given to answer /rest/v1/rpc/<name>.
 */
// Rows after the PostgREST cursor `(created_at.lt."t",and(created_at.eq."t",id.lt."i"),...)`,
// newest first, as resultsHandlers asks for them.
function responsePage(rows, url) {
  const sorted = [...rows].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id).localeCompare(String(a.id)));
  const cursor = url.searchParams.get('or');
  let out = sorted;
  if (cursor) {
    const stamp = (cursor.match(/created_at\.eq\.("(?:[^"\\]|\\.)*")/) || [])[1];
    const id = (cursor.match(/id\.lt\.("(?:[^"\\]|\\.)*")/) || [])[1];
    const at = stamp ? JSON.parse(stamp) : null;
    const lastId = id ? JSON.parse(id) : null;
    const index = sorted.findIndex((row) => String(row.created_at || '') === String(at || '') && String(row.id) === String(lastId));
    out = index >= 0 ? sorted.slice(index + 1) : [];
  }
  const limit = Number(url.searchParams.get('limit'));
  return Number.isFinite(limit) && limit > 0 ? out.slice(0, limit) : out;
}

export function fakeSupabase({ projects = [], templates = [], admins = [], responses = [], rpc = {}, missingColumns = [], failPatch = null, responseCount = null } = {}) {
  const tables = {
    projects: projects.map(clone),
    templates: templates.map(clone),
    admins: admins.map(clone),
    survey_responses: responses.map(clone),
  };
  const calls = [];
  const original = globalThis.fetch;
  const reply = (status, body) => new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: url.pathname, query: url.search, body });
    if (!url.pathname.startsWith('/rest/v1/')) return reply(404, { message: 'not found' });
    const name = url.pathname.slice('/rest/v1/'.length);
    if (name.startsWith('rpc/')) {
      const fn = rpc[name.slice(4)];
      if (!fn) return reply(404, { message: `Could not find the function ${name}` });
      try {
        return reply(200, await fn(body, tables));
      } catch (err) {
        return reply(400, { message: err.message });
      }
    }
    const table = tables[name];
    if (!table) return reply(200, []);
    const params = [...url.searchParams.entries()];
    const select = url.searchParams.get('select');
    if (select && select.split(',').some((col) => missingColumns.includes(col.trim()))) {
      return reply(400, { message: `column projects.${select} does not exist`, code: '42703' });
    }
    if (method === 'GET') {
      const hits = table.filter((row) => matches(row, params));
      const prefer = String(init.headers?.Prefer || init.headers?.prefer || '');
      if (prefer.includes('count=exact')) {
        // A count request (Range 0-0): the total is in Content-Range.
        const total = responseCount ?? hits.length;
        return new Response(JSON.stringify(hits.slice(0, 1).map((row) => pick(row, select))), {
          status: 200,
          headers: { 'content-type': 'application/json', 'content-range': `0-0/${total}` },
        });
      }
      if (name === 'survey_responses') return reply(200, responsePage(hits, url).map((row) => pick(row, select)));
      return reply(200, hits.map((row) => pick(row, select)));
    }
    if (method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      for (const row of rows) {
        if (table.some((r) => r.id === row.id)) return reply(409, { message: 'duplicate key value', code: '23505' });
      }
      table.push(...rows.map(clone));
      return reply(201, rows);
    }
    if (method === 'PATCH') {
      if (failPatch && failPatch(body, name)) return reply(500, { message: 'database unavailable' });
      const hit = table.filter((row) => matches(row, params));
      hit.forEach((row) => Object.assign(row, clone(body)));
      return reply(200, hit.map((row) => pick(row, select)));
    }
    if (method === 'DELETE') {
      const keep = table.filter((row) => !matches(row, params));
      const removed = table.length - keep.length;
      table.splice(0, table.length, ...keep);
      return reply(200, removed ? [] : []);
    }
    return reply(405, { message: 'method' });
  };
  return {
    tables,
    calls,
    restore() { globalThis.fetch = original; },
  };
}

export function baseEnv(extra = {}) {
  return {
    SUPABASE_URL: 'https://db.example',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    SUPABASE_ANON_KEY: 'anon',
    R2_PUBLIC_URL: 'https://media.example',
    APP_URL: 'https://sp-survey.org',
    R2_BUCKET: memoryBucket(),
    ...extra,
  };
}

/** Call one MCP tool as an MCP-token user; returns { isError, body }. */
export async function callTool(env, name, args = {}, { userId = 'u1', scopes = ['surveys:read', 'surveys:write', 'surveys:publish', 'media:write', 'results:read'] } = {}) {
  const { handleMcpRequest } = await import('./server.mjs');
  const req = new Request('https://sp-survey.org/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const res = await handleMcpRequest(req, env, { kind: 'mcp', userId, scopes });
  const { result } = await res.json();
  return { isError: result.isError, body: JSON.parse(result.content[0].text) };
}

export function projectRow(extra = {}) {
  const now = '2026-11-01T00:00:00.000Z';
  return {
    id: 'proj_1_abc',
    user_id: 'u1',
    name: 'Street study',
    description: '',
    survey_config: { title: 'Street study', pages: [] },
    survey_config_draft: { title: 'Street study', pages: [] },
    draft_updated_at: now,
    updated_at: now,
    preloaded_images: [],
    image_dataset_config: { enabled: true },
    metadata: {},
    ...extra,
  };
}

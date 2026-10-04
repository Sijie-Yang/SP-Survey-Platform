// Results loading benchmark with a simulated network (no Supabase access).
//   node scripts/bench/results-page-load.mjs [--rows 500] [--images 300] [--old /path/to/oldLoader.mjs]
// Each simulated request costs RTT + bytes / throughput; JSON is really serialized and parsed.
import { createHash } from 'node:crypto';
import { loadSurveyResponsePage } from '../../src/lib/responsePageLoader.js';
import { restoreResponseContracts } from '../../src/lib/slimResponses.js';
import { syntheticResponses, syntheticSurveyConfig } from '../../src/lib/__fixtures__/syntheticResults.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const N = Number(arg('rows', 500));
const IMAGES = Number(arg('images', 300));
const NET = {
  workerDbRtt: Number(arg('worker-db-rtt', 100)), workerDbMBps: Number(arg('worker-db-mbps', 20)),
  browserRtt: Number(arg('browser-rtt', 60)), browserMBps: Number(arg('browser-mbps', 5)),
  browserDbRtt: Number(arg('browser-db-rtt', 120)),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const transfer = async (value, rtt, mbps) => {
  const text = JSON.stringify(value);
  await sleep(rtt + text.length / (mbps * 1e3));
  return { data: JSON.parse(text), bytes: text.length };
};

const config = syntheticSurveyConfig({ images: IMAGES, urlBase: 'https://abcdefghijklmnop.supabase.co/storage/v1/object/public/media/proj_1789437408398_xip9r5qzx/street-view' });
const rows = syntheticResponses(N, { config }).map((row) => ({ ...row, survey_metadata: { ...row.survey_metadata, survey_response_contract: JSON.parse(JSON.stringify(row.survey_metadata.survey_response_contract)) } }));
const size = (v) => JSON.stringify(v).length;
const sample = rows[0];
console.log(JSON.stringify({
  rowBytes: size(sample),
  contractBytes: size(sample.survey_metadata.survey_response_contract),
  responsesBytes: size(sample.responses),
  otherMetadataBytes: size({ ...sample.survey_metadata, survey_response_contract: undefined }),
  network: NET,
}));

function database(link) {
  let calls = 0;
  const after = (query) => {
    const or = query.get('or');
    if (!or) return 0;
    const stamp = or.match(/created_at\.lt\."([^"]+)"/)[1];
    return rows.findIndex((row) => row.created_at === stamp) + 1;
  };
  const rest = async ({ path, query = '', body }) => {
    calls += 1;
    if (path.endsWith('/rpc/survey_response_rows')) {
      if (!link.rpc) {
        await transfer({ code: 'PGRST202' }, link.rtt, link.mbps);
        throw Object.assign(new Error('missing'), { status: 404, details: { code: 'PGRST202' } });
      }
      const known = new Set(body.p_known_contracts);
      const contracts = {};
      const out = [];
      const refs = [];
      for (const row of rows.filter((r) => body.p_ids.includes(r.id))) {
        const { survey_response_contract: contract, ...meta } = row.survey_metadata;
        const key = createHash('md5').update(JSON.stringify(contract)).digest('hex');
        if (!known.has(key)) contracts[key] = contract;
        out.push({ ...row, survey_metadata: meta });
        refs.push(key);
      }
      return (await transfer({ rows: out, refs, contracts }, link.rtt, link.mbps)).data;
    }
    const q = new URLSearchParams(query.slice(1));
    if (q.get('select') === 'id,created_at,project_id') {
      const start = after(q);
      const keys = rows.slice(start, start + Number(q.get('limit'))).map(({ id, created_at, project_id }) => ({ id, created_at, project_id }));
      return (await transfer(keys, link.rtt, link.mbps)).data;
    }
    const ids = JSON.parse(`[${q.get('id').slice(4, -1)}]`);
    return (await transfer(rows.filter((r) => ids.includes(r.id)), link.rtt, link.mbps)).data;
  };
  return { rest, calls: () => calls };
}

async function run(label, fetchPage) {
  const pages = [];
  const loaded = [];
  const t0 = performance.now();
  let cursor = null;
  for (;;) {
    const p0 = performance.now();
    const { rows: page, bytes } = await fetchPage(cursor);
    if (!page.length) break;
    pages.push({ ms: performance.now() - p0, rows: page.length, bytes });
    loaded.push(...page);
    cursor = page[page.length - 1];
  }
  const total = performance.now() - t0;
  const ms = pages.map((p) => p.ms).sort((a, b) => a - b);
  const identical = JSON.stringify(loaded) === JSON.stringify(rows);
  console.log(JSON.stringify({
    label, totalMs: Math.round(total), pages: pages.length, rowsPerPage: Math.round(N / pages.length),
    medianPageMs: Math.round(ms[Math.floor(ms.length / 2)]), totalMB: +(pages.reduce((s, p) => s + p.bytes, 0) / 1e6).toFixed(1), identical,
  }));
}

function adminPath(loader, { rpc, client }) {
  const db = database({ rtt: NET.workerDbRtt, mbps: NET.workerDbMBps, rpc });
  const session = { contracts: new Map(), mode: 'auto' };
  return async (after) => {
    await sleep(3 * NET.workerDbRtt); // auth user, admin row, project row
    const page = client === 'old'
      ? { responses: (await loader(db.rest, 'proj', { after })).responses }
      : await loader(db.rest, 'proj', { after, mode: session.mode, knownContracts: [...session.contracts.keys()] });
    const { data, bytes } = await transfer(page, NET.browserRtt, NET.browserMBps);
    if (client === 'old') return { rows: data.responses, bytes };
    for (const [key, contract] of Object.entries(data.contracts || {})) session.contracts.set(key, contract);
    session.mode = data.mode || session.mode;
    return { rows: restoreResponseContracts(data.responses, session.contracts), bytes };
  };
}

function ownerOld() {
  const link = { rtt: NET.browserDbRtt, mbps: NET.browserMBps };
  return async (after) => {
    const start = after ? rows.indexOf(rows.find((r) => r.id === after.id)) + 1 : 0;
    const { data, bytes } = await transfer(rows.slice(start, start + 50), link.rtt, link.mbps);
    return { rows: data, bytes };
  };
}

function ownerNew(rpc) {
  const db = database({ rtt: NET.browserDbRtt, mbps: NET.browserMBps, rpc });
  const session = { contracts: new Map(), mode: 'auto' };
  return async (after) => {
    const page = await loadSurveyResponsePage(db.rest, 'proj', { after, mode: session.mode, knownContracts: [...session.contracts.keys()], legacyKeyLimit: 50, legacyBatch: 25 });
    for (const [key, contract] of Object.entries(page.contracts || {})) session.contracts.set(key, contract);
    session.mode = page.mode || session.mode;
    const bytes = size(page);
    return { rows: restoreResponseContracts(page.responses, session.contracts), bytes };
  };
}

const oldPath = arg('old', null);
if (oldPath) {
  const old = await import(oldPath);
  await run('admin before (c56dd83)', adminPath(old.loadSurveyResponsePage, { client: 'old' }));
}
await run('admin after, RPC not installed', adminPath(loadSurveyResponsePage, { rpc: false }));
await run('admin after, RPC installed', adminPath(loadSurveyResponsePage, { rpc: true }));
await run('owner before (select * limit 50)', ownerOld());
await run('owner after, RPC not installed', ownerNew(false));
await run('owner after, RPC installed', ownerNew(true));

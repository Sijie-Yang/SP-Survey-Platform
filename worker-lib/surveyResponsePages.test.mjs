import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  classifyRowFailure,
  isSerializationFailure,
  loadSurveyResponsePage,
  responseIdsQuery,
  responseListQuery,
} from './surveyResponsePages.mjs';
import { compareJsonbKeys, restoreResponseContracts } from '../src/lib/slimResponses.js';

function keys(n, start = 1) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${start + i}`,
    created_at: `2026-01-01T00:00:0${start + i}Z`,
    project_id: 'project-a',
  }));
}

function fullRow(key, extra = {}) {
  return {
    id: key.id,
    created_at: key.created_at,
    project_id: key.project_id,
    participant_id: `p-${key.id}`,
    responses: { q: 4 },
    displayed_images: {},
    survey_metadata: { survey_revision: 'v1', ...(extra.survey_metadata || {}) },
    ...extra,
  };
}

test('key listing stays tiny and id filters quote values', () => {
  const list = new URLSearchParams(responseListQuery('proj_1', {
    select: 'id,created_at,project_id', after: null, offset: 1000, limit: 40,
  }).slice(1));
  assert.equal(list.get('project_id'), 'eq.proj_1');
  assert.equal(list.get('select'), 'id,created_at,project_id');
  assert.equal(list.get('limit'), '40');
  assert.equal(list.get('offset'), '1000');
  const ids = new URLSearchParams(responseIdsQuery('proj_1', ['a,b', 'c'], '*').slice(1));
  assert.equal(ids.get('id'), 'in.("a,b","c")');
});

function params(query) {
  return new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
}

function idsIn(query) {
  const raw = params(query).get('id') || '';
  const inner = raw.match(/^in\.\((.*)\)$/)?.[1] || '';
  return inner ? inner.split(',').map((part) => JSON.parse(part)) : [];
}

function isKeyQuery(query) {
  return !params(query).has('id');
}

test('a full page hydrates after the key listing', async () => {
  const listed = keys(3);
  const rest = async ({ query }) => (isKeyQuery(query) ? listed : listed.map((key) => fullRow(key)));
  const page = await loadSurveyResponsePage(rest, 'project-a', { mode: 'legacy' });
  assert.equal(page.responses.length, 3);
  assert.equal(page.skipped.length, 0);
  assert.equal(page.responses[0].participant_id, 'p-r1');
});

test('an oversized batch is split until readable rows load', async () => {
  const listed = keys(4);
  const rest = async ({ query }) => {
    if (isKeyQuery(query)) return listed;
    const ids = idsIn(query);
    if (params(query).get('select') === '*' && ids.length > 1) {
      throw Object.assign(new Error('JSON payload too large'), { status: 502 });
    }
    return ids.map((id) => fullRow(listed.find((key) => key.id === id)));
  };
  const page = await loadSurveyResponsePage(rest, 'project-a', { mode: 'legacy' });
  assert.equal(page.responses.length, 4);
  assert.equal(page.skipped.length, 0);
  assert.ok(page.responses.every((row) => row.responses.q === 4));
});

test('a single unreadable row is stubbed so the page still returns', async () => {
  const listed = keys(2);
  const rest = async ({ query }) => {
    if (isKeyQuery(query)) return listed;
    const ids = idsIn(query);
    if (ids.includes('r2')) {
      throw Object.assign(new Error('unsupported Unicode escape sequence'), { status: 500 });
    }
    return ids.map((id) => fullRow(listed.find((key) => key.id === id)));
  };
  const page = await loadSurveyResponsePage(rest, 'project-a', { mode: 'legacy' });
  assert.equal(page.responses.length, 2);
  assert.equal(page.responses[0].participant_id, 'p-r1');
  assert.equal(page.responses[1]._unreadable, true);
  assert.equal(page.responses[1]._unreadableReason, 'malformed_row');
  assert.equal(page.skipped[0].id, 'r2');
});

test('huge survey_metadata is dropped so answers still load', async () => {
  const listed = keys(1);
  const rest = async ({ query }) => {
    if (isKeyQuery(query)) return listed;
    if (params(query).get('select') === '*') {
      throw Object.assign(new Error('canceling statement due to statement timeout'), { status: 500 });
    }
    return [fullRow(listed[0], { survey_metadata: { huge: true } })];
  };
  const page = await loadSurveyResponsePage(rest, 'project-a', { mode: 'legacy' });
  assert.equal(page.responses[0].responses.q, 4);
  assert.deepEqual(page.responses[0].survey_metadata, {});
  assert.equal(page.responses[0]._truncated, true);
  assert.equal(page.skipped[0].reason, 'survey_metadata_omitted');
});

test('a byte budget stops the page so the next cursor can continue', async () => {
  const listed = keys(3);
  const rest = async ({ query }) => {
    if (isKeyQuery(query)) return listed;
    return listed.map((key) => fullRow(key, { blob: 'x'.repeat(200) }));
  };
  const page = await loadSurveyResponsePage(rest, 'project-a', { mode: 'legacy', maxBytes: 250 });
  assert.equal(page.responses.length, 1);
  assert.equal(page.responses[0].id, 'r1');
});

test('rows past the byte budget are not hydrated', async () => {
  const listed = keys(40);
  const hydratedIds = [];
  const rest = async ({ query }) => {
    if (isKeyQuery(query)) return listed;
    const ids = idsIn(query);
    hydratedIds.push(...ids);
    return ids.map((id) => fullRow(listed.find((key) => key.id === id), { blob: 'x'.repeat(1000) }));
  };
  const page = await loadSurveyResponsePage(rest, 'project-a', { mode: 'legacy', maxBytes: 10000 });
  assert.ok(page.responses.length > 1 && page.responses.length < 16);
  assert.deepEqual(page.responses.map((row) => row.id), listed.slice(0, page.responses.length).map((key) => key.id));
  assert.equal(hydratedIds.length, 32);
});

test('generic database outages are not converted into stub rows', async () => {
  const listed = keys(1);
  const rest = async ({ query }) => {
    if (isKeyQuery(query)) return listed;
    throw Object.assign(new Error('private database failure'), { status: 500 });
  };
  await assert.rejects(() => loadSurveyResponsePage(rest, 'project-a', { mode: 'legacy' }), /private database failure/);
});

test('serialization classifier stays conservative', () => {
  assert.equal(isSerializationFailure({ status: 413, message: 'x' }), true);
  assert.equal(isSerializationFailure({ status: 500, message: 'statement timeout' }), true);
  assert.equal(isSerializationFailure({ status: 500, message: 'private database failure' }), false);
  assert.equal(classifyRowFailure({ message: 'payload too large' }), 'oversized_or_timeout');
});

const contractA = { version: 2, title: 'A', questions: [{ name: 'q', type: 'imagepicker', selectedImageUrls: ['https://m/1.jpg', 'https://m/2.jpg'] }] };
const contractB = { version: 2, title: 'B', questions: [{ name: 'q', type: 'rating' }] };

function jsonbOrdered(obj) {
  return Object.fromEntries(Object.keys(obj).sort(compareJsonbKeys).map((k) => [k, obj[k]]));
}

function contractRows(n) {
  return keys(n).map((key, i) => fullRow(key, {
    survey_metadata: jsonbOrdered({ survey_revision: i === 2 ? 'v2' : 'v1', completion_code: `c${i}`, survey_response_contract: i === 2 ? contractB : contractA, timing: { total_seconds: i } }),
  }));
}

const missingRpc = () => { throw Object.assign(new Error('Could not find the function'), { status: 404, details: { code: 'PGRST202' } }); };
const refOf = (contract) => (contract === contractB ? 'b'.repeat(32) : 'a'.repeat(32));

function fakeSlimRpc(rows, calls, { failIds = [] } = {}) {
  return ({ body }) => {
    calls.push(body);
    if (body.p_ids.some((id) => failIds.includes(id))) {
      throw Object.assign(new Error('canceling statement due to statement timeout'), { status: 500 });
    }
    const picked = rows.filter((row) => body.p_ids.includes(row.id)).map((row) => structuredClone(row));
    const contracts = {};
    const refs = picked.map((row) => {
      const contract = row.survey_metadata.survey_response_contract;
      const ref = refOf(rows.find((r) => r.id === row.id).survey_metadata.survey_response_contract);
      delete row.survey_metadata.survey_response_contract;
      if (!body.p_known_contracts.includes(ref)) contracts[ref] = contract;
      return ref;
    });
    return { rows: picked, refs, contracts };
  };
}

test('without the RPC, contracts are split off full rows and sent once', async () => {
  const rows = contractRows(5);
  const rest = async ({ path, query }) => {
    if (path.includes('/rpc/')) return missingRpc();
    if (isKeyQuery(query)) return keys(5);
    return idsIn(query).map((id) => structuredClone(rows.find((row) => row.id === id)));
  };
  const page = await loadSurveyResponsePage(rest, 'project-a');
  assert.equal(page.mode, 'legacy');
  assert.equal(Object.keys(page.contracts).length, 2);
  assert.ok(page.responses.every((row) => !('survey_response_contract' in row.survey_metadata)));
  const restored = restoreResponseContracts(JSON.parse(JSON.stringify(page.responses)), JSON.parse(JSON.stringify(page.contracts)));
  assert.equal(JSON.stringify(restored), JSON.stringify(rows));
});

test('the slim RPC sends each new contract once and restores rows exactly', async () => {
  const rows = contractRows(5);
  const calls = [];
  const rpc = fakeSlimRpc(rows, calls);
  const rest = async (opts) => {
    if (opts.path.includes('/rpc/')) {
      assert.equal(opts.method, 'POST');
      return rpc(opts);
    }
    if (isKeyQuery(opts.query)) return keys(5);
    throw new Error('full rows should not be read');
  };
  const page = await loadSurveyResponsePage(rest, 'project-a', { knownContracts: [refOf(contractB)] });
  assert.equal(page.mode, 'slim');
  assert.deepEqual(Object.keys(page.contracts), [refOf(contractA)]);
  assert.deepEqual(calls[0].p_known_contracts, [refOf(contractB)]);
  const known = new Map([[refOf(contractB), contractB], ...Object.entries(page.contracts)]);
  const restored = restoreResponseContracts(JSON.parse(JSON.stringify(page.responses)), known);
  assert.equal(JSON.stringify(restored), JSON.stringify(rows));
});

test('a row the RPC cannot return is read through the full-row path', async () => {
  const rows = contractRows(4);
  const rpc = fakeSlimRpc(rows, [], { failIds: ['r2'] });
  const rest = async (opts) => {
    if (opts.path.includes('/rpc/')) return rpc(opts);
    if (isKeyQuery(opts.query)) return keys(4);
    return idsIn(opts.query).map((id) => structuredClone(rows.find((row) => row.id === id)));
  };
  const page = await loadSurveyResponsePage(rest, 'project-a');
  assert.equal(page.mode, 'slim');
  const restored = restoreResponseContracts(JSON.parse(JSON.stringify(page.responses)), page.contracts);
  assert.equal(JSON.stringify(restored), JSON.stringify(rows));
});

test('restoring an unknown contract fails instead of returning incomplete rows', () => {
  assert.throws(() => restoreResponseContracts([{ id: 'x', survey_metadata: {}, _contract_ref: 'f'.repeat(32) }], {}), /unknown survey contract/);
});

test('a load that knows the RPC exists fetches all batches of a page in parallel', async () => {
  const rows = keys(9).flatMap((_, k) => contractRows(9).map((row) => ({ ...row, id: `${row.id}-${k}` })));
  const listed = rows.map(({ id, created_at, project_id }) => ({ id, created_at, project_id }));
  const calls = [];
  const rpc = fakeSlimRpc(rows, calls);
  let inFlight = 0;
  let maxInFlight = 0;
  const rest = async (opts) => {
    if (!opts.path.includes('/rpc/')) return listed.slice(0, 200);
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return rpc(opts);
  };
  const page = await loadSurveyResponsePage(rest, 'project-a', { mode: 'slim' });
  assert.equal(page.responses.length, 81);
  assert.equal(calls.length, 2);
  assert.equal(maxInFlight, 2);
  assert.equal(Object.keys(page.contracts).length, 2);
  const restored = restoreResponseContracts(JSON.parse(JSON.stringify(page.responses)), page.contracts);
  assert.equal(JSON.stringify(restored), JSON.stringify(rows));
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  classifyRowFailure,
  isSerializationFailure,
  loadSurveyResponsePage,
  responseIdsQuery,
  responseListQuery,
} from './surveyResponsePages.mjs';

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
  const page = await loadSurveyResponsePage(rest, 'project-a');
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
  const page = await loadSurveyResponsePage(rest, 'project-a');
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
  const page = await loadSurveyResponsePage(rest, 'project-a');
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
  const page = await loadSurveyResponsePage(rest, 'project-a');
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
  const page = await loadSurveyResponsePage(rest, 'project-a', { maxBytes: 250 });
  assert.equal(page.responses.length, 1);
  assert.equal(page.responses[0].id, 'r1');
});

test('generic database outages are not converted into stub rows', async () => {
  const listed = keys(1);
  const rest = async ({ query }) => {
    if (isKeyQuery(query)) return listed;
    throw Object.assign(new Error('private database failure'), { status: 500 });
  };
  await assert.rejects(() => loadSurveyResponsePage(rest, 'project-a'), /private database failure/);
});

test('serialization classifier stays conservative', () => {
  assert.equal(isSerializationFailure({ status: 413, message: 'x' }), true);
  assert.equal(isSerializationFailure({ status: 500, message: 'statement timeout' }), true);
  assert.equal(isSerializationFailure({ status: 500, message: 'private database failure' }), false);
  assert.equal(classifyRowFailure({ message: 'payload too large' }), 'oversized_or_timeout');
});

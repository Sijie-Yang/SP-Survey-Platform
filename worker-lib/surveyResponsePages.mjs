import { responseCursorFilter } from '../src/lib/responsePagination.js';

export const RESPONSE_KEY_PAGE = 40;
export const RESPONSE_HYDRATE_BATCH = 8;
export const RESPONSE_PAGE_MAX_BYTES = 2_500_000;

const ORDER = 'created_at.desc.nullslast,id.desc';
const LITE_SELECT = 'id,project_id,participant_id,created_at,responses,displayed_images';

export function isSerializationFailure(err) {
  const status = Number(err?.status);
  const msg = String(err?.message || err || '');
  if (status === 413) return true;
  return /timeout|too large|payload|memory|unicode|invalid.*json|could not serialize|statement timeout|out of memory|Maximum call stack|Failed to parse/i.test(msg);
}

export function classifyRowFailure(err) {
  const msg = String(err?.message || '');
  if (/unicode|escape sequence/i.test(msg)) return 'malformed_row';
  if (isSerializationFailure(err)) return 'oversized_or_timeout';
  return 'unreadable';
}

export function responseListQuery(projectId, { select, after, offset, limit }) {
  return `?${new URLSearchParams({
    project_id: `eq.${projectId}`,
    select,
    order: ORDER,
    limit: String(limit),
    offset: after ? '0' : String(offset || 0),
    ...(after ? { or: `(${responseCursorFilter(after)})` } : {}),
  })}`;
}

export function responseIdsQuery(projectId, ids, select) {
  return `?${new URLSearchParams({
    project_id: `eq.${projectId}`,
    id: `in.(${ids.map((id) => JSON.stringify(String(id))).join(',')})`,
    select,
  })}`;
}

export function stubUnreadableRow(key, reason) {
  return {
    id: key.id,
    created_at: key.created_at ?? null,
    project_id: key.project_id ?? null,
    participant_id: null,
    responses: {},
    displayed_images: null,
    survey_metadata: {},
    _unreadable: true,
    _unreadableReason: reason || 'unreadable',
  };
}

function rowBytes(row) {
  try {
    return JSON.stringify(row).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function rememberSkipped(skipped, id, reason) {
  if (id == null) return;
  if (!skipped.some((item) => String(item.id) === String(id))) {
    skipped.push({ id, reason });
  }
}

/**
 * Load one admin/results page without asking PostgREST for 1000 full rows.
 * Keys first (tiny), then hydrate in small batches. A single oversized or
 * malformed row becomes a stub so the rest of the project can still render.
 */
export async function loadSurveyResponsePage(rest, projectId, {
  after = null,
  offset = 0,
  keyLimit = RESPONSE_KEY_PAGE,
  maxBytes = RESPONSE_PAGE_MAX_BYTES,
} = {}) {
  const keys = await rest({
    path: '/rest/v1/survey_responses',
    serviceRole: true,
    query: responseListQuery(projectId, {
      select: 'id,created_at,project_id',
      after,
      offset,
      limit: keyLimit,
    }),
  });
  if (!Array.isArray(keys) || !keys.length) return { responses: [], skipped: [] };

  const hydrated = new Map();
  const skipped = [];

  const fetchByIds = (ids, select) => rest({
    path: '/rest/v1/survey_responses',
    serviceRole: true,
    query: responseIdsQuery(projectId, ids, select),
  });

  const hydrateKeys = async (keySlice) => {
    const usable = keySlice.filter((key) => key?.id != null && key.id !== '');
    if (!usable.length) return;
    const ids = usable.map((key) => key.id);
    try {
      for (const row of (await fetchByIds(ids, '*')) || []) {
        hydrated.set(String(row.id), row);
      }
    } catch (err) {
      if (ids.length === 1) {
        const key = usable[0];
        try {
          const lite = await fetchByIds(ids, LITE_SELECT);
          if (lite?.[0]) {
            hydrated.set(String(ids[0]), {
              ...lite[0],
              survey_metadata: {},
              _truncated: true,
              _truncatedReason: 'survey_metadata_omitted',
            });
            rememberSkipped(skipped, ids[0], 'survey_metadata_omitted');
            return;
          }
        } catch (liteErr) {
          if (isSerializationFailure(err) || isSerializationFailure(liteErr)) {
            hydrated.set(String(ids[0]), stubUnreadableRow(key, classifyRowFailure(err)));
            rememberSkipped(skipped, ids[0], classifyRowFailure(err));
            return;
          }
          throw err;
        }
        hydrated.set(String(ids[0]), stubUnreadableRow(key, 'missing'));
        rememberSkipped(skipped, ids[0], 'missing');
        return;
      }
      const mid = Math.ceil(usable.length / 2);
      await hydrateKeys(usable.slice(0, mid));
      await hydrateKeys(usable.slice(mid));
    }
  };

  for (let i = 0; i < keys.length; i += RESPONSE_HYDRATE_BATCH) {
    await hydrateKeys(keys.slice(i, i + RESPONSE_HYDRATE_BATCH));
  }

  const responses = [];
  let bytes = 40;
  for (const key of keys) {
    const row = hydrated.get(String(key.id)) || stubUnreadableRow(key, 'missing');
    const size = rowBytes(row);
    const usable = Number.isFinite(size) ? row : stubUnreadableRow(key, 'oversized_or_timeout');
    const usableSize = Number.isFinite(size) ? size : rowBytes(usable);
    if (responses.length && bytes + usableSize > maxBytes) break;
    if (usable._unreadable) rememberSkipped(skipped, usable.id, usable._unreadableReason);
    responses.push(usable);
    bytes += usableSize;
  }

  return {
    responses,
    skipped: skipped.filter((item) => responses.some((row) => String(row.id) === String(item.id))),
  };
}

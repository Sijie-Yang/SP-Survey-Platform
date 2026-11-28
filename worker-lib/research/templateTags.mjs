// Admin: read and set the classification facets of published templates
// (stored as "dimension:value" strings in templates.tags; vocabulary in
// src/lib/templateFacets.js). Other tags on a template are kept as they are.

import { supabaseRest } from '../supabaseUserClient.mjs';
import { TEMPLATE_DIMENSIONS, parseFacets, upgradeFacets, withFacets } from '../../src/lib/templateFacets.js';

export const TAGS_SAVE_MAX = 60;

function fail(message, status = 400, code = 'BAD_REQUEST') {
  return Object.assign(new Error(message), { status, code });
}

/**
 * Check one { dimension: [values] } object against the vocabulary. Ids of the
 * earlier vocabulary are accepted and turned into today's ids; `added` holds
 * what such an id adds to another dimension (old "crowd" → setting "online").
 */
export function checkFacets(facets) {
  const problems = [];
  const clean = {};
  if (!facets || typeof facets !== 'object' || Array.isArray(facets)) return { clean, added: {}, problems: ['facets must be an object'] };
  const known = {};
  for (const [key, raw] of Object.entries(facets)) {
    if (!TEMPLATE_DIMENSIONS.some((d) => d.key === key)) { problems.push(`unknown dimension "${key}"`); continue; }
    known[key] = raw;
  }
  const { facets: upgraded, added } = upgradeFacets(known);
  for (const [key, values] of Object.entries(upgraded)) {
    const dim = TEMPLATE_DIMENSIONS.find((d) => d.key === key);
    if (dim.single && values.length > 1) problems.push(`${key} takes one value`);
    if (!dim.open) {
      const bad = values.filter((v) => !dim.values.some((x) => x.id === v));
      if (bad.length) problems.push(`${key}: unknown value(s) ${bad.join(', ')} (allowed: ${dim.values.map((x) => x.id).join(', ')})`);
    }
    clean[key] = values.map((v) => v.slice(0, 80));
  }
  return { clean, added, problems };
}

/** Every approved template with its facets (no templates → empty list). */
export async function listTemplateFacets(env) {
  const data = await supabaseRest(env, {
    path: '/rest/v1/templates',
    serviceRole: true,
    query: '?select=id,name,category,tags&is_approved=eq.true&order=year.desc',
  });
  return {
    dimensions: TEMPLATE_DIMENSIONS.map((d) => ({ key: d.key, single: !!d.single, open: !!d.open, values: d.values.map((v) => v.id) })),
    templates: (Array.isArray(data) ? data : []).map((row) => ({ id: row.id, name: row.name, category: row.category, facets: parseFacets(row.tags) })),
  };
}

/**
 * items: [{ templateId, facets: { dimension: [values] }, merge? }].
 * Without merge the given dimensions replace that template's values for those
 * dimensions; dimensions not named stay as they are. merge:true adds values.
 */
export async function saveTemplateFacets(env, items) {
  if (!Array.isArray(items) || !items.length) throw fail('templates must be a non-empty list.');
  if (items.length > TAGS_SAVE_MAX) throw fail(`At most ${TAGS_SAVE_MAX} templates per call.`);
  const results = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {};
    const id = String(item.templateId || '').trim().slice(0, 120);
    if (!id) { results.push({ index: i, result: 'error', error: 'templateId is required.' }); continue; }
    const { clean, added, problems } = checkFacets(item.facets);
    if (problems.length) { results.push({ index: i, templateId: id, result: 'error', error: problems.join('; ') }); continue; }
    try {
      const found = await supabaseRest(env, { path: '/rest/v1/templates', serviceRole: true, query: `?id=eq.${encodeURIComponent(id)}&select=id,tags` });
      const row = Array.isArray(found) ? found[0] : null;
      if (!row) { results.push({ index: i, templateId: id, result: 'error', error: `No template with id "${id}".` }); continue; }
      const current = parseFacets(row.tags);
      const next = { ...current };
      for (const [key, values] of Object.entries(clean)) {
        next[key] = item.merge ? [...new Set([...(current[key] || []), ...values])] : values;
      }
      for (const [key, values] of Object.entries(added)) {
        next[key] = [...new Set([...(next[key] || []), ...values])];
      }
      const tags = withFacets(row.tags || [], next);
      await supabaseRest(env, {
        path: '/rest/v1/templates',
        method: 'PATCH',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(id)}`,
        body: { tags, updated_at: new Date().toISOString() },
        prefer: 'return=minimal',
      });
      results.push({ index: i, templateId: id, result: 'updated', facets: parseFacets(tags) });
    } catch (err) {
      results.push({ index: i, templateId: id, result: 'error', error: err?.message || String(err) });
    }
  }
  const updated = results.filter((r) => r.result === 'updated').length;
  return { success: updated === results.length, updated, errors: results.length - updated, results };
}

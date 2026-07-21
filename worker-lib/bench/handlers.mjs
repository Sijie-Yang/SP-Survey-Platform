/**
 * SP-Bench HTTP handlers (admin + public).
 */

import { getUserFromBearer, jsonResponse, errorResponse } from '../auth/supabaseJwt.mjs';
import { supabaseRest } from '../supabaseUserClient.mjs';
import { encryptApiKey, keyHint } from '../crypto/byokAesGcm.mjs';
import { toByteaHex } from './bytea.mjs';
import { validateProviderKey } from './providers.mjs';
import {
  SUGGESTED_DIMENSIONS,
  freezeMethodPayload,
  validateItemLabels,
  buildJsonSchemaFromDimensions,
  buildPromptTemplate,
} from './dimensions.mjs';
import { enqueueOrProcess, processRunChunk } from './runner.mjs';

async function requireAdmin(request, env) {
  const auth = await getUserFromBearer(request, env);
  if (!auth?.user?.id) {
    throw Object.assign(new Error('Authentication required'), { status: 401, code: 'UNAUTHENTICATED' });
  }
  const rows = await supabaseRest(env, {
    path: '/rest/v1/admins',
    serviceRole: true,
    query: `?user_id=eq.${encodeURIComponent(auth.user.id)}&select=user_id`,
  });
  if (!Array.isArray(rows) || !rows[0]) {
    throw Object.assign(new Error('Admin only'), { status: 403, code: 'FORBIDDEN' });
  }
  return auth;
}

function publicSettingsRow(row) {
  if (!row) {
    return {
      public_enabled: false,
      title: 'SP-Bench',
      subtitle: 'Benchmarking Subjective–Objective Spatial Perception and Cognition in Urban Environments',
      method_version: 'v1-draft',
      landing_blurb: '',
    };
  }
  return {
    public_enabled: !!row.public_enabled,
    title: row.title,
    subtitle: row.subtitle,
    method_version: row.method_version,
    landing_blurb: row.landing_blurb || '',
    active_dataset_id: row.active_dataset_id,
    active_method_id: row.active_method_id,
  };
}

function sanitizeProvider(row) {
  return {
    id: row.id,
    display_name: row.display_name,
    adapter: row.adapter,
    base_url: row.base_url,
    configured: !!row.configured,
    key_hint: row.key_hint || null,
    last_validated_at: row.last_validated_at,
    last_error: row.last_error,
    metadata: row.metadata || {},
  };
}

async function getSettings(env) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/sp_bench_settings',
    serviceRole: true,
    query: '?id=eq.1&select=*',
  });
  return Array.isArray(rows) ? rows[0] : null;
}

export async function handleBenchRoutes(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (!pathname.startsWith('/api/bench')) return null;

  try {
    // ── Public ────────────────────────────────────────────────────────────
    if (pathname === '/api/bench/public' && request.method === 'GET') {
      const settings = await getSettings(env);
      const pub = publicSettingsRow(settings);
      if (!pub.public_enabled) {
        return jsonResponse({ success: true, enabled: false, settings: pub, leaderboard: [] });
      }
      const board = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_public_leaderboard',
        serviceRole: true,
        query: '?select=*&order=overall_score.desc.nullslast',
      });
      let method = null;
      if (settings?.active_method_id) {
        const methods = await supabaseRest(env, {
          path: '/rest/v1/sp_bench_methods',
          serviceRole: true,
          query: `?id=eq.${encodeURIComponent(settings.active_method_id)}&select=id,version,title,status,dimensions,notes,frozen_at`,
        });
        method = Array.isArray(methods) ? methods[0] : null;
      }
      let dataset = null;
      if (settings?.active_dataset_id) {
        const datasets = await supabaseRest(env, {
          path: '/rest/v1/sp_bench_datasets',
          serviceRole: true,
          query: `?id=eq.${encodeURIComponent(settings.active_dataset_id)}&select=id,version,title,status,item_count,frozen_at,notes`,
        });
        dataset = Array.isArray(datasets) ? datasets[0] : null;
      }
      return jsonResponse({
        success: true,
        enabled: true,
        settings: pub,
        method,
        dataset,
        leaderboard: Array.isArray(board) ? board : [],
      });
    }

    if (pathname === '/api/bench/public/status' && request.method === 'GET') {
      const settings = await getSettings(env);
      return jsonResponse({
        success: true,
        enabled: !!settings?.public_enabled,
        settings: publicSettingsRow(settings),
      });
    }

    // ── Admin gate for remaining routes ───────────────────────────────────
    const auth = await requireAdmin(request, env);
    const userId = auth.user.id;

    if (pathname === '/api/bench/settings' && request.method === 'GET') {
      const settings = await getSettings(env);
      const queueReady = !!(env.SP_BENCH_QUEUE && typeof env.SP_BENCH_QUEUE.send === 'function');
      return jsonResponse({
        success: true,
        settings: settings || publicSettingsRow(null),
        queueReady,
        inlineRunnerAllowed: !queueReady,
        suggestedDimensions: SUGGESTED_DIMENSIONS,
      });
    }

    if (pathname === '/api/bench/settings' && request.method === 'PATCH') {
      const body = await request.json();
      const patch = { updated_at: new Date().toISOString(), updated_by: userId };
      for (const key of [
        'public_enabled', 'title', 'subtitle', 'method_version',
        'landing_blurb', 'active_dataset_id', 'active_method_id',
      ]) {
        if (key in body) patch[key] = body[key];
      }
      await supabaseRest(env, {
        path: '/rest/v1/sp_bench_settings',
        method: 'POST',
        serviceRole: true,
        body: { id: 1, ...patch },
        prefer: 'resolution=merge-duplicates,return=representation',
      });
      const settings = await getSettings(env);
      return jsonResponse({ success: true, settings });
    }

    if (pathname === '/api/bench/providers' && request.method === 'GET') {
      const rows = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_providers',
        serviceRole: true,
        query: '?select=*&order=id.asc',
      });
      return jsonResponse({
        success: true,
        providers: (Array.isArray(rows) ? rows : []).map(sanitizeProvider),
      });
    }

    if (pathname === '/api/bench/providers' && request.method === 'PUT') {
      const body = await request.json();
      const providerId = String(body.providerId || body.id || '').trim();
      const apiKey = String(body.apiKey || '').trim();
      if (!providerId || apiKey.length < 8) {
        throw Object.assign(new Error('providerId and apiKey required'), { status: 400 });
      }
      const existing = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_providers',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(providerId)}&select=*`,
      });
      const provider = Array.isArray(existing) ? existing[0] : null;
      if (!provider) throw Object.assign(new Error('Unknown provider'), { status: 404 });

      const validated = await validateProviderKey(provider, apiKey);
      const encrypted = await encryptApiKey(env, apiKey);
      await supabaseRest(env, {
        path: '/rest/v1/sp_bench_providers',
        method: 'PATCH',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(providerId)}`,
        body: {
          key_ciphertext: toByteaHex(encrypted.ciphertext),
          key_nonce: toByteaHex(encrypted.nonce),
          key_version: encrypted.keyVersion,
          key_hint: keyHint(apiKey),
          configured: true,
          last_validated_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
          metadata: {
            ...(provider.metadata || {}),
            discovered_model_count: validated.models?.length || 0,
          },
        },
        prefer: 'return=minimal',
      });
      return jsonResponse({
        success: true,
        provider: {
          id: providerId,
          configured: true,
          key_hint: keyHint(apiKey),
          discovered_models: (validated.models || []).slice(0, 50),
        },
      });
    }

    if (pathname === '/api/bench/providers' && request.method === 'DELETE') {
      const providerId = url.searchParams.get('id');
      if (!providerId) throw Object.assign(new Error('id required'), { status: 400 });
      await supabaseRest(env, {
        path: '/rest/v1/sp_bench_providers',
        method: 'PATCH',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(providerId)}`,
        body: {
          key_ciphertext: null,
          key_nonce: null,
          key_hint: null,
          configured: false,
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        prefer: 'return=minimal',
      });
      return jsonResponse({ success: true });
    }

    if (pathname === '/api/bench/models' && request.method === 'GET') {
      const rows = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_models',
        serviceRole: true,
        query: '?select=*&order=sort_order.asc',
      });
      return jsonResponse({ success: true, models: Array.isArray(rows) ? rows : [] });
    }

    if (pathname === '/api/bench/models' && request.method === 'POST') {
      const body = await request.json();
      const row = {
        provider_id: body.provider_id,
        model_id: body.model_id,
        display_name: body.display_name || body.model_id,
        family: body.family || null,
        enabled: !!body.enabled,
        vision: body.vision !== false,
        context_window: body.context_window || null,
        notes: body.notes || null,
        sort_order: body.sort_order ?? 200,
        metadata: body.metadata || {},
        updated_at: new Date().toISOString(),
      };
      const inserted = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_models',
        method: 'POST',
        serviceRole: true,
        body: row,
        prefer: 'return=representation',
      });
      return jsonResponse({ success: true, model: Array.isArray(inserted) ? inserted[0] : inserted }, { status: 201 });
    }

    if (pathname === '/api/bench/models' && request.method === 'PATCH') {
      const body = await request.json();
      const id = body.id;
      if (!id) throw Object.assign(new Error('id required'), { status: 400 });
      const patch = { updated_at: new Date().toISOString() };
      for (const key of [
        'display_name', 'family', 'enabled', 'vision', 'context_window',
        'notes', 'sort_order', 'metadata', 'model_id', 'provider_id',
      ]) {
        if (key in body) patch[key] = body[key];
      }
      const updated = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_models',
        method: 'PATCH',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(id)}`,
        body: patch,
        prefer: 'return=representation',
      });
      return jsonResponse({ success: true, model: Array.isArray(updated) ? updated[0] : updated });
    }

    if (pathname === '/api/bench/dimensions' && request.method === 'GET') {
      const rows = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_dimensions',
        serviceRole: true,
        query: '?select=*&order=sort_order.asc',
      });
      const dims = Array.isArray(rows) ? rows : [];
      return jsonResponse({
        success: true,
        dimensions: dims,
        preview: {
          prompt_template: buildPromptTemplate(dims),
          json_schema: buildJsonSchemaFromDimensions(dims),
        },
      });
    }

    if (pathname === '/api/bench/dimensions' && request.method === 'PUT') {
      const body = await request.json();
      const dims = Array.isArray(body.dimensions) ? body.dimensions : null;
      if (!dims) throw Object.assign(new Error('dimensions array required'), { status: 400 });
      // Replace strategy: upsert each, disable missing keys
      const existing = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_dimensions',
        serviceRole: true,
        query: '?select=key',
      });
      const existingKeys = new Set((Array.isArray(existing) ? existing : []).map((d) => d.key));
      const nextKeys = new Set();
      for (const dim of dims) {
        const key = String(dim.key || '').trim();
        if (!key) continue;
        nextKeys.add(key);
        const row = {
          key,
          name_en: dim.name_en || key,
          name_zh: dim.name_zh || '',
          group_key: dim.group_key || 'subjective',
          label_type: dim.label_type || 'continuous',
          value_range: dim.value_range || {},
          metrics: dim.metrics || [],
          weight: dim.weight ?? 1,
          prompt_field: dim.prompt_field || key,
          required: dim.required !== false,
          enabled: dim.enabled !== false,
          sort_order: dim.sort_order ?? 100,
          metadata: dim.metadata || {},
          updated_at: new Date().toISOString(),
        };
        await supabaseRest(env, {
          path: '/rest/v1/sp_bench_dimensions',
          method: 'POST',
          serviceRole: true,
          body: row,
          prefer: 'resolution=merge-duplicates,return=minimal',
        });
      }
      for (const key of existingKeys) {
        if (!nextKeys.has(key)) {
          await supabaseRest(env, {
            path: '/rest/v1/sp_bench_dimensions',
            method: 'PATCH',
            serviceRole: true,
            query: `?key=eq.${encodeURIComponent(key)}`,
            body: { enabled: false, updated_at: new Date().toISOString() },
            prefer: 'return=minimal',
          });
        }
      }
      return jsonResponse({ success: true });
    }

    if (pathname === '/api/bench/methods' && request.method === 'GET') {
      const rows = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_methods',
        serviceRole: true,
        query: '?select=*&order=created_at.desc',
      });
      return jsonResponse({ success: true, methods: Array.isArray(rows) ? rows : [] });
    }

    if (pathname === '/api/bench/methods/freeze' && request.method === 'POST') {
      const body = await request.json();
      const version = String(body.version || '').trim();
      if (!version) throw Object.assign(new Error('version required'), { status: 400 });
      const dims = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_dimensions',
        serviceRole: true,
        query: '?enabled=eq.true&select=*&order=sort_order.asc',
      });
      const payload = freezeMethodPayload({
        version,
        title: body.title,
        dimensions: Array.isArray(dims) ? dims : [],
        notes: body.notes || '',
      });
      payload.frozen_by = userId;
      const inserted = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_methods',
        method: 'POST',
        serviceRole: true,
        body: payload,
        prefer: 'return=representation',
      });
      const method = Array.isArray(inserted) ? inserted[0] : inserted;
      await supabaseRest(env, {
        path: '/rest/v1/sp_bench_settings',
        method: 'PATCH',
        serviceRole: true,
        query: '?id=eq.1',
        body: {
          active_method_id: method.id,
          method_version: version,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        },
        prefer: 'return=minimal',
      });
      return jsonResponse({ success: true, method }, { status: 201 });
    }

    if (pathname === '/api/bench/datasets' && request.method === 'GET') {
      const rows = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_datasets',
        serviceRole: true,
        query: '?select=*&order=created_at.desc',
      });
      return jsonResponse({ success: true, datasets: Array.isArray(rows) ? rows : [] });
    }

    if (pathname === '/api/bench/datasets' && request.method === 'POST') {
      const body = await request.json();
      const version = String(body.version || '').trim();
      const title = String(body.title || version).trim();
      if (!version) throw Object.assign(new Error('version required'), { status: 400 });
      const r2Prefix = `bench/datasets/${version}/`;
      const inserted = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_datasets',
        method: 'POST',
        serviceRole: true,
        body: {
          version,
          title,
          status: 'draft',
          method_id: body.method_id || null,
          r2_prefix: r2Prefix,
          notes: body.notes || null,
        },
        prefer: 'return=representation',
      });
      return jsonResponse({ success: true, dataset: Array.isArray(inserted) ? inserted[0] : inserted }, { status: 201 });
    }

    if (pathname === '/api/bench/datasets/items' && request.method === 'POST') {
      const body = await request.json();
      const datasetId = body.datasetId || body.dataset_id;
      const items = Array.isArray(body.items) ? body.items : [];
      if (!datasetId || !items.length) {
        throw Object.assign(new Error('datasetId and items required'), { status: 400 });
      }
      const datasets = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_datasets',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(datasetId)}&select=*`,
      });
      const dataset = Array.isArray(datasets) ? datasets[0] : null;
      if (!dataset) throw Object.assign(new Error('Dataset not found'), { status: 404 });
      if (dataset.status === 'frozen') {
        throw Object.assign(new Error('Frozen dataset cannot be modified; create a new version'), { status: 400 });
      }

      let dimensions = [];
      if (dataset.method_id) {
        const methods = await supabaseRest(env, {
          path: '/rest/v1/sp_bench_methods',
          serviceRole: true,
          query: `?id=eq.${encodeURIComponent(dataset.method_id)}&select=dimensions`,
        });
        dimensions = Array.isArray(methods) ? (methods[0]?.dimensions || []) : [];
      } else {
        const dims = await supabaseRest(env, {
          path: '/rest/v1/sp_bench_dimensions',
          serviceRole: true,
          query: '?enabled=eq.true&select=*',
        });
        dimensions = Array.isArray(dims) ? dims : [];
      }

      const rows = [];
      const errors = [];
      for (const item of items) {
        const labels = item.labels || {};
        const check = validateItemLabels(labels, dimensions);
        if (!check.ok) {
          errors.push({ item_key: item.item_key, errors: check.errors });
          continue;
        }
        rows.push({
          dataset_id: datasetId,
          item_key: String(item.item_key || '').trim(),
          split: item.split || 'test',
          media_type: item.media_type || 'image',
          media_urls: item.media_urls || [],
          r2_keys: item.r2_keys || [],
          labels,
          metadata: item.metadata || {},
        });
      }
      if (!rows.length) {
        throw Object.assign(new Error('No valid items'), { status: 400, details: { errors } });
      }
      // Upsert in chunks
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50);
        await supabaseRest(env, {
          path: '/rest/v1/sp_bench_items',
          method: 'POST',
          serviceRole: true,
          body: chunk,
          prefer: 'resolution=merge-duplicates,return=minimal',
        });
      }
      const countRows = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_items',
        serviceRole: true,
        query: `?dataset_id=eq.${encodeURIComponent(datasetId)}&select=id`,
      });
      const itemCount = Array.isArray(countRows) ? countRows.length : 0;
      await supabaseRest(env, {
        path: '/rest/v1/sp_bench_datasets',
        method: 'PATCH',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(datasetId)}`,
        body: { item_count: itemCount, updated_at: new Date().toISOString() },
        prefer: 'return=minimal',
      });
      return jsonResponse({
        success: true,
        imported: rows.length,
        skipped: errors.length,
        item_count: itemCount,
        errors: errors.slice(0, 20),
      });
    }

    if (pathname === '/api/bench/datasets/freeze' && request.method === 'POST') {
      const body = await request.json();
      const datasetId = body.datasetId || body.dataset_id;
      if (!datasetId) throw Object.assign(new Error('datasetId required'), { status: 400 });
      const items = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_items',
        serviceRole: true,
        query: `?dataset_id=eq.${encodeURIComponent(datasetId)}&select=item_key,labels,media_urls`,
      });
      const list = Array.isArray(items) ? items : [];
      if (!list.length) throw Object.assign(new Error('Dataset has no items'), { status: 400 });
      const hashInput = JSON.stringify(list.map((i) => ({
        k: i.item_key,
        l: i.labels,
        u: i.media_urls,
      })));
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashInput));
      const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const updated = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_datasets',
        method: 'PATCH',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(datasetId)}`,
        body: {
          status: 'frozen',
          content_hash: hash,
          item_count: list.length,
          frozen_at: new Date().toISOString(),
          frozen_by: userId,
          method_id: body.method_id || undefined,
          updated_at: new Date().toISOString(),
        },
        prefer: 'return=representation',
      });
      const dataset = Array.isArray(updated) ? updated[0] : updated;
      await supabaseRest(env, {
        path: '/rest/v1/sp_bench_settings',
        method: 'PATCH',
        serviceRole: true,
        query: '?id=eq.1',
        body: {
          active_dataset_id: datasetId,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        },
        prefer: 'return=minimal',
      });
      return jsonResponse({ success: true, dataset });
    }

    if (pathname === '/api/bench/datasets/items' && request.method === 'GET') {
      const datasetId = url.searchParams.get('datasetId');
      if (!datasetId) throw Object.assign(new Error('datasetId required'), { status: 400 });
      const rows = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_items',
        serviceRole: true,
        query: `?dataset_id=eq.${encodeURIComponent(datasetId)}&select=*&order=item_key.asc&limit=500`,
      });
      return jsonResponse({ success: true, items: Array.isArray(rows) ? rows : [] });
    }

    if (pathname === '/api/bench/runs' && request.method === 'GET') {
      const rows = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_runs',
        serviceRole: true,
        query: '?select=*&order=created_at.desc',
      });
      return jsonResponse({ success: true, runs: Array.isArray(rows) ? rows : [] });
    }

    if (pathname === '/api/bench/runs' && request.method === 'POST') {
      const body = await request.json();
      const settings = await getSettings(env);
      const datasetId = body.datasetId || settings?.active_dataset_id;
      const methodId = body.methodId || settings?.active_method_id;
      if (!datasetId || !methodId) {
        throw Object.assign(new Error('Active frozen dataset and method required'), { status: 400 });
      }
      const datasets = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_datasets',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(datasetId)}&select=*`,
      });
      const dataset = Array.isArray(datasets) ? datasets[0] : null;
      if (!dataset || dataset.status !== 'frozen') {
        throw Object.assign(new Error('Dataset must be frozen'), { status: 400 });
      }
      const methods = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_methods',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(methodId)}&select=*`,
      });
      const method = Array.isArray(methods) ? methods[0] : null;
      if (!method || method.status !== 'frozen') {
        throw Object.assign(new Error('Method must be frozen'), { status: 400 });
      }

      let modelIds = Array.isArray(body.modelIds) ? body.modelIds : null;
      if (body.unevaluatedOnly || !modelIds) {
        const models = await supabaseRest(env, {
          path: '/rest/v1/sp_bench_models',
          serviceRole: true,
          query: '?enabled=eq.true&select=id,provider_id',
        });
        const providers = await supabaseRest(env, {
          path: '/rest/v1/sp_bench_providers',
          serviceRole: true,
          query: '?configured=eq.true&select=id',
        });
        const configured = new Set((Array.isArray(providers) ? providers : []).map((p) => p.id));
        const enabled = (Array.isArray(models) ? models : [])
          .filter((m) => configured.has(m.provider_id));
        if (body.unevaluatedOnly) {
          const existing = await supabaseRest(env, {
            path: '/rest/v1/sp_bench_runs',
            serviceRole: true,
            query: `?dataset_id=eq.${encodeURIComponent(datasetId)}&method_id=eq.${encodeURIComponent(methodId)}&select=model_row_id,status`,
          });
          const done = new Set(
            (Array.isArray(existing) ? existing : [])
              .filter((r) => !['failed', 'cancelled', 'rejected'].includes(r.status))
              .map((r) => r.model_row_id),
          );
          modelIds = enabled.filter((m) => !done.has(m.id)).map((m) => m.id);
        } else if (!modelIds) {
          modelIds = enabled.map((m) => m.id);
        }
      }
      if (!modelIds.length) {
        return jsonResponse({ success: true, created: [], message: 'No models to evaluate' });
      }

      const items = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_items',
        serviceRole: true,
        query: `?dataset_id=eq.${encodeURIComponent(datasetId)}&select=id`,
      });
      const itemList = Array.isArray(items) ? items : [];
      if (!itemList.length) throw Object.assign(new Error('Dataset has no items'), { status: 400 });

      const created = [];
      for (const modelRowId of modelIds) {
        const runRows = await supabaseRest(env, {
          path: '/rest/v1/sp_bench_runs',
          method: 'POST',
          serviceRole: true,
          body: {
            model_row_id: modelRowId,
            dataset_id: datasetId,
            method_id: methodId,
            status: 'queued',
            progress_done: 0,
            progress_total: itemList.length,
            dataset_hash: dataset.content_hash,
            method_version: method.version,
            created_by: userId,
          },
          prefer: 'resolution=merge-duplicates,return=representation',
        });
        const run = Array.isArray(runRows) ? runRows[0] : runRows;
        if (!run?.id) continue;
        // Reset predictions for re-run
        await supabaseRest(env, {
          path: '/rest/v1/sp_bench_predictions',
          method: 'DELETE',
          serviceRole: true,
          query: `?run_id=eq.${encodeURIComponent(run.id)}`,
        });
        const predRows = itemList.map((item) => ({
          run_id: run.id,
          item_id: item.id,
          status: 'pending',
        }));
        for (let i = 0; i < predRows.length; i += 100) {
          await supabaseRest(env, {
            path: '/rest/v1/sp_bench_predictions',
            method: 'POST',
            serviceRole: true,
            body: predRows.slice(i, i + 100),
            prefer: 'return=minimal',
          });
        }
        await enqueueOrProcess(env, ctx, run.id);
        created.push(run);
      }
      return jsonResponse({ success: true, created }, { status: 201 });
    }

    const processMatch = pathname.match(/^\/api\/bench\/runs\/([^/]+)\/process$/);
    if (processMatch && request.method === 'POST') {
      const runId = processMatch[1];
      const result = await processRunChunk(env, runId);
      if (!result.finished && env.SP_BENCH_QUEUE?.send) {
        await env.SP_BENCH_QUEUE.send({ runId, type: 'process_chunk' });
      } else if (!result.finished) {
        await enqueueOrProcess(env, ctx, runId);
      }
      return jsonResponse({ success: true, ...result });
    }

    const reviewMatch = pathname.match(/^\/api\/bench\/runs\/([^/]+)\/review$/);
    if (reviewMatch && request.method === 'POST') {
      const runId = reviewMatch[1];
      const body = await request.json();
      const action = body.action;
      if (!['approve', 'reject', 'publish', 'unpublish'].includes(action)) {
        throw Object.assign(new Error('Invalid action'), { status: 400 });
      }
      const patch = {
        updated_at: new Date().toISOString(),
        review_notes: body.notes || null,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      };
      if (action === 'approve') {
        patch.status = 'approved';
        patch.published = !!body.publish;
      } else if (action === 'reject') {
        patch.status = 'rejected';
        patch.published = false;
      } else if (action === 'publish') {
        patch.status = 'approved';
        patch.published = true;
      } else if (action === 'unpublish') {
        patch.published = false;
      }
      const updated = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_runs',
        method: 'PATCH',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(runId)}`,
        body: patch,
        prefer: 'return=representation',
      });
      return jsonResponse({ success: true, run: Array.isArray(updated) ? updated[0] : updated });
    }

    const resultsMatch = pathname.match(/^\/api\/bench\/runs\/([^/]+)\/results$/);
    if (resultsMatch && request.method === 'GET') {
      const runId = resultsMatch[1];
      const results = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_results',
        serviceRole: true,
        query: `?run_id=eq.${encodeURIComponent(runId)}&select=*`,
      });
      const preds = await supabaseRest(env, {
        path: '/rest/v1/sp_bench_predictions',
        serviceRole: true,
        query: `?run_id=eq.${encodeURIComponent(runId)}&select=id,item_id,status,error_message,latency_ms&order=created_at.asc&limit=200`,
      });
      return jsonResponse({
        success: true,
        result: Array.isArray(results) ? results[0] : null,
        predictions: Array.isArray(preds) ? preds : [],
      });
    }

    return jsonResponse({ success: false, error: 'Not found' }, { status: 404 });
  } catch (error) {
    return errorResponse(error, error.status || 500);
  }
}

export async function handleBenchQueueBatch(batch, env) {
  for (const msg of batch.messages) {
    try {
      const body = msg.body || {};
      if (body.runId) {
        let guard = 0;
        while (guard < 40) {
          const result = await processRunChunk(env, body.runId);
          if (result.finished) break;
          guard += 1;
        }
      }
      msg.ack();
    } catch (err) {
      console.error('SP-Bench queue error', err);
      msg.retry();
    }
  }
}

/**
 * Cloudflare Worker handlers for /api/inference/* (SAM3 + fal key test + SegFormer).
 * Pages Functions under functions/api/inference/ are not used when wrangler
 * run_worker_first catches /api/* — missing routes fall through to SPA assets → HTTP 405 on POST.
 */
import { buildSam3Input, extractSamInstances } from '../src/lib/falServer.js';

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });

async function resolveFalKey(body, env = {}) {
  if (body?.falKey) return String(body.falKey).trim();
  const projectId = body?.projectId;
  if (!projectId) return null;

  const url = env.SUPABASE_URL || env.REACT_APP_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.REACT_APP_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  try {
    const res = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}&select=image_dataset_config`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const cfg = rows?.[0]?.image_dataset_config || {};
    return cfg.falApiKey || null;
  } catch {
    return null;
  }
}

export async function handleInferenceTest(request) {
  try {
    const body = await request.json();
    const falKey = String(body?.falKey || '').trim();
    if (!falKey) return json({ success: false, error: 'falKey is required' }, { status: 400 });

    const falRes = await fetch('https://api.fal.ai/v1/models?limit=1', {
      headers: { Authorization: `Key ${falKey}` },
    });
    const text = await falRes.text();
    let detail = '';
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.detail || parsed?.error || parsed?.message || '';
      if (Array.isArray(detail)) detail = detail.map((d) => d?.msg || JSON.stringify(d)).join('; ');
    } catch {
      detail = text.slice(0, 300);
    }

    if (falRes.status === 401) {
      return json({
        success: false,
        error: detail || 'Invalid fal API key (401). Use the full key from fal.ai/dashboard/keys (id:secret).',
      }, { status: 401 });
    }
    if (falRes.status === 403) {
      const ping = await fetch('https://fal.run/fal-ai/any-llm', {
        method: 'POST',
        headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'ping', model: 'google/gemini-flash-1.5' }),
      });
      if (ping.status === 401) {
        return json({
          success: false,
          error: 'Invalid fal API key. Check you copied the full key (key_id:key_secret).',
        }, { status: 401 });
      }
      return json({ success: true, status: ping.status, note: 'Key accepted by fal.run' });
    }
    if (!falRes.ok && falRes.status >= 500) {
      return json({ success: false, error: detail || `fal server error (${falRes.status})` }, { status: 502 });
    }
    return json({ success: true, status: falRes.status });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}

export async function handleInferenceSam3(request, env) {
  try {
    const body = await request.json();
    const falKey = await resolveFalKey(body, env || {});
    const { imageUrl, prompt, points, box } = body || {};
    if (!falKey) {
      return json({
        success: false,
        error: 'falKey is required (or configure falApiKey on the project and pass projectId)',
      }, { status: 400 });
    }
    if (!imageUrl) return json({ success: false, error: 'imageUrl is required' }, { status: 400 });

    const promptText = String(prompt || '').trim();
    const hasPoints = Array.isArray(points) && points.length > 0;
    const hasBox = !!box;
    const input = buildSam3Input({
      imageUrl,
      prompt: promptText,
      points,
      box,
      maxMasks: promptText ? 32 : 4,
    });

    const callFal = async (payload) => {
      const res = await fetch('https://fal.run/fal-ai/sam-3/image', {
        method: 'POST',
        headers: {
          Authorization: `Key ${falKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        return { ok: false, status: res.status, error: text || `fal HTTP ${res.status}`, result: null };
      }
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: result?.detail || result?.error || result?.message || `fal HTTP ${res.status}`,
          result,
        };
      }
      return { ok: true, status: res.status, result };
    };

    let call = await callFal(input);
    if (!call.ok) {
      return json({ success: false, error: call.error }, { status: call.status === 401 ? 401 : 502 });
    }
    let instances = extractSamInstances(call.result);
    if (!instances.some((i) => i.maskUrl)) {
      const retry = await callFal({ ...input, apply_mask: true });
      if (retry.ok) {
        call = retry;
        instances = extractSamInstances(retry.result);
      }
    }
    if (!instances.length) {
      const hint = promptText
        ? `SAM3 found nothing for "${promptText}". Try one noun, or use SAM Click / SAM Box.`
        : (hasPoints || hasBox)
          ? 'SAM3 returned no mask for that click/box. Try another spot, or a tighter box.'
          : 'SAM3 returned no mask or box.';
      return json({
        success: false,
        error: hint,
        rawKeys: call.result && typeof call.result === 'object' ? Object.keys(call.result) : [],
      }, { status: 422 });
    }
    return json({
      success: true,
      maskUrl: instances[0].maskUrl,
      box: instances[0].box,
      instances,
      candidates: instances.length,
      raw: call.result,
    });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}

const HF_MODEL = 'nvidia/segformer-b0-finetuned-cityscapes-1024-1024';
const HF_URLS = [
  `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`,
  `https://api-inference.huggingface.co/models/${HF_MODEL}`,
];

function toDataUrl(mask) {
  if (!mask) return null;
  if (typeof mask !== 'string') return null;
  if (mask.startsWith('data:')) return mask;
  return `data:image/png;base64,${mask}`;
}

export async function handleInferenceStreetscapeSeg(request, env) {
  try {
    const body = await request.json();
    let hfToken = body?.hfToken ? String(body.hfToken).trim() : (env?.HF_TOKEN || null);
    const { imageUrl, projectId } = body || {};

    if (!hfToken && projectId) {
      const url = env?.SUPABASE_URL || env?.REACT_APP_SUPABASE_URL;
      const key = env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_ANON_KEY || env?.REACT_APP_SUPABASE_ANON_KEY;
      if (url && key) {
        try {
          const res = await fetch(
            `${url.replace(/\/$/, '')}/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}&select=image_dataset_config`,
            { headers: { apikey: key, Authorization: `Bearer ${key}` } },
          );
          if (res.ok) {
            const rows = await res.json();
            const cfg = rows?.[0]?.image_dataset_config || {};
            hfToken = cfg.huggingFaceToken || cfg.huggingfaceToken || null;
          }
        } catch { /* ignore */ }
      }
    }

    if (!hfToken) {
      return json({
        success: false,
        error: 'HuggingFace token required for SegFormer streetscape seg. Set it in Media Dataset → HuggingFace section.',
      }, { status: 400 });
    }
    if (!imageUrl) return json({ success: false, error: 'imageUrl is required' }, { status: 400 });

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return json({ success: false, error: `Failed to fetch image (${imgRes.status})` }, { status: 400 });
    }
    const imgBuf = await imgRes.arrayBuffer();
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';

    let lastErr = '';
    let segments = null;
    for (const endpoint of HF_URLS) {
      // eslint-disable-next-line no-await-in-loop
      const hfRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hfToken}`,
          'Content-Type': contentType,
          Accept: 'application/json',
        },
        body: imgBuf,
      });
      const text = await hfRes.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        lastErr = text.slice(0, 300) || `HF HTTP ${hfRes.status}`;
        continue;
      }
      if (hfRes.status === 503 && parsed?.estimated_time) {
        return json({
          success: false,
          error: `Model is loading on HuggingFace (~${Math.ceil(parsed.estimated_time)}s). Retry in a moment.`,
        }, { status: 503 });
      }
      if (!hfRes.ok) {
        lastErr = parsed?.error || parsed?.message || `HF HTTP ${hfRes.status}`;
        if (hfRes.status === 401 || hfRes.status === 403) {
          return json({ success: false, error: lastErr || 'Invalid HuggingFace token' }, { status: 401 });
        }
        continue;
      }
      if (!Array.isArray(parsed)) {
        lastErr = 'Unexpected HF response (expected segment list)';
        continue;
      }
      segments = parsed;
      break;
    }

    if (!segments) {
      return json({ success: false, error: lastErr || 'SegFormer request failed' }, { status: 502 });
    }

    const masks = {};
    const labels = [];
    for (const seg of segments) {
      const label = seg.label || seg.class || '';
      if (!label) continue;
      labels.push(label);
      masks[label] = toDataUrl(seg.mask);
    }

    return json({
      success: true,
      model: HF_MODEL,
      masks,
      labels,
      vocab: labels,
      compute_runtime: 'hf_segformer_cityscapes',
    });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}

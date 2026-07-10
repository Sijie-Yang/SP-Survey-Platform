// POST /api/inference/streetscape-seg
// SegFormer Cityscapes via HuggingFace Inference (ONE pass per image — not SAM3).
// Body: { hfToken?, projectId?, imageUrl }
import { json } from '../../_lib/r2.js';

const HF_MODEL = 'nvidia/segformer-b0-finetuned-cityscapes-1024-1024';
const HF_URLS = [
  `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`,
  `https://api-inference.huggingface.co/models/${HF_MODEL}`,
];

async function resolveHfToken(body, env = {}) {
  if (body?.hfToken) return String(body.hfToken).trim();
  // Optional: env fallback for deployed workers
  if (env.HF_TOKEN) return env.HF_TOKEN;
  return null;
}

function toDataUrl(mask) {
  if (!mask) return null;
  if (typeof mask !== 'string') return null;
  if (mask.startsWith('data:')) return mask;
  // HF often returns raw base64 PNG
  return `data:image/png;base64,${mask}`;
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await request.json();
    let hfToken = await resolveHfToken(body, env || {});
    const { imageUrl, projectId } = body || {};

    // CF worker cannot read local project JSON; client should send hfToken.
    // If projectId-only, try Supabase projects table when env is set.
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
};

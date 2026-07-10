/**
 * Shared fal.ai proxy helpers for Express (server.js) and Cloudflare Pages Functions.
 */

export async function falSubscribe(falKey, modelId, input) {
  const res = await fetch(`https://fal.run/${modelId}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(text || `fal HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(json?.detail || json?.error || json?.message || `fal HTTP ${res.status}`);
  }
  return json;
}

export async function handleFalTest(falKey) {
  if (!falKey) throw new Error('falKey is required');
  // Lightweight auth check — queue status endpoint
  const res = await fetch('https://api.fal.ai/v1/models', {
    headers: { Authorization: `Key ${falKey}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('Invalid fal API key');
  }
  // Some accounts may not list models; any non-auth response counts as ok
  if (res.status === 404) return { ok: true };
  if (!res.ok && res.status !== 404) {
    // Try a tiny SAM3 dry-run is expensive; accept 200–499 except 401/403
    const body = await res.text();
    if (res.status >= 500) throw new Error(body || 'fal server error');
  }
  return { ok: true };
}

export function buildSam3Input({ imageUrl, prompt, points, box }) {
  const input = { image_url: imageUrl };
  if (prompt) input.prompt = prompt;
  if (points?.length) {
    input.point_prompts = points.map((p) => ({
      x: p.x,
      y: p.y,
      label: p.label === 0 ? 0 : 1,
    }));
  }
  if (box) {
    input.box_prompts = [{ x_min: box.x1, y_min: box.y1, x_max: box.x2, y_max: box.y2 }];
  }
  return input;
}

/** Extract first mask image URL from fal SAM3 response (schema may vary). */
export function extractMaskUrl(result) {
  if (!result) return null;
  if (typeof result.image?.url === 'string') return result.image.url;
  if (typeof result.mask?.url === 'string') return result.mask.url;
  if (Array.isArray(result.masks) && result.masks[0]?.url) return result.masks[0].url;
  if (Array.isArray(result.images) && result.images[0]?.url) return result.images[0].url;
  if (typeof result.url === 'string') return result.url;
  return null;
}

export async function estimateMaskRatioFromUrl(maskUrl) {
  // Server-side: fetch and count opaque-ish pixels via raw decode is heavy.
  // Return null; client can refine. For streetscape-seg we use fal output metadata if any.
  return null;
}

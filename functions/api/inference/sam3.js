// POST /api/inference/sam3
// Body: { falKey?, projectId?, imageUrl, prompt?, points?, box? }
import { json } from '../../_lib/r2.js';
import { resolveFalKey } from '../../_lib/falAuth.js';

function extractMaskUrl(result) {
  if (!result) return null;
  if (typeof result.image?.url === 'string') return result.image.url;
  if (typeof result.mask?.url === 'string') return result.mask.url;
  if (Array.isArray(result.masks) && result.masks[0]?.url) return result.masks[0].url;
  if (Array.isArray(result.images) && result.images[0]?.url) return result.images[0].url;
  if (typeof result.url === 'string') return result.url;
  return null;
}

export const onRequestPost = async ({ request, env }) => {
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
      input.box_prompts = [{
        x_min: box.x1, y_min: box.y1, x_max: box.x2, y_max: box.y2,
      }];
    }

    const res = await fetch('https://fal.run/fal-ai/sam-3/image', {
      method: 'POST',
      headers: {
        Authorization: `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    const text = await res.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return json({ success: false, error: text || `fal HTTP ${res.status}` }, { status: 502 });
    }
    if (!res.ok) {
      return json({
        success: false,
        error: result?.detail || result?.error || result?.message || `fal HTTP ${res.status}`,
      }, { status: res.status === 401 ? 401 : 502 });
    }
    const maskUrl = extractMaskUrl(result);
    return json({ success: true, maskUrl, raw: result });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};

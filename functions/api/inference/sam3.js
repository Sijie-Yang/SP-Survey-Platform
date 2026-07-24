// POST /api/inference/sam3
// Body: { falKey?, projectId?, imageUrl, prompt?, points?, box? }
import { json } from '../../_lib/r2.js';
import { resolveFalKey } from '../../_lib/falAuth.js';
import { buildSam3Input, extractSamInstances } from '../../../src/lib/falServer.js';

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
};

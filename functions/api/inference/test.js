// POST /api/inference/test  { falKey }
import { json } from '../../_lib/r2.js';

export const onRequestPost = async ({ request }) => {
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
};

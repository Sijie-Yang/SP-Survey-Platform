// Cloudflare Pages Function: GET /api/r2/image-proxy?url=...
// Proxies R2 public images for canvas/L0 when bucket CORS blocks the browser.
import { json, publicBaseUrl } from '../../_lib/r2.js';

export const onRequestGet = async ({ request, env }) => {
  try {
    const reqUrl = new URL(request.url);
    const rawUrl = String(reqUrl.searchParams.get('url') || '').trim();
    if (!rawUrl) return json({ success: false, error: 'url is required' }, { status: 400 });

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return json({ success: false, error: 'Invalid url' }, { status: 400 });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return json({ success: false, error: 'Only http(s) URLs allowed' }, { status: 400 });
    }

    const base = publicBaseUrl(env);
    if (base) {
      const allowedHost = new URL(base).host;
      if (parsed.host !== allowedHost) {
        return json({
          success: false,
          error: `Proxy only allows images from ${allowedHost}`,
        }, { status: 403 });
      }
    }

    const upstream = await fetch(rawUrl);
    if (!upstream.ok) {
      return json({
        success: false,
        error: `Upstream fetch failed (${upstream.status})`,
      }, { status: upstream.status });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};

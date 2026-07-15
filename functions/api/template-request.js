// Cloudflare Pages Function: /api/template-request
// POST  — create a pending guest paper→template request
// PATCH — attach sample images (requires editKey from create)

import {
  json,
  createPaperTemplateRequest,
  attachPaperTemplateImages,
} from '../_lib/templateRequest.js';

export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await request.json();
    const result = await createPaperTemplateRequest(body, env);
    return json(result, { status: result.success ? 200 : (result.status || 400) });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};

export const onRequestPatch = async ({ request, env }) => {
  try {
    const body = await request.json();
    const result = await attachPaperTemplateImages(body, env);
    return json(result, { status: result.success ? 200 : (result.status || 400) });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};

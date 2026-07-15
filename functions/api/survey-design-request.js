// Cloudflare Pages Function: /api/survey-design-request
// POST  — create a pending guest survey-design help request
// PATCH — attach media / supplementary files (requires editKey from create)

import {
  json,
  createSurveyDesignRequest,
  attachSurveyDesignFiles,
} from '../_lib/surveyDesignRequest.js';

export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await request.json();
    const result = await createSurveyDesignRequest(body, env);
    return json(result, { status: result.success ? 200 : (result.status || 400) });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};

export const onRequestPatch = async ({ request, env }) => {
  try {
    const body = await request.json();
    const result = await attachSurveyDesignFiles(body, env);
    return json(result, { status: result.success ? 200 : (result.status || 400) });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};

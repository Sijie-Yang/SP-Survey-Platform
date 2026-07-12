import { json } from '../../_lib/r2.js';

const PAPER_TO_TEMPLATE_PROMPT = `You are an expert survey designer specialising in urban / streetscape perception research.
Given a research paper's metadata (title, abstract, venue, year), produce a COMPLETE survey configuration JSON that could reasonably replicate or approximate the paper's human-perception study design for the SP-Survey platform.

CRITICAL RULE: No standalone text questions about streetscapes. Text questions should be socioeconomic or paired with image display.

PAGE TYPES:
1. Socioeconomic text questions
2. Image-based: imagerating, imagepicker, imageranking, imageboolean, imagematrix with imageSelectionMode huggingface_random, imageCount, choices: []
3. Image display + text about that image

Keep 2–6 pages. Return ONLY valid JSON: {"title":"...","description":"...","pages":[...]}`;

export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await request.json();
    const { paper, apiKey } = body || {};
    if (!apiKey) {
      return json({ success: false, error: 'apiKey is required (BYOK)' }, { status: 400 });
    }
    if (!paper?.title) {
      return json({ success: false, error: 'paper.title is required' }, { status: 400 });
    }

    const isOpenRouter = String(apiKey).startsWith('sk-or-');
    const baseURL = isOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
    const model = isOpenRouter ? 'openai/gpt-4o' : 'gpt-4o';

    const userPayload = [
      `Title: ${paper.title}`,
      paper.authors?.length ? `Authors: ${paper.authors.join(', ')}` : null,
      paper.year ? `Year: ${paper.year}` : null,
      paper.venue ? `Venue: ${paper.venue}` : null,
      paper.doi ? `DOI: ${paper.doi}` : null,
      paper.paper_url ? `URL: ${paper.paper_url}` : null,
      '',
      'Abstract:',
      paper.abstract || '(no abstract available — produce a conservative visual perception survey)',
    ].filter(Boolean).join('\n');

    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(isOpenRouter ? {
          'HTTP-Referer': env.APP_URL || 'https://sp-survey.org',
          'X-Title': env.APP_NAME || 'SP-Survey-Platform',
        } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: 'system', content: PAPER_TO_TEMPLATE_PROMPT },
          { role: 'user', content: userPayload },
        ],
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({
        success: false,
        error: data?.error?.message || `AI provider HTTP ${res.status}`,
      }, { status: 502 });
    }

    const raw = data.choices?.[0]?.message?.content || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return json({ success: false, error: 'Model did not return JSON survey config' }, { status: 502 });
    }
    let surveyConfig;
    try {
      surveyConfig = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return json({ success: false, error: `Invalid JSON: ${e.message}` }, { status: 502 });
    }
    if (!surveyConfig.pages || !Array.isArray(surveyConfig.pages)) {
      return json({ success: false, error: 'survey config missing pages[]' }, { status: 502 });
    }

    const author = Array.isArray(paper.authors) && paper.authors.length
      ? paper.authors.slice(0, 3).join(', ')
      : 'Unknown';
    const year = paper.year ? String(paper.year) : String(new Date().getFullYear());

    return json({
      success: true,
      surveyConfig,
      templateMeta: {
        name: surveyConfig.title || paper.title,
        description: surveyConfig.description
          || `Draft survey inspired by: ${paper.title}`,
        author,
        year,
        category: 'Academic Research',
        tags: ['deep-search', 'urban-perception', ...(paper.keywords || []).slice(0, 5)],
        website: paper.paper_url || (paper.doi ? `https://doi.org/${paper.doi}` : null),
      },
    });
  } catch (error) {
    return json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
};

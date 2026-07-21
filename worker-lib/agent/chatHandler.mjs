/**
 * Platform Assistant chat — uses stored BYOK key (never accepts key in body in prod).
 * Simplified CoT orchestration ported for Worker.
 */

import { loadDecryptedApiKey } from './credentials.mjs';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const OPENAI_BASE = 'https://api.openai.com/v1';

function resolveProvider(apiKey) {
  const isOpenRouter = String(apiKey || '').startsWith('sk-or-');
  return {
    baseURL: isOpenRouter ? OPENROUTER_BASE : OPENAI_BASE,
    models: isOpenRouter
      ? { fast: 'openai/gpt-4o-mini', default: 'openai/gpt-4o' }
      : { fast: 'gpt-4o-mini', default: 'gpt-4o' },
    headers: isOpenRouter
      ? {
        'HTTP-Referer': 'https://sp-survey.org',
        'X-Title': 'SP-Survey-Platform',
      }
      : {},
  };
}

async function chatCompletion(apiKey, tier, messages, { json = false, env } = {}) {
  const { baseURL, models, headers } = resolveProvider(apiKey);
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      model: models[tier] || models.default,
      messages,
      temperature: 0.4,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(data?.error?.message || 'AI request failed'), {
      status: res.status || 502,
    });
  }
  return data.choices?.[0]?.message?.content || '';
}

function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

const INTENT_PROMPT = `Classify the user request for a survey builder.
Return JSON: {"intent":"generate"|"adjust"|"question","reason":"..."}.
- generate: create a new survey from scratch
- adjust: modify an existing surveyConfig
- question: ask about the survey without changing it`;

const GENERATE_PROMPT = `You are an expert survey designer for SP-Survey (spatial / media preference research).
Return JSON: {"message":"...","surveyConfig":{...}}.
surveyConfig must include title, description, pages[].elements[] with unique name and type.

Use the FULL type set when appropriate — not only text/rating:
- Standard: text, comment, radiogroup, checkbox, dropdown, boolean, rating, matrix, ranking, slidergroup, pointallocation, consent
- Image*: image, imagepicker, imageranking, imagerating, imageboolean, imagematrix, imageslidergroup, imagepointallocation, imageannotation
- Media*: mediadisplay, mediapicker, mediaranking, mediarating, mediaboolean, mediamatrix, mediaslidergroup, mediapointallocation
- Interactive: skillquestion with skillId from presets only

For image*/media*/skillquestion ALWAYS set:
  imageSelectionMode:"huggingface_random", choices:[], randomImageSelection:true, excludePreviouslyUsedImages:true
Leave choices empty (runtime fills from the project dataset). Never invent image URLs or API keys.

media* extras: mediaType ("any"|"image"|"video"|"audio"), mediaSlots:[], mediaPresentation:"stack".

skillquestion presets (required skillId + skillConfig; NEVER invent skillHtml on the survey):
- preset_image_preference_slider (imageCount/mediaCount 2) — pairwise A/B slider
- preset_image_preference_forced (2) — forced A/B click
- preset_best_worst_choice (4) — MaxDiff best/worst
- preset_emotion_color_picker (1)
- preset_video_moment_tag (1, mediaType video)
- preset_video_continuous_rating (1, mediaType video)
- preset_composite_blocks (1)

For custom interactions: use skill_save (MCP) with SPSkill.setAnswer + spskill-init, ONE task per skill,
then skillquestion + that skillId. Never pack 5 modes into one skill. Never parent.postMessage answer protocols.

Prefer imagerating / imagepicker / skillquestion for scene preference tasks.
Do not include API keys or credentials.`;

const ADJUST_PROMPT = `You are an expert survey designer for SP-Survey.
Given the current surveyConfig and user request, return JSON:
{"message":"...","surveyConfig":{...}} with the full updated config.
Keep existing question names stable unless renaming is requested.
You may add image*/media*/skillquestion types using the same sampling defaults as generate
(imageSelectionMode huggingface_random, choices:[], mediaSlots:[] for media*, preset_* skillId only).
Do not include API keys or credentials.`;

export async function handleAgentChat(env, userId, body) {
  const { apiKey } = await loadDecryptedApiKey(env, userId);
  const message = String(body?.message || '').trim();
  if (!message) {
    throw Object.assign(new Error('message is required'), { status: 400 });
  }

  const history = Array.isArray(body?.conversationHistory) ? body.conversationHistory.slice(-10) : [];
  const research = body?.researchContext || {};
  const researchBlock = research.topic || research.requirements
    ? `\nResearch context:\n- topic: ${research.topic || ''}\n- requirements: ${research.requirements || ''}\n- scenario: ${research.scenario || ''}`
    : '';

  const intentRaw = await chatCompletion(apiKey, 'fast', [
    { role: 'system', content: INTENT_PROMPT },
    { role: 'user', content: message },
  ], { json: true, env });
  const intentObj = extractJson(intentRaw) || { intent: body?.currentConfig ? 'adjust' : 'generate' };
  const intent = ['generate', 'adjust', 'question'].includes(intentObj.intent)
    ? intentObj.intent
    : (body?.currentConfig ? 'adjust' : 'generate');

  if (intent === 'question') {
    const answer = await chatCompletion(apiKey, 'default', [
      { role: 'system', content: 'Answer survey design questions helpfully. Do not return surveyConfig JSON unless asked.' },
      ...history,
      { role: 'user', content: `${message}${researchBlock}` },
    ], { env });
    return { success: true, intent, message: answer };
  }

  const system = (intent === 'generate' ? GENERATE_PROMPT : ADJUST_PROMPT) + researchBlock;
  const userContent = intent === 'adjust'
    ? `Current surveyConfig:\n${JSON.stringify(body.currentConfig || {})}\n\nUser request:\n${message}`
    : message;

  const raw = await chatCompletion(apiKey, 'default', [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: userContent },
  ], { json: true, env });

  const parsed = extractJson(raw);
  if (!parsed?.surveyConfig) {
    return {
      success: true,
      intent,
      message: parsed?.message || raw || 'Could not produce a surveyConfig.',
    };
  }

  return {
    success: true,
    intent,
    message: parsed.message || 'Updated survey draft.',
    surveyConfig: parsed.surveyConfig,
    researchContext: research,
  };
}

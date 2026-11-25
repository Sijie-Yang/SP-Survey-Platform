/**
 * The platform's own AI for SP-Scheme: the researcher describes a study (or
 * pastes an existing survey) and the Assistant model writes the index.html.
 *
 * The model only writes text. Whether the page is usable is decided by the
 * same deterministic check Studio runs on a dropped file
 * (src/lib/spSchemeImport.js); when that check finds problems, the problems
 * go back to the model for a fixed number of repair rounds, and the best page
 * is returned with whatever problems remain. Studio then shows it in the
 * normal import card, so nothing is imported without the researcher's click.
 */

import { strToU8 } from 'fflate';
import { buildSpSchemeText, readSpSchemeUpload } from '../../src/lib/spScheme.js';
import { prepareSpSchemeUpload, summarizeSpSchemeImport } from '../../src/lib/spSchemeImport.js';

export const MAX_REQUEST_CHARS = 20000;
export const MAX_CURRENT_HTML_CHARS = 200000;
export const MAX_REPAIR_ROUNDS = 2;
const MAX_OUTPUT_TOKENS = 32000;

const BUILT_IN_RULES = `

## How to answer here

You are the AI built into SP-Survey Studio. The researcher typed the request below into Studio; they cannot see code.
- Answer with the complete page only: one \`\`\`html block holding the whole index.html, nothing before or after it.
- The page must work on its own: no external scripts, stylesheets, fonts or CDNs; plain HTML, CSS and JavaScript inline.
- Do not hard-code image URLs. Declare the media folders the study needs; the researcher uploads the images afterwards.
- Write what participants read in the language the researcher writes in, unless they ask for another language.
- Keep it simple and tidy: a clear welcome with consent, the tasks, and a short end. Works on phones.
- If the researcher pasted an existing survey, keep its questions and wording and fit it to SP-Scheme.`;

function fail(message, status = 400, code = 'BAD_REQUEST') {
  return Object.assign(new Error(message), { status, code });
}

export function normalizeGenerateRequest(body = {}) {
  const request = String(body?.request || '').trim();
  if (!request) throw fail('Describe the study you want first.');
  if (request.length > MAX_REQUEST_CHARS) {
    throw fail(`The description is too long (over ${MAX_REQUEST_CHARS} characters). Shorten it or attach the survey as a file to your own AI.`);
  }
  const currentHtml = typeof body?.currentHtml === 'string' ? body.currentHtml : '';
  if (currentHtml.length > MAX_CURRENT_HTML_CHARS) {
    throw fail('The current page is too large for the built-in AI to edit.');
  }
  return { request, currentHtml };
}

/** The page inside the model's answer: the ```html block, or the bare document. */
export function extractHtml(text) {
  const raw = String(text || '');
  const fences = [...raw.matchAll(/```(?:html|HTML)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const fenced = fences.sort((a, b) => b.length - a.length)[0];
  const source = fenced && /<html[\s>]/i.test(fenced) ? fenced : raw;
  const start = source.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) return '';
  const end = source.toLowerCase().lastIndexOf('</html>');
  const html = end > start ? source.slice(start, end + '</html>'.length) : source.slice(start);
  return html.trim();
}

/** Studio's import check on a page, in the JSON-safe summary shape. */
export function checkGeneratedPage(html) {
  try {
    const prepared = prepareSpSchemeUpload(readSpSchemeUpload(strToU8(html)), { name: 'index.html' });
    return summarizeSpSchemeImport(prepared);
  } catch (error) {
    return { ok: false, asIs: true, problems: [{ path: '', message: error?.message || String(error) }] };
  }
}

/** Lower is better: unusable pages first, then pages imported as-is, then the problem count. */
export function pageScore(summary) {
  if (!summary) return Infinity;
  return (summary.ok ? 0 : 1000) + (summary.asIs ? 100 : 0) + (summary.problems?.length || 0);
}

const NOT_SP_SCHEME = {
  path: 'index.html',
  message: 'The page is not SP-Scheme yet: embed the survey JSON (<script type="application/json" id="sp-scheme">) declaring every question, record every answer with SPSite.answer(...) and finish with SPSite.complete().',
};

/**
 * What still has to change: the check's problems, and for a page that would be
 * imported as-is (or declares no questions) also why, so the model can fix it.
 */
export function pageFixList(summary) {
  const list = [...(summary?.problems || [])];
  if (summary?.asIs || summary?.matchLevel === 'none') {
    list.push(NOT_SP_SCHEME);
    for (const warning of summary?.warnings || []) list.push(warning);
  }
  return list;
}

function problemsMessage(problems) {
  return [
    'The platform checked your page and found these problems:',
    ...problems.slice(0, 30).map((p) => `- ${p.message}${p.path ? ` (${p.path})` : ''}`),
    '',
    'Fix all of them and answer with the complete corrected index.html in one ```html block.',
  ].join('\n');
}

export function buildFirstMessage({ request, currentHtml }) {
  if (!currentHtml) return request;
  return [
    'Here is the current index.html of this study:',
    '```html',
    currentHtml,
    '```',
    '',
    'Change it as follows and answer with the complete updated index.html:',
    request,
  ].join('\n');
}

async function resolveModelCall(env, userId, deps) {
  const credentials = deps.credentials || await import('./credentials.mjs');
  const subsidyLib = deps.subsidy || await import('./subsidy.mjs');
  const registry = deps.registry || await import('./runtime/registry.mjs');
  const validators = deps.validators || await import('./runtime/validators.mjs');

  const settings = await credentials.loadUserAiSettings(env, userId);
  const profiles = await credentials.listProviderProfiles(env, userId);
  const candidates = [];
  const ownProvider = settings.assistant_provider || settings.default_provider || '';
  if (ownProvider) {
    const profile = profiles.find((row) => row.provider === ownProvider) || {};
    try {
      candidates.push({ provider: ownProvider, model: registry.availableModelId(ownProvider, settings.assistant_model, { profile }) });
    } catch {
      // An unknown or removed provider: fall through to the shared model.
    }
  }
  // No model of their own: the platform's shared (free) model, if the admin opened one.
  const subsidy = await subsidyLib.loadActiveSubsidy(env);
  for (const route of subsidyLib.normalizeSubsidyRoutes(subsidy?.allowed_routes)) {
    candidates.push(route);
  }

  for (const { provider, model } of candidates) {
    if (!provider || !model) continue;
    let binding;
    try {
      binding = await credentials.resolveAssistantBinding(env, userId, provider, model, { receiverProfiles: profiles });
    } catch (error) {
      if (error?.code === 'CREDENTIALS_MISSING') continue;
      throw error;
    }
    if (!binding?.credential?.apiKey) continue;
    const profile = binding.profile || {};
    const checked = validators.assertRoute({ provider, model, profile, requireConfigured: true, credential: binding.credential });
    const modelRecord = registry.resolveModel(provider, model, profile);
    return { provider, model, binding, checked, modelRecord };
  }
  throw fail('No AI model is available right now. Add your own model and key in AI & Integrations, or use your own AI with the copied instructions.', 400, 'CREDENTIALS_MISSING');
}

/**
 * Write (or change) a study page. Returns the best page found and Studio's
 * check of it; `rounds` counts the model calls.
 */
export async function handleSpSchemeGenerate(env, userId, body, deps = {}) {
  const input = normalizeGenerateRequest(body);
  const call = await resolveModelCall(env, userId, deps);
  const chat = deps.chatCompletions || (await import('./runtime/providers.mjs')).chatCompletions;

  const messages = [
    { role: 'system', content: buildSpSchemeText() + BUILT_IN_RULES },
    { role: 'user', content: buildFirstMessage(input) },
  ];
  let best = null;
  let rounds = 0;
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round += 1) {
    rounds += 1;
    const result = await chat({
      apiKey: call.binding.credential.apiKey,
      provider: call.provider,
      baseUrl: call.checked.route.baseUrl,
      model: call.model,
      modelRecord: call.modelRecord,
      protocol: call.checked.route.protocol,
      compat: call.modelRecord?.compat,
      extra: call.checked.route.headers,
      temperature: 0.2,
      maxTokens: Math.min(Number(call.modelRecord?.maxTokens) || MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
      messages,
    });
    const answer = String(result?.content || '');
    const html = extractHtml(answer);
    const summary = html
      ? checkGeneratedPage(html)
      : { ok: false, asIs: true, problems: [{ path: '', message: 'The answer did not contain an HTML page.' }] };
    if (html && (!best || pageScore(summary) < pageScore(best.summary))) best = { html, summary };
    const fixes = pageFixList(summary);
    if ((summary.ok && !fixes.length) || round === MAX_REPAIR_ROUNDS) break;
    messages.push({ role: 'assistant', content: answer.slice(0, 200000) || '(empty answer)' });
    messages.push({ role: 'user', content: problemsMessage(fixes) });
  }
  if (!best) {
    throw fail('The AI did not return a page. Try again, or describe the study in a few more words.', 502, 'GENERATE_EMPTY');
  }
  return {
    success: true,
    provider: call.provider,
    model: call.model,
    shared: call.binding.source === 'subsidy',
    rounds,
    html: best.html,
    check: {
      ok: best.summary.ok,
      asIs: best.summary.asIs,
      matchLevel: best.summary.matchLevel || 'none',
      problems: pageFixList(best.summary),
    },
  };
}

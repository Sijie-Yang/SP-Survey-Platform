/**
 * Convert an existing survey web page into an SP-Scheme site with the
 * Assistant model (the free route when the user has no key of their own).
 *
 * The model does not rewrite the page. It returns the questions as native
 * SP-Survey types, a small adapter script and exact find/replace patches.
 * The browser applies them and runs the normal SP-Scheme validation, so
 * nothing the model returns is trusted until it passes those checks.
 */

const MAX_HTML_CHARS = 200000;
const MAX_REFERENCE_CHARS = 80000;
const MAX_PREVIOUS_CHARS = 200000;
const MAX_DATA_CHARS = 150000;
const MAX_MEDIA_FILES = 3000;

function extractJson(text) {
  if (!text) return null;
  const raw = String(text).trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  for (const candidate of [raw, fenced?.[1]]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate.trim());
    } catch {
      /* try the next candidate */
    }
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(raw.slice(first, last + 1));
  } catch {
    return null;
  }
}

export const CONVERT_SYSTEM_PROMPT = `You convert an existing survey web page so it runs on SP-Survey without losing its design.
The REFERENCE (SP-Scheme) explains native question types, answer shapes and the SPSite API. Follow it exactly.

The page will run inside SP-Survey with window.SPSite already defined before any page script. You do NOT rewrite the page. You return JSON only, no prose:
{
  "survey": { "title": "...", "description": "...", "pages": [ { "name": "page1", "elements": [ ... ] } ] },
  "adapterScript": "JavaScript run at the end of <body>",
  "replacements": [ { "find": "exact text copied from the page", "replace": "new text" } ],
  "externalHosts": [ { "host": "api.example.com", "why": "loads the question list" } ],
  "originalImages": [ { "url": "https://...", "note": "stimulus for q3" } ],
  "notes": [ "short sentence for the researcher" ],
  "mediaGroups": [ { "folder": "occupancy_activity", "files": [ "images/IMG0279.jpg" ] } ]
}

Rules:
1. survey: declare every answer the page collects as a question (unique snake_case name, title = the wording on the page, choices with the page's own values, isRequired where the page requires it). Use a native type from the REFERENCE when the page's value fits its answer shape exactly (the researcher then gets the platform's analysis); when nothing fits, declare "type": "custom" and pass the page's own value as is (any JSON; stored and exported, not analysed). Never force a value into a native type it does not fit, and never leave out something the page records. Display-only text needs no question. Never put URLs, HTML or credentials in the survey.
2. Images or clips that participants judge (stimuli): declare them on an image/media question type with platform sampling (no URLs) and, in the adapter, put question.media[i].url (or question.trials[t].media) into the page's existing <img>/<video> elements inside SPSite.onReady. List the page's original stimulus URLs in originalImages so the researcher can upload them to the media pool. Logos and decoration stay as they are.
3. adapterScript connects the page to SPSite without changing its look:
   - Prefer listening to the page's own inputs (change/click) and calling SPSite.answer(name, value) with the value shape from the REFERENCE.
   - The page's old way of sending results (fetch/XMLHttpRequest/sendBeacon POST, form submit, Google Forms, Apps Script, Firebase, Supabase, Formspree, etc.) is intercepted by the platform: it never leaves the page, the call resolves as a success, and the payload arrives in SPSite.onSubmit(function (item) { item.kind, item.url, item.method, item.data }). Use onSubmit to map any remaining fields onto SPSite.answer, then call SPSite.complete(). Await every SPSite.answer before complete.
   - When the page ends (its last submit or thank-you step) call SPSite.complete() exactly once.
   - Pages that expect their own server (relative URLs such as fetch('/api/state'), '/api/save', '/image/<id>'): the page has no server on SP-Survey. Emulate it with SPSite.onRequest(function (req) { ... }) where req = { url (path + query for same-page URLs, full URL otherwise), method, data, headers }. Return { json: ... } (or { status, json }) to answer; return nothing to leave the request blocked. Build every response from SPSite.getQuestions(): for example answer the page's "state/config" request with its tasks, options and image list made from the questions and question.trials[t].media, and its "save" request by calling SPSite.answer(...) (return the shape the page expects, e.g. { answer: { value } }), and its "complete/finish" request by awaiting SPSite.complete(). Answer heartbeat/ping requests with { json: { ok: true } }. Handlers may return a Promise.
   - Images the page loads by URL from its own server (img.src = '/image/' + id) do not exist on SP-Survey: use a replacement so the page takes the URL from the question media instead (for example keep a map id -> media url built in onRequest).
   - The page's own scripts start before adapterScript runs; requests they make at start-up wait until onRequest handlers are registered, so register them at the top level of adapterScript (not inside onReady). Every handler must settle quickly: SPSite.getQuestions() is available synchronously, so never wait for window "load", a timer, a user action or any event that may already have fired. A request left unanswered for 15 s fails, and the platform loads the converted page once to check this; problems it finds come back as FEEDBACK lines starting "When the page loads:".
   - Use plain ES2017 that runs in a browser, no imports. Keep it under 300 lines.
4. replacements: only when the adapter cannot do the job (for example removing a hard-coded API key, or a script that would break). Each "find" must be copied exactly from the page and be unique. Never replace large blocks. Strings like data:sp-token/3 stand for embedded images; keep them unchanged.
5. externalHosts: every host the page needs at run time for loading things (questions, config, scripts or styles not on cdn.jsdelivr.net, cdnjs.cloudflare.com, unpkg.com, cdn.tailwindcss.com, esm.sh or Google Fonts). Hosts that only received the results do not need to be listed, because results go through SPSite.
6. Remove any secret (API key, token, password) you find with a replacement and say so in notes.
7. DATA FILES (config, question lists, CSV) that came with the page tell you the real tasks, wording, options and images; use them instead of guessing. When the page loads its wording from a server and no data file gives it, keep the structure the code implies, write the most likely wording, and say in notes exactly what was guessed.
8. MEDIA FILES, when given, are the study's own files that came with the page (stimuli, logos); the platform uploads them to the project's media library on import, in folders that mirror the zip exactly (images/IMG0279.jpg -> folder "images", app/logo.png -> folder "app"). You do not regroup them (mediaGroups may stay empty). KEEP THE PAGE'S OWN DRAWING LOGIC: in the adapter replace the page's source of its image list (its config, data file or server answer) with SPSite.getMedia("<folder>") -> [{ url, name, type }] for the zip folder, and apply the page's own assignment (for example config.json's image-to-task mapping, matched by file name) to those files, so its sampling, grouping, pairing and ordering stay as they are. Record each answer with SPSite.answer(name, value, { key: <the page's item id>, shown: [<file names shown>] }); do not set trialCount or per-question mediaFolders for such questions. Only when the page has no drawing logic of its own (a fixed list), use platform drawing instead: "mediaFolders": ["<zip folder>"] on the question, "imageCount" per round and "trialCount" rounds, reading question.trials[t].media. Same-site URLs the page builds from a file name ("/image/" + id, "/logo.png") are mapped by the platform to the uploaded file of that name, so they may stay.
9. If FEEDBACK is given, it lists problems with your PREVIOUS answer after it was applied and checked. Return a complete corrected JSON, not a diff.`;

function clip(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function normalizeConvertRequest(body) {
  if (body?.apiKey) {
    throw Object.assign(new Error('Do not send apiKey in body. Store it via AI & Integrations.'), { status: 400 });
  }
  const html = typeof body?.html === 'string' ? body.html : '';
  if (!html.trim()) {
    throw Object.assign(new Error('Upload the survey page to convert.'), { status: 400, code: 'NOTHING_TO_CONVERT' });
  }
  if (html.length > MAX_HTML_CHARS) {
    throw Object.assign(new Error(`The page is too long to convert (${html.length} characters; the limit is ${MAX_HTML_CHARS}).`), {
      status: 413,
      code: 'PAGE_TOO_LARGE',
    });
  }
  const feedback = Array.isArray(body?.feedback)
    ? body.feedback.filter((item) => typeof item === 'string').slice(0, 30).map((item) => item.slice(0, 600))
    : [];
  let previous = null;
  if (body?.previous && typeof body.previous === 'object') {
    const text = JSON.stringify(body.previous);
    if (text.length <= MAX_PREVIOUS_CHARS) previous = text;
  }
  let dataBudget = MAX_DATA_CHARS;
  const dataFiles = (Array.isArray(body?.dataFiles) ? body.dataFiles : [])
    .filter((file) => file && typeof file.name === 'string' && typeof file.text === 'string')
    .slice(0, 20)
    .map((file) => {
      const text = file.text.slice(0, Math.max(0, dataBudget));
      dataBudget -= text.length;
      return { name: file.name.slice(0, 200), text };
    })
    .filter((file) => file.text);
  const mediaFiles = (Array.isArray(body?.mediaFiles) ? body.mediaFiles : [])
    .filter((path) => typeof path === 'string' && path && path.length <= 300)
    .slice(0, MAX_MEDIA_FILES);
  return {
    html,
    dataFiles,
    mediaFiles,
    reference: clip(body?.reference, MAX_REFERENCE_CHARS),
    notes: clip(body?.notes, 2000),
    feedback,
    previous,
  };
}

/** Keep only the fields the client applies, with the expected types. */
export function normalizeConvertResult(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const survey = parsed.survey && typeof parsed.survey === 'object' ? parsed.survey : null;
  if (!survey || !Array.isArray(survey.pages)) return null;
  const list = (value) => (Array.isArray(value) ? value : []);
  return {
    survey,
    adapterScript: typeof parsed.adapterScript === 'string' ? parsed.adapterScript : '',
    replacements: list(parsed.replacements)
      .filter((item) => item && typeof item.find === 'string' && item.find && typeof item.replace === 'string')
      .slice(0, 40)
      .map((item) => ({ find: item.find, replace: item.replace })),
    externalHosts: list(parsed.externalHosts)
      .map((item) => (typeof item === 'string' ? { host: item } : item))
      .filter((item) => item && typeof item.host === 'string')
      .slice(0, 20)
      .map((item) => ({ host: item.host.slice(0, 200), why: clip(item.why, 200) })),
    originalImages: list(parsed.originalImages)
      .map((item) => (typeof item === 'string' ? { url: item } : item))
      .filter((item) => item && typeof item.url === 'string')
      .slice(0, 200)
      .map((item) => ({ url: item.url.slice(0, 2000), note: clip(item.note, 200) })),
    notes: list(parsed.notes).filter((item) => typeof item === 'string').slice(0, 12).map((item) => item.slice(0, 400)),
    mediaGroups: list(parsed.mediaGroups)
      .filter((group) => group && typeof group.folder === 'string' && Array.isArray(group.files))
      .slice(0, 50)
      .map((group) => ({
        folder: group.folder.slice(0, 120),
        files: group.files.filter((file) => typeof file === 'string').slice(0, MAX_MEDIA_FILES).map((file) => file.slice(0, 300)),
      })),
  };
}

export async function handleSpSchemeConvert(env, userId, body, deps = {}) {
  const input = normalizeConvertRequest(body);

  const credentials = deps.loadUserAiSettings ? null : await import('./credentials.mjs');
  const loadSettings = deps.loadUserAiSettings || credentials.loadUserAiSettings;
  const listProfiles = deps.listProviderProfiles || credentials.listProviderProfiles;
  const resolveBinding = deps.resolveAssistantBinding || credentials.resolveAssistantBinding;
  const settings = await loadSettings(env, userId);
  const profiles = await listProfiles(env, userId);
  const provider = settings.assistant_provider || settings.default_provider || 'deepseek';
  const profile = profiles.find((row) => row.provider === provider) || {};
  const binding = await resolveBinding(env, userId, provider, settings.assistant_model || '', { receiverProfiles: profiles });
  const credential = binding?.credential;
  if (!credential?.apiKey) {
    throw Object.assign(new Error('No Assistant model is available for conversion. Add a model and key in AI & Integrations.'), {
      status: 400,
      code: 'CREDENTIALS_MISSING',
    });
  }
  const { availableModelId, resolveModel } = await import('./runtime/registry.mjs');
  const { assertRoute } = await import('./runtime/validators.mjs');
  const chat = deps.chatCompletions || (await import('./runtime/providers.mjs')).chatCompletions;
  const model = availableModelId(provider, settings.assistant_model, { profile });
  const checked = assertRoute({ provider, model, profile, requireConfigured: true, credential });
  const modelRecord = resolveModel(provider, model, profile);

  const parts = [];
  if (input.reference) parts.push(`REFERENCE (SP-Scheme)\n${input.reference}`);
  if (input.notes) parts.push(`RESEARCHER NOTES\n${input.notes}`);
  parts.push(`PAGE (index.html)\n${input.html}`);
  input.dataFiles.forEach((file) => parts.push(`DATA FILE ${file.name}\n${file.text}`));
  if (input.mediaFiles.length) parts.push(`MEDIA FILES (${input.mediaFiles.length})\n${input.mediaFiles.join('\n')}`);
  if (input.previous) parts.push(`PREVIOUS\n${input.previous}`);
  if (input.feedback.length) parts.push(`FEEDBACK\n- ${input.feedback.join('\n- ')}`);

  const result = await chat({
    apiKey: credential.apiKey,
    provider,
    baseUrl: checked.route.baseUrl,
    model,
    modelRecord,
    protocol: checked.route.protocol,
    compat: modelRecord?.compat,
    extra: checked.route.headers,
    temperature: 0.1,
    maxTokens: Math.min(Number(modelRecord?.maxTokens) || 8192, 16384),
    messages: [
      { role: 'system', content: CONVERT_SYSTEM_PROMPT },
      { role: 'user', content: parts.join('\n\n') },
    ],
  });
  const converted = normalizeConvertResult(extractJson(result?.content));
  if (!converted) {
    throw Object.assign(new Error('The model did not return a usable conversion. Try again, or convert the page with SP-Scheme in another model.'), {
      status: 502,
      code: 'CONVERT_UNPARSEABLE',
    });
  }
  return { success: true, provider, model, result: converted };
}

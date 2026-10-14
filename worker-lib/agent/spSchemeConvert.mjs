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

/**
 * The model's answer: a json block with the questions and a javascript block
 * with the adapter. Code is kept out of JSON because small models often break
 * its escaping. An answer that is one JSON object (adapterScript inside) still
 * works.
 */
export function parseConvertAnswer(text) {
  const raw = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const blocks = [...raw.matchAll(/```([a-z]*)[^\n]*\n([\s\S]*?)(?:```|$)/gi)].map((m) => ({ lang: m[1].toLowerCase(), body: m[2] }));
  const code = blocks.find((b) => /^(javascript|js)$/.test(b.lang));
  const jsonBlock = blocks.find((b) => b.lang === 'json') || blocks.find((b) => !b.lang && /^\s*\{/.test(b.body));
  let parsed = extractJson(jsonBlock ? jsonBlock.body : raw);
  if (!parsed && code) parsed = extractJson(raw.slice(0, raw.indexOf(code.body)));
  if (!parsed) return null;
  if (code && code.body.trim()) parsed.adapterScript = code.body.trim();
  if (parsed.survey && !Array.isArray(parsed.survey.pages)) parsed.survey.pages = [];
  return parsed;
}

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

export const CONVERT_SYSTEM_PROMPT = `You connect an existing survey web page to SP-Survey. The platform has already done the rest:
- The page runs exactly as it is, in a sandbox, with window.SPSite defined before any page script. You do not edit the page.
- The study's files (MEDIA FILES) are in the project's media library, in the upload's own folders (images/IMG0279.jpg -> folder "images"). Any same-site URL that ends in a known file name ("/image/IMG0279?x=1", "logo.png") is mapped to that file automatically.
- Every request the page sends that nobody answers is recorded as it is, so no data is lost.

Your only job is the data interface. Reply with exactly two fenced blocks and nothing else. First the questions as JSON (no code inside it):
\`\`\`json
{ "survey": { "title": "...", "mediaFolders": ["<folder>"], "pages": [ { "name": "page1", "elements": [ ... ] } ] }, "notes": [ "short sentence for the researcher" ] }
\`\`\`
Then the adapterScript as plain JavaScript (not inside JSON, no escaping):
\`\`\`javascript
// adapterScript
\`\`\`

survey: one element per answer the page records (unique snake_case name, title = the page's wording). Use a type from the REFERENCE when the value fits its answer shape exactly; otherwise "type": "custom" (any JSON, stored as is, not analysed). Rating one image on a few labelled options is "imagerating" with "imageCount": 1, "rateMin"/"rateMax" covering the values and "rateLabels". Do not set mediaFolders, imageCount draws or trialCount on questions: the page keeps its own image logic. survey.mediaFolders lists the MEDIA FILES folders the page shows images from.

adapterScript stands in for the page's own server (see its server code and DATA FILES) and does nothing else:
- SPSite.onRequest(function (req) { ... }) answers the page's requests; req = { url (path + query), method, data, headers }. Return { json: ... } in exactly the shape the page's code reads, or nothing to leave it unanswered. Register it at the top level, never inside a callback. Every handler returns at once or a Promise that settles quickly.
- DATA FILES (.json/.csv/.txt) are available at run time: SPSite.getData("config.json") returns the parsed JSON (other files as text). When the page's server answered with a data file (or part of it), return that data AS IT IS from SPSite.getData, never rebuilt or reordered by hand: the page checks its structure. Only add what the server added (for example saved answers, start empty: {}).
- Image file names and ids in that data stay as they are; the page's image URLs are mapped to the uploaded files automatically.
- Only when there is no data file to return, build lists of images from SPSite.getMedia("<folder>") -> [{ url, name, type }] combined with the page's own config (its task list, image assignment, order rules), so the page's randomisation stays its own. Image ids are file names without extension.
- When the page saves an answer, call SPSite.answer(name, value, { key: <item id>, shown: [<file name shown>] }) and return what the page expects; when it finishes, await SPSite.complete().
- A page with no server that posts its results elsewhere: SPSite.onSubmit(function (item) { item.url, item.method, item.data }) maps the payload to SPSite.answer, then SPSite.complete().
- Plain ES2017, no imports, no DOM changes, under 200 lines. Never include secrets.

If the page needs no server and records nothing you can map, return an empty pages list and an empty javascript block: the platform then records what the page sends.`;

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
  const converted = normalizeConvertResult(parseConvertAnswer(result?.content));
  if (!converted) {
    const head = String(result?.content || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    throw Object.assign(new Error(`The model did not return a usable conversion${head ? ` (it began: "${head}")` : ' (its answer was empty)'}.`), {
      status: 502,
      code: 'CONVERT_UNPARSEABLE',
    });
  }
  return { success: true, provider, model, result: converted };
}

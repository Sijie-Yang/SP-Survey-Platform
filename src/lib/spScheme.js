/**
 * SP-Scheme: a copyable context document that lets any external LLM design an
 * SP-Survey study, plus the validator/importer for the package it returns.
 *
 * The LLM may invent any interaction, but stimuli, question wording and answer
 * recording must follow the platform contract so Results Analysis, export and
 * Silicon Samples keep working. Pure module except applySpSchemePackage, which
 * receives its save function from the caller.
 */

import { DESIGN_CAPABILITIES } from './designProtocol/capabilities';
import { listGenerationContracts, listPresetSkillContracts } from './designProtocol/generationContracts';
import { findSecretFields } from './designProtocol/secrets';
import { postProcessAiConfig, normalizeBuilderSurveyJson } from './designProtocol/normalize';
import { validateSurveyConfig } from './designProtocol/validate';
import { prepareSkillForSave } from './skillHtmlValidate';
import { NATIVE_SKILL_RESULT_TYPE_IDS, skillResultTypesCatalogText } from './skillResultTypes';
import { getPresetSkill } from './presetSkills';
import { questionHasTrait } from './platformSchema';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export const SP_SCHEME_VERSION = '1.0';
export const SP_SCHEME_FORMAT = 'sp-scheme-package';
const CUSTOM_PREFIX = 'custom:';
const PLACEHOLDER_PREFIX = 'skill_pkg_';
const REF_RE = /^[a-z][a-z0-9_]{1,47}$/;

// Agent/MCP-only rules (draft concurrency, publishing tools) do not apply to a pasted package.
const MCP_ONLY_RULE = /expectedDraftUpdatedAt|survey_publish|Publish to Main Page|deterministic operations|media_import_from_template|skill_list/;

const PREVIEW_SHIM_START = '<!-- sp-preview-shim:start -->';
const PREVIEW_SHIM_END = '<!-- sp-preview-shim:end -->';

/**
 * Lets an interaction run on its own in a model's preview (Claude artifact,
 * ChatGPT canvas, a local browser): placeholder images, demo config, and an
 * on-screen readout of what SPSkill.setAnswer would record. Removed on import;
 * the platform SDK replaces it at runtime.
 */
export const SP_PREVIEW_SHIM = `${PREVIEW_SHIM_START}
<script>
(function () {
  if (window.SPSkill) return;
  var cfg = window.SP_PREVIEW_CONFIG || {};
  var n = Number(cfg.mediaCount) || 4;
  var colors = ['#8fb3d9', '#d9a38f', '#9fd98f', '#d9cf8f', '#b38fd9', '#8fd9cf'];
  var images = [];
  for (var i = 0; i < n; i += 1) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="' + colors[i % colors.length] + '"/><text x="320" y="225" font-size="44" text-anchor="middle" fill="#222" font-family="sans-serif">Image ' + (i + 1) + '</text></svg>';
    images.push({ name: 'image_' + (i + 1) + '.jpg', url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), type: 'image' });
  }
  var value = null;
  function show(v) {
    var box = document.getElementById('sp-preview-answer');
    if (!box) {
      box = document.createElement('pre');
      box.id = 'sp-preview-answer';
      box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;max-height:30vh;overflow:auto;margin:0;padding:8px;background:#111;color:#9f9;font:12px monospace;border-radius:6px;opacity:.92;z-index:99999';
      document.body.appendChild(box);
    }
    box.textContent = 'Recorded answer (preview): ' + JSON.stringify(v, null, 2);
  }
  window.SPSkill = {
    __spPreview: true,
    getConfig: function () { return cfg; },
    getImages: function () { return images; },
    getValue: function () { return value; },
    setAnswer: function (v) { value = v; show(v); },
    ready: function () {}
  };
  setTimeout(function () {
    if (!window.SPSkill || !window.SPSkill.__spPreview) return;
    document.dispatchEvent(new CustomEvent('spskill-init', { detail: { config: cfg, images: images, value: null }, bubbles: true }));
  }, 300);
})();
</script>
${PREVIEW_SHIM_END}`;

const EXAMPLE_INTERACTION_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script>window.SP_PREVIEW_CONFIG = { prompt: 'Tap the safer street', mediaCount: 2 };</script>
${'__SHIM__'}
<style>body{font-family:sans-serif;margin:0;padding:8px}#row{display:flex;gap:8px}button{flex:1;padding:0;border:3px solid transparent;border-radius:8px;background:none}button[aria-pressed=true]{border-color:#1976d2}img{width:100%;display:block;border-radius:6px}</style>
</head><body>
<div id="app"><p id="p"></p><div id="row"></div></div>
<script>
document.addEventListener('spskill-init', function (e) {
  var cfg = e.detail.config || {};
  var imgs = (e.detail.images || []).slice(0, 2);
  var urls = imgs.map(function (m) { return m.url; });
  document.getElementById('p').textContent = cfg.prompt || '';
  var row = document.getElementById('row');
  row.innerHTML = '';
  imgs.forEach(function (m) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    var i = document.createElement('img');
    i.src = m.url;
    i.alt = m.name || 'street';
    b.appendChild(i);
    b.onclick = function () {
      row.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      SPSkill.setAnswer({ choice: { shownUrls: urls, winner: m.url } });
    };
    row.appendChild(b);
  });
});
</script>
</body></html>
`.replace('__SHIM__', SP_PREVIEW_SHIM);

const EXAMPLE_PACKAGE = {
  format: SP_SCHEME_FORMAT,
  spScheme: SP_SCHEME_VERSION,
  survey: {
    title: 'Street perception study',
    description: 'You will see street images and answer a few questions. About 5 minutes.',
    locale: 'en',
    pages: [
      {
        name: 'consent_page',
        title: 'Consent',
        elements: [
          { type: 'consent', name: 'consent', title: 'I agree to take part in this study', isRequired: true },
        ],
      },
      {
        name: 'swipe_page',
        title: 'Which street feels safer?',
        description: 'Tap the street that feels safer to walk alone at night.',
        elements: [
          {
            type: 'skillquestion',
            name: 'safety_duel',
            title: 'Which street feels safer?',
            skillId: 'custom:safety_duel',
            skillConfig: { prompt: 'Tap the safer street', mediaCount: 2, mediaType: 'image' },
            imageCount: 2,
            imageSelectionMode: 'huggingface_random',
            randomImageSelection: true,
            excludePreviouslyUsedImages: true,
            trialCount: 5,
            isRequired: true,
          },
          {
            type: 'imageslidergroup',
            name: 'scene_scales',
            title: 'Rate this street',
            imageCount: 1,
            imageSelectionMode: 'huggingface_random',
            randomImageSelection: true,
            scaleMin: 1,
            scaleMax: 7,
            dimensions: [
              { id: 'safety', label: 'Safety', left: 'Very unsafe', right: 'Very safe' },
              { id: 'lively', label: 'Liveliness', left: 'Dull', right: 'Lively' },
            ],
          },
        ],
      },
    ],
  },
  customInteractions: [
    {
      ref: 'safety_duel',
      name: 'Safety duel',
      description: 'Two streets side by side; tap the one that feels safer.',
      file: 'interactions/safety_duel.html',
      configSchema: [{ key: 'prompt', label: 'Instruction', type: 'string' }],
      defaultConfig: { prompt: 'Tap the safer street', mediaCount: 2, mediaType: 'image' },
      resultSchema: [{ key: 'choice', label: 'Chosen street', type: 'pairwiseChoice' }],
      exampleAnswer: {
        choice: { shownUrls: ['https://media.example/a.jpg', 'https://media.example/b.jpg'], winner: 'https://media.example/a.jpg' },
      },
    },
  ],
};

function compactJson(value) {
  return JSON.stringify(value);
}

function questionCatalogLines() {
  return listGenerationContracts().map((c) => {
    const required = (c.requiredFields || []).filter((f) => !['type', 'name'].includes(f));
    const parts = [
      `- \`${c.type}\` — ${c.useWhen || c.label || c.type}`,
      `answer: ${c.answerShape || 'unknown'}`,
      c.media?.stimulus ? 'media: drawn by the platform' : null,
      required.length ? `required: ${required.join(', ')}` : null,
    ].filter(Boolean);
    const example = c.minimumExample ? `\n  example: \`${compactJson(c.minimumExample)}\`` : '';
    return parts.join(' · ') + example;
  }).join('\n');
}

function presetLines() {
  return listPresetSkillContracts().map((p) => (
    `- \`${p.skillId}\` — ${p.useWhen}; answer family ${p.answerShape}; set imageCount=${p.imageCount}; `
    + `skillConfig keys: ${Object.keys(p.skillConfig || {}).join(', ')}`
  )).join('\n');
}

/**
 * The SP-Scheme context document (Markdown). Written in English so every model
 * follows it precisely; participant-facing text follows `survey.locale`.
 */
export function buildSpSchemeText() {
  const rules = DESIGN_CAPABILITIES.rules.filter((rule) => !MCP_ONLY_RULE.test(rule));
  return `# SP-Scheme ${SP_SCHEME_VERSION} — design an SP-Survey study

You are helping a researcher design a perception survey for SP-Survey (https://sp-survey.org). The researcher may not be technical. The interface is yours to design: participants will see exactly the interactions you build and the researcher approves, not a standard form. Only how images are randomised, how questions are described and how answers are recorded MUST follow this scheme, otherwise the platform rejects the upload.

## 0. Workflow — follow these steps in order

**Step 1 · Understand the study.** Ask briefly for what you need: research question, what participants judge, language, how many images each person sees, roughly how long it should take. Suggest a design in plain language before writing code.

**Step 2 · Build a clickable prototype and let the researcher try it.** Make ONE self-contained HTML page called \`preview.html\` and show it in your preview / canvas / artifact view (or tell the researcher to open it in a browser). It walks through the whole survey page by page with Next/Back buttons:
- every question with a designed look or interaction (image comparisons, sliders, sorting, slides, games…) is a custom interaction (section 5): write it as its own \`interactions/<ref>.html\` file first, then embed that same file in preview.html (for example as an \`<iframe srcdoc>\`), working for real with placeholder images. What the researcher tries must be the very code that ships;
- plain form questions (consent, demographics, open text) may use native types (section 4), shown as simple mock-ups;
- under each question, the exact JSON that would be recorded, so the researcher can see what data they will get.
Ask the researcher to click through it on a phone-sized and a desktop-sized window. Change it until they say they are happy. Do NOT produce the package before the researcher confirms.

**Ship what was approved.** When packing, every question that has its own interface in the prototype MUST become a custom interaction whose HTML is exactly what the researcher tried. Never swap it for a native question type or a built-in task (\`preset_*\`) at packing time, even if one looks similar: the researcher approved your design, and custom interactions get the same platform analysis as the result family they record (for example \`pairwiseChoice\` gets the same TrueSkill ranking as the built-in A/B task). Use native types or built-in tasks only for plain form questions, or when the researcher explicitly asks for the standard platform version.

**Step 3 · Pack it as a zip.** When the researcher confirms, build \`<study-name>.zip\`:

\`\`\`
<study-name>.zip
├── sp-scheme.json            ← the survey and the list of custom interactions (section 1)
├── interactions/<ref>.html   ← one file per custom interaction (section 5)
└── preview.html              ← the prototype from step 2 (kept for reference, not imported)
\`\`\`

If you can run code, create the zip and give the researcher the download. If you cannot, give each file in its own code block with its file name, and tell the researcher: "make a folder, save these files into it with exactly these names, then compress the folder to a zip". Then tell them: in SP-Survey open Survey Builder → SP-Scheme → Upload package, choose the zip, read the check report, and click Import. The Builder checks the format and lists anything to fix; if it reports problems, the researcher will paste the list back to you, and you return a corrected zip.

## 1. sp-scheme.json

\`\`\`json
{
  "format": "${SP_SCHEME_FORMAT}",
  "spScheme": "${SP_SCHEME_VERSION}",
  "survey": { "title": "...", "description": "...", "locale": "en | zh", "pages": [ { "name": "...", "title": "...", "description": "...", "elements": [ /* questions */ ] } ] },
  "customInteractions": [ /* optional, see section 5 */ ]
}
\`\`\`

- Every question has a unique, stable \`name\` (lowercase, letters/digits/underscores). Choice, row, column and dimension ids must be unique within their question.
- Put the wording participants see in \`title\` and optional \`description\` (Markdown allowed) of pages and questions, in the survey's \`locale\` language.
- Start with a \`consent\` question when the study collects data from people.
- Do not include API keys, tokens, Supabase settings or any credential.

## 2. Stimuli and randomisation (platform-owned)

Images, videos and audio come from the researcher's project media pool. The platform draws them for each participant and records exactly what was shown. You never write media URLs into sp-scheme.json; placeholder images exist only in the preview.

- Default for every media question: \`"imageSelectionMode": "huggingface_random", "randomImageSelection": true, "excludePreviouslyUsedImages": true\` and leave \`choices\` empty.
- \`imageCount\` = how many files are drawn per presentation. \`trialCount\` = how many times the question repeats with a fresh draw (each trial is recorded separately).
- \`mediaAssignmentMode\`: \`individual\` (random files, default), \`set\` (one whole folder tagged set; imageCount must equal the folder size) or \`category\` (folders tagged category). \`mediaFolders\` optionally limits eligible folders.
- If the researcher must curate specific files, use \`"imageSelectionMode": "huggingface_manual"\` and tell them to pick the files in the Builder after import.
- Remind the researcher to upload their images to the project's Media Dataset before publishing.

## 3. Platform rules

${rules.map((rule) => `- ${rule}`).join('\n')}

## 4. Native question types

Native types render in the platform's standard form style. Use them for consent, demographics and other plain form questions, or when the researcher explicitly wants the standard version. They are not a replacement for an interface you designed in the prototype.

${questionCatalogLines()}

Built-in interactive tasks (use \`"type": "skillquestion"\` with this \`skillId\`):

${presetLines()}

## 5. Custom interactions (the default for anything you designed)

For every question with its own designed interface, write a self-contained HTML file \`interactions/<ref>.html\` and reference it from a question with \`"type": "skillquestion", "skillId": "custom:<ref>"\`. Slides, drag-and-drop, timed exposure, canvas, animation and games are all fine.

Each entry in \`customInteractions\`:

\`\`\`json
{
  "ref": "lowercase_id",
  "name": "Short name",
  "description": "What the participant does",
  "file": "interactions/lowercase_id.html",
  "configSchema": [{ "key": "prompt", "label": "Instruction", "type": "string" }],
  "defaultConfig": { "prompt": "...", "mediaCount": 2, "mediaType": "image" },
  "resultSchema": [{ "key": "answer_key", "label": "What is recorded", "type": "<one result family>" }],
  "exampleAnswer": { "answer_key": "<a valid value>" }
}
\`\`\`

(When you cannot make files at all, you may put the HTML in a \`"sourceHtml"\` string instead of \`"file"\` and deliver sp-scheme.json alone.)

Runtime contract:

- Initialise from \`document.addEventListener("spskill-init", e => { e.detail.config; e.detail.images })\` or \`SPSkill.getConfig()\` / \`SPSkill.getImages()\`. Images arrive as \`[{ name, url, type }]\`, already drawn by the platform; show only these.
- Record the answer with \`SPSkill.setAnswer({ <answer_key>: value })\` — always an object whose single key is the resultSchema key. Call it again whenever the answer changes. Never use parent.postMessage directly.
- The interaction runs in a sandboxed iframe with no network: no fetch/XHR, no CDN scripts or fonts, no forms, no nested frames, no camera or microphone. Inline all CSS and JS. Put content inside \`<div id="app">\` so height is measured.
- Make it work on a phone (≥360px wide) and by keyboard; give images alt text.
- One question records one answer. For repeated rounds use \`trialCount\` on the question instead of looping inside the HTML.
- No \`analysisHtml\`; analysis is done by the platform.

**Preview shim.** So the interaction also runs in your preview and in a plain browser, paste this block unchanged inside \`<head>\` of every interaction file (and of preview.html if it embeds interactions). Optionally set \`window.SP_PREVIEW_CONFIG = { ... }\` in a script just before it to try a config. It supplies placeholder images and shows the recorded answer on screen. The platform removes it on import and supplies the real SDK and images:

\`\`\`html
${SP_PREVIEW_SHIM}
\`\`\`

\`resultSchema\` must contain exactly ONE field whose \`type\` is one of these result families (declare its \`min\`/\`max\`, \`options\`, \`rows\`/\`columns\`, \`dimensions\` or \`budget\` as the family needs). \`exampleAnswer\` must satisfy it:

${skillResultTypesCatalogText({ nativeOnly: true })}

The question that uses a custom interaction sets \`imageCount\` (and \`skillConfig.mediaCount\`) to the number of media it needs, plus the media sampling fields from section 2. Its \`skillConfig\` overrides \`defaultConfig\`.

## 6. Example

sp-scheme.json:

\`\`\`json
${JSON.stringify(EXAMPLE_PACKAGE, null, 2)}
\`\`\`

interactions/safety_duel.html:

\`\`\`html
${EXAMPLE_INTERACTION_HTML.trim()}
\`\`\`

## 7. Self-check before packing

1. The researcher has tried the prototype and confirmed.
2. Every question that has its own interface in the prototype is packed as a custom interaction with that same HTML, not replaced by a native type or \`preset_*\` task.
3. sp-scheme.json is valid JSON with \`format\`, \`spScheme\`, \`survey.pages\`.
4. Question names are unique; every \`custom:<ref>\` has a matching \`customInteractions[].ref\` and file, and every interaction is used.
5. No media URLs in sp-scheme.json; media questions use platform sampling.
6. Every interaction calls \`SPSkill.setAnswer({...})\`, uses \`spskill-init\` or \`SPSkill.getConfig/getImages\`, has one resultSchema field from the list, and a matching exampleAnswer.
7. No external scripts, network calls or credentials.
`;
}

/** Remove the preview-only shim before the HTML is validated or saved. */
export function stripPreviewShim(html) {
  const text = String(html || '');
  const start = text.indexOf(PREVIEW_SHIM_START);
  if (start < 0) return text;
  const end = text.indexOf(PREVIEW_SHIM_END, start);
  if (end < 0) return text;
  return stripPreviewShim(text.slice(0, start) + text.slice(end + PREVIEW_SHIM_END.length));
}

const MAX_ZIP_BYTES = 10 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 25 * 1024 * 1024;
const MANIFEST_NAME = 'sp-scheme.json';

function isZipBytes(bytes) {
  return bytes?.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * Read an uploaded package: a .zip (sp-scheme.json + interactions/*.html) or a
 * bare sp-scheme.json / model reply. Interaction files are inlined as sourceHtml.
 * @param {Uint8Array} bytes
 * @returns {{ pkg: object, files: string[], hasPreview: boolean, fromZip: boolean }}
 */
export function readSpSchemeUpload(bytes) {
  if (!isZipBytes(bytes)) {
    return { pkg: parseSpSchemePackage(strFromU8(bytes)), files: [], hasPreview: false, fromZip: false };
  }
  if (bytes.length > MAX_ZIP_BYTES) throw new Error('The zip is larger than 10 MB. Media files do not belong in the package; upload them to the Media Dataset.');
  let total = 0;
  let entries;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store)/.test(file.name)) return false;
        total += file.originalSize || 0;
        if (total > MAX_UNZIPPED_BYTES) throw new Error('The zip expands to more than 25 MB.');
        return /\.(json|html?|md|txt)$/i.test(file.name);
      },
    });
  } catch (err) {
    throw new Error(/25 MB/.test(err.message) ? err.message : 'The zip could not be opened.');
  }
  const names = Object.keys(entries);
  // Zipping a folder nests everything one level down; find the manifest wherever it is.
  const manifest = names
    .filter((name) => name.split('/').pop().toLowerCase() === MANIFEST_NAME)
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!manifest) throw new Error(`The zip has no ${MANIFEST_NAME}.`);
  const root = manifest.slice(0, manifest.length - MANIFEST_NAME.length);
  const pkg = parseSpSchemePackage(strFromU8(entries[manifest]));
  const relative = names.filter((name) => name.startsWith(root)).map((name) => name.slice(root.length));
  if (Array.isArray(pkg?.customInteractions)) {
    pkg.customInteractions = pkg.customInteractions.map((item) => {
      if (!item || typeof item !== 'object' || !item.file || item.sourceHtml) return item;
      const path = String(item.file).replace(/^\.?\//, '');
      const data = entries[root + path];
      return data ? { ...item, sourceHtml: strFromU8(data) } : { ...item, missingFile: path };
    });
  }
  return { pkg, files: relative, hasPreview: relative.some((name) => /^preview\.html?$/i.test(name)), fromZip: true };
}

/** A ready-made example zip for researchers to try the upload flow. */
export function buildExampleZip() {
  const manifest = JSON.stringify(EXAMPLE_PACKAGE, null, 2);
  return zipSync({
    'street-perception-example/sp-scheme.json': strToU8(manifest),
    'street-perception-example/interactions/safety_duel.html': strToU8(EXAMPLE_INTERACTION_HTML),
  });
}

/** Accepts raw JSON or a model reply that wraps the JSON in a ```json fence. */
export function parseSpSchemePackage(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('The package is empty.');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [raw, fenced?.[1]];
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate.trim());
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('The package is not valid JSON.');
}

function allQuestions(survey) {
  const out = [];
  const walk = (elements, path) => (elements || []).forEach((element, index) => {
    const elementPath = `${path}[${index}]`;
    if (!element || typeof element !== 'object') return;
    out.push({ element, path: elementPath });
    if (Array.isArray(element.elements)) walk(element.elements, `${elementPath}.elements`);
  });
  (survey?.pages || []).forEach((page, i) => walk(page?.elements, `survey.pages[${i}].elements`));
  return out;
}

const URL_RE = /^(https?:|data:|blob:)/i;
function mentionsUrl(value) {
  if (typeof value === 'string') return URL_RE.test(value.trim());
  if (Array.isArray(value)) return value.some(mentionsUrl);
  if (value && typeof value === 'object') {
    return ['url', 'imageUrl', 'imageLink', 'value', 'src'].some((key) => mentionsUrl(value[key]));
  }
  return false;
}

function issue(list, path, message) {
  list.push({ path, message });
}

/**
 * Check a package against the platform contract without saving anything.
 * @returns {{ ok, errors, warnings, survey, interactions, summary }}
 *   survey: normalized survey with custom refs replaced by placeholders.
 */
export function validateSpSchemePackage(pkg) {
  const errors = [];
  const warnings = [];
  const empty = { ok: false, errors, warnings, survey: null, interactions: [], summary: null };

  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    issue(errors, '', 'The package must be a JSON object.');
    return empty;
  }
  if (pkg.format !== SP_SCHEME_FORMAT) {
    issue(warnings, 'format', `Expected "format": "${SP_SCHEME_FORMAT}".`);
  }
  if (pkg.spScheme && String(pkg.spScheme).split('.')[0] !== SP_SCHEME_VERSION.split('.')[0]) {
    issue(errors, 'spScheme', `This package targets SP-Scheme ${pkg.spScheme}; the platform accepts ${SP_SCHEME_VERSION}.`);
  }
  const secretPaths = findSecretFields(pkg);
  if (secretPaths.length) {
    issue(errors, secretPaths[0], `Remove credential fields: ${secretPaths.slice(0, 5).join(', ')}.`);
  }
  const survey = pkg.survey;
  if (!survey || typeof survey !== 'object' || !Array.isArray(survey.pages)) {
    issue(errors, 'survey.pages', 'survey.pages must be an array of pages.');
    return empty;
  }

  // Custom interactions: each must pass the same save-time contract as the Skill editor.
  const interactions = [];
  const byRef = new Map();
  const rawInteractions = pkg.customInteractions ?? [];
  if (!Array.isArray(rawInteractions)) {
    issue(errors, 'customInteractions', 'customInteractions must be an array.');
  } else {
    rawInteractions.forEach((raw, index) => {
      const path = `customInteractions[${index}]`;
      const ref = String(raw?.ref || '').trim();
      if (!REF_RE.test(ref)) {
        issue(errors, `${path}.ref`, 'ref must be 2–48 lowercase letters, digits or underscores, starting with a letter.');
        return;
      }
      if (byRef.has(ref)) {
        issue(errors, `${path}.ref`, `Duplicate ref "${ref}".`);
        return;
      }
      if (raw.missingFile) {
        issue(errors, `${path}.file`, `${ref}: ${raw.missingFile} is not in the zip.`);
      } else if (raw.file && !raw.sourceHtml) {
        issue(errors, `${path}.file`, `${ref}: upload the whole zip so ${raw.file} can be read.`);
      }
      const { file: _file, missingFile: _missing, ...fields } = raw;
      const sourceHtml = stripPreviewShim(raw.sourceHtml || raw.source_html || '');
      const prepared = prepareSkillForSave({ ...fields, sourceHtml, contractVersion: 1 });
      prepared.errors.forEach((message) => issue(errors, path, `${ref}: ${message}`));
      prepared.warnings.forEach((message) => issue(warnings, path, `${ref}: ${message}`));
      const entry = {
        ref,
        placeholderId: `${PLACEHOLDER_PREFIX}${ref}`,
        ok: prepared.ok,
        skill: {
          ...prepared.skill,
          name: String(raw.name || ref),
          description: String(raw.description || ''),
        },
        usedBy: [],
      };
      delete entry.skill.ref;
      byRef.set(ref, entry);
      interactions.push(entry);
    });
  }

  const working = JSON.parse(JSON.stringify(survey));
  allQuestions(working).forEach(({ element, path }) => {
    const label = element.name || path;
    if (element.skillHtml || element.sourceHtml) {
      issue(errors, `${path}.skillHtml`, `${label}: put HTML in customInteractions and reference it with skillId "custom:<ref>".`);
    }
    if (element.type === 'skillquestion') {
      const sid = String(element.skillId || '');
      if (sid.startsWith(CUSTOM_PREFIX)) {
        const entry = byRef.get(sid.slice(CUSTOM_PREFIX.length));
        if (!entry) {
          issue(errors, `${path}.skillId`, `${label}: no customInteractions entry for "${sid}".`);
        } else {
          entry.usedBy.push(element.name);
          element.skillId = entry.placeholderId;
          element.skillRevision = 1;
          element.skillContractVersion = 1;
          element.skillResultSchema = entry.skill.resultSchema;
          if (element.imageCount == null && element.skillConfig?.mediaCount == null
            && entry.skill.defaultConfig?.mediaCount != null) {
            element.imageCount = Number(entry.skill.defaultConfig.mediaCount) || 1;
          }
        }
      } else if (sid.startsWith('preset_')) {
        if (!getPresetSkill(sid)) issue(errors, `${path}.skillId`, `${label}: unknown built-in task "${sid}".`);
      } else if (sid.startsWith('skill_')) {
        issue(warnings, `${path}.skillId`, `${label}: "${sid}" must already exist in your interaction library.`);
      } else {
        issue(errors, `${path}.skillId`, `${label}: skillId must be "custom:<ref>" or a built-in "preset_*" id.`);
      }
    }
    if (questionHasTrait(element.type, 'stimulus') || element.type === 'skillquestion') {
      const manual = element.imageSelectionMode === 'huggingface_manual';
      const urlFields = ['choices', 'imageLinks', 'selectedImageUrls', 'annotationImageUrl']
        .filter((key) => mentionsUrl(element[key]));
      if (urlFields.length && !manual) {
        issue(errors, `${path}.${urlFields[0]}`, `${label}: media URLs are not allowed; the platform draws media from the project pool. Leave ${urlFields.join(', ')} empty.`);
      } else if (urlFields.length) {
        issue(warnings, `${path}.${urlFields[0]}`, `${label}: curated media URLs must already be in this project's media library; re-pick them in the Builder if unsure.`);
      } else if (manual) {
        issue(warnings, path, `${label}: curated media mode — pick the files in the Builder after import.`);
      }
    }
  });
  interactions.filter((entry) => !entry.usedBy.length).forEach((entry) => {
    issue(warnings, 'customInteractions', `${entry.ref}: not used by any question and will not be imported.`);
  });

  const normalized = normalizeBuilderSurveyJson(postProcessAiConfig(working));
  const report = validateSurveyConfig(normalized);
  report.errors.forEach((item) => issue(errors, `survey.${String(item.path || '').replace(/^surveyConfig\.?/, '')}`, item.message));
  report.warnings.forEach((item) => issue(warnings, `survey.${String(item.path || '').replace(/^surveyConfig\.?/, '')}`, item.message));

  const questions = allQuestions(normalized);
  const types = {};
  questions.forEach(({ element }) => { types[element.type] = (types[element.type] || 0) + 1; });
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    survey: normalized,
    interactions: interactions.filter((entry) => entry.usedBy.length),
    summary: {
      title: normalized.title || '',
      pageCount: normalized.pages.length,
      questionCount: questions.length,
      customInteractionCount: interactions.filter((entry) => entry.usedBy.length).length,
      types,
    },
  };
}

/**
 * Save the package's custom interactions to the user's library and return the
 * survey config to load into the Builder. Call only with a validated report.
 * @param {object} report validateSpSchemePackage result with ok=true
 * @param {{ saveSkill: (skill) => Promise<{skill:{id,revision}}>, baseConfig?: object }} deps
 */
export async function applySpSchemePackage(report, { saveSkill, baseConfig = {} }) {
  if (!report?.ok) throw new Error('Fix the package errors before importing.');
  const saved = new Map();
  for (const entry of report.interactions) {
    const result = await saveSkill(entry.skill);
    const skill = result?.skill;
    if (!skill?.id) throw new Error(`Could not save custom interaction "${entry.ref}".`);
    saved.set(entry.placeholderId, {
      id: skill.id,
      revision: Number(skill.revision || skill.currentRevision || 1),
      resultSchema: skill.resultSchema || entry.skill.resultSchema,
    });
  }
  const survey = JSON.parse(JSON.stringify(report.survey));
  allQuestions(survey).forEach(({ element }) => {
    const hit = element.type === 'skillquestion' && saved.get(element.skillId);
    if (!hit) return;
    element.skillId = hit.id;
    element.skillRevision = hit.revision;
    element.skillContractVersion = 1;
    element.skillResultSchema = hit.resultSchema;
  });
  // Keep project-level settings the package does not describe (theme, logo, runtime context).
  return {
    ...baseConfig,
    ...survey,
    theme: survey.theme || baseConfig.theme,
    spScheme: { version: SP_SCHEME_VERSION, importedAt: new Date().toISOString() },
  };
}

export const SP_SCHEME_RESULT_FAMILIES = NATIVE_SKILL_RESULT_TYPE_IDS;
export const SP_SCHEME_EXAMPLE_PACKAGE = EXAMPLE_PACKAGE;

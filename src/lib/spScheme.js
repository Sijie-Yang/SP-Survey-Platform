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

export const SP_SCHEME_VERSION = '1.0';
export const SP_SCHEME_FORMAT = 'sp-scheme-package';
const CUSTOM_PREFIX = 'custom:';
const PLACEHOLDER_PREFIX = 'skill_pkg_';
const REF_RE = /^[a-z][a-z0-9_]{1,47}$/;

// Agent/MCP-only rules (draft concurrency, publishing tools) do not apply to a pasted package.
const MCP_ONLY_RULE = /expectedDraftUpdatedAt|survey_publish|Publish to Main Page|deterministic operations|media_import_from_template|skill_list/;

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
      configSchema: [{ key: 'prompt', label: 'Instruction', type: 'string' }],
      defaultConfig: { prompt: 'Tap the safer street', mediaCount: 2, mediaType: 'image' },
      resultSchema: [{ key: 'choice', label: 'Chosen street', type: 'pairwiseChoice' }],
      exampleAnswer: {
        choice: { shownUrls: ['https://media.example/a.jpg', 'https://media.example/b.jpg'], winner: 'https://media.example/a.jpg' },
      },
      sourceHtml: '<div id="app"><p id="p"></p><div id="row" style="display:flex;gap:8px"></div></div>\n'
        + '<script>\n'
        + 'document.addEventListener("spskill-init", function (e) {\n'
        + '  var cfg = e.detail.config || {}; var imgs = (e.detail.images || []).slice(0, 2);\n'
        + '  document.getElementById("p").textContent = cfg.prompt || "";\n'
        + '  var row = document.getElementById("row"); row.innerHTML = "";\n'
        + '  var urls = imgs.map(function (m) { return m.url; });\n'
        + '  imgs.forEach(function (m) {\n'
        + '    var b = document.createElement("button"); b.type = "button"; b.style.flex = "1";\n'
        + '    var i = document.createElement("img"); i.src = m.url; i.alt = m.name || "street"; i.style.width = "100%";\n'
        + '    b.appendChild(i); b.onclick = function () { SPSkill.setAnswer({ choice: { shownUrls: urls, winner: m.url } }); };\n'
        + '    row.appendChild(b);\n'
        + '  });\n'
        + '});\n'
        + '</script>',
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

You are designing a perception survey for SP-Survey (https://sp-survey.org). You may invent any interface and interaction you like, but how images are randomised, how questions are described, and how answers are recorded MUST follow this scheme, otherwise the platform rejects the upload.

Ask the researcher for anything you need (research question, constructs, language, number of images per participant). Then output ONE JSON file and nothing else inside it. The researcher uploads it in SP-Survey → Survey Builder → SP-Scheme.

## 1. Output format

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

Images, videos and audio come from the researcher's project media pool. The platform draws them for each participant and records exactly what was shown. You never write media URLs.

- Default for every media question: \`"imageSelectionMode": "huggingface_random", "randomImageSelection": true, "excludePreviouslyUsedImages": true\` and leave \`choices\` empty.
- \`imageCount\` = how many files are drawn per presentation. \`trialCount\` = how many times the question repeats with a fresh draw (each trial is recorded separately).
- \`mediaAssignmentMode\`: \`individual\` (random files, default), \`set\` (one whole folder tagged set; imageCount must equal the folder size) or \`category\` (folders tagged category). \`mediaFolders\` optionally limits eligible folders.
- If the researcher must curate specific files, use \`"imageSelectionMode": "huggingface_manual"\` and tell them to pick the files in the Builder after import.

## 3. Platform rules

${rules.map((rule) => `- ${rule}`).join('\n')}

## 4. Native question types

Prefer a native type whenever it fits; it gets full analysis, export and Silicon Sample support.

${questionCatalogLines()}

Built-in interactive tasks (use \`"type": "skillquestion"\` with this \`skillId\`):

${presetLines()}

## 5. Custom interactions (any interface you can imagine)

When no native type fits, write a self-contained HTML interaction and reference it from a question with \`"type": "skillquestion", "skillId": "custom:<ref>"\`. Slides, drag-and-drop, timed exposure, canvas, animation and games are all fine.

Each entry in \`customInteractions\`:

\`\`\`json
{
  "ref": "lowercase_id",
  "name": "Short name",
  "description": "What the participant does",
  "configSchema": [{ "key": "prompt", "label": "Instruction", "type": "string" }],
  "defaultConfig": { "prompt": "...", "mediaCount": 2, "mediaType": "image" },
  "resultSchema": [{ "key": "answer_key", "label": "What is recorded", "type": "<one result family>" }],
  "exampleAnswer": { "answer_key": "<a valid value>" },
  "sourceHtml": "<div id=\\"app\\">...</div><script>...</script>"
}
\`\`\`

Runtime contract (the platform injects the SDK; do not include it):

- Initialise from \`document.addEventListener("spskill-init", e => { e.detail.config; e.detail.images })\` or \`SPSkill.getConfig()\` / \`SPSkill.getImages()\`. Images arrive as \`[{ name, url, type }]\`, already drawn by the platform; show only these.
- Record the answer with \`SPSkill.setAnswer({ <answer_key>: value })\` — always an object whose single key is the resultSchema key. Call it again whenever the answer changes. Never use parent.postMessage directly.
- The interaction runs in a sandboxed iframe with no network: no fetch/XHR, no CDN scripts or fonts, no forms, no nested frames, no camera or microphone. Inline all CSS and JS. Put content inside \`<div id="app">\` so height is measured.
- Make it work on a phone (≥360px wide) and by keyboard; give images alt text.
- One question records one answer. For repeated rounds use \`trialCount\` on the question instead of looping inside the HTML.
- No \`analysisHtml\`; analysis is done by the platform.

\`resultSchema\` must contain exactly ONE field whose \`type\` is one of these result families (declare its \`min\`/\`max\`, \`options\`, \`rows\`/\`columns\`, \`dimensions\` or \`budget\` as the family needs). \`exampleAnswer\` must satisfy it:

${skillResultTypesCatalogText({ nativeOnly: true })}

The question that uses a custom interaction sets \`imageCount\` (and \`skillConfig.mediaCount\`) to the number of media it needs, plus the media sampling fields from section 2. Its \`skillConfig\` overrides \`defaultConfig\`.

## 6. Example package

\`\`\`json
${JSON.stringify(EXAMPLE_PACKAGE, null, 2)}
\`\`\`

## 7. Self-check before you answer

1. The file is valid JSON with \`format\`, \`spScheme\`, \`survey.pages\`.
2. Question names are unique; every \`custom:<ref>\` has a matching \`customInteractions[].ref\`, and every interaction is used.
3. No media URLs in survey questions; media questions use platform sampling.
4. Every custom interaction calls \`SPSkill.setAnswer({...})\`, uses \`spskill-init\` or \`SPSkill.getConfig/getImages\`, has one resultSchema field from the list, and a matching exampleAnswer.
5. No external scripts, network calls or credentials.
`;
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
      const prepared = prepareSkillForSave({ ...raw, contractVersion: 1 });
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

/**
 * Worker-compatible re-export of the design protocol (duplicated as ESM
 * so the Worker bundle does not depend on CRA src/ paths).
 * Keep in sync with src/lib/designProtocol/*.
 */

import { ANNOTATION_TOOLS, normalizeAllowedTools } from './annotationTools.mjs';
import { dimensionIncomplete, matrixItemLabel, normalizeSliderQuestion } from './sliderScale.mjs';
import {
  OPERATION_TYPES,
  PLATFORM_SCHEMA,
  PLATFORM_SCHEMA_HASH,
  QUESTION_TYPE_IDS,
} from './platformSchema.generated.mjs';

const SECRET_FIELDS = new Set([
  'supabaseconfig', 'supabasekey', 'supabaseanonkey', 'servicerolekey', 'anonkey',
  'huggingfacetoken', 'falapikey', 'falkey', 'openaiapikey', 'openrouterapikey',
  'apikey', 'accesstoken', 'accesskeyid', 'secretkey', 'secretaccesskey', 'password',
]);

export const isSecretField = (key) => SECRET_FIELDS.has(String(key || '').toLowerCase());

export const sanitizeForAgent = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeForAgent);
  if (!value || typeof value !== 'object') return value;
  return Object.entries(value).reduce((cleaned, [key, child]) => {
    if (!isSecretField(key)) cleaned[key] = sanitizeForAgent(child);
    return cleaned;
  }, {});
};

export const findSecretFields = (value, currentPath = '') => {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => findSecretFields(child, `${currentPath}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = currentPath ? `${currentPath}.${key}` : key;
    return isSecretField(key) ? [childPath] : findSecretFields(child, childPath);
  });
};

export const restoreStoredSecrets = (incoming, stored) => {
  if (Array.isArray(incoming)) {
    return incoming.map((child, index) => restoreStoredSecrets(child, stored?.[index]));
  }
  if (!incoming || typeof incoming !== 'object') return incoming;
  const restored = {};
  Object.entries(incoming).forEach(([key, child]) => {
    restored[key] = isSecretField(key)
      ? stored?.[key]
      : restoreStoredSecrets(child, stored?.[key]);
  });
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    Object.entries(stored).forEach(([key, child]) => {
      if (isSecretField(key) && child !== undefined) restored[key] = child;
    });
  }
  return restored;
};

const isKnownQuestionType = (type) => Object.prototype.hasOwnProperty.call(PLATFORM_SCHEMA.questionTypes, type);
const questionHasTrait = (type, trait) => PLATFORM_SCHEMA.questionTypes[type]?.traits?.includes(trait) || false;

const MEDIA_STIMULUS_TYPES = [
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagecheckbox', 'image',
  'imagematrix', 'imageslidergroup', 'imagepointallocation', 'imageannotation',
  'mediadisplay', 'mediapicker', 'mediaranking', 'mediarating', 'mediaboolean', 'mediacheckbox',
  'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
  'skillquestion',
];

const MEDIA_STAR_TYPES = [
  'mediadisplay', 'mediapicker', 'mediaranking', 'mediarating', 'mediaboolean', 'mediacheckbox',
  'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
];

function structuredIssue(issue, severity = 'error') {
  return {
    code: issue.code || (severity === 'error' ? 'INVALID_SURVEY_FIELD' : 'SURVEY_WARNING'),
    path: issue.path || 'surveyConfig',
    message: issue.message || 'Invalid survey configuration.',
    retryable: severity === 'error',
    hint: issue.hint || (severity === 'error'
      ? `Correct ${issue.path || 'the survey configuration'} and validate again.`
      : 'Review this warning before publishing.'),
  };
}

/** Native settings shared by the Builder and Agent API. Undefined means use the native default. */
export function validateQuestionSettings(q) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  const bounds = (obj, minKey, maxKey, prefix = '') => {
    for (const key of [minKey, maxKey]) {
      if (obj[key] != null && !Number.isFinite(obj[key])) add(prefix + key, `${prefix + key} must be a finite number.`);
    }
    if (obj[minKey] != null && obj[maxKey] != null && obj[minKey] > obj[maxKey]) {
      add(prefix + minKey, `${prefix + minKey} must not exceed ${prefix + maxKey}.`);
    }
  };
  bounds(q, 'min', 'max');
  bounds(q, 'rateMin', 'rateMax');
  bounds(q, 'minValue', 'maxValue');
  bounds(q, 'scaleMin', 'scaleMax');
  bounds({ ...q, maxAnnotations: q.maxAnnotations === 0 ? undefined : (q.maxAnnotations ?? 50) }, 'minAnnotations', 'maxAnnotations');
  for (const key of ['minAnnotations', 'maxAnnotations', 'minSelectedChoices', 'maxSelectedChoices']) {
    if (q[key] != null && (!Number.isInteger(q[key]) || q[key] < 0)) add(key, `${key} must be a non-negative integer.`);
  }
  if (q.annotationLabels != null) {
    if (!Array.isArray(q.annotationLabels)) {
      add('annotationLabels', 'annotationLabels must be an array of strings.');
    } else {
      q.annotationLabels.forEach((label, i) => {
        if (typeof label !== 'string' || !label.trim()) {
          add(`annotationLabels[${i}]`, `annotationLabels[${i}] must be a non-empty string.`);
        }
      });
    }
  }
  if (['slidergroup', 'imageslidergroup', 'mediaslidergroup'].includes(q.type)
    && (q.scaleMin ?? 1) >= (q.scaleMax ?? 7)) add('scaleMin', 'Scale minimum must be less than its maximum.');
  bounds({ ...q, maxSelectedChoices: q.maxSelectedChoices === 0 ? undefined : q.maxSelectedChoices }, 'minSelectedChoices', 'maxSelectedChoices');
  for (const key of ['step', 'rateStep', 'scaleStep', 'budget']) {
    if (q[key] != null && (!Number.isFinite(q[key]) || q[key] <= 0)) add(key, `${key} must be a positive number.`);
  }
  for (const key of ['choices', 'rows', 'columns', 'dimensions']) {
    if (!Array.isArray(q[key])) continue;
    const seen = new Set();
    q[key].forEach((item, i) => {
      const id = item && typeof item === 'object' ? (item.value ?? item.id ?? item.key) : item;
      if (id == null || String(id).trim() === '') add(`${key}[${i}]`, `${key}[${i}] needs a stable, non-empty ID.`);
      else if (seen.has(String(id))) add(`${key}[${i}]`, `${key}: duplicate ID "${id}".`);
      seen.add(String(id));
      if (key === 'dimensions' && item && typeof item === 'object') {
        bounds(item, 'min', 'max', `dimensions[${i}].`);
        if (!(item.min != null && item.max != null && item.min > item.max)
          && (item.min ?? q.scaleMin ?? 1) >= (item.max ?? q.scaleMax ?? 7)) {
          add(`dimensions[${i}].min`, 'Dimension minimum must be less than its effective maximum.');
        }
        if (item.step != null && (!Number.isFinite(item.step) || item.step <= 0)) add(`dimensions[${i}].step`, 'Dimension step must be positive.');
      }
    });
  }
  return errors;
}

export function validateSurveyConfig(surveyConfig) {
  const errors = [];
  const warnings = [];
  let questionCount = 0;

  if (!surveyConfig || typeof surveyConfig !== 'object' || Array.isArray(surveyConfig)) {
    return {
      valid: false,
      errors: [structuredIssue({ path: 'surveyConfig', message: 'surveyConfig must be an object.' })],
      warnings,
      pageCount: 0,
      questionCount,
    };
  }

  if (!Array.isArray(surveyConfig.pages)) {
    errors.push({ path: 'surveyConfig.pages', message: 'pages must be an array.' });
  } else {
    if (surveyConfig.pages.length === 0) {
      warnings.push({ path: 'surveyConfig.pages', message: 'The survey has no pages.' });
    }
    const names = new Map();
    surveyConfig.pages.forEach((page, pageIndex) => {
      const pagePath = `surveyConfig.pages[${pageIndex}]`;
      if (!page || typeof page !== 'object' || Array.isArray(page)) {
        errors.push({ path: pagePath, message: 'Each page must be an object.' });
        return;
      }
      if (!page.name) warnings.push({ path: `${pagePath}.name`, message: 'Page name is recommended.' });
      if (!Array.isArray(page.elements)) {
        errors.push({ path: `${pagePath}.elements`, message: 'elements must be an array.' });
        return;
      }
      if (page.elements.length === 0) {
        warnings.push({ path: `${pagePath}.elements`, message: 'Page has no questions.' });
      }
      page.elements.forEach((element, elementIndex) => {
        questionCount += 1;
        const elementPath = `${pagePath}.elements[${elementIndex}]`;
        if (!element || typeof element !== 'object' || Array.isArray(element)) {
          errors.push({ path: elementPath, message: 'Each element must be an object.' });
          return;
        }
        if (!element.type) errors.push({ path: `${elementPath}.type`, message: 'Question type is required.' });
        else if (!isKnownQuestionType(element.type)) {
          warnings.push({
            path: `${elementPath}.type`,
            message: `Question type "${element.type}" is not in the canonical platform schema.`,
          });
        }
        if (!element.name) {
          errors.push({ path: `${elementPath}.name`, message: 'Question name is required.' });
        } else if (names.has(element.name)) {
          errors.push({
            path: `${elementPath}.name`,
            message: `Duplicate question name; first used at ${names.get(element.name)}.`,
          });
        } else {
          names.set(element.name, `${elementPath}.name`);
        }

        validateQuestionSettings(element).forEach((error) => errors.push({
          path: `${elementPath}.${error.path}`, message: `${element.name || 'Question'}: ${error.message}`,
        }));

        if (questionHasTrait(element.type, 'stimulus') && element.type !== 'skillquestion') {
          const hasManual = element.selectedImageUrls?.length
            || element.choices?.length
            || element.imageLinks?.length
            || element.annotationImageUrl;
          const hasRandom = element.randomImageSelection !== false
            || element.imageSelectionMode === 'huggingface_random';
          if (!hasManual && !hasRandom) {
            warnings.push({
              path: elementPath,
              message: `Question "${element.title || element.name}" may have no images configured.`,
            });
          }
        }
        if (questionHasTrait(element.type, 'slider')) {
          if (!element.dimensions?.length) {
            warnings.push({
              path: elementPath,
              message: `Slider group "${element.title || element.name}" has no dimensions configured.`,
            });
          } else {
            element.dimensions.forEach((dimension, dimIndex) => {
              if (dimensionIncomplete(dimension)) {
                warnings.push({
                  path: `${elementPath}.dimensions[${dimIndex}]`,
                  message: `Dimension ${dimIndex + 1} is incomplete (needs a display name and both pole labels). Historical answer ids are unchanged.`,
                });
              }
            });
          }
        }
        for (const key of ['rows', 'columns']) {
          if (!Array.isArray(element[key])) continue;
          element[key].forEach((item, itemIndex) => {
            const kind = key === 'rows' ? 'Row' : 'Column';
            const hasText = item && typeof item === 'object'
              ? String(item.text || '').trim()
              : String(item || '').trim();
            if (!hasText) {
              warnings.push({
                path: `${elementPath}.${key}[${itemIndex}]`,
                message: `${kind} ${itemIndex + 1} is missing a display label (fallback: ${matrixItemLabel(item, itemIndex, kind)}).`,
              });
            }
          });
        }
        if (
          questionHasTrait(element.type, 'allocation')
          && !element.choices?.length
        ) {
          warnings.push({
            path: elementPath,
            message: `Point allocation "${element.title || element.name}" has no choices configured.`,
          });
        }
      });
    });
  }

  return {
    valid: errors.length === 0,
    errors: errors.map((issue) => structuredIssue(issue)),
    warnings: warnings.map((issue) => structuredIssue(issue, 'warning')),
    pageCount: Array.isArray(surveyConfig.pages) ? surveyConfig.pages.length : 0,
    questionCount,
  };
}

/** Human-readable warning strings for the builder banner. */
export function getSurveyValidationWarningStrings(surveyConfig) {
  const report = validateSurveyConfig(surveyConfig);
  return [
    ...report.errors.map((e) => e.message),
    ...report.warnings.map((w) => w.message),
  ];
}

/** Post-process LLM/MCP-generated configs (image/media/skill defaults, strip secrets). */
export function postProcessAiConfig(surveyConfig) {
  const processedConfig = JSON.parse(JSON.stringify(surveyConfig || {}));
  if (!Array.isArray(processedConfig.pages)) return processedConfig;

  processedConfig.pages.forEach((page) => {
    page.elements = (page.elements || []).map((raw) => {
      const element = normalizeSliderQuestion(raw);
      if (!MEDIA_STIMULUS_TYPES.includes(element.type)) return element;
      if (!element.imageSelectionMode || element.imageSelectionMode === 'random') {
        element.imageSelectionMode = 'huggingface_random';
      }
      element.randomImageSelection = true;
      if (element.excludePreviouslyUsedImages === undefined) {
        element.excludePreviouslyUsedImages = true;
      }
      if (!element.choices) element.choices = [];
      if (element.type === 'imagematrix' && !element.imageLinks) element.imageLinks = [];
      if ((element.type === 'imagecheckbox' || element.type === 'mediacheckbox')
        && (!Array.isArray(element.choices) || !element.choices.length)) {
        element.choices = [
          { value: 'tag_a', text: 'Tag A' },
          { value: 'tag_b', text: 'Tag B' },
          { value: 'tag_c', text: 'Tag C' },
        ];
      }
      if (element.type === 'imageannotation') {
        element.allowedTools = normalizeAllowedTools(element.allowedTools, ANNOTATION_TOOLS);
        element.annotationLabels = (Array.isArray(element.annotationLabels) ? element.annotationLabels : [])
          .map((label) => {
            if (typeof label === 'string' || typeof label === 'number') return String(label).trim();
            if (label && typeof label === 'object') {
              return String(label.text ?? label.label ?? label.value ?? '').trim();
            }
            return '';
          })
          .filter(Boolean);
      }
      if (MEDIA_STAR_TYPES.includes(element.type)) {
        if (!element.mediaType) element.mediaType = 'any';
        if (!Array.isArray(element.mediaSlots)) element.mediaSlots = [];
        if (!element.mediaPresentation) element.mediaPresentation = 'stack';
      }
      if (element.type === 'skillquestion') {
        delete element.skillHtml;
        // Bare preset keys → preset_*. Library skill_* ids stay unchanged.
        // Heal mistaken preset_skill_* rewrites from older normalizers.
        let sid = element.skillId ? String(element.skillId) : '';
        if (sid.startsWith('preset_skill_')) {
          sid = sid.slice('preset_'.length);
        } else if (sid && !sid.startsWith('preset_') && !sid.startsWith('skill_')) {
          sid = `preset_${sid}`;
        }
        if (sid) element.skillId = sid;
        if (element.skillConfig?.mediaCount != null && element.imageCount == null) {
          element.imageCount = Number(element.skillConfig.mediaCount) || 1;
        }
      }
      delete element.imageSource;
      delete element.huggingFaceConfig;
      delete element.falApiKey;
      return element;
    });
  });

  return processedConfig;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function applyOperations(surveyConfig, operations = []) {
  let config = clone(surveyConfig || { pages: [] });
  if (!Array.isArray(config.pages)) config.pages = [];
  const applied = [];
  const inverse = [];

  operations.forEach((op, opIndex) => {
    if (!op?.op) throw new Error(`operations[${opIndex}] is missing op`);
    switch (op.op) {
      case 'addPage': {
        const page = clone(op.page || {});
        if (!page.name) page.name = `page_${Date.now()}_${opIndex}`;
        if (!Array.isArray(page.elements)) page.elements = [];
        const index = Number.isInteger(op.index) ? op.index : config.pages.length;
        config.pages.splice(Math.max(0, Math.min(index, config.pages.length)), 0, page);
        applied.push(op);
        inverse.unshift({ op: 'removePage', pageName: page.name });
        break;
      }
      case 'removePage': {
        const idx = config.pages.findIndex((p) => p.name === op.pageName);
        if (idx < 0) throw new Error(`Page not found: ${op.pageName}`);
        const removed = config.pages[idx];
        config.pages.splice(idx, 1);
        applied.push(op);
        inverse.unshift({ op: 'addPage', page: removed, index: idx });
        break;
      }
      case 'addQuestion': {
        const pageIdx = config.pages.findIndex((p) => p.name === op.pageName);
        if (pageIdx < 0) throw new Error(`Page not found: ${op.pageName}`);
        const page = config.pages[pageIdx];
        if (!Array.isArray(page.elements)) page.elements = [];
        const question = clone(op.question || {});
        if (!question.name || !question.type) throw new Error('addQuestion requires name and type');
        const index = Number.isInteger(op.index) ? op.index : page.elements.length;
        page.elements.splice(Math.max(0, Math.min(index, page.elements.length)), 0, question);
        applied.push(op);
        inverse.unshift({ op: 'removeQuestion', pageName: op.pageName, questionName: question.name });
        break;
      }
      case 'updateQuestion': {
        const pageIdx = config.pages.findIndex((p) => p.name === op.pageName);
        if (pageIdx < 0) throw new Error(`Page not found: ${op.pageName}`);
        const qIdx = (config.pages[pageIdx].elements || []).findIndex((el) => el.name === op.questionName);
        if (qIdx < 0) throw new Error(`Question not found: ${op.questionName}`);
        const previous = clone(config.pages[pageIdx].elements[qIdx]);
        config.pages[pageIdx].elements[qIdx] = { ...previous, ...(op.patch || {}), name: previous.name };
        applied.push(op);
        inverse.unshift({
          op: 'updateQuestion',
          pageName: op.pageName,
          questionName: op.questionName,
          patch: previous,
        });
        break;
      }
      case 'removeQuestion': {
        const pageIdx = config.pages.findIndex((p) => p.name === op.pageName);
        if (pageIdx < 0) throw new Error(`Page not found: ${op.pageName}`);
        const qIdx = (config.pages[pageIdx].elements || []).findIndex((el) => el.name === op.questionName);
        if (qIdx < 0) throw new Error(`Question not found: ${op.questionName}`);
        const removed = config.pages[pageIdx].elements[qIdx];
        config.pages[pageIdx].elements.splice(qIdx, 1);
        applied.push(op);
        inverse.unshift({
          op: 'addQuestion',
          pageName: op.pageName,
          question: removed,
          index: qIdx,
        });
        break;
      }
      case 'setAllRatingScales': {
        const types = new Set(op.types || ['rating', 'imagerating', 'mediarating']);
        const previous = [];
        config.pages.forEach((page) => {
          (page.elements || []).forEach((el) => {
            if (!types.has(el.type)) return;
            previous.push({
              pageName: page.name,
              questionName: el.name,
              rateMin: el.rateMin,
              rateMax: el.rateMax,
            });
            if (op.rateMin != null) el.rateMin = op.rateMin;
            if (op.rateMax != null) el.rateMax = op.rateMax;
          });
        });
        applied.push(op);
        inverse.unshift({ op: 'restoreRatingScales', previous });
        break;
      }
      case 'restoreRatingScales': {
        (op.previous || []).forEach((item) => {
          const page = config.pages.find((p) => p.name === item.pageName);
          const el = page?.elements?.find((e) => e.name === item.questionName);
          if (!el) return;
          if (item.rateMin !== undefined) el.rateMin = item.rateMin;
          if (item.rateMax !== undefined) el.rateMax = item.rateMax;
        });
        applied.push(op);
        break;
      }
      case 'replaceConfig': {
        const previous = clone(config);
        config = clone(op.surveyConfig || { pages: [] });
        applied.push(op);
        inverse.unshift({ op: 'replaceConfig', surveyConfig: previous });
        break;
      }
      case 'updateSurvey': {
        const previous = {};
        const patch = op.patch && typeof op.patch === 'object' ? op.patch : {};
        Object.keys(patch).forEach((key) => {
          if (key === 'pages') return;
          previous[key] = clone(config[key]);
          config[key] = clone(patch[key]);
        });
        applied.push(op);
        inverse.unshift({ op: 'updateSurvey', patch: previous });
        break;
      }
      case 'updatePage': {
        const idx = config.pages.findIndex((p) => p.name === op.pageName);
        if (idx < 0) throw new Error(`Page not found: ${op.pageName}`);
        const previous = clone(config.pages[idx]);
        const patch = op.patch && typeof op.patch === 'object' ? op.patch : {};
        config.pages[idx] = {
          ...previous,
          ...clone(patch),
          name: previous.name,
          elements: Object.prototype.hasOwnProperty.call(patch, 'elements')
            ? clone(patch.elements)
            : previous.elements,
        };
        applied.push(op);
        inverse.unshift({ op: 'updatePage', pageName: op.pageName, patch: previous });
        break;
      }
      case 'setTheme': {
        const previous = clone(config.theme || {});
        config.theme = clone(op.theme || {});
        applied.push(op);
        inverse.unshift({ op: 'setTheme', theme: previous });
        break;
      }
      case 'reorderPages': {
        const names = Array.isArray(op.pageNames) ? op.pageNames : [];
        const previous = config.pages.map((page) => page.name);
        const next = names.map((name) => config.pages.find((page) => page.name === name)).filter(Boolean);
        const leftover = config.pages.filter((page) => !names.includes(page.name));
        config.pages = [...next, ...leftover];
        applied.push(op);
        inverse.unshift({ op: 'reorderPages', pageNames: previous });
        break;
      }
      case 'reorderQuestions': {
        const pageIdx = config.pages.findIndex((p) => p.name === op.pageName);
        if (pageIdx < 0) throw new Error(`Page not found: ${op.pageName}`);
        const page = config.pages[pageIdx];
        const names = Array.isArray(op.questionNames) ? op.questionNames : [];
        const previous = (page.elements || []).map((element) => element.name);
        const next = names.map((name) => (page.elements || []).find((element) => element.name === name)).filter(Boolean);
        const leftover = (page.elements || []).filter((element) => !names.includes(element.name));
        page.elements = [...next, ...leftover];
        applied.push(op);
        inverse.unshift({ op: 'reorderQuestions', pageName: op.pageName, questionNames: previous });
        break;
      }
      default:
        throw new Error(`Unknown operation: ${op.op}`);
    }
  });

  return {
    surveyConfig: config,
    applied,
    inverse,
    validation: validateSurveyConfig(config),
  };
}

export function createDefaultSurveyConfig(name, description = '') {
  const defaults = JSON.parse(JSON.stringify(PLATFORM_SCHEMA.defaultSurveyConfig));
  defaults.title = name;
  if (description) defaults.description = description;
  return defaults;
}

export function buildProjectUrls(projectId, clientOrigin) {
  const origin = String(clientOrigin || '').replace(/\/$/, '') || 'https://sp-survey.org';
  const encodedId = encodeURIComponent(projectId);
  return {
    admin: `${origin}/admin`,
    liveSurvey: `${origin}/survey?project=${encodedId}`,
  };
}

export function isSafeProjectId(projectId) {
  return /^[A-Za-z0-9_-]+$/.test(String(projectId || ''));
}

const MEDIA_SAMPLING = {
  imageSelectionMode: 'huggingface_random',
  randomImageSelection: true,
  excludePreviouslyUsedImages: true,
  choices: [],
};

/** Keep in sync with src/lib/designProtocol/capabilities.js — Codex reads this via MCP. */
export const DESIGN_CAPABILITIES = {
  name: 'SP-Survey Design Protocol',
  version: '1.1.0',
  platformSchemaHash: PLATFORM_SCHEMA_HASH,
  questionTypes: QUESTION_TYPE_IDS,
  rules: [
    'Question names must be unique across the survey.',
    'Binary imagepicker/mediapicker and the built-in Forced-Choice A/B task support allowTie (default false) and tieLabel (empty follows survey language). Requires two options and single selection. No preference is stored separately; TrueSkill uses decisive outcomes only.',
    'Prefer deterministic operations over full surveyConfig replace.',
    'Never send API keys or storage credentials.',
    'For version-managed projects, saves update the draft; survey_publish updates the participant URL. Legacy projects remain live on save until their first release.',
    'Optional survey locale: en (default) or zh. Participant chrome (progress, trials, Next) follows this setting, not the researcher admin language.',
    'Product "Publish to Main Page" is the homepage listing flow, not gating the share URL.',
    'Use expectedDraftUpdatedAt for optimistic concurrency on every write.',
    'Prefer image*/media*/skillquestion for visual preference studies — not only text/rating.',
    'Media pipeline has several layers (see mediaAssignment). Default simple case: imageSelectionMode=huggingface_random, mediaAssignmentMode=individual, choices:[].',
    'Do not put skillHtml on survey questions. Use skillquestion with skillId from skillPresets (preset_*) or skill_list / skill_save (private library).',
    'media* may use mediaSlots for multi-modal. Empty mediaSlots = legacy single-pool path.',
    'For set mode, imageCount must equal files-per-set folder size. Folder tags live on Media Dataset.',
    'Never invent media URLs or send storage/API credentials.',
    'MEDIA SOURCE RULES: Do NOT AI-generate / synthesize / invent images or videos and media_upload them. Prefer media_import_from_template, the project Media Dataset, or the platform Admin preview media library (预览媒体库). media_upload only for real files the researcher explicitly provides.',
  ],
  mediaSamplingDefaults: MEDIA_SAMPLING,
  mediaAssignment: {
    layers: [
      '1. imageSelectionMode: huggingface_random (pool) | huggingface_manual (curated selectedImageUrls)',
      '2. mediaAssignmentMode: individual | set | category (legacy group→set)',
      '3. mediaFolders[] optional scope of tagged folders',
      '4. mediaSlots[] optional multi-modal (fixed/random/set_member/category, setBinding shared)',
      '5. trialCount multi-trial redraw',
      '6. Runtime injection fills choices — do not pre-fill for random modes',
    ],
    mediaAssignmentMode: {
      individual: 'Random N files from pool (imageCount).',
      set: 'One whole set-tagged folder; imageCount must equal folder file count. Alias: group.',
      category: 'mediaCategoryMode=all (default): mediaPerCategory from each selected category. single: each trial randomly chooses one category with enough unused files and draws mediaPerCategory files only from it. mediaFolders scopes eligible categories.',
    },
    mediaSlots: {
      selectionValues: ['random', 'fixed', 'set_member', 'category'],
      note: '[] = legacy path; set_member+shared fills typed slots from one set draw.',
    },
  },
  questionTypeGuide: {
    standard: {
      text: { fields: ['name', 'title', 'placeholder', 'inputType?'] },
      comment: { fields: ['name', 'title', 'rows?'] },
      radiogroup: { fields: ['name', 'title', 'choices[]'] },
      checkbox: { fields: ['name', 'title', 'choices[]'] },
      dropdown: { fields: ['name', 'title', 'choices[]'] },
      boolean: { fields: ['name', 'title', 'labelTrue', 'labelFalse'] },
      consent: { note: 'Stored as boolean with isRequired:true; labels for agree/disagree.' },
      rating: { fields: ['name', 'title', 'rateMin', 'rateMax', 'minRateDescription?', 'maxRateDescription?'] },
      matrix: { fields: ['name', 'title', 'rows[]', 'columns[]'] },
      ranking: { fields: ['name', 'title', 'choices[]'] },
      slidergroup: { fields: ['name', 'title', 'dimensions[{id,label,left,right,min?,max?,step?}]', 'scaleMin', 'scaleMax', 'scaleStep'] },
      pointallocation: { fields: ['name', 'title', 'choices[]', 'budget'] },
    },
    image: {
      note: 'Image-only stimuli. Always include mediaSamplingDefaults.',
      types: [
        'image', 'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagecheckbox',
        'imagematrix', 'imageslidergroup', 'imagepointallocation', 'imageannotation',
      ],
      imagecheckbox: {
        role: 'Multi-select text tags about an image (which apply to this scene)',
        defaults: {
          imageCount: 1,
          choices: [
            { value: 'tag_a', text: 'Tag A' },
            { value: 'tag_b', text: 'Tag B' },
            { value: 'tag_c', text: 'Tag C' },
          ],
        },
      },
      imageannotation: {
        role: 'Draw/annotate on image',
        defaults: { imageCount: 1, allowedTools: ['point', 'line', 'polygon', 'bbox'], annotationLabels: [], minAnnotations: 0 },
        note: 'Tools: point|line|polygon|bbox (aliases: path→line, points→point, rect/box→bbox).',
      },
    },
    media: {
      note: 'Image/video/audio. Add mediaType + mediaSlots:[] + mediaPresentation:"stack".',
      types: [
        'mediadisplay', 'mediapicker', 'mediaranking', 'mediarating', 'mediaboolean', 'mediacheckbox',
        'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
      ],
      mediacheckbox: {
        role: 'Multi-select text tags about media (which apply to this scene)',
        defaults: {
          mediaType: 'any',
          imageCount: 1,
          mediaSlots: [],
          mediaPresentation: 'stack',
          choices: [
            { value: 'tag_a', text: 'Tag A' },
            { value: 'tag_b', text: 'Tag B' },
            { value: 'tag_c', text: 'Tag C' },
          ],
        },
      },
    },
    skillquestion: {
      note:
        'Interactive skills. Prefer preset_* first. Custom HTML only via skill_save (never skillHtml on the draft). '
        + 'skill_save HTML MUST use SPSkill.setAnswer + spskill-init; one task per skill; '
        + 'configSchema as [{key,label,type},...]; resultSchema must contain exactly one native field. Required: skillId, skillConfig, imageCount. '
        + 'YOU choose resultSchema[].type: ANNOTATION→points|path|polygon|bbox; '
        + 'MEDIA→rating/number/boolean/scaleGroup/mediaChoice/mediaRankedList/mediaMatrix+imageUrl; '
        + 'STRUCTURED→multiChoice(text tags; +imageUrl⇒imagecheckbox)|matrix|rankedList|allocation|compositeBlocks; '
        + 'Prefer native imagecheckbox/mediacheckbox for stimulus+text multi-select. '
        + 'COLOR→color; COMPARISON→pairwiseChoice|pairwisePreference|bestWorst; '
        + 'VIDEO→timeRanges|timeSeries; TEXT→choice/text. '
        + 'Every field must match an existing native family; json, legacy pairwise, and analysisHtml are forbidden for new revisions. Include imageUrl when media is shown.',
      resultSchemaTypes: [
        'number', 'rating', 'boolean', 'choice', 'text', 'count', 'color', 'scaleGroup',
        'points', 'path', 'polygon', 'bbox', 'allocation', 'rankedList',
        'multiChoice', 'matrix', 'mediaMatrix', 'mediaChoice', 'mediaRankedList',
        'timeRanges', 'timeSeries', 'pairwiseChoice', 'pairwisePreference', 'bestWorst', 'compositeBlocks',
      ],
      analysisGuide:
        'Annotation: points/path/polygon/bbox → imageannotation overlays. '
        + 'Media: rating/number/boolean/scaleGroup/mediaChoice/mediaRankedList/mediaMatrix+imageUrl → native media charts. '
        + 'Structured: multiChoice(+media⇒imagecheckbox)/matrix/rankedList/allocation; comparison: pairwiseChoice/pairwisePreference/bestWorst. '
        + 'Video: timeRanges/timeSeries → moment timeline / continuous rating. '
        + 'No custom result layer: redesign unmatched shapes to one of these native families.',
      skillPresets: [
        { skillId: 'preset_image_preference_slider', useWhen: 'Pairwise A/B slider', imageCount: 2 },
        { skillId: 'preset_image_preference_forced', useWhen: 'Forced-choice A/B', imageCount: 2 },
        { skillId: 'preset_best_worst_choice', useWhen: 'Best–worst MaxDiff', imageCount: 4 },
        { skillId: 'preset_emotion_color_picker', useWhen: 'Emotion color for one scene', imageCount: 1 },
        { skillId: 'preset_video_moment_tag', useWhen: 'Tag video moments', imageCount: 1, mediaType: 'video' },
        { skillId: 'preset_video_continuous_rating', useWhen: 'Continuous rating while watching video', imageCount: 1, mediaType: 'video' },
        { skillId: 'preset_composite_blocks', useWhen: 'Several mini-questions about one scene', imageCount: 1 },
      ],
    },
  },
  examples: {
    imagerating: {
      type: 'imagerating', name: 'scene_rating', title: 'How pleasant is this scene?',
      imageCount: 1, rateMin: 1, rateMax: 7, ...MEDIA_SAMPLING,
    },
    mediapicker: {
      type: 'mediapicker', name: 'media_choice', title: 'Which option do you prefer?',
      mediaType: 'any', imageCount: 4, multiSelect: false, mediaSlots: [], mediaPresentation: 'stack', ...MEDIA_SAMPLING,
    },
    skill_pairwise: {
      type: 'skillquestion', name: 'pairwise_pref', title: 'Which scene do you prefer?',
      skillId: 'preset_image_preference_slider',
      skillConfig: {
        leftLabel: 'Prefer A', rightLabel: 'Prefer B',
        prompt: 'Drag the slider toward the scene you prefer.', mediaCount: 2, mediaType: 'image',
      },
      imageCount: 2, ...MEDIA_SAMPLING,
    },
  },
  supportMatrix: {
    projectProfile: 'read/write via survey_update_project (Agent); read-only in Generate/Ask',
    surveyDraft: 'read/write — Generate: survey_submit_generated_draft; Adjust: survey_apply_operations; Ask: read-only',
    questionSettings: 'read/write with the survey draft',
    mediaLibrary: 'read via media_list; write needs media:write and approval',
    appearanceTheme: 'read/write via updateSurvey / setTheme or Generate surveyConfig.theme',
    publishDelete: 'approval-gated; not available in Generate or Ask',
    unsupported: ['arbitrary website CMS', 'SQL', 'participant account admin', 'human quota changes'],
  },
  operations: OPERATION_TYPES,
  scopes: ['surveys:read', 'surveys:write', 'surveys:publish', 'media:write', 'results:read'],
};

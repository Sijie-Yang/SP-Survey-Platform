/**
 * Worker-compatible re-export of the design protocol (duplicated as ESM
 * so the Worker bundle does not depend on CRA src/ paths).
 * Keep in sync with src/lib/designProtocol/*.
 */

import { ANNOTATION_TOOLS, normalizeAllowedTools } from './annotationTools.mjs';

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

const IMAGE_TYPES = new Set([
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagecheckbox', 'imagematrix', 'image',
  'imageannotation', 'skillquestion', 'imageslidergroup', 'imagepointallocation',
  'mediadisplay', 'mediapicker', 'mediaranking', 'mediarating', 'mediaboolean', 'mediacheckbox',
  'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
]);

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

export function validateSurveyConfig(surveyConfig) {
  const errors = [];
  const warnings = [];
  let questionCount = 0;
  if (!surveyConfig || typeof surveyConfig !== 'object' || Array.isArray(surveyConfig)) {
    return {
      valid: false,
      errors: [{ path: 'surveyConfig', message: 'surveyConfig must be an object.' }],
      warnings,
      pageCount: 0,
      questionCount,
    };
  }
  if (!Array.isArray(surveyConfig.pages)) {
    errors.push({ path: 'surveyConfig.pages', message: 'pages must be an array.' });
  } else {
    const names = new Map();
    if (surveyConfig.pages.length === 0) {
      warnings.push({ path: 'surveyConfig.pages', message: 'The survey has no pages.' });
    }
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

        if (IMAGE_TYPES.has(element.type) && element.type !== 'skillquestion') {
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
        if (
          (element.type === 'slidergroup' || element.type === 'imageslidergroup' || element.type === 'mediaslidergroup')
          && !element.dimensions?.length
        ) {
          warnings.push({
            path: elementPath,
            message: `Slider group "${element.title || element.name}" has no dimensions configured.`,
          });
        }
        if (
          (element.type === 'pointallocation'
            || element.type === 'imagepointallocation'
            || element.type === 'mediapointallocation')
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
    errors,
    warnings,
    pageCount: Array.isArray(surveyConfig.pages) ? surveyConfig.pages.length : 0,
    questionCount,
  };
}

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
    (page.elements || []).forEach((element) => {
      if (!MEDIA_STIMULUS_TYPES.includes(element.type)) return;
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
      }
      if (MEDIA_STAR_TYPES.includes(element.type)) {
        if (!element.mediaType) element.mediaType = 'any';
        if (!Array.isArray(element.mediaSlots)) element.mediaSlots = [];
        if (!element.mediaPresentation) element.mediaPresentation = 'stack';
      }
      if (element.type === 'skillquestion') {
        delete element.skillHtml;
        if (element.skillId && !String(element.skillId).startsWith('preset_')) {
          element.skillId = `preset_${element.skillId}`;
        }
        if (element.skillConfig?.mediaCount != null && element.imageCount == null) {
          element.imageCount = Number(element.skillConfig.mediaCount) || 1;
        }
      }
      delete element.imageSource;
      delete element.huggingFaceConfig;
      delete element.falApiKey;
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
  return {
    title: name,
    description: description || 'This survey helps us understand user preferences and opinions.',
    pages: [{ name: 'page1', title: 'Survey Questions', elements: [] }],
    showQuestionNumbers: 'off',
    showProgressBar: 'top',
    completedHtml: '<h3>Thank you for completing the survey.</h3>',
  };
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
  questionTypes: [
    'text', 'comment', 'number', 'radiogroup', 'checkbox', 'dropdown', 'boolean', 'rating',
    'matrix', 'ranking', 'slidergroup', 'pointallocation', 'consent',
    'expression',
    'image', 'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagecheckbox',
    'imagematrix', 'imageslidergroup', 'imagepointallocation', 'imageannotation',
    'mediadisplay', 'mediapicker', 'mediaranking', 'mediarating', 'mediaboolean', 'mediacheckbox',
    'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
    'skillquestion',
  ],
  rules: [
    'Question names must be unique across the survey.',
    'Prefer deterministic operations over full surveyConfig replace.',
    'Never send API keys or storage credentials.',
    'Saves update the live participant URL immediately (preview / share / view-live).',
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
      category: 'mediaPerCategory from each category-tagged folder.',
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
      slidergroup: { fields: ['name', 'title', 'dimensions[{id,left,right}]', 'scaleMin', 'scaleMax'] },
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
  operations: [
    'addPage', 'removePage', 'addQuestion', 'updateQuestion', 'removeQuestion',
    'setAllRatingScales', 'replaceConfig',
  ],
  scopes: ['surveys:read', 'surveys:write', 'surveys:publish', 'media:write', 'results:read'],
};

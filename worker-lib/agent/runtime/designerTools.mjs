import { DESIGN_CAPABILITIES } from '../../designProtocol.mjs';
import {
  applyProjectOperations,
  getDraft,
} from '../projectHandlers.mjs';
import { normalizeOperationsArg, validateSurveyConfig } from '../../designProtocol.mjs';
import {
  PLATFORM_SCHEMA,
  PLATFORM_SCHEMA_HASH,
  QUESTION_TYPE_IDS,
} from '../../platformSchema.generated.mjs';
import {
  applyToolContract,
  capabilityHasContent,
  classifySubmitDraftError,
  expandSurveyConfigForTools,
  publicOperationContracts,
  questionsCapabilitySchema,
  SLIDER_DIMENSION_CONTRACT,
} from './applySchema.mjs';
import { summarizeSurveyConfig } from './generateGoals.mjs';
import { modeToolError } from './modes.mjs';
import {
  getGenerationContract,
  getPresetSkillContract,
  listGenerationContracts,
  listPresetSkillContracts,
  settingsCapabilityCatalog,
  GENERATION_CONTRACT_VERSION,
} from '../../generationContracts.mjs';
import { draftCatalog, pickQuestion } from './toolArgs.mjs';
import { evaluateSurveyContract } from '../../answerability.mjs';

function skillsCapabilitySchema(skillId) {
  const guide = DESIGN_CAPABILITIES.questionTypeGuide?.skillquestion || {};
  if (skillId) {
    const preset = getPresetSkillContract(skillId);
    if (!preset) {
      return {
        skillId,
        found: false,
        skillPresets: listPresetSkillContracts().map((item) => item.skillId),
        note: 'Unknown preset. Load domain=skills without skillId for the catalog.',
      };
    }
    return { found: true, ...preset, generationContractVersion: GENERATION_CONTRACT_VERSION };
  }
  return {
    resultSchemaTypes: guide.resultSchemaTypes || [],
    skillPresets: listPresetSkillContracts(),
    note: guide.note || 'Generate may read these contracts. Do not write skillHtml onto questions.',
    generationContractVersion: GENERATION_CONTRACT_VERSION,
  };
}

function generateOverview() {
  const submit = {
    tool: 'survey_submit_generated_draft',
    required: ['expectedDraftUpdatedAt', 'surveyConfig'],
    surveyConfig: expandSurveyConfigForTools(PLATFORM_SCHEMA),
  };
  return {
    name: DESIGN_CAPABILITIES.name,
    version: DESIGN_CAPABILITIES.version,
    platformSchemaHash: PLATFORM_SCHEMA_HASH,
    questionTypes: QUESTION_TYPE_IDS,
    rules: [
      ...DESIGN_CAPABILITIES.rules.filter((rule) => !/deterministic operations|full surveyConfig replace/i.test(rule)),
      'Generate mode saves only through survey_submit_generated_draft with expectedDraftUpdatedAt and a complete surveyConfig.',
    ],
    submit,
    mediaAssignment: {
      default: 'huggingface_random with empty choices; do not invent media URLs',
    },
    supportMatrix: {
      ...DESIGN_CAPABILITIES.supportMatrix,
      surveyDraft: 'read/write through survey_submit_generated_draft only',
      publishDelete: 'not available in Generate',
    },
    sliderDimensions: SLIDER_DIMENSION_CONTRACT,
    generationContractVersion: GENERATION_CONTRACT_VERSION,
    recommendedVisualTypes: [
      'imagerating', 'imageslidergroup', 'imagepicker', 'imageranking',
      'imagecheckbox', 'imageboolean', 'imageannotation',
      'preset_image_preference_slider', 'preset_best_worst_choice',
    ],
    next: {
      read: {
        tool: 'survey_capabilities',
        args: { domain: 'questions', questionType: 'imageslidergroup' },
        note: 'Query one questionType, fieldGroup, or skillId for the full contract. Repeat queries of the same version are cached.',
      },
    },
  };
}

function compactQuestionsSchema() {
  const full = questionsCapabilitySchema();
  return {
    questionTypeIds: Object.keys(full.questionTypes || {}),
    fieldGroups: Object.keys(full.questionFieldGroups || {}),
    sliderDimensions: SLIDER_DIMENSION_CONTRACT,
    generationContractVersion: GENERATION_CONTRACT_VERSION,
    types: Object.fromEntries(listGenerationContracts().map((contract) => [contract.type, {
      label: contract.label,
      group: contract.group,
      traits: contract.traits,
      useWhen: contract.useWhen,
      answerOptions: contract.answerOptions,
      editorBlankDefaults: contract.editorBlankDefaults,
      requiredFields: contract.requiredFields,
    }])),
    next: {
      read: {
        tool: 'survey_capabilities',
        args: { domain: 'questions', questionType: '<typeId>' },
      },
    },
  };
}

function domainCapability(domain, assistantMode, query = {}) {
  if (domain === 'survey') {
    return {
      survey: PLATFORM_SCHEMA.entities?.survey,
      page: PLATFORM_SCHEMA.entities?.page,
    };
  }
  if (domain === 'questions') {
    if (query.questionType) {
      return getGenerationContract(query.questionType);
    }
    if (query.fieldGroup) {
      const fields = PLATFORM_SCHEMA.questionFieldGroups?.[query.fieldGroup] || [];
      const types = Object.entries(PLATFORM_SCHEMA.questionTypes || {})
        .filter(([, definition]) => (definition.fieldGroups || []).includes(query.fieldGroup))
        .map(([id]) => id);
      return {
        fieldGroup: query.fieldGroup,
        fields,
        types,
        fieldSchemas: Object.fromEntries(fields.map((name) => [name, PLATFORM_SCHEMA.questionFields?.[name]])),
        generationContractVersion: GENERATION_CONTRACT_VERSION,
      };
    }
    return assistantMode === 'generate' ? compactQuestionsSchema() : {
      ...questionsCapabilitySchema(),
      generationContractVersion: GENERATION_CONTRACT_VERSION,
      next: { read: { tool: 'survey_capabilities', args: { domain: 'questions', questionType: '<typeId>' } } },
    };
  }
  if (domain === 'media') {
    return {
      imageSelectionMode: ['huggingface_random', 'huggingface_manual'],
      mediaAssignmentMode: ['individual', 'set', 'category'],
      answerOptions: {
        runtime_media_pool: 'imagepicker / imageranking / ratings can keep choices empty when sampling from the project media library.',
        researcher_defined: 'checkbox tags, matrix rows/columns, slider dimensions, and allocation choices must be written by the researcher.',
      },
    };
  }
  if (domain === 'skills') return skillsCapabilitySchema(query.skillId);
  if (domain === 'settings') return settingsCapabilityCatalog();
  if (domain === 'project') return { fields: Object.keys(PLATFORM_SCHEMA.entities?.project?.fields || {}) };
  if (domain === 'operations') {
    if (assistantMode === 'generate') {
      return {
        submit: 'survey_submit_generated_draft',
        required: ['expectedDraftUpdatedAt', 'surveyConfig'],
        allowedOps: ['replaceConfig'],
        surveyConfig: expandSurveyConfigForTools(PLATFORM_SCHEMA),
        note: 'The server wraps surveyConfig as one replaceConfig. Do not send operations.',
      };
    }
    return {
      allowedOps: Object.keys(publicOperationContracts(assistantMode)),
      contracts: publicOperationContracts(assistantMode),
    };
  }
  return null;
}

async function saveReplaceConfig({
  env,
  accessToken,
  scopedId,
  expectedDraftUpdatedAt,
  surveyConfig,
  writerSource,
  ownerUserId,
  generateGoal,
}) {
  const contract = evaluateSurveyContract(surveyConfig, {
    mode: 'generate',
    generateGoal,
    strictAll: true,
  });
  if (!contract.ok) {
    throw modeToolError({
      code: generateGoal ? 'GENERATE_GOAL' : 'UNANSWERABLE_QUESTION',
      path: contract.errors[0]?.path || 'surveyConfig',
      expected: generateGoal ? {
        minPages: generateGoal.minPages,
        requiredCoverage: generateGoal.coverMostTypes,
      } : undefined,
      receivedShape: {
        pageCount: contract.pageCount,
        questionCount: contract.questionCount,
        coveredTypes: contract.coveredTypes,
        issues: contract.errors,
      },
      repairHint: contract.errors.map((item) => item.repairHint || item.reason).join(' '),
      retryAction: 'repair_args',
      message: `Generated survey does not meet the contract: ${contract.errors[0]?.reason || 'goal failed'}`,
    });
  }
  const result = await applyProjectOperations(env, accessToken, scopedId, {
    expectedDraftUpdatedAt,
    operations: [{ op: 'replaceConfig', surveyConfig }],
  }, writerSource, ownerUserId);
  const stats = summarizeSurveyConfig(result.surveyConfig);
  return {
    summary: `Applied ${result.applied?.length || 0} operation(s) and saved`,
    draftUpdatedAt: result.draftUpdatedAt,
    applied: result.applied,
    inverse: result.inverse,
    validation: result.validation,
    surveyConfig: result.surveyConfig,
    pageCount: stats.pageCount,
    questionCount: stats.questionCount,
    types: stats.types,
  };
}

export function createDesignerTools({
  env,
  accessToken,
  projectId,
  getProjectId,
  request,
  writerSource = 'assistant',
  ownerUserId = null,
  assistantMode = 'agent',
  generateGoal = null,
  editorContext = null,
} = {}) {
  const currentProjectId = () => getProjectId?.() || projectId;
  const applyContract = applyToolContract({ mode: assistantMode === 'generate' ? 'agent' : assistantMode || 'agent' });
  const submitSchema = expandSurveyConfigForTools(PLATFORM_SCHEMA);
  const capabilityCache = new Map();
  const cacheKey = (query) => JSON.stringify({
    assistantMode,
    hash: PLATFORM_SCHEMA_HASH,
    version: GENERATION_CONTRACT_VERSION,
    ...query,
  });
  const tools = [
    {
      name: 'survey_capabilities',
      description: assistantMode === 'generate'
        ? 'Read generate contracts. Query overview first, then questionType / fieldGroup / skillId for full fields. Repeats of the same version are cached.'
        : 'Read SP-Survey contracts. Query by domain, questionType, fieldGroup, or skillId. Same-version repeats are cached.',
      minPermission: 'ask',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            enum: ['overview', 'survey', 'questions', 'media', 'skills', 'settings', 'project', 'operations'],
          },
          questionType: { type: 'string' },
          fieldGroup: { type: 'string' },
          skillId: { type: 'string' },
        },
      },
      async execute(args) {
        const domain = args?.domain || 'overview';
        const query = {
          domain,
          questionType: args?.questionType || '',
          fieldGroup: args?.fieldGroup || '',
          skillId: args?.skillId || '',
        };
        const key = cacheKey(query);
        if (capabilityCache.has(key)) {
          return {
            summary: `Already loaded ${domain} contract for this schema version`,
            cached: true,
            platformSchemaHash: PLATFORM_SCHEMA_HASH,
            generationContractVersion: GENERATION_CONTRACT_VERSION,
            query,
            next: { read: 'Use the earlier result, or query a different questionType / fieldGroup / skillId.' },
          };
        }
        let payload;
        if (domain === 'overview') {
          payload = {
            summary: 'Loaded overview capabilities',
            capabilities: assistantMode === 'generate' ? generateOverview() : DESIGN_CAPABILITIES,
            generateApply: assistantMode === 'generate'
              ? {
                tool: 'survey_submit_generated_draft',
                required: ['expectedDraftUpdatedAt', 'surveyConfig'],
                surveyConfig: submitSchema,
              }
              : undefined,
            platformSchemaHash: PLATFORM_SCHEMA_HASH,
            generationContractVersion: GENERATION_CONTRACT_VERSION,
          };
        } else {
          const schema = domainCapability(domain, assistantMode, query);
          if (!capabilityHasContent(schema)) {
            throw Object.assign(new Error(`No ${domain} capabilities available.`), {
              status: 400,
              code: 'CAPABILITIES_EMPTY',
            });
          }
          payload = {
            summary: `Loaded ${domain} capabilities`,
            schema,
            platformSchemaHash: PLATFORM_SCHEMA_HASH,
            generationContractVersion: GENERATION_CONTRACT_VERSION,
          };
        }
        capabilityCache.set(key, true);
        return payload;
      },
    },
    {
      name: 'survey_get_draft',
      description: 'Read the saved draft catalog or one page/question. view=workingCopy reads unsaved editor fields without saving. Always retain draftUpdatedAt.',
      minPermission: 'ask',
      parameters: {
        type: 'object',
        properties: {
          view: { type: 'string', enum: ['catalog', 'page', 'question', 'full', 'workingCopy'] },
          pageName: { type: 'string' },
          questionName: { type: 'string' },
          source: { type: 'string', enum: ['saved', 'workingCopy'] },
        },
      },
      async execute(args) {
        const scopedId = currentProjectId();
        if (!scopedId) throw new Error('projectId is required');
        const view = args?.view || (args?.questionName ? 'question' : args?.pageName ? 'page' : 'full');
        const source = args?.source || (view === 'workingCopy' ? 'workingCopy' : 'saved');
        if (source === 'workingCopy' || view === 'workingCopy') {
          const copy = editorContext?.workingCopy || null;
          const pageCopy = editorContext?.pageWorkingCopy || null;
          return {
            summary: 'Unsaved editor working copy (not saved; this read does not persist)',
            source: 'workingCopy',
            saved: false,
            draftUpdatedAt: editorContext?.draftUpdatedAt || null,
            pageName: editorContext?.pageName || args?.pageName || '',
            questionName: editorContext?.questionName || args?.questionName || '',
            workingCopy: copy,
            pageWorkingCopy: pageCopy,
          };
        }
        const draft = await getDraft(env, accessToken, scopedId, request, ownerUserId);
        const catalog = draftCatalog(draft.surveyConfig);
        const base = {
          summary: `Draft "${draft.surveyConfig?.title || scopedId}" loaded`,
          projectId: scopedId,
          source: 'saved',
          draftUpdatedAt: draft.draftUpdatedAt,
          validation: draft.validation,
          urls: draft.urls,
          catalog,
          generationContractVersion: GENERATION_CONTRACT_VERSION,
        };
        if (view === 'catalog') {
          return { ...base, summary: 'Draft catalog loaded', pageCount: catalog.length };
        }
        if (view === 'page') {
          const page = (draft.surveyConfig?.pages || []).find((item) => item?.name === args.pageName);
          if (!page) throw Object.assign(new Error(`Page not found: ${args.pageName}`), { status: 404 });
          return { ...base, summary: `Page ${args.pageName} loaded`, page };
        }
        if (view === 'question') {
          const found = pickQuestion(draft.surveyConfig, args.pageName, args.questionName);
          if (!found) throw Object.assign(new Error(`Question not found: ${args.questionName}`), { status: 404 });
          return { ...base, summary: `Question ${args.questionName} loaded`, ...found };
        }
        return { ...base, surveyConfig: draft.surveyConfig };
      },
    },
    {
      name: 'survey_validate',
      description: 'Validate a candidate surveyConfig or the current saved draft. Returns target=candidate|currentDraft plus page/question counts.',
      minPermission: 'ask',
      parameters: {
        type: 'object',
        properties: { surveyConfig: { type: 'object' } },
      },
      async execute(args) {
        const hasSurveyConfig = Object.prototype.hasOwnProperty.call(args || {}, 'surveyConfig');
        if (hasSurveyConfig || args?.pages || args?.operations || args?.arguments) {
          const config = args?.surveyConfig;
          if (!config || typeof config !== 'object' || Array.isArray(config) || !Array.isArray(config.pages)) {
            throw modeToolError({
              code: 'VALIDATE_CANDIDATE_INCOMPLETE',
              path: 'surveyConfig',
              message: 'Candidate validation requires a complete surveyConfig object with pages. The current draft was not checked.',
              retryAction: 'repair_args',
              repairHint: 'Resend survey_validate with the full candidate surveyConfig, or omit surveyConfig to check the saved draft.',
            });
          }
          const scopedId = currentProjectId();
          let baseline = null;
          if (scopedId) {
            try {
              const draft = await getDraft(env, accessToken, scopedId, request, ownerUserId);
              baseline = draft.surveyConfig;
            } catch {
              baseline = null;
            }
          }
          const validation = validateSurveyConfig(config, {
            baseline,
            mode: assistantMode,
            generateGoal: assistantMode === 'generate' ? generateGoal : null,
            strictAll: assistantMode === 'generate',
          });
          const stats = summarizeSurveyConfig(config);
          return {
            summary: validation.valid ? 'Candidate is valid' : 'Candidate has errors',
            target: 'candidate',
            pageCount: stats.pageCount,
            questionCount: stats.questionCount,
            types: stats.types,
            identity: {
              title: config.title || '',
              pageNames: (config.pages || []).map((page) => page?.name).filter(Boolean),
            },
            validation,
          };
        }
        const scopedId = currentProjectId();
        if (!scopedId) throw new Error('projectId is required');
        const draft = await getDraft(env, accessToken, scopedId, request, ownerUserId);
        const validation = validateSurveyConfig(draft.surveyConfig, { mode: 'compat' });
        const stats = summarizeSurveyConfig(draft.surveyConfig);
        return {
          summary: validation.valid ? 'Current draft is valid' : 'Current draft has errors',
          target: 'currentDraft',
          pageCount: stats.pageCount,
          questionCount: stats.questionCount,
          types: stats.types,
          identity: {
            title: draft.surveyConfig?.title || '',
            draftUpdatedAt: draft.draftUpdatedAt,
            pageNames: (draft.surveyConfig?.pages || []).map((page) => page?.name).filter(Boolean),
          },
          validation,
        };
      },
    },
    {
      name: 'survey_preview_urls',
      description: 'Return preview and live share URLs for this project.',
      minPermission: 'ask',
      parameters: { type: 'object', properties: {} },
      async execute() {
        const scopedId = currentProjectId();
        if (!scopedId) throw new Error('projectId is required');
        const draft = await getDraft(env, accessToken, scopedId, request, ownerUserId);
        return { summary: 'Preview URLs ready', urls: draft.urls };
      },
    },
  ];

  if (assistantMode === 'generate') {
    tools.splice(3, 0, {
      name: 'survey_submit_generated_draft',
      description: 'Save a complete generated survey. Provide expectedDraftUpdatedAt from survey_get_draft and surveyConfig with title and pages[{name, elements:[{type,name}]}]. The server wraps this as one replaceConfig.',
      minPermission: 'edit_draft',
      parameters: {
        type: 'object',
        additionalProperties: true,
        required: ['expectedDraftUpdatedAt', 'surveyConfig'],
        properties: {
          expectedDraftUpdatedAt: { type: 'string' },
          surveyConfig: submitSchema,
        },
      },
      async execute(args) {
        const scopedId = currentProjectId();
        if (!scopedId) throw new Error('projectId is required');
        const contractError = classifySubmitDraftError(args);
        if (contractError) throw modeToolError(contractError);
        return saveReplaceConfig({
          env,
          accessToken,
          scopedId,
          expectedDraftUpdatedAt: args.expectedDraftUpdatedAt,
          surveyConfig: args.surveyConfig,
          writerSource,
          ownerUserId,
          generateGoal,
        });
      },
    });
  } else {
    tools.splice(3, 0, {
      name: 'survey_apply_operations',
      description: applyContract.description,
      minPermission: 'edit_draft',
      parameters: applyContract.parameters,
      async execute(args) {
        const scopedId = currentProjectId();
        if (!scopedId) throw new Error('projectId is required');
        const operations = normalizeOperationsArg(args?.operations);
        if (!Array.isArray(operations)) {
          throw modeToolError({
            code: 'INVALID_TOOL_ARGUMENTS',
            path: 'operations',
            message: 'operations must be an array of {op, ...}. A single replaceConfig object is also accepted.',
            retryAction: 'repair_args',
            repairHint: 'Resend survey_apply_operations with operations:[{op:"replaceConfig",surveyConfig:{title,pages}}]. Do not send a prose JSON blob or an operations object.',
          });
        }
        const result = await applyProjectOperations(env, accessToken, scopedId, {
          expectedDraftUpdatedAt: args.expectedDraftUpdatedAt,
          operations,
          assistantMode,
        }, writerSource, ownerUserId);
        const stats = summarizeSurveyConfig(result.surveyConfig);
        return {
          summary: `Applied ${result.applied?.length || 0} operation(s) and saved`,
          draftUpdatedAt: result.draftUpdatedAt,
          applied: result.applied,
          inverse: result.inverse,
          validation: result.validation,
          surveyConfig: result.surveyConfig,
          pageCount: stats.pageCount,
          questionCount: stats.questionCount,
          types: stats.types,
        };
      },
    });
  }
  return tools;
}

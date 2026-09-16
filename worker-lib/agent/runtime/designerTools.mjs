import { DESIGN_CAPABILITIES } from '../../designProtocol.mjs';
import {
  applyProjectOperations,
  getDraft,
} from '../projectHandlers.mjs';
import { validateSurveyConfig } from '../../designProtocol.mjs';
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
} from './applySchema.mjs';
import { evaluateGenerateGoals, summarizeSurveyConfig } from './generateGoals.mjs';
import { modeToolError } from './modes.mjs';

function skillsCapabilitySchema() {
  const guide = DESIGN_CAPABILITIES.questionTypeGuide?.skillquestion || {};
  return {
    resultSchemaTypes: guide.resultSchemaTypes || [],
    skillPresets: (guide.skillPresets || []).map((preset) => ({
      skillId: preset.skillId,
      useWhen: preset.useWhen,
      imageCount: preset.imageCount,
    })),
    note: guide.note || '',
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
  };
}

function compactQuestionsSchema() {
  const full = questionsCapabilitySchema();
  return {
    questionTypeIds: Object.keys(full.questionTypes || {}),
    fieldGroups: Object.keys(full.questionFieldGroups || {}),
    types: Object.fromEntries(Object.entries(full.questionTypes || {}).map(([id, definition]) => [id, {
      label: definition.label,
      group: definition.group,
      traits: definition.traits,
      defaults: definition.defaults,
      fields: ['slidergroup', 'imageslidergroup', 'mediaslidergroup'].includes(id)
        ? ['dimensions[{id,label,left,right,min?,max?,step?}]', 'scaleMin', 'scaleMax', 'scaleStep']
        : undefined,
    }])),
  };
}

function domainCapability(domain, assistantMode) {
  if (domain === 'survey') {
    return {
      survey: PLATFORM_SCHEMA.entities?.survey,
      page: PLATFORM_SCHEMA.entities?.page,
    };
  }
  if (domain === 'questions') {
    return assistantMode === 'generate' ? compactQuestionsSchema() : questionsCapabilitySchema();
  }
  if (domain === 'media') {
    return {
      imageSelectionMode: ['huggingface_random', 'huggingface_manual'],
      mediaAssignmentMode: ['individual', 'set', 'category'],
    };
  }
  if (domain === 'skills') return skillsCapabilitySchema();
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
  if (generateGoal) {
    const goal = evaluateGenerateGoals(surveyConfig, generateGoal);
    if (!goal.ok) {
      throw modeToolError({
        code: 'GENERATE_GOAL',
        path: goal.errors[0]?.path || 'surveyConfig',
        expected: {
          minPages: generateGoal.minPages,
          requiredCoverage: goal.requiredCoverage,
          answerTypeDenominator: goal.answerTypeDenominator,
        },
        receivedShape: {
          pageCount: goal.pageCount,
          questionCount: goal.questionCount,
          types: goal.types,
          coveredTypes: goal.coveredTypes,
        },
        repairHint: goal.errors.map((item) => item.message).join(' '),
        retryAction: 'repair_args',
        message: `Generated survey does not meet the requested goal: ${goal.errors[0]?.message || 'goal failed'}`,
      });
    }
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
} = {}) {
  const currentProjectId = () => getProjectId?.() || projectId;
  const applyContract = applyToolContract({ mode: assistantMode === 'generate' ? 'agent' : assistantMode || 'agent' });
  const submitSchema = expandSurveyConfigForTools(PLATFORM_SCHEMA);
  const tools = [
    {
      name: 'survey_capabilities',
      description: assistantMode === 'generate'
        ? 'Read the generate submit contract and compact question/media rules. Call first.'
        : 'Read SP-Survey question types, media assignment, and Skill rules. Call first when designing.',
      minPermission: 'ask',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            enum: ['overview', 'survey', 'questions', 'media', 'skills', 'project', 'operations'],
          },
        },
      },
      async execute(args) {
        const domain = args?.domain || 'overview';
        if (domain === 'overview') {
          return {
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
          };
        }
        const schema = domainCapability(domain, assistantMode);
        if (!capabilityHasContent(schema)) {
          throw Object.assign(new Error(`No ${domain} capabilities available.`), {
            status: 400,
            code: 'CAPABILITIES_EMPTY',
          });
        }
        return {
          summary: `Loaded ${domain} capabilities`,
          schema,
          platformSchemaHash: PLATFORM_SCHEMA_HASH,
        };
      },
    },
    {
      name: 'survey_get_draft',
      description: 'Load the current project draft. Always call before a write and retain draftUpdatedAt.',
      minPermission: 'ask',
      parameters: { type: 'object', properties: {} },
      async execute() {
        const scopedId = currentProjectId();
        if (!scopedId) throw new Error('projectId is required');
        const draft = await getDraft(env, accessToken, scopedId, request, ownerUserId);
        return {
          summary: `Draft "${draft.surveyConfig?.title || scopedId}" loaded`,
          projectId: scopedId,
          draftUpdatedAt: draft.draftUpdatedAt,
          surveyConfig: draft.surveyConfig,
          validation: draft.validation,
          urls: draft.urls,
        };
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
          const validation = validateSurveyConfig(config);
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
        const validation = validateSurveyConfig(draft.surveyConfig);
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
        const result = await applyProjectOperations(env, accessToken, scopedId, {
          expectedDraftUpdatedAt: args.expectedDraftUpdatedAt,
          operations: args.operations,
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

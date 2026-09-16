import { DESIGN_CAPABILITIES } from '../../designProtocol.mjs';
import {
  applyProjectOperations,
  getDraft,
} from '../projectHandlers.mjs';
import { validateSurveyConfig } from '../../designProtocol.mjs';
import {
  OPERATION_ITEM_SCHEMA,
  PLATFORM_SCHEMA,
  PLATFORM_SCHEMA_HASH,
} from '../../platformSchema.generated.mjs';

export function createDesignerTools({
  env,
  accessToken,
  projectId,
  getProjectId,
  request,
  writerSource = 'assistant',
  ownerUserId = null,
}) {
  const currentProjectId = () => getProjectId?.() || projectId;
  return [
    {
      name: 'survey_capabilities',
      description: 'Read SP-Survey question types, media assignment, and Skill rules. Call first when designing.',
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
        const domainSchema = {
          survey: {
            survey: PLATFORM_SCHEMA.entities?.survey,
            page: PLATFORM_SCHEMA.entities?.page,
            theme: PLATFORM_SCHEMA.entities?.theme,
          },
          questions: {
            commonFields: PLATFORM_SCHEMA.commonQuestionFields,
            questionTypes: PLATFORM_SCHEMA.questionTypes,
          },
          media: {
            mediaItem: PLATFORM_SCHEMA.entities?.mediaItem,
            mediaDataset: PLATFORM_SCHEMA.entities?.mediaDataset,
          },
          skills: {
            skill: PLATFORM_SCHEMA.entities?.skill,
            skillResultFamilies: PLATFORM_SCHEMA.skillResultFamilies,
          },
          project: PLATFORM_SCHEMA.entities?.project,
          operations: PLATFORM_SCHEMA.operations,
        }[domain];
        return {
          summary: `Loaded ${domain} capabilities`,
          capabilities: domain === 'overview' ? DESIGN_CAPABILITIES : undefined,
          schema: domainSchema,
          platformSchemaHash: PLATFORM_SCHEMA_HASH,
        };
      },
    },
    {
      name: 'survey_get_draft',
      description: 'Load the current project draft. Always call before apply_operations.',
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
      description: 'Validate a surveyConfig without saving.',
      minPermission: 'ask',
      parameters: {
        type: 'object',
        properties: { surveyConfig: { type: 'object' } },
      },
      async execute(args) {
        const config = args.surveyConfig;
        if (!config) {
          const scopedId = currentProjectId();
          if (!scopedId) throw new Error('projectId is required');
          const draft = await getDraft(env, accessToken, scopedId, request, ownerUserId);
          const validation = validateSurveyConfig(draft.surveyConfig);
          return { summary: validation.valid ? 'Draft is valid' : 'Draft has errors', validation };
        }
        const validation = validateSurveyConfig(config);
        return { summary: validation.valid ? 'Config is valid' : 'Config has errors', validation };
      },
    },
    {
      name: 'survey_apply_operations',
      description: 'Apply operations and save the draft. For a new or complete redesign, use one replaceConfig operation. For small edits use addPage, removePage, addQuestion, updateQuestion, removeQuestion, setAllRatingScales, updateSurvey, updatePage, setTheme, reorderPages, or reorderQuestions. Requires the latest expectedDraftUpdatedAt from survey_get_draft.',
      minPermission: 'edit_draft',
      parameters: {
        type: 'object',
        properties: {
          expectedDraftUpdatedAt: { type: 'string' },
          operations: {
            type: 'array',
            items: OPERATION_ITEM_SCHEMA,
          },
        },
        required: ['expectedDraftUpdatedAt', 'operations'],
      },
      async execute(args) {
        const scopedId = currentProjectId();
        if (!scopedId) throw new Error('projectId is required');
        const result = await applyProjectOperations(env, accessToken, scopedId, {
          expectedDraftUpdatedAt: args.expectedDraftUpdatedAt,
          operations: args.operations,
        }, writerSource, ownerUserId);
        return {
          summary: `Applied ${result.applied?.length || 0} operation(s) and saved`,
          draftUpdatedAt: result.draftUpdatedAt,
          applied: result.applied,
          inverse: result.inverse,
          validation: result.validation,
          surveyConfig: result.surveyConfig,
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
}

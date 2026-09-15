import { DESIGN_CAPABILITIES } from '../../designProtocol.mjs';
import {
  applyProjectOperations,
  getDraft,
} from '../projectHandlers.mjs';
import { validateSurveyConfig } from '../../designProtocol.mjs';

export function createDesignerTools({ env, accessToken, projectId, request, writerSource = 'assistant' }) {
  return [
    {
      name: 'survey_capabilities',
      description: 'Read SP-Survey question types, media assignment, and Skill rules. Call first when designing.',
      minPermission: 'ask',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return {
          summary: 'Loaded design capabilities',
          capabilities: DESIGN_CAPABILITIES,
        };
      },
    },
    {
      name: 'survey_get_draft',
      description: 'Load the current project draft. Always call before apply_operations.',
      minPermission: 'ask',
      parameters: { type: 'object', properties: {} },
      async execute() {
        if (!projectId) throw new Error('projectId is required');
        const draft = await getDraft(env, accessToken, projectId, request);
        return {
          summary: `Draft "${draft.surveyConfig?.title || projectId}" loaded`,
          projectId,
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
          const draft = await getDraft(env, accessToken, projectId, request);
          const validation = validateSurveyConfig(draft.surveyConfig);
          return { summary: validation.valid ? 'Draft is valid' : 'Draft has errors', validation };
        }
        const validation = validateSurveyConfig(config);
        return { summary: validation.valid ? 'Config is valid' : 'Config has errors', validation };
      },
    },
    {
      name: 'survey_apply_operations',
      description: 'Apply incremental operations and save the live draft. Requires expectedDraftUpdatedAt from survey_get_draft.',
      minPermission: 'edit_draft',
      parameters: {
        type: 'object',
        properties: {
          expectedDraftUpdatedAt: { type: 'string' },
          operations: { type: 'array', items: { type: 'object' } },
        },
        required: ['expectedDraftUpdatedAt', 'operations'],
      },
      async execute(args) {
        if (!projectId) throw new Error('projectId is required');
        const result = await applyProjectOperations(env, accessToken, projectId, {
          expectedDraftUpdatedAt: args.expectedDraftUpdatedAt,
          operations: args.operations,
        }, writerSource);
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
        const draft = await getDraft(env, accessToken, projectId, request);
        return { summary: 'Preview URLs ready', urls: draft.urls };
      },
    },
  ];
}

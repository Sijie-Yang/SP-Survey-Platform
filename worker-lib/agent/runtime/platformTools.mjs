import { supabaseRest } from '../../supabaseUserClient.mjs';
import {
  deleteOwnedProject,
  deleteProjectMedia,
  duplicateProject,
  exportProject,
  getMediaDataset,
  getTemplate,
  importProject,
  importMediaFromTemplate,
  createFromTemplate,
  applyMainPage,
  listProjectMedia,
  listTemplates,
  saveAsTemplate,
  updateMediaDataset,
} from '../projectLifecycle.mjs';
import { exportResponses, listResponses, summarizeResponses } from '../resultsHandlers.mjs';
import { getSkill, listSkills, saveSkill } from '../skillHandlers.mjs';
import {
  createProject,
  listVersions,
  publishProject,
  updateProjectMeta,
} from '../projectHandlers.mjs';

const PROJECT_ID = {
  type: 'object',
  properties: { projectId: { type: 'string' } },
  required: ['projectId'],
};

function scopedProject(args, currentProjectId) {
  const projectId = args?.projectId || currentProjectId;
  if (!projectId) throw Object.assign(new Error('projectId is required'), { status: 400 });
  return projectId;
}

export function createPlatformTools({
  env,
  userId,
  accessToken,
  projectId: currentProjectId,
  request,
}) {
  const serviceRole = !accessToken;
  const ctx = { accessToken, userId, serviceRole };
  return [
    {
      name: 'survey_list_projects',
      description: 'List survey projects owned by the user.',
      minPermission: 'ask',
      domain: 'project',
      executionMode: 'parallel',
      parameters: { type: 'object', properties: {} },
      async execute() {
        const rows = await supabaseRest(env, {
          path: '/rest/v1/projects',
          accessToken,
          serviceRole,
          query: serviceRole
            ? `?user_id=eq.${encodeURIComponent(userId)}&select=id,name,description,updated_at,draft_updated_at,published_version`
            : '?select=id,name,description,updated_at,draft_updated_at,published_version',
        });
        return { summary: `Found ${(rows || []).length} projects`, projects: rows || [] };
      },
    },
    {
      name: 'survey_list_templates',
      description: 'List available survey templates.',
      minPermission: 'ask',
      domain: 'templates',
      executionMode: 'parallel',
      parameters: { type: 'object', properties: {} },
      async execute() {
        const result = await listTemplates(env, ctx);
        return { summary: `Found ${(result.templates || []).length} templates`, ...result };
      },
    },
    {
      name: 'survey_create_project',
      description: 'Create a new owned project, optionally with a complete valid surveyConfig.',
      minPermission: 'edit_draft',
      domain: 'project',
      executionMode: 'exclusive',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          surveyConfig: { type: 'object' },
        },
        required: ['name'],
      },
      execute: (args) => createProject(env, accessToken, userId, args, request),
    },
    {
      name: 'survey_update_project',
      description: 'Update an owned project name, description, or research metadata.',
      minPermission: 'edit_draft',
      domain: 'project',
      executionMode: 'exclusive',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          metadata: { type: 'object' },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      execute: (args) => updateProjectMeta(
        env,
        accessToken,
        scopedProject(args, currentProjectId),
        args,
        serviceRole ? userId : null,
      ),
    },
    {
      name: 'survey_duplicate_project',
      description: 'Duplicate an owned project and optionally copy its media.',
      minPermission: 'edit_draft',
      domain: 'project',
      executionMode: 'exclusive',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          name: { type: 'string' },
          copyMedia: { type: 'boolean' },
        },
      },
      execute: (args) => duplicateProject(
        env,
        ctx,
        scopedProject(args, currentProjectId),
        args,
        request,
      ),
    },
    {
      name: 'survey_export_project',
      description: 'Read an owned project as a portable export bundle.',
      minPermission: 'ask',
      domain: 'project',
      executionMode: 'parallel',
      parameters: PROJECT_ID,
      execute: (args) => exportProject(env, ctx, scopedProject(args, currentProjectId)),
    },
    {
      name: 'survey_import_project',
      description: 'Create an owned project from a portable SP-Survey export bundle.',
      minPermission: 'edit_draft',
      domain: 'project',
      executionMode: 'exclusive',
      parameters: {
        type: 'object',
        properties: {
          bundle: { type: 'object' },
          name: { type: 'string' },
        },
        required: ['bundle'],
      },
      execute: (args) => importProject(env, ctx, {
        package: {
          ...args.bundle,
          ...(args.name ? { name: args.name } : {}),
        },
      }, request),
    },
    {
      name: 'survey_get_template',
      description: 'Read one published survey template.',
      minPermission: 'ask',
      domain: 'templates',
      executionMode: 'parallel',
      parameters: {
        type: 'object',
        properties: { templateId: { type: 'string' } },
        required: ['templateId'],
      },
      execute: (args) => getTemplate(env, ctx, args.templateId),
    },
    {
      name: 'survey_create_from_template',
      description: 'Create an owned project from an existing template.',
      minPermission: 'edit_draft',
      domain: 'templates',
      executionMode: 'exclusive',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string' },
          name: { type: 'string' },
          copyMedia: { type: 'boolean' },
        },
        required: ['templateId'],
      },
      execute: (args) => createFromTemplate(env, ctx, args, request),
    },
    {
      name: 'media_list',
      description: 'List media and media-dataset metadata for an owned project.',
      minPermission: 'ask',
      domain: 'media',
      executionMode: 'parallel',
      parameters: PROJECT_ID,
      async execute(args) {
        return listProjectMedia(env, ctx, scopedProject(args, currentProjectId));
      },
    },
    {
      name: 'survey_save_as_template',
      description: 'Submit the current project as a reusable template. Requires approval.',
      minPermission: 'media',
      domain: 'templates',
      risk: 'upload',
      executionMode: 'exclusive',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          name: { type: 'string' },
          author: { type: 'string' },
          year: { type: 'string' },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          confirm: { type: 'boolean', const: true },
        },
        required: ['confirm'],
      },
      execute: (args) => saveAsTemplate(
        env,
        ctx,
        scopedProject(args, currentProjectId),
        args,
      ),
    },
    {
      name: 'survey_apply_main_page',
      description: 'Apply to list a survey on the public main page. This is distinct from releasing the participant survey and requires approval.',
      minPermission: 'media',
      domain: 'project',
      risk: 'publish',
      executionMode: 'exclusive',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          onlineStart: { type: 'string' },
          onlineEnd: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          confirm: { type: 'boolean', const: true },
        },
        required: ['onlineStart', 'onlineEnd', 'confirm'],
      },
      execute: (args) => applyMainPage(
        env,
        ctx,
        scopedProject(args, currentProjectId),
        args,
      ),
    },
    {
      name: 'survey_get_media_dataset',
      description: 'Read folder tags and media assignment groups for an owned project.',
      minPermission: 'ask',
      domain: 'media',
      executionMode: 'parallel',
      parameters: PROJECT_ID,
      async execute(args) {
        return getMediaDataset(env, ctx, scopedProject(args, currentProjectId));
      },
    },
    {
      name: 'survey_update_media_dataset',
      description: 'Organize project media folders and set/category tags.',
      minPermission: 'media',
      domain: 'media',
      executionMode: 'exclusive',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          mediaFolderTags: { type: 'object', additionalProperties: { type: 'string' } },
        },
        required: ['mediaFolderTags'],
      },
      async execute(args) {
        return updateMediaDataset(
          env,
          ctx,
          scopedProject(args, currentProjectId),
          { mediaFolderTags: args.mediaFolderTags },
        );
      },
    },
    {
      name: 'media_import_from_template',
      description: 'Copy existing template media into the current project. Prefer this over uploads.',
      minPermission: 'media',
      domain: 'media',
      executionMode: 'exclusive',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          templateId: { type: 'string' },
          confirm: { type: 'boolean', const: true },
        },
        required: ['templateId', 'confirm'],
      },
      async execute(args) {
        return importMediaFromTemplate(
          env,
          ctx,
          scopedProject(args, currentProjectId),
          { templateId: args.templateId, confirm: true },
        );
      },
    },
    {
      name: 'media_delete',
      description: 'Permanently delete selected project media keys. Requires user approval.',
      minPermission: 'media',
      domain: 'media',
      risk: 'delete',
      executionMode: 'exclusive',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          keys: { type: 'array', items: { type: 'string' } },
          confirm: { type: 'boolean', const: true },
        },
        required: ['keys', 'confirm'],
      },
      async execute(args) {
        return deleteProjectMedia(
          env,
          ctx,
          scopedProject(args, currentProjectId),
          { keys: args.keys, confirm: true },
        );
      },
    },
    {
      name: 'skill_list',
      aliases: ['survey_skill_list'],
      description: 'List public and user-owned interactive survey Skills.',
      minPermission: 'ask',
      domain: 'skills',
      executionMode: 'parallel',
      parameters: { type: 'object', properties: {} },
      execute: () => listSkills(env, ctx),
    },
    {
      name: 'skill_get',
      aliases: ['survey_skill_get'],
      description: 'Read one Skill contract and source when available.',
      minPermission: 'ask',
      domain: 'skills',
      executionMode: 'parallel',
      parameters: {
        type: 'object',
        properties: {
          skillId: { type: 'string' },
          revision: { type: 'integer' },
        },
        required: ['skillId'],
      },
      execute: (args) => getSkill(env, ctx, args.skillId, args.revision),
    },
    {
      name: 'skill_save',
      description: 'Save a private interactive Skill. Source code changes require user approval.',
      minPermission: 'media',
      domain: 'skills',
      risk: 'upload',
      executionMode: 'exclusive',
      parameters: {
        type: 'object',
        properties: {
          skillId: { type: 'string' },
          name: { type: 'string' },
          sourceHtml: { type: 'string' },
          configSchema: { type: 'object' },
          resultSchema: { type: 'object' },
          exampleAnswer: { type: 'object' },
          confirm: { type: 'boolean', const: true },
        },
        required: ['name', 'sourceHtml', 'resultSchema', 'exampleAnswer', 'confirm'],
      },
      execute: (args) => saveSkill(env, ctx, { ...args, confirm: true }),
    },
    {
      name: 'survey_list_responses',
      description: 'List response summaries for an owned project using the same analysisScope as Results.',
      minPermission: 'ask',
      domain: 'results',
      executionMode: 'parallel',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          dataSource: { type: 'string', enum: ['human', 'practice', 'silicon'] },
          siliconRunId: { type: 'string' },
          includePractice: { type: 'boolean' },
          includeAnswers: { type: 'boolean' },
          excludeFlagged: { type: 'boolean' },
          dateFrom: { type: 'string' },
          dateTo: { type: 'string' },
          timezone: { type: 'string' },
          sessionId: { type: 'string' },
          surveyRevision: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      execute: (args) => listResponses(
        env,
        ctx,
        scopedProject(args, currentProjectId),
        args,
      ),
    },
    {
      name: 'survey_results_summary',
      description: 'Compute platform statistics for the current analysisScope. Use view=overview or view=question. Do not invent metrics.',
      minPermission: 'ask',
      domain: 'results',
      executionMode: 'parallel',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          view: { type: 'string', enum: ['overview', 'question'] },
          dataSource: { type: 'string', enum: ['human', 'practice', 'silicon'] },
          siliconRunId: { type: 'string' },
          includePractice: { type: 'boolean' },
          excludeFlagged: { type: 'boolean' },
          dateFrom: { type: 'string' },
          dateTo: { type: 'string' },
          timezone: { type: 'string' },
          sessionId: { type: 'string' },
          surveyRevision: { type: 'string' },
          questionName: { type: 'string' },
          dimensionId: { type: 'string' },
          mediaKey: { type: 'string' },
          catalogOffset: { type: 'integer', minimum: 0 },
          catalogLimit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
      execute: (args) => summarizeResponses(env, ctx, scopedProject(args, currentProjectId), args),
    },
    {
      name: 'survey_export_responses',
      description: 'Prepare a downloadable export for the current analysisScope. Returns file metadata, not a CSV for the model to read.',
      minPermission: 'ask',
      domain: 'results',
      executionMode: 'parallel',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          format: { type: 'string', enum: ['json', 'wide_csv', 'both', 'long_csv', 'summary_csv', 'analysis_bundle'] },
          dataSource: { type: 'string', enum: ['human', 'practice', 'silicon'] },
          siliconRunId: { type: 'string' },
          includePractice: { type: 'boolean' },
          excludeFlagged: { type: 'boolean' },
          dateFrom: { type: 'string' },
          dateTo: { type: 'string' },
          timezone: { type: 'string' },
          sessionId: { type: 'string' },
          surveyRevision: { type: 'string' },
          questionName: { type: 'string' },
        },
      },
      execute: (args) => exportResponses(env, ctx, scopedProject(args, currentProjectId), args),
    },
    {
      name: 'survey_list_versions',
      description: 'List released survey versions.',
      minPermission: 'ask',
      domain: 'project',
      executionMode: 'parallel',
      parameters: PROJECT_ID,
      execute: (args) => listVersions(
        env,
        accessToken,
        scopedProject(args, currentProjectId),
        serviceRole ? userId : null,
      ),
    },
    {
      name: 'survey_publish',
      description: 'Release the saved draft to the participant URL. Requires user approval.',
      minPermission: 'edit_draft',
      domain: 'project',
      risk: 'publish',
      executionMode: 'exclusive',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          confirm: { type: 'boolean', const: true },
          changeSummary: { type: 'string' },
          expectedDraftUpdatedAt: { type: 'string' },
        },
        required: ['confirm', 'expectedDraftUpdatedAt'],
      },
      execute: (args) => publishProject(
        env,
        accessToken,
        scopedProject(args, currentProjectId),
        {
          confirm: true,
          summary: args.changeSummary,
          expectedDraftUpdatedAt: args.expectedDraftUpdatedAt,
        },
        serviceRole ? userId : null,
      ),
    },
    {
      name: 'survey_delete_project',
      description: 'Permanently delete an owned project and its media. Requires user approval.',
      minPermission: 'media',
      domain: 'project',
      risk: 'delete',
      executionMode: 'exclusive',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          confirm: { type: 'boolean', const: true },
        },
        required: ['projectId', 'confirm'],
      },
      execute: (args) => deleteOwnedProject(env, ctx, scopedProject(args, currentProjectId)),
    },
  ];
}

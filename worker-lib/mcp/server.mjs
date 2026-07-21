/**
 * Streamable HTTP MCP server for SP-Survey Platform.
 * Tools call Agent project handlers — never nested LLM orchestration.
 */

import {
  acquireLease,
  applyProjectOperations,
  createProject,
  getDraft,
  handleAgentDiscovery,
  listProjects,
  listVersions,
  previewUrls,
  publishProject,
  releaseLease,
  rollbackProject,
  saveDraft,
  updateProjectMeta,
  validateProject,
} from '../agent/projectHandlers.mjs';
import {
  applyMainPage,
  createFromTemplate,
  deleteOwnedProject,
  deleteProjectMedia,
  duplicateProject,
  exportProject,
  getMediaDataset,
  getTemplate,
  importMediaFromTemplate,
  importProject,
  listProjectMedia,
  listTemplates,
  saveAsTemplate,
  updateMediaDataset,
  uploadProjectMedia,
} from '../agent/projectLifecycle.mjs';
import {
  deleteResponse,
  exportResponses,
  listResponses,
  summarizeResponses,
} from '../agent/resultsHandlers.mjs';
import {
  getSkill,
  listSkills,
  saveSkill,
} from '../agent/skillHandlers.mjs';
import { DESIGN_CAPABILITIES } from '../designProtocol.mjs';
import { getCredentialStatus } from '../agent/credentials.mjs';
import { supabaseRest } from '../supabaseUserClient.mjs';
import { normalizeProjectMetadata, metadataFromRow, projectCardFromRow } from '../agent/projectMeta.mjs';

function mcpCtx(auth) {
  if (auth.kind === 'mcp') {
    return { userId: auth.userId, serviceRole: true };
  }
  return { userId: auth.userId, accessToken: auth.accessToken, serviceRole: false };
}

function toolResult(data, isError = false) {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
    isError,
  };
}

function requireScope(auth, scope) {
  if (auth.kind === 'supabase') return;
  const scopes = auth.scopes || [];
  if (!scopes.includes(scope)) {
    const err = new Error(`Missing scope: ${scope}`);
    err.code = 'insufficient_scope';
    err.status = 403;
    throw err;
  }
}

/** Mint a short-lived user JWT is not available for MCP opaque tokens.
 * For MCP tokens we use service-role REST filtered by user_id. */
async function ensureAccessToken(env, auth) {
  if (auth.accessToken) return auth.accessToken;
  // MCP opaque token path: use service role with ownership checks in handlers
  // by wrapping a synthetic access via service role + user filter helpers.
  return null;
}

async function withUserScopedClient(env, auth, fn) {
  if (auth.accessToken) {
    return fn(auth.accessToken, false);
  }
  // Service-role path for MCP tokens: handlers must filter by auth.userId
  return fn(null, true);
}

async function listOwnedViaService(env, userId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    serviceRole: true,
    query: `?user_id=eq.${encodeURIComponent(userId)}&select=id,name,description,metadata,updated_at,draft_updated_at,published_at,published_version,last_writer,template_id&order=updated_at.desc`,
  });
  return {
    success: true,
    projects: (rows || []).map((row) => ({
      ...projectCardFromRow(row),
      updatedAt: row.updated_at,
      lastWriter: row.last_writer || null,
    })),
  };
}

const TOOLS = [
  {
    name: 'survey_capabilities',
    description: 'Read SP-Survey design rules, FULL question-type catalog (image*/media*/skillquestion presets + examples), operations, and scopes. Call this before designing surveys that need images, video, audio, or interactive skills.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'survey_list_projects',
    description: 'List projects owned by the authenticated user.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'survey_create_project',
    description: 'Create a new survey project. The share / live URL follows this config immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        surveyConfig: { type: 'object' },
      },
      required: ['name'],
    },
  },
  {
    name: 'survey_update_project',
    description: 'Update project you own: name, description, and metadata (author, year, category, tags, website, huggingfaceDataset).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        author: { type: 'string' },
        year: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        website: { type: 'string' },
        huggingfaceDataset: { type: 'string' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_delete_project',
    description: 'Permanently delete a project you own (DB row + R2 media prefix when configured). Requires confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['projectId', 'confirm'],
    },
  },
  {
    name: 'survey_duplicate_project',
    description: 'Duplicate an owned project (config + metadata). Optional copyMedia:true copies R2 files.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        copyMedia: { type: 'boolean' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_export_project',
    description: 'Export an owned project as a sanitized JSON package (project + surveyConfig + metadata).',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_import_project',
    description: 'Import a previously exported project package into a new owned project.',
    inputSchema: {
      type: 'object',
      properties: {
        package: { type: 'object' },
        name: { type: 'string' },
        description: { type: 'string' },
        surveyConfig: { type: 'object' },
      },
    },
  },
  {
    name: 'survey_list_templates',
    description: 'List approved templates plus your own pending template submissions.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'survey_get_template',
    description: 'Read one template (metadata + sanitized surveyConfig).',
    inputSchema: {
      type: 'object',
      properties: { templateId: { type: 'string' } },
      required: ['templateId'],
    },
  },
  {
    name: 'survey_create_from_template',
    description: 'Create a new project from a template (does not auto-copy template media).',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['templateId'],
    },
  },
  {
    name: 'survey_save_as_template',
    description: 'Submit an owned project as a template for admin review. Requires confirm:true. Copies R2 media when configured.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        confirm: { type: 'boolean' },
        name: { type: 'string' },
        description: { type: 'string' },
        author: { type: 'string' },
        year: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['projectId', 'confirm'],
    },
  },
  {
    name: 'survey_apply_main_page',
    description: 'Apply to Publish to Main Page (live listing pending admin review). Requires confirm:true. Not the same as survey_publish version snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        confirm: { type: 'boolean' },
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string' },
        author: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        onlineStart: { type: 'string', description: 'ISO datetime' },
        onlineEnd: { type: 'string', description: 'ISO datetime' },
      },
      required: ['projectId', 'confirm', 'onlineStart', 'onlineEnd'],
    },
  },
  {
    name: 'media_list',
    description: 'List media objects and preloadedImages for an owned project.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'media_import_from_template',
    description: 'Copy template R2 media into an owned project. Requires confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        templateId: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['projectId', 'confirm'],
    },
  },
  {
    name: 'media_delete',
    description: 'Delete specific R2 keys under an owned project prefix. Requires confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        keys: { type: 'array', items: { type: 'string' } },
        confirm: { type: 'boolean' },
      },
      required: ['projectId', 'keys', 'confirm'],
    },
  },
  {
    name: 'media_upload',
    description: 'Upload one media file (base64) into an owned project Media Dataset prefix. Max 8MB decoded. Optional folder + updatePreloaded (default true).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        filename: { type: 'string' },
        data: { type: 'string', description: 'Base64 file bytes (data: URL prefix allowed)' },
        folder: { type: 'string' },
        contentType: { type: 'string' },
        updatePreloaded: { type: 'boolean' },
      },
      required: ['projectId', 'filename', 'data'],
    },
  },
  {
    name: 'survey_get_media_dataset',
    description: 'Read Media Dataset folder tags (mediaFolderTags set/category) for an owned project.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_update_media_dataset',
    description: 'Update Media Dataset folder tags/folders for set/category assignment modes.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        mediaFolderTags: { type: 'object', description: 'Map folder path → "set" | "category"' },
        mediaFolders: { type: 'array', items: { type: 'string' } },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'skill_list',
    description: 'List approved public skills plus your private skill library.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'skill_get',
    description: 'Get one skill (sourceHtml when approved or owned by you).',
    inputSchema: {
      type: 'object',
      properties: { skillId: { type: 'string' } },
      required: ['skillId'],
    },
  },
  {
    name: 'skill_save',
    description:
      'Create or update a private skill. Requires confirm:true. '
      + 'HARD RULES (save is rejected if violated): sourceHtml MUST call SPSkill.setAnswer(...); '
      + 'MUST use spskill-init or SPSkill.getConfig/getImages; NEVER parent.postMessage skill-result aliases; '
      + 'ONE focused task per skill (do not pack attention_map+route_trace+budget_lab+… into one HTML); '
      + 'configSchema/resultSchema must be arrays of {key,label,type} objects. '
      + 'Prefer preset_* skillquestion when a preset fits. Does not submit for public review.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        sourceHtml: { type: 'string' },
        configSchema: { type: 'array' },
        defaultConfig: { type: 'object' },
        resultSchema: { type: 'array' },
        confirm: { type: 'boolean' },
      },
      required: ['name', 'sourceHtml', 'confirm'],
    },
  },
  {
    name: 'survey_list_responses',
    description: 'List survey response summaries for an owned project (results:read). Optional includeAnswers for full answer payloads.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        includePractice: { type: 'boolean' },
        includeAnswers: { type: 'boolean' },
        dateFrom: { type: 'string', description: 'YYYY-MM-DD' },
        dateTo: { type: 'string', description: 'YYYY-MM-DD' },
        sessionId: { type: 'string' },
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_export_responses',
    description: 'Export owned project responses as JSON and/or wide CSV (results:read). Not a full Admin analysis suite — use for offline analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        format: { type: 'string', enum: ['json', 'wide_csv', 'both'] },
        includePractice: { type: 'boolean' },
        excludeFlagged: { type: 'boolean' },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        sessionId: { type: 'string' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_results_summary',
    description: 'Light summary of owned project responses: counts, date range, per-question n_answered, quality flags (results:read).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        includePractice: { type: 'boolean' },
        excludeFlagged: { type: 'boolean' },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        sessionId: { type: 'string' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_delete_response',
    description: 'Delete one survey response for an owned project. Requires confirm:true (results:read).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        responseId: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['projectId', 'responseId', 'confirm'],
    },
  },
  {
    name: 'survey_get_draft',
    description: 'Read a project draft and draftUpdatedAt concurrency token.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_validate',
    description: 'Validate a surveyConfig or the current project draft.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        surveyConfig: { type: 'object' },
      },
    },
  },
  {
    name: 'survey_apply_operations',
    description: 'Apply deterministic survey operations. Saves update the live share URL immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        operations: { type: 'array' },
        expectedDraftUpdatedAt: { type: 'string' },
        clientMutationId: { type: 'string' },
      },
      required: ['projectId', 'operations'],
    },
  },
  {
    name: 'survey_replace_draft',
    description: 'Replace the full surveyConfig (escape hatch). Saves update the live share URL immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        surveyConfig: { type: 'object' },
        expectedDraftUpdatedAt: { type: 'string' },
        clientMutationId: { type: 'string' },
      },
      required: ['projectId', 'surveyConfig'],
    },
  },
  {
    name: 'survey_acquire_lease',
    description: 'Acquire an edit lease so the browser assistant does not overwrite Codex.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        sessionId: { type: 'string' },
        ttlMinutes: { type: 'number' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_release_lease',
    description: 'Release an edit lease.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        sessionId: { type: 'string' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_preview_urls',
    description: 'Get admin and live survey URLs for a project.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_publish',
    description: 'Optional: create a version snapshot for rollback. Not required for the live share URL (saves are already live). Product homepage listing uses Publish to Main Page in Admin.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        summary: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['projectId', 'confirm'],
    },
  },
  {
    name: 'survey_list_versions',
    description: 'List published versions for rollback.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_rollback',
    description: 'Rollback published config to a previous version.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        version: { type: 'number' },
        confirm: { type: 'boolean' },
      },
      required: ['projectId', 'version', 'confirm'],
    },
  },
  {
    name: 'credentials_status',
    description: 'Check whether a Platform Assistant API key is configured (never returns the key).',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function callTool(env, auth, request, name, args = {}) {
  // For MCP opaque tokens without a Supabase JWT, use service-role helpers
  // that always filter by auth.userId.
  const useService = auth.kind === 'mcp';

  switch (name) {
    case 'survey_capabilities':
      return toolResult({ ...(await handleAgentDiscovery(request, env)), capabilities: DESIGN_CAPABILITIES });
    case 'survey_list_projects': {
      requireScope(auth, 'surveys:read');
      if (useService) return toolResult(await listOwnedViaService(env, auth.userId));
      return toolResult(await listProjects(env, auth.accessToken));
    }
    case 'survey_create_project': {
      requireScope(auth, 'surveys:write');
      if (useService) {
        // Create via service role with explicit user_id
        const { createProject: create } = await import('../agent/projectHandlers.mjs');
        // Temporarily mint: use service role path by inserting with user id
        const result = await createViaService(env, auth.userId, args, request);
        return toolResult(result);
      }
      return toolResult(await createProject(env, auth.accessToken, auth.userId, args, request));
    }
    case 'survey_update_project': {
      requireScope(auth, 'surveys:write');
      if (useService) return toolResult(await updateMetaViaService(env, auth.userId, args));
      return toolResult(await updateProjectMeta(env, auth.accessToken, args.projectId, args, auth.userId));
    }
    case 'survey_delete_project': {
      requireScope(auth, 'surveys:write');
      if (!args.confirm) {
        return toolResult({ error: 'Set confirm:true to permanently delete this owned project.' }, true);
      }
      return toolResult(await deleteOwnedProject(env, mcpCtx(auth), args.projectId));
    }
    case 'survey_duplicate_project': {
      requireScope(auth, 'surveys:write');
      return toolResult(await duplicateProject(env, mcpCtx(auth), args.projectId, args, request));
    }
    case 'survey_export_project': {
      requireScope(auth, 'surveys:read');
      return toolResult(await exportProject(env, mcpCtx(auth), args.projectId));
    }
    case 'survey_import_project': {
      requireScope(auth, 'surveys:write');
      return toolResult(await importProject(env, mcpCtx(auth), args, request));
    }
    case 'survey_list_templates': {
      requireScope(auth, 'surveys:read');
      return toolResult(await listTemplates(env, mcpCtx(auth)));
    }
    case 'survey_get_template': {
      requireScope(auth, 'surveys:read');
      return toolResult(await getTemplate(env, mcpCtx(auth), args.templateId));
    }
    case 'survey_create_from_template': {
      requireScope(auth, 'surveys:write');
      return toolResult(await createFromTemplate(env, mcpCtx(auth), args, request));
    }
    case 'survey_save_as_template': {
      requireScope(auth, 'surveys:write');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to submit as template.' }, true);
      return toolResult(await saveAsTemplate(env, mcpCtx(auth), args.projectId, args));
    }
    case 'survey_apply_main_page': {
      requireScope(auth, 'surveys:write');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to apply to Main Page.' }, true);
      return toolResult(await applyMainPage(env, mcpCtx(auth), args.projectId, args));
    }
    case 'media_list': {
      requireScope(auth, 'surveys:read');
      return toolResult(await listProjectMedia(env, mcpCtx(auth), args.projectId));
    }
    case 'media_import_from_template': {
      requireScope(auth, 'media:write');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to import template media.' }, true);
      return toolResult(await importMediaFromTemplate(env, mcpCtx(auth), args.projectId, args));
    }
    case 'media_delete': {
      requireScope(auth, 'media:write');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to delete media keys.' }, true);
      return toolResult(await deleteProjectMedia(env, mcpCtx(auth), args.projectId, args));
    }
    case 'media_upload': {
      requireScope(auth, 'media:write');
      return toolResult(await uploadProjectMedia(env, mcpCtx(auth), args.projectId, args));
    }
    case 'survey_get_media_dataset': {
      requireScope(auth, 'surveys:read');
      return toolResult(await getMediaDataset(env, mcpCtx(auth), args.projectId));
    }
    case 'survey_update_media_dataset': {
      requireScope(auth, 'surveys:write');
      return toolResult(await updateMediaDataset(env, mcpCtx(auth), args.projectId, args));
    }
    case 'skill_list': {
      requireScope(auth, 'surveys:read');
      return toolResult(await listSkills(env, mcpCtx(auth)));
    }
    case 'skill_get': {
      requireScope(auth, 'surveys:read');
      return toolResult(await getSkill(env, mcpCtx(auth), args.skillId));
    }
    case 'skill_save': {
      requireScope(auth, 'surveys:write');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to save a skill.' }, true);
      return toolResult(await saveSkill(env, mcpCtx(auth), args));
    }
    case 'survey_list_responses': {
      requireScope(auth, 'results:read');
      return toolResult(await listResponses(env, mcpCtx(auth), args.projectId, args));
    }
    case 'survey_export_responses': {
      requireScope(auth, 'results:read');
      return toolResult(await exportResponses(env, mcpCtx(auth), args.projectId, args));
    }
    case 'survey_results_summary': {
      requireScope(auth, 'results:read');
      return toolResult(await summarizeResponses(env, mcpCtx(auth), args.projectId, args));
    }
    case 'survey_delete_response': {
      requireScope(auth, 'results:read');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to delete a response.' }, true);
      return toolResult(await deleteResponse(env, mcpCtx(auth), args.projectId, args));
    }
    case 'survey_get_draft': {
      requireScope(auth, 'surveys:read');
      if (useService) return toolResult(await getDraftViaService(env, auth.userId, args.projectId, request));
      return toolResult(await getDraft(env, auth.accessToken, args.projectId, request));
    }
    case 'survey_validate': {
      requireScope(auth, 'surveys:read');
      if (useService) {
        const { validateSurveyConfig } = await import('../designProtocol.mjs');
        if (args.surveyConfig) {
          const validation = validateSurveyConfig(args.surveyConfig);
          return toolResult({ success: validation.valid, validation });
        }
        const draft = await getDraftViaService(env, auth.userId, args.projectId, request);
        return toolResult({ success: draft.validation.valid, validation: draft.validation });
      }
      return toolResult(await validateProject(env, auth.accessToken, args.projectId, args));
    }
    case 'survey_apply_operations': {
      requireScope(auth, 'surveys:write');
      if (useService) {
        return toolResult(await applyOpsViaService(env, auth.userId, args.projectId, args));
      }
      return toolResult(await applyProjectOperations(env, auth.accessToken, args.projectId, args, 'codex'));
    }
    case 'survey_replace_draft': {
      requireScope(auth, 'surveys:write');
      if (useService) {
        return toolResult(await saveDraftViaService(env, auth.userId, args.projectId, args));
      }
      return toolResult(await saveDraft(env, auth.accessToken, args.projectId, args, 'codex'));
    }
    case 'survey_acquire_lease': {
      requireScope(auth, 'surveys:write');
      if (useService) {
        return toolResult(await leaseViaService(env, auth.userId, args.projectId, args));
      }
      return toolResult(await acquireLease(env, auth.accessToken, auth.userId, args.projectId, args));
    }
    case 'survey_release_lease': {
      requireScope(auth, 'surveys:write');
      if (useService) {
        await supabaseRest(env, {
          path: '/rest/v1/project_edit_leases',
          method: 'DELETE',
          serviceRole: true,
          query: `?project_id=eq.${encodeURIComponent(args.projectId)}&user_id=eq.${encodeURIComponent(auth.userId)}`,
        });
        return toolResult({ success: true });
      }
      return toolResult(await releaseLease(env, auth.accessToken, args.projectId, args));
    }
    case 'survey_preview_urls': {
      requireScope(auth, 'surveys:read');
      if (useService) {
        await assertOwned(env, auth.userId, args.projectId);
        const { buildProjectUrls } = await import('../designProtocol.mjs');
        const origin = env.APP_URL || new URL(request.url).origin;
        return toolResult({ success: true, urls: buildProjectUrls(args.projectId, origin) });
      }
      return toolResult(await previewUrls(env, auth.accessToken, args.projectId, request));
    }
    case 'survey_publish': {
      requireScope(auth, 'surveys:publish');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to publish.' }, true);
      if (useService) {
        return toolResult(await publishViaService(env, auth.userId, args.projectId, args));
      }
      return toolResult(await publishProject(env, auth.accessToken, args.projectId, args));
    }
    case 'survey_list_versions': {
      requireScope(auth, 'surveys:read');
      if (useService) {
        await assertOwned(env, auth.userId, args.projectId);
        const rows = await supabaseRest(env, {
          path: '/rest/v1/project_config_versions',
          serviceRole: true,
          query: `?project_id=eq.${encodeURIComponent(args.projectId)}&select=version,published_at,change_summary&order=version.desc`,
        });
        return toolResult({ success: true, versions: rows || [] });
      }
      return toolResult(await listVersions(env, auth.accessToken, args.projectId));
    }
    case 'survey_rollback': {
      requireScope(auth, 'surveys:publish');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to rollback.' }, true);
      if (useService) {
        return toolResult(await rollbackViaService(env, auth.userId, args.projectId, args.version));
      }
      return toolResult(await rollbackProject(env, auth.accessToken, args.projectId, args));
    }
    case 'credentials_status':
      return toolResult(await getCredentialStatus(env, auth.userId));
    default:
      return toolResult({ error: `Unknown tool: ${name}` }, true);
  }
}

async function assertOwned(env, userId, projectId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(userId)}&select=id`,
  });
  if (!rows?.[0]) {
    throw Object.assign(new Error('Project not found'), { status: 404, code: 'PROJECT_NOT_FOUND' });
  }
}

async function updateMetaViaService(env, userId, body) {
  await assertOwned(env, userId, body.projectId);
  const existingRows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(body.projectId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
  });
  const existing = existingRows?.[0];
  const patch = {};
  if (body?.name != null) {
    const name = String(body.name || '').trim().slice(0, 160);
    if (!name) throw Object.assign(new Error('Project name cannot be empty.'), { status: 400 });
    patch.name = name;
  }
  if (body?.description != null) {
    patch.description = String(body.description || '').trim();
  }
  const metaKeys = ['author', 'year', 'category', 'tags', 'website', 'huggingfaceDataset', 'metadata'];
  if (metaKeys.some((k) => body?.[k] !== undefined)) {
    patch.metadata = normalizeProjectMetadata(body, metadataFromRow(existing || {}));
  }
  if (!Object.keys(patch).length) {
    throw Object.assign(new Error('Provide name, description, and/or metadata fields to update.'), { status: 400 });
  }
  patch.updated_at = new Date().toISOString();
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(body.projectId)}&user_id=eq.${encodeURIComponent(userId)}`,
    body: patch,
    prefer: 'return=representation',
  });
  const row = Array.isArray(rows) ? rows[0] : { ...existing, ...patch, id: body.projectId };
  return { success: true, project: projectCardFromRow(row) };
}

async function getDraftViaService(env, userId, projectId, request) {
  await assertOwned(env, userId, projectId);
  // Reuse handler by temporarily using service role through a patched access —
  // simplest: duplicate read using service role.
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
  });
  const row = rows?.[0];
  if (!row) throw Object.assign(new Error('Project not found'), { status: 404 });
  const { sanitizeForAgent, validateSurveyConfig, buildProjectUrls } = await import('../designProtocol.mjs');
  const surveyConfig = row.survey_config_draft ?? row.survey_config ?? {};
  return {
    success: true,
    project: sanitizeForAgent(projectCardFromRow(row)),
    surveyConfig: sanitizeForAgent(surveyConfig),
    draftUpdatedAt: row.draft_updated_at || row.updated_at,
    publishedVersion: row.published_version || 0,
    validation: validateSurveyConfig(surveyConfig),
    urls: buildProjectUrls(projectId, env.APP_URL || new URL(request.url).origin),
  };
}

async function createViaService(env, userId, body, request) {
  const {
    createDefaultSurveyConfig,
    validateSurveyConfig,
    sanitizeForAgent,
    findSecretFields,
    buildProjectUrls,
    isSafeProjectId,
  } = await import('../designProtocol.mjs');
  if (findSecretFields(body).length) {
    throw Object.assign(new Error('Do not send credentials through the agent API.'), { status: 400 });
  }
  const name = String(body?.name || '').trim();
  if (!name) throw Object.assign(new Error('Project name is required.'), { status: 400 });
  const surveyConfig = body?.surveyConfig || createDefaultSurveyConfig(name, body?.description || '');
  const validation = validateSurveyConfig(surveyConfig);
  if (!validation.valid) throw Object.assign(new Error('Survey validation failed.'), { status: 400, validation });
  const id = `proj_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  if (!isSafeProjectId(id)) throw new Error('Invalid id');
  const now = new Date().toISOString();
  const metadata = normalizeProjectMetadata(body, {});
  const row = {
    id,
    user_id: userId,
    name,
    description: body?.description || '',
    survey_config: surveyConfig,
    survey_config_draft: surveyConfig,
    draft_updated_at: now,
    metadata,
    last_writer: { source: 'codex', at: now },
    updated_at: now,
  };
  await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'POST',
    serviceRole: true,
    body: row,
  });
  return {
    success: true,
    project: sanitizeForAgent(projectCardFromRow(row)),
    surveyConfig: sanitizeForAgent(surveyConfig),
    draftUpdatedAt: now,
    validation,
    urls: buildProjectUrls(id, env.APP_URL || new URL(request.url).origin),
  };
}

async function saveDraftViaService(env, userId, projectId, body) {
  await assertOwned(env, userId, projectId);
  const { validateSurveyConfig, restoreStoredSecrets, findSecretFields } = await import('../designProtocol.mjs');
  if (findSecretFields(body?.surveyConfig).length) {
    throw Object.assign(new Error('Do not send credentials through the agent API.'), { status: 400 });
  }
  const validation = validateSurveyConfig(body.surveyConfig);
  if (!validation.valid) throw Object.assign(new Error('Survey validation failed.'), { status: 400, validation });

  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(projectId)}&select=survey_config_draft,survey_config,draft_updated_at`,
  });
  const row = rows?.[0];
  if (body.expectedDraftUpdatedAt && row.draft_updated_at && body.expectedDraftUpdatedAt !== row.draft_updated_at) {
    throw Object.assign(new Error('Project draft changed. Re-read before updating.'), {
      status: 409,
      code: 'CONFLICT',
      draftUpdatedAt: row.draft_updated_at,
    });
  }
  const merged = restoreStoredSecrets(body.surveyConfig, row.survey_config_draft ?? row.survey_config);
  const now = new Date().toISOString();
  await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(userId)}`,
    body: {
      survey_config: merged,
      survey_config_draft: merged,
      draft_updated_at: now,
      updated_at: now,
      last_writer: { source: 'codex', at: now },
    },
  });
  return { success: true, projectId, draftUpdatedAt: now, validation };
}

async function applyOpsViaService(env, userId, projectId, body) {
  const draft = await getDraftViaService(env, userId, projectId, { url: 'https://local' });
  const { applyOperations } = await import('../designProtocol.mjs');
  const next = applyOperations(draft.surveyConfig, body.operations || []);
  if (!next.validation.valid) {
    throw Object.assign(new Error('Survey validation failed after operations.'), {
      status: 400,
      validation: next.validation,
    });
  }
  const saved = await saveDraftViaService(env, userId, projectId, {
    surveyConfig: next.surveyConfig,
    expectedDraftUpdatedAt: body.expectedDraftUpdatedAt || draft.draftUpdatedAt,
    clientMutationId: body.clientMutationId,
  });
  return { ...saved, applied: next.applied, inverse: next.inverse };
}

async function leaseViaService(env, userId, projectId, body) {
  await assertOwned(env, userId, projectId);
  const sessionId = body.sessionId || crypto.randomUUID();
  const expiresAt = new Date(Date.now() + (Math.min(body.ttlMinutes || 30, 120) * 60 * 1000)).toISOString();
  await supabaseRest(env, {
    path: '/rest/v1/project_edit_leases',
    method: 'POST',
    serviceRole: true,
    body: {
      project_id: projectId,
      holder: 'codex',
      session_id: sessionId,
      user_id: userId,
      expires_at: expiresAt,
    },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  return { success: true, lease: { projectId, holder: 'codex', sessionId, expiresAt } };
}

async function publishViaService(env, userId, projectId, body) {
  await assertOwned(env, userId, projectId);
  // Inline publish (service role) mirroring SQL RPC
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(projectId)}&select=survey_config_draft,published_version`,
  });
  const row = rows?.[0];
  const draft = row?.survey_config_draft;
  if (!draft) throw Object.assign(new Error('draft is empty'), { status: 400 });
  const ver = (row.published_version || 0) + 1;
  const now = new Date().toISOString();
  await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(projectId)}`,
    body: {
      survey_config_published: draft,
      survey_config: draft,
      published_at: now,
      published_version: ver,
      updated_at: now,
      last_writer: { source: 'publish', at: now },
    },
  });
  await supabaseRest(env, {
    path: '/rest/v1/project_config_versions',
    method: 'POST',
    serviceRole: true,
    body: {
      project_id: projectId,
      version: ver,
      config: draft,
      published_by: userId,
      change_summary: body.summary || null,
    },
  });
  return { success: true, publishedVersion: ver, publishedAt: now };
}

async function rollbackViaService(env, userId, projectId, version) {
  await assertOwned(env, userId, projectId);
  const versions = await supabaseRest(env, {
    path: '/rest/v1/project_config_versions',
    serviceRole: true,
    query: `?project_id=eq.${encodeURIComponent(projectId)}&version=eq.${Number(version)}&select=config`,
  });
  const config = versions?.[0]?.config;
  if (!config) throw Object.assign(new Error('version not found'), { status: 404 });
  return publishViaService(env, userId, projectId, { summary: `Rollback to version ${version}` })
    .then(async () => {
      // Also set draft
      const now = new Date().toISOString();
      await supabaseRest(env, {
        path: '/rest/v1/projects',
        method: 'PATCH',
        serviceRole: true,
        query: `?id=eq.${encodeURIComponent(projectId)}`,
        body: {
          survey_config_draft: config,
          survey_config_published: config,
          survey_config: config,
          draft_updated_at: now,
        },
      });
      return { success: true, restoredFrom: version };
    });
}

export async function handleMcpRequest(request, env, auth) {
  if (request.method === 'GET') {
    // Optional SSE stream — return empty endpoint info for Streamable HTTP clients.
    return new Response(null, { status: 405 });
  }
  if (request.method === 'DELETE') {
    return new Response(null, { status: 204 });
  }

  let message;
  try {
    message = await request.json();
  } catch {
    return jsonRpcError(null, -32700, 'Parse error');
  }

  const respond = async (id, result) => new Response(JSON.stringify({
    jsonrpc: '2.0',
    id,
    result,
  }), { headers: { 'content-type': 'application/json' } });

  const { id, method, params } = message || {};

  try {
    if (method === 'initialize') {
      return respond(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'sp-survey-platform', version: '1.0.0' },
      });
    }
    if (method === 'notifications/initialized' || method === 'initialized') {
      return new Response(null, { status: 202 });
    }
    if (method === 'tools/list') {
      return respond(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    }
    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments || {};
      const result = await callTool(env, auth, request, name, args);
      return respond(id, result);
    }
    if (method === 'ping') {
      return respond(id, {});
    }
    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    return respond(id, toolResult({
      error: error.message,
      code: error.code || 'ERROR',
    }, true));
  }
}

function jsonRpcError(id, code, message) {
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// silence unused import warnings for tree helpers intentionally re-exported above
void ensureAccessToken;
void withUserScopedClient;
void listVersions;
void releaseLease;
void rollbackProject;
void applyProjectOperations;
void saveDraft;
void publishProject;
void getDraft;
void createProject;
void acquireLease;
void previewUrls;
void validateProject;
void listProjects;

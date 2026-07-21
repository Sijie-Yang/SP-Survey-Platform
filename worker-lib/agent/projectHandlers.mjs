/**
 * Authenticated Agent project CRUD (draft/publish) for Worker + Express.
 */

import { supabaseRest, rpc } from '../supabaseUserClient.mjs';
import {
  applyOperations,
  buildProjectUrls,
  createDefaultSurveyConfig,
  findSecretFields,
  isSafeProjectId,
  restoreStoredSecrets,
  sanitizeForAgent,
  validateSurveyConfig,
  DESIGN_CAPABILITIES,
} from '../designProtocol.mjs';
import { normalizeProjectMetadata, metadataFromRow, projectCardFromRow } from './projectMeta.mjs';
import { deleteOwnedProject } from './projectLifecycle.mjs';

function originFromRequest(request, env) {
  return env.APP_URL
    || request.headers.get('Origin')
    || new URL(request.url).origin;
}

function generateProjectId() {
  const rand = crypto.getRandomValues(new Uint8Array(5));
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
  return `proj_${Date.now()}_${hex}`;
}

async function loadOwnedProject(env, accessToken, projectId) {
  if (!isSafeProjectId(projectId)) {
    throw Object.assign(new Error('Invalid project id'), { status: 400, code: 'INVALID_PROJECT_ID' });
  }
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    accessToken,
    query: `?id=eq.${encodeURIComponent(projectId)}&select=*`,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    throw Object.assign(new Error('Project not found'), { status: 404, code: 'PROJECT_NOT_FOUND' });
  }
  return row;
}

function draftConfig(row) {
  return row.survey_config_draft ?? row.survey_config ?? {};
}

export async function handleAgentDiscovery(request, env) {
  return {
    success: true,
    name: 'SP-Survey Platform Agent API',
    workflow: 'Call survey_capabilities (image/media/skillquestion guides), then get draft, edit with apply_operations (saves are live), validate, share preview/live URL. Prefer image*/media*/preset skillquestion for visual studies. Media: import from template or use project/preview library — never AI-generate uploads. Use survey_delete_project / survey_update_project for owned-project CRUD.',
    capabilities: DESIGN_CAPABILITIES,
    endpoints: {
      credentialsStatus: 'GET /api/agent/credentials/status',
      storeCredentials: 'POST /api/agent/credentials/openai',
      listProjects: 'GET /api/agent/projects',
      createProject: 'POST /api/agent/projects',
      updateProject: 'PATCH /api/agent/projects/:id',
      deleteProject: 'DELETE /api/agent/projects/:id',
      duplicateProject: 'POST /api/agent/projects/:id/duplicate',
      exportProject: 'GET /api/agent/projects/:id/export',
      importProject: 'POST /api/agent/projects/import',
      listTemplates: 'GET /api/agent/templates',
      getTemplate: 'GET /api/agent/templates/:id',
      createFromTemplate: 'POST /api/agent/projects/from-template',
      saveAsTemplate: 'POST /api/agent/projects/:id/save-as-template',
      applyMainPage: 'POST /api/agent/projects/:id/main-page',
      listMedia: 'GET /api/agent/projects/:id/media',
      importMediaFromTemplate: 'POST /api/agent/projects/:id/media/import-template',
      deleteMedia: 'DELETE /api/agent/projects/:id/media',
      uploadMedia: 'POST /api/agent/projects/:id/media/upload',
      getMediaDataset: 'GET /api/agent/projects/:id/media-dataset',
      updateMediaDataset: 'PATCH /api/agent/projects/:id/media-dataset',
      listSkills: 'GET /api/agent/skills',
      getSkill: 'GET /api/agent/skills/:id',
      saveSkill: 'POST /api/agent/skills',
      listResponses: 'GET /api/agent/projects/:id/responses',
      exportResponses: 'GET /api/agent/projects/:id/responses/export',
      resultsSummary: 'GET /api/agent/projects/:id/results/summary',
      deleteResponse: 'DELETE /api/agent/projects/:id/responses',
      getDraft: 'GET /api/agent/projects/:id/draft',
      saveDraft: 'PUT /api/agent/projects/:id/draft',
      applyOps: 'POST /api/agent/projects/:id/operations',
      publish: 'POST /api/agent/projects/:id/publish',
      versions: 'GET /api/agent/projects/:id/versions',
      rollback: 'POST /api/agent/projects/:id/rollback',
      validate: 'POST /api/agent/projects/:id/validate',
      previewUrls: 'GET /api/agent/projects/:id/preview-url',
      chat: 'POST /api/agent/chat',
    },
  };
}

export async function listProjects(env, accessToken) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    accessToken,
    query: '?select=id,name,description,metadata,updated_at,draft_updated_at,published_at,published_version,last_writer,template_id&order=updated_at.desc',
  });
  return {
    success: true,
    projects: (rows || []).map((row) => ({
      ...sanitizeForAgent(projectCardFromRow(row)),
      updatedAt: row.updated_at,
      lastWriter: row.last_writer || null,
    })),
  };
}

export async function createProject(env, accessToken, userId, body, request) {
  const secretFields = findSecretFields(body);
  if (secretFields.length) {
    throw Object.assign(new Error('Do not send credentials through the agent API.'), {
      status: 400,
      details: { secretFields },
    });
  }
  const name = String(body?.name || '').trim().slice(0, 160);
  if (!name) throw Object.assign(new Error('Project name is required.'), { status: 400 });

  const description = String(body?.description || '').trim();
  const surveyConfig = body?.surveyConfig || createDefaultSurveyConfig(name, description);
  const validation = validateSurveyConfig(surveyConfig);
  if (!validation.valid) {
    throw Object.assign(new Error('Survey validation failed.'), { status: 400, validation });
  }

  const id = generateProjectId();
  const now = new Date().toISOString();
  const metadata = normalizeProjectMetadata(body, {});
  const row = {
    id,
    user_id: userId,
    name,
    description,
    // Save = live: share / preview / view-live follow this config immediately.
    survey_config: surveyConfig,
    survey_config_draft: surveyConfig,
    draft_updated_at: now,
    metadata,
    image_dataset_config: { enabled: true },
    last_writer: { source: 'codex', at: now },
    updated_at: now,
  };

  await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'POST',
    accessToken,
    body: row,
    prefer: 'return=representation',
  });

  return {
    success: true,
    project: sanitizeForAgent(projectCardFromRow(row)),
    surveyConfig: sanitizeForAgent(surveyConfig),
    draftUpdatedAt: now,
    validation,
    urls: buildProjectUrls(id, originFromRequest(request, env)),
  };
}

export async function getDraft(env, accessToken, projectId, request) {
  const row = await loadOwnedProject(env, accessToken, projectId);
  const surveyConfig = draftConfig(row);
  return {
    success: true,
    project: sanitizeForAgent(projectCardFromRow(row)),
    surveyConfig: sanitizeForAgent(surveyConfig),
    draftUpdatedAt: row.draft_updated_at || row.updated_at,
    publishedVersion: row.published_version || 0,
    publishedAt: row.published_at,
    lastWriter: row.last_writer || null,
    validation: validateSurveyConfig(surveyConfig),
    urls: buildProjectUrls(projectId, originFromRequest(request, env)),
  };
}

/** Update owned project name/description/metadata. */
export async function updateProjectMeta(env, accessToken, projectId, body, userId = null) {
  const existing = await loadOwnedProject(env, accessToken, projectId);
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
  const touchesMeta = metaKeys.some((k) => body?.[k] !== undefined);
  if (touchesMeta) {
    patch.metadata = normalizeProjectMetadata(body, metadataFromRow(existing));
  }
  if (!Object.keys(patch).length) {
    throw Object.assign(new Error('Provide name, description, and/or metadata fields to update.'), { status: 400 });
  }
  patch.updated_at = new Date().toISOString();
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'PATCH',
    accessToken,
    query: `?id=eq.${encodeURIComponent(projectId)}`,
    body: patch,
    prefer: 'return=representation',
  });
  const row = Array.isArray(rows) ? rows[0] : { ...existing, ...patch, id: projectId };
  return {
    success: true,
    project: sanitizeForAgent(projectCardFromRow(row)),
  };
}

/** Delete owned project (+ R2 prefix when configured). */
export async function deleteProject(env, accessToken, projectId, userId = null) {
  return deleteOwnedProject(env, {
    accessToken,
    userId,
    serviceRole: false,
  }, projectId);
}

export async function saveDraft(env, accessToken, projectId, body, writerSource = 'codex') {
  const secretFields = findSecretFields(body?.surveyConfig);
  if (secretFields.length) {
    throw Object.assign(new Error('Do not send credentials through the agent API.'), {
      status: 400,
      details: { secretFields },
    });
  }
  const surveyConfig = body?.surveyConfig;
  const validation = validateSurveyConfig(surveyConfig);
  if (!validation.valid) {
    throw Object.assign(new Error('Survey validation failed.'), { status: 400, validation });
  }

  const row = await loadOwnedProject(env, accessToken, projectId);
  const merged = restoreStoredSecrets(surveyConfig, draftConfig(row));

  try {
    const result = await rpc(env, 'save_project_draft', {
      p_project_id: projectId,
      p_survey_config: merged,
      p_expected_draft_updated_at: body?.expectedDraftUpdatedAt || null,
      p_writer: { source: writerSource, ...(body?.writer || {}) },
      p_client_mutation_id: body?.clientMutationId || null,
    }, accessToken);
    return {
      success: true,
      projectId,
      draftUpdatedAt: result?.draftUpdatedAt || result?.draft_updated_at,
      revisionId: result?.revisionId || result?.revision_id,
      validation,
    };
  } catch (error) {
    if (String(error.message || '').includes('conflict')) {
      throw Object.assign(new Error('Project draft changed. Re-read before updating.'), {
        status: 409,
        code: 'CONFLICT',
        draftUpdatedAt: row.draft_updated_at,
      });
    }
    throw error;
  }
}

export async function applyProjectOperations(env, accessToken, projectId, body, writerSource = 'codex') {
  const row = await loadOwnedProject(env, accessToken, projectId);
  const current = draftConfig(row);
  let next;
  try {
    next = applyOperations(current, body?.operations || []);
  } catch (error) {
    throw Object.assign(new Error(error.message), { status: 400 });
  }
  if (!next.validation.valid) {
    throw Object.assign(new Error('Survey validation failed after operations.'), {
      status: 400,
      validation: next.validation,
    });
  }
  const saved = await saveDraft(env, accessToken, projectId, {
    surveyConfig: next.surveyConfig,
    expectedDraftUpdatedAt: body?.expectedDraftUpdatedAt || row.draft_updated_at,
    clientMutationId: body?.clientMutationId,
    writer: body?.writer,
  }, writerSource);
  return {
    ...saved,
    applied: next.applied,
    inverse: next.inverse,
    surveyConfig: sanitizeForAgent(next.surveyConfig),
  };
}

export async function publishProject(env, accessToken, projectId, body) {
  const result = await rpc(env, 'publish_project_config', {
    p_project_id: projectId,
    p_summary: body?.summary || null,
  }, accessToken);
  return { success: true, projectId, ...result };
}

export async function listVersions(env, accessToken, projectId) {
  await loadOwnedProject(env, accessToken, projectId);
  const rows = await supabaseRest(env, {
    path: '/rest/v1/project_config_versions',
    accessToken,
    query: `?project_id=eq.${encodeURIComponent(projectId)}&select=version,published_at,change_summary,published_by&order=version.desc`,
  });
  return { success: true, versions: rows || [] };
}

export async function rollbackProject(env, accessToken, projectId, body) {
  const version = Number(body?.version);
  if (!Number.isInteger(version)) {
    throw Object.assign(new Error('version is required'), { status: 400 });
  }
  const result = await rpc(env, 'rollback_project_config', {
    p_project_id: projectId,
    p_version: version,
  }, accessToken);
  return { success: true, projectId, ...result };
}

export async function validateProject(env, accessToken, projectId, body) {
  const surveyConfig = body?.surveyConfig
    || draftConfig(await loadOwnedProject(env, accessToken, projectId));
  const validation = validateSurveyConfig(surveyConfig);
  return { success: validation.valid, validation };
}

export async function previewUrls(env, accessToken, projectId, request) {
  await loadOwnedProject(env, accessToken, projectId);
  return {
    success: true,
    urls: buildProjectUrls(projectId, originFromRequest(request, env)),
  };
}

export async function acquireLease(env, accessToken, userId, projectId, body) {
  await loadOwnedProject(env, accessToken, projectId);
  const holder = body?.holder || 'codex';
  const sessionId = body?.sessionId || crypto.randomUUID();
  const ttlMinutes = Math.min(Number(body?.ttlMinutes) || 30, 120);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  await supabaseRest(env, {
    path: '/rest/v1/project_edit_leases',
    method: 'POST',
    accessToken,
    body: {
      project_id: projectId,
      holder,
      session_id: sessionId,
      user_id: userId,
      expires_at: expiresAt,
    },
    prefer: 'resolution=merge-duplicates,return=representation',
  });

  return { success: true, lease: { projectId, holder, sessionId, expiresAt } };
}

export async function releaseLease(env, accessToken, projectId, body) {
  await loadOwnedProject(env, accessToken, projectId);
  let query = `?project_id=eq.${encodeURIComponent(projectId)}`;
  if (body?.sessionId) query += `&session_id=eq.${encodeURIComponent(body.sessionId)}`;
  await supabaseRest(env, {
    path: '/rest/v1/project_edit_leases',
    method: 'DELETE',
    accessToken,
    query,
  });
  return { success: true };
}

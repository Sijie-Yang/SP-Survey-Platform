/**
 * Studio's reads and writes, on top of projectManager. Every write drops the
 * classic editor's working copy of the project (see studioState.js).
 *
 * Local mode (no Supabase, server.js on :3001): projects live in files and
 * every save is live; there is no publishing.
 */

import { isSupabaseConfigured } from './supabase';
import {
  createProject,
  deleteProject,
  getProjectById,
  getUserProjects,
  publishProjectConfig,
  saveProjectFull,
  updateProject,
} from './projectManager';
import { countOwnerResponses } from './adminResults';
import { deleteImagesFromR2, isR2Configured, listImagesFromR2 } from './r2';
import { loadSurveyConfig } from './surveyStorage';
import { forgetClassicEditingState } from './studioState';
import { sortProjectsNewestFirst } from './studioProject';

const LOCAL_API = 'http://localhost:3001/api';

export const isStudioLocalMode = () => !isSupabaseConfigured();

async function localJson(path, init) {
  const res = await fetch(`${LOCAL_API}${path}`, init);
  if (!res.ok) throw new Error(`Local server: ${res.status}`);
  return res.json();
}

/** The researcher's projects, newest first, each with its draft config. */
export async function listStudioProjects() {
  if (!isStudioLocalMode()) return sortProjectsNewestFirst(await getUserProjects());
  // The local server lists file names only; read each project once.
  try {
    const { files = [] } = await localJson('/projects');
    const ids = files.filter((f) => /\.json$/i.test(f)).map((f) => f.replace(/\.json$/i, ''));
    const rows = await Promise.all(ids.map((id) => localJson(`/projects/${encodeURIComponent(id)}`).catch(() => null)));
    return sortProjectsNewestFirst(rows
      .filter((row) => row?.success && row.project?.id)
      .map((row) => ({ ...row.project, _surveyConfig: row.surveyConfig || {} })));
  } catch {
    return [];
  }
}

/** One project with its draft config, or null. */
export async function loadStudioProject(projectId) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  if (project._surveyConfig) return project;
  const config = await loadSurveyConfig(projectId);
  return { ...project, _surveyConfig: config || {} };
}

function storedProject(project) {
  const { _surveyConfig: _config, accessRole: _role, ...row } = project || {};
  return row;
}

/** Save the project row (name, media) and its draft config in one write. */
export async function saveStudioProject(project, config) {
  const result = await saveProjectFull(storedProject(project), config);
  if (result.success) forgetClassicEditingState(project.id);
  return result;
}

/** Change project fields (name, description); the config is kept. */
export async function updateStudioProject(projectId, patch) {
  const result = await updateProject(projectId, patch);
  if (result.success) forgetClassicEditingState(projectId);
  return result;
}

export async function createStudioProject(name) {
  const result = await createProject({ name });
  if (result.success) forgetClassicEditingState(result.project.id);
  return result;
}

// The project's own images (only under its prefix; template media is never touched).
async function removeProjectImages(userId, projectId) {
  if (!userId || !projectId || !isR2Configured()) return;
  const prefix = `${userId}/${projectId}/`;
  const listed = await listImagesFromR2(prefix);
  const keys = (listed.success ? listed.images : []).map((img) => img.key).filter((key) => key && key.startsWith(prefix));
  for (let i = 0; i < keys.length; i += 50) {
    // eslint-disable-next-line no-await-in-loop
    await deleteImagesFromR2(keys.slice(i, i + 50), { allowedPrefix: prefix });
  }
}

/** Delete the project and, like the classic editor, its own images. */
export async function removeStudioProject(projectId, { userId = null } = {}) {
  await removeProjectImages(userId, projectId).catch(() => null);
  const result = await deleteProject(projectId);
  if (result.success && isStudioLocalMode()) {
    // deleteProject leaves the local file in place.
    await localJson(`/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }).catch(() => null);
  }
  forgetClassicEditingState(projectId);
  return result;
}

/** How many responses the project has (practice runs included), or null when unknown. */
export async function countStudioResponses(projectId) {
  if (!projectId) return null;
  if (!isStudioLocalMode()) return countOwnerResponses(projectId);
  try {
    const data = await localJson(`/responses?${new URLSearchParams({ projectId, countOnly: '1' })}`);
    return Number.isFinite(Number(data?.count)) ? Number(data.count) : null;
  } catch {
    return null;
  }
}

/**
 * Publish the current draft. `code: 'site-pages-sql'` when the database
 * still refuses drafts that only hold a page (no question pages).
 */
export async function publishStudioProject(projectId) {
  const result = await publishProjectConfig(projectId, '');
  if (result.success) {
    forgetClassicEditingState(projectId);
    return result;
  }
  const message = String(result.error || '');
  return { ...result, code: /draft has no pages/i.test(message) ? 'site-pages-sql' : 'failed' };
}

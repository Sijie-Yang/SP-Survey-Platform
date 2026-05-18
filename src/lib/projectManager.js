/**
 * Project management — Supabase-first, falls back to local Express server.
 *
 * Platform mode  (REACT_APP_SUPABASE_URL set):
 *   Projects stored in Supabase `projects` table (per-user via RLS).
 *
 * Self-hosted dev mode (no env vars):
 *   Projects stored on local file system via Express server on port 3001.
 *
 * Required Supabase SQL (run once in your project's SQL editor):
 * ─────────────────────────────────────────────────────────────────
 * CREATE TABLE projects (
 *   id           TEXT PRIMARY KEY,
 *   user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
 *   name         TEXT NOT NULL,
 *   description  TEXT DEFAULT '',
 *   survey_config        JSONB DEFAULT '{}',
 *   image_dataset_config JSONB DEFAULT '{}',
 *   preloaded_images     JSONB DEFAULT '[]',
 *   preloaded_at         TIMESTAMPTZ,
 *   preloaded_source     TEXT,
 *   template_id          TEXT,
 *   created_at   TIMESTAMPTZ DEFAULT now(),
 *   updated_at   TIMESTAMPTZ DEFAULT now()
 * );
 * ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "Users manage their own projects" ON projects
 *   FOR ALL USING (auth.uid() = user_id)
 *   WITH CHECK (auth.uid() = user_id);
 * ─────────────────────────────────────────────────────────────────
 */

import { supabase } from './supabase';
import { saveSurveyConfig, loadSurveyConfig, deleteSurveyConfig } from './surveyStorage';
import { getTemplateById } from './projectTemplates';

const ACTIVE_PROJECT_KEY = 'active_project_id';
const isPlatformMode = () => !!supabase;

// ── Helpers ───────────────────────────────────────────────────────────────────

const generateProjectId = () =>
  'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

const createDefaultSurveyConfig = (title) => ({
  title,
  description: 'This survey helps us understand user preferences and opinions.',
  logo: '',
  logoPosition: 'right',
  showQuestionNumbers: 'off',
  showProgressBar: 'aboveheader',
  progressBarType: 'questions',
  autoGrowComment: true,
  showPreviewBeforeComplete: 'showAllQuestions',
  pages: [
    {
      name: 'page1',
      title: 'Survey Questions',
      description: 'Please answer the following questions.',
      elements: [],
    },
  ],
});

async function getCurrentUserId() {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function sbSaveProject(project, surveyConfig) {
  const userId = await getCurrentUserId();
  const row = {
    id: project.id,
    user_id: userId,
    name: project.name,
    description: project.description || '',
    survey_config: surveyConfig || {},
    image_dataset_config: project.imageDatasetConfig || {},
    preloaded_images: project.preloadedImages || [],
    preloaded_at: project.preloadedAt || null,
    preloaded_source: project.preloadedSource || null,
    template_id: project.templateId || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('projects').upsert(row, { onConflict: 'id' });
  if (error) throw error;
}

async function sbLoadProject(projectId) {
  // First try a direct table read — succeeds for project owners and admins
  // under the strict RLS policies (auth.uid() = user_id, or admins.user_id).
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .maybeSingle();
  if (!error && data) return rowToProject(data);

  // Fallback: anonymous (survey participant) or authenticated-but-not-owner
  // users get the project through a SECURITY DEFINER RPC that only exposes
  // the columns needed to render the survey (no user_id, no timestamps,
  // no per-row metadata that would leak ownership).
  const { data: rpcRows, error: rpcError } = await supabase.rpc(
    'get_survey_project',
    { p_id: projectId }
  );
  if (rpcError || !rpcRows || rpcRows.length === 0) return null;
  return rowToProject(rpcRows[0]);
}

async function sbListProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) return [];
  return (data || []).map(rowToProject);
}

async function sbDeleteProject(projectId) {
  const { error } = await supabase.from('projects').delete().eq('id', projectId);
  if (error) throw error;
}

function rowToProject(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    // created_at / updated_at are absent on the survey-RPC payload; that's
    // fine — those callers (survey participants) never read these fields.
    createdAt: row.created_at || null,
    lastModified: row.updated_at || null,
    templateId: row.template_id || null,
    imageDatasetConfig: row.image_dataset_config || {},
    preloadedImages: row.preloaded_images || [],
    preloadedAt: row.preloaded_at || null,
    preloadedSource: row.preloaded_source || null,
    // surveyConfig lives inside the row but is kept separate for callers
    _surveyConfig: row.survey_config || {},
  };
}

// ── Local server helpers ──────────────────────────────────────────────────────

async function localSaveProject(project, surveyConfig) {
  const res = await fetch('http://localhost:3001/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, surveyConfig }),
  });
  const result = await res.json();
  if (!result.success) throw new Error(result.error || 'Save failed');
}

async function localLoadProject(projectId) {
  const res = await fetch(`http://localhost:3001/api/projects/${projectId}`);
  const data = await res.json();
  if (!data.success || !data.project) return null;
  return data.project;
}

async function localListProjects() {
  const res = await fetch('http://localhost:3001/api/projects');
  const data = await res.json();
  return data.projects || [];
}

// ── Public API ────────────────────────────────────────────────────────────────

export const createProject = async (projectData) => {
  try {
    const projectId = generateProjectId();
    const now = new Date().toISOString();

    const project = {
      id: projectId,
      name: projectData.name,
      description: projectData.description || '',
      createdAt: now,
      lastModified: now,
      templateId: projectData.templateId || null,
      imageDatasetConfig: projectData.imageDatasetConfig || {
        enabled: true,
        huggingFaceToken: '',
        datasetName: '',
      },
    };

    let surveyConfig;
    if (projectData.surveyConfig) {
      surveyConfig = { ...projectData.surveyConfig, title: projectData.name };
    } else if (projectData.templateId) {
      const template = getTemplateById(projectData.templateId);
      if (!template) throw new Error('Template not found');
      surveyConfig = { ...template.config, title: projectData.name };
    } else {
      surveyConfig = createDefaultSurveyConfig(projectData.name);
    }

    if (isPlatformMode()) {
      await sbSaveProject(project, surveyConfig);
    } else {
      await saveSurveyConfig(projectId, surveyConfig);
      const { saveProjectToProjectsFolder } = await import('./fileSystemManager');
      const fileResult = await saveProjectToProjectsFolder(project, surveyConfig);
      if (!fileResult.success) throw new Error('Failed to create project file: ' + fileResult.error);
    }

    return { success: true, project, surveyConfig };
  } catch (error) {
    console.error('createProject:', error);
    return { success: false, error: error.message };
  }
};

export const duplicateProject = async (sourceProjectId, newName, sourceProject) => {
  try {
    let sourceConfig;
    if (isPlatformMode()) {
      const src = await sbLoadProject(sourceProjectId);
      sourceConfig = src?._surveyConfig || {};
    } else {
      sourceConfig = await loadSurveyConfig(sourceProjectId);
    }
    if (!sourceConfig) throw new Error('Source project not found');

    const result = await createProject({
      name: newName,
      description: `Copy of ${sourceProject?.name || 'Unknown Project'}`,
      surveyConfig: { ...sourceConfig, title: newName },
      imageDatasetConfig: sourceProject?.imageDatasetConfig || {},
    });

    return result;
  } catch (error) {
    console.error('duplicateProject:', error);
    return { success: false, error: error.message };
  }
};

export const createProjectFromTemplate = async (templateId, projectName) => {
  try {
    const template = getTemplateById(templateId);
    if (!template) throw new Error('Template not found');
    return await createProject({
      name: projectName,
      description: `Based on ${template.name}`,
      templateId,
    });
  } catch (error) {
    console.error('createProjectFromTemplate:', error);
    return { success: false, error: error.message };
  }
};

export const deleteProject = async (projectId) => {
  try {
    if (isPlatformMode()) {
      await sbDeleteProject(projectId);
    } else {
      await deleteSurveyConfig(projectId);
    }
    const activeProjectId = getActiveProjectId();
    if (activeProjectId === projectId) {
      sessionStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
    return { success: true };
  } catch (error) {
    console.error('deleteProject:', error);
    return { success: false, error: error.message };
  }
};

export const updateProject = async (projectId, updates) => {
  try {
    if (isPlatformMode()) {
      const existing = await sbLoadProject(projectId);
      if (!existing) throw new Error('Project not found');
      const merged = { ...existing, ...updates, id: projectId, lastModified: new Date().toISOString() };
      await sbSaveProject(merged, merged._surveyConfig || {});
      return { success: true, project: merged };
    } else {
      const res = await fetch(`http://localhost:3001/api/projects/${projectId}`);
      const data = await res.json();
      if (!data.success || !data.project) throw new Error('Project not found');
      const updatedProject = { ...data.project, ...updates, id: projectId, lastModified: new Date().toISOString() };
      await localSaveProject(updatedProject, data.surveyConfig);
      return { success: true, project: updatedProject };
    }
  } catch (error) {
    console.error('updateProject:', error);
    return { success: false, error: error.message };
  }
};

export const getUserProjects = async () => {
  try {
    if (isPlatformMode()) return await sbListProjects();
    return await localListProjects();
  } catch (error) {
    console.error('getUserProjects:', error);
    return [];
  }
};

export const getProjectById = async (projectId) => {
  try {
    if (isPlatformMode()) return await sbLoadProject(projectId);
    return await localLoadProject(projectId);
  } catch (error) {
    console.error('getProjectById:', error);
    return null;
  }
};

export const saveProjectFull = async (project, surveyConfig) => {
  try {
    if (isPlatformMode()) {
      await sbSaveProject(project, surveyConfig);
    } else {
      await localSaveProject(project, surveyConfig);
    }
    return { success: true };
  } catch (error) {
    console.error('saveProjectFull:', error);
    return { success: false, error: error.message };
  }
};

export const loadSurveyConfigForProject = async (projectId) => {
  try {
    if (isPlatformMode()) {
      const project = await sbLoadProject(projectId);
      return project?._surveyConfig || null;
    }
    return await loadSurveyConfig(projectId);
  } catch (error) {
    console.error('loadSurveyConfigForProject:', error);
    return null;
  }
};

export const setActiveProject = (projectId) => {
  sessionStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
};

export const getActiveProjectId = () => sessionStorage.getItem(ACTIVE_PROJECT_KEY);

export const getActiveProject = async () => {
  const activeId = getActiveProjectId();
  return activeId ? await getProjectById(activeId) : null;
};

export const migrateExistingConfig = async () => null;

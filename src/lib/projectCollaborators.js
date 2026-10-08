import { supabase } from './supabase';

export const PRESENCE_HEARTBEAT_MS = 25000;
export const PRESENCE_STALE_MS = 70000;

const AVATAR_COLORS = ['#1565c0', '#2e7d32', '#6a1b9a', '#ef6c00', '#00838f', '#ad1457'];

export function normalizeCollaboratorEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

export function avatarColor(seed) {
  const text = String(seed || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function presenceInitials(name, email) {
  const source = String(name || email || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (Array.from(source)[0] || '?').toUpperCase();
}

/** Owned projects stay owned. Shared rows are appended once. Nothing else is included. */
export function mergeAccessibleProjects(owned, shared) {
  const byId = new Map();
  for (const project of owned || []) {
    if (!project?.id) continue;
    byId.set(project.id, { ...project, accessRole: 'owner' });
  }
  for (const project of shared || []) {
    if (!project?.id || byId.has(project.id)) continue;
    byId.set(project.id, { ...project, accessRole: 'collaborator' });
  }
  return [...byId.values()];
}

/** Full draft replacement. user_id is omitted so a collaborator save cannot transfer the project. */
export function projectUpdatePayload(fields) {
  const now = fields.now;
  return {
    name: fields.name,
    description: fields.description || '',
    survey_config: fields.surveyConfig || {},
    survey_config_draft: fields.surveyConfig || {},
    draft_updated_at: now,
    image_dataset_config: fields.imageDatasetConfig || {},
    preloaded_images: fields.preloadedImages || [],
    preloaded_at: fields.preloadedAt || null,
    preloaded_source: fields.preloadedSource || null,
    template_id: fields.templateId || null,
    metadata: fields.metadata || {},
    updated_at: now,
    last_writer: fields.writer || { source: 'human', at: now },
  };
}

export function projectInsertPayload(patch, { id, userId }) {
  return { ...patch, id, user_id: userId };
}

export function visiblePresence(rows, selfId, now = Date.now(), staleMs = PRESENCE_STALE_MS) {
  return (rows || []).filter((row) => {
    if (!row?.userId || row.userId === selfId) return false;
    const seen = Date.parse(row.lastSeenAt || '');
    return Number.isFinite(seen) && (now - seen) <= staleMs;
  });
}

export function collaboratorErrorText(error, t = {}) {
  const message = String(error?.message || error || '');
  if (/no account for that email/i.test(message)) return t.collaboratorNoAccount || message;
  if (/only the project owner can add/i.test(message)) return t.collaboratorOwnerOnly || message;
  if (/only the project owner can remove/i.test(message)) return t.collaboratorOwnerOnly || message;
  if (/already own this project/i.test(message)) return t.collaboratorAlreadyOwner || message;
  if (/enter a valid email/i.test(message)) return t.collaboratorEmailInvalid || message;
  if (/project_collaborators|add_project_collaborator|schema cache|PGRST202|could not find the function/i.test(message)) {
    return t.collaboratorMigrationMissing || message;
  }
  return message || t.collaboratorSaveFailed || 'Could not update collaborators';
}

function asMember(row) {
  if (!row || typeof row !== 'object') return null;
  const userId = row.userId || row.user_id;
  if (!userId) return null;
  return {
    userId,
    email: row.email || '',
    displayName: row.displayName || row.display_name || '',
    lastSeenAt: row.lastSeenAt || row.last_seen_at || null,
  };
}

function asMemberList(data) {
  const rows = Array.isArray(data) ? data : [];
  return rows.map(asMember).filter(Boolean);
}

export async function listCollaboratorProjectIds(userId) {
  if (!supabase || !userId) return [];
  const { data, error } = await supabase
    .from('project_collaborators')
    .select('project_id')
    .eq('user_id', userId);
  if (error || !Array.isArray(data)) return [];
  return data.map((row) => row.project_id).filter(Boolean);
}

export async function listProjectCollaborators(projectId) {
  if (!supabase || !projectId) return [];
  const { data, error } = await supabase.rpc('list_project_collaborators', { p_project_id: projectId });
  if (error) throw error;
  return asMemberList(data);
}

export async function addProjectCollaborator(projectId, email) {
  if (!supabase) throw new Error('add_project_collaborator is not applied');
  const normalized = normalizeCollaboratorEmail(email);
  if (!normalized) throw new Error('enter a valid email');
  const { data, error } = await supabase.rpc('add_project_collaborator', {
    p_project_id: projectId,
    p_email: normalized,
  });
  if (error) throw error;
  return asMember(data);
}

export async function removeProjectCollaborator(projectId, userId) {
  if (!supabase) throw new Error('remove_project_collaborator is not applied');
  const { data, error } = await supabase.rpc('remove_project_collaborator', {
    p_project_id: projectId,
    p_user_id: userId,
  });
  if (error) throw error;
  return data;
}

export async function touchProjectPresence(projectId) {
  if (!supabase || !projectId) return [];
  const { data, error } = await supabase.rpc('touch_project_presence', { p_project_id: projectId });
  if (error) throw error;
  return asMemberList(data);
}

export async function clearProjectPresence(projectId) {
  if (!supabase || !projectId) return false;
  const { error } = await supabase.rpc('clear_project_presence', { p_project_id: projectId });
  if (error) return false;
  return true;
}

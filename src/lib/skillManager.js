/**
 * question_skills CRUD — personal library + optional public submission.
 */
import { supabase } from './supabase';
import { PRESET_SKILLS, getPresetSkill } from './presetSkills';

function rowToSkill(row) {
  return {
    id: row.id,
    name: row.name || '',
    description: row.description || '',
    user_id: row.user_id || null,
    submitter_email: row.submitter_email || null,
    sourceHtml: row.source_html || '',
    configSchema: row.config_schema || [],
    defaultConfig: row.default_config || {},
    resultSchema: row.result_schema || [],
    is_approved: row.is_approved ?? false,
    submittedAt: row.submitted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSkillStatus(skill) {
  if (skill.is_approved) return 'approved';
  if (skill.submittedAt) return 'pending';
  return 'draft';
}

export async function listApprovedSkills() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('question_skills')
      .select('*')
      .eq('is_approved', true)
      .order('name');
    if (error) { console.error('listApprovedSkills:', error); return []; }
    return (data || []).map(rowToSkill);
  } catch (err) {
    console.error('listApprovedSkills exception:', err);
    return [];
  }
}

export async function listMySkills() {
  if (!supabase) return [];
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('question_skills')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (error) { console.error('listMySkills:', error); return []; }
    return (data || []).map(rowToSkill);
  } catch (err) {
    console.error('listMySkills exception:', err);
    return [];
  }
}

/** Approved public skills + current user's personal library (for survey builder). */
export async function listSkillsForBuilder() {
  const [approved, mine] = await Promise.all([listApprovedSkills(), listMySkills()]);
  const byId = new Map();
  approved.forEach((s) => byId.set(s.id, { ...s, scope: 'public' }));
  mine.forEach((s) => {
    if (!byId.has(s.id)) byId.set(s.id, { ...s, scope: 'mine' });
  });
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listSubmittedSkills() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('question_skills')
      .select('*')
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false });
    if (error) { console.error('listSubmittedSkills:', error); return []; }
    return (data || []).map(rowToSkill);
  } catch (err) {
    return [];
  }
}

/** @deprecated Use listSubmittedSkills for admin review queue */
export async function listAllSkills() {
  return listSubmittedSkills();
}

export async function saveSkill(skill) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const existing = skill.id ? await getSkillById(skill.id) : null;
  if (existing && existing.user_id && existing.user_id !== user.id) {
    throw new Error('Cannot edit another user\'s skill');
  }

  const id = skill.id || `skill_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const row = {
    id,
    name: skill.name || 'Untitled Skill',
    description: skill.description || '',
    source_html: skill.sourceHtml || '',
    config_schema: skill.configSchema || [],
    default_config: skill.defaultConfig || {},
    result_schema: skill.resultSchema || [],
    user_id: user.id,
    submitter_email: user.email || null,
    is_approved: existing?.is_approved ?? false,
    submitted_at: existing?.submittedAt ?? null,
    updated_at: new Date().toISOString(),
  };
  if (!existing) row.created_at = new Date().toISOString();

  const { error } = await supabase.from('question_skills').upsert(row, { onConflict: 'id' });
  if (error) throw error;
  return { success: true, skill: rowToSkill(row) };
}

export async function submitSkillForReview(id) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const existing = await getSkillById(id);
  if (!existing || existing.user_id !== user.id) {
    throw new Error('Skill not found');
  }
  if (existing.is_approved) {
    throw new Error('Skill is already public');
  }

  const { error } = await supabase.from('question_skills').update({
    submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
  return { success: true };
}

export async function updateSkill(id, updates) {
  if (!supabase) throw new Error('Supabase not configured');
  const row = { updated_at: new Date().toISOString() };
  if ('name' in updates) row.name = updates.name;
  if ('description' in updates) row.description = updates.description;
  if ('source_html' in updates) row.source_html = updates.source_html;
  if ('config_schema' in updates) row.config_schema = updates.config_schema;
  if ('default_config' in updates) row.default_config = updates.default_config;
  if ('result_schema' in updates) row.result_schema = updates.result_schema;
  if ('is_approved' in updates) row.is_approved = updates.is_approved;
  const { error } = await supabase.from('question_skills').update(row).eq('id', id);
  if (error) throw error;
  return { success: true };
}

export async function deleteSkill(id) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('question_skills').delete().eq('id', id);
  if (error) throw error;
  return { success: true };
}

export async function getSkillById(id) {
  if (!supabase || !id) return null;
  try {
    const { data, error } = await supabase.from('question_skills').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return rowToSkill(data);
  } catch {
    return null;
  }
}

/** Import a built-in preset into the current user's library. Re-import syncs latest HTML. */
export async function importPresetSkill(presetId) {
  const preset = getPresetSkill(presetId);
  if (!preset) throw new Error('Preset not found');

  const stableId = `preset_${presetId}`;
  const existing = await getSkillById(stableId);
  const payload = {
    id: stableId,
    name: preset.name,
    description: preset.description,
    sourceHtml: preset.sourceHtml,
    configSchema: preset.configSchema,
    defaultConfig: preset.defaultConfig,
    resultSchema: preset.resultSchema || [],
  };
  const result = await saveSkill(payload);
  return { ...result, alreadyExists: !!existing, updated: !!existing };
}

export async function listImportedPresetIds() {
  const mine = await listMySkills();
  return mine
    .filter((s) => s.id.startsWith('preset_'))
    .map((s) => s.id.replace(/^preset_/, ''));
}

export { PRESET_SKILLS };

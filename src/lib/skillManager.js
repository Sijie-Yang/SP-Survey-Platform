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
    analysisHtml: row.analysis_html || '',
    configSchema: row.config_schema || [],
    defaultConfig: row.default_config || {},
    resultSchema: row.result_schema || [],
    exampleAnswer: row.example_answer || null,
    contractVersion: Number(row.contract_version) || 0,
    currentRevision: Number(row.current_revision) || 1,
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

  const { prepareSkillForSave } = await import('./skillHtmlValidate');
  const prepared = prepareSkillForSave({ ...skill, contractVersion: 1 });
  if (!prepared.ok) {
    throw new Error(prepared.errors.join(' '));
  }

  const existing = skill.id ? await getSkillById(skill.id) : null;
  if (existing && existing.user_id && existing.user_id !== user.id) {
    throw new Error('Cannot edit another user\'s skill');
  }

  const id = skill.id || `skill_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const unchanged = existing
    && existing.name === (prepared.skill.name || skill.name || 'Untitled Skill')
    && existing.description === (prepared.skill.description || skill.description || '')
    && existing.sourceHtml === prepared.skill.sourceHtml
    && existing.analysisHtml === prepared.skill.analysisHtml
    && sameJson(existing.configSchema, prepared.skill.configSchema)
    && sameJson(existing.defaultConfig, prepared.skill.defaultConfig)
    && sameJson(existing.resultSchema, prepared.skill.resultSchema)
    && sameJson(existing.exampleAnswer, prepared.skill.exampleAnswer);
  if (unchanged) {
    return { success: true, skill: { ...existing, revision: existing.currentRevision }, warnings: prepared.warnings };
  }
  const revision = existing ? (Number(existing.currentRevision) || 1) + 1 : 1;
  const row = {
    id,
    name: prepared.skill.name || skill.name || 'Untitled Skill',
    description: prepared.skill.description || skill.description || '',
    source_html: prepared.skill.sourceHtml || '',
    analysis_html: prepared.skill.analysisHtml || '',
    config_schema: prepared.skill.configSchema || [],
    default_config: prepared.skill.defaultConfig || {},
    result_schema: prepared.skill.resultSchema || [],
    example_answer: prepared.skill.exampleAnswer,
    contract_version: 1,
    current_revision: revision,
    user_id: user.id,
    submitter_email: user.email || null,
    is_approved: existing?.is_approved ?? false,
    submitted_at: existing?.submittedAt ?? null,
    updated_at: new Date().toISOString(),
  };
  if (!existing) row.created_at = new Date().toISOString();

  let { error } = await supabase.from('question_skills').upsert(row, { onConflict: 'id' });
  // Graceful fallback before supabase/question_skills_analysis_html.sql is applied.
  if (error && /analysis_html/i.test(error.message || '')) {
    const { analysis_html: _omit, ...rowWithoutAnalysis } = row;
    ({ error } = await supabase.from('question_skills').upsert(rowWithoutAnalysis, { onConflict: 'id' }));
    if (!error) {
      prepared.warnings.push(
        'Saved without analysis_html — run supabase/question_skills_analysis_html.sql to enable skill-authored analysis views.',
      );
    }
  }
  if (error) throw error;
  const versionRow = {
    skill_id: id,
    revision,
    user_id: user.id,
    name: row.name,
    description: row.description,
    source_html: row.source_html,
    analysis_html: row.analysis_html,
    config_schema: row.config_schema,
    default_config: row.default_config,
    result_schema: row.result_schema,
    example_answer: row.example_answer,
    contract_version: 1,
    created_at: row.updated_at,
  };
  const { error: versionError } = await supabase
    .from('question_skill_versions')
    .upsert(versionRow, { onConflict: 'skill_id,revision', ignoreDuplicates: true });
  if (versionError) throw versionError;
  return {
    success: true,
    skill: { ...rowToSkill(row), revision },
    warnings: prepared.warnings,
  };
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
  if ('analysis_html' in updates) row.analysis_html = updates.analysis_html;
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

export async function getSkillById(id, revision = null) {
  if (!supabase || !id) return null;
  try {
    const { data, error } = await supabase.from('question_skills').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    if (revision == null || Number(revision) === Number(data.current_revision || 1)) {
      return { ...rowToSkill(data), revision: Number(revision) || Number(data.current_revision) || 1 };
    }
    const { data: version, error: versionError } = await supabase
      .from('question_skill_versions')
      .select('*')
      .eq('skill_id', id)
      .eq('revision', Number(revision))
      .maybeSingle();
    if (versionError || !version) return null;
    return {
      ...rowToSkill({ ...data, ...version, id, current_revision: data.current_revision }),
      revision: Number(revision),
    };
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
  const { buildSyntheticAnalysisResponses } = await import('./skillSdk');
  const exampleAnswer = buildSyntheticAnalysisResponses(
    preset.resultSchema || [],
    [{ url: 'https://example.invalid/stimulus.jpg', name: 'stimulus.jpg', type: preset.defaultConfig?.mediaType || 'image' }],
    1,
  )[0]?.answer || { value: true };
  const payload = {
    id: stableId,
    name: preset.name,
    description: preset.description,
    sourceHtml: preset.sourceHtml,
    configSchema: preset.configSchema,
    defaultConfig: preset.defaultConfig,
    resultSchema: preset.resultSchema || [],
    exampleAnswer,
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

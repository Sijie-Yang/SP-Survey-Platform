/**
 * Private + approved public question_skills for Agent/MCP.
 */

import { supabaseRest } from '../supabaseUserClient.mjs';
import { prepareSkillForSave } from './skillHtmlValidate.mjs';

function rowToSkill(row, { includeHtml = false } = {}) {
  const skill = {
    id: row.id,
    name: row.name || '',
    description: row.description || '',
    userId: row.user_id || null,
    configSchema: row.config_schema || [],
    defaultConfig: row.default_config || {},
    resultSchema: row.result_schema || [],
    isApproved: Boolean(row.is_approved),
    submittedAt: row.submitted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.is_approved ? 'approved' : (row.submitted_at ? 'pending' : 'draft'),
  };
  if (includeHtml) skill.sourceHtml = row.source_html || '';
  return skill;
}

function generateSkillId() {
  const rand = crypto.getRandomValues(new Uint8Array(4));
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
  return `skill_${Date.now()}_${hex}`;
}

/**
 * Approved public skills + caller's private library.
 */
export async function listSkills(env, ctx) {
  const userId = ctx.userId;
  if (!userId) {
    throw Object.assign(new Error('userId required'), { status: 400 });
  }
  const [approved, mine] = await Promise.all([
    supabaseRest(env, {
      path: '/rest/v1/question_skills',
      serviceRole: true,
      query: '?is_approved=eq.true&select=id,name,description,user_id,config_schema,default_config,result_schema,is_approved,submitted_at,created_at,updated_at&order=name.asc',
    }),
    supabaseRest(env, {
      path: '/rest/v1/question_skills',
      serviceRole: true,
      query: `?user_id=eq.${encodeURIComponent(userId)}&select=id,name,description,user_id,config_schema,default_config,result_schema,is_approved,submitted_at,created_at,updated_at&order=updated_at.desc`,
    }),
  ]);
  const byId = new Map();
  (approved || []).forEach((row) => {
    byId.set(row.id, { ...rowToSkill(row), scope: 'public' });
  });
  (mine || []).forEach((row) => {
    if (!byId.has(row.id)) {
      byId.set(row.id, { ...rowToSkill(row), scope: 'mine' });
    } else {
      byId.set(row.id, { ...byId.get(row.id), scope: 'mine' });
    }
  });
  return {
    success: true,
    skills: Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name)),
    note: 'Use skillId on skillquestion (preset_* or your library id). Do not put skillHtml in the survey draft.',
  };
}

export async function getSkill(env, ctx, skillId) {
  const userId = ctx.userId;
  const id = String(skillId || '').trim();
  if (!id) {
    throw Object.assign(new Error('skillId is required'), { status: 400 });
  }
  const rows = await supabaseRest(env, {
    path: '/rest/v1/question_skills',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(id)}&select=*`,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    throw Object.assign(new Error('Skill not found'), { status: 404 });
  }
  const isOwner = row.user_id && row.user_id === userId;
  const isPublic = Boolean(row.is_approved);
  if (!isOwner && !isPublic) {
    throw Object.assign(new Error('Skill not found'), { status: 404 });
  }
  return {
    success: true,
    skill: {
      ...rowToSkill(row, { includeHtml: isOwner || isPublic }),
      scope: isOwner ? 'mine' : 'public',
    },
  };
}

/**
 * Create or update caller's private skill (no auto review submit).
 */
export async function saveSkill(env, ctx, body = {}) {
  const userId = ctx.userId;
  if (!userId) {
    throw Object.assign(new Error('userId required'), { status: 400 });
  }
  const name = String(body.name || '').trim();
  if (!name) {
    throw Object.assign(new Error('name is required'), { status: 400 });
  }
  const prepared = prepareSkillForSave({
    ...body,
    name,
    sourceHtml: body.sourceHtml || body.source_html || '',
    configSchema: body.configSchema ?? body.config_schema,
    resultSchema: body.resultSchema ?? body.result_schema,
    defaultConfig: body.defaultConfig ?? body.default_config,
  });
  if (!prepared.ok) {
    throw Object.assign(new Error(prepared.errors.join(' ')), { status: 400 });
  }

  let id = body.id ? String(body.id).trim() : '';
  let existing = null;
  if (id) {
    if (id.startsWith('preset_')) {
      throw Object.assign(new Error('Cannot overwrite preset skills'), { status: 400 });
    }
    const rows = await supabaseRest(env, {
      path: '/rest/v1/question_skills',
      serviceRole: true,
      query: `?id=eq.${encodeURIComponent(id)}&select=*`,
    });
    existing = Array.isArray(rows) ? rows[0] : null;
    if (existing && existing.user_id && existing.user_id !== userId) {
      throw Object.assign(new Error('Cannot edit another user\'s skill'), { status: 403 });
    }
  } else {
    id = generateSkillId();
  }

  const now = new Date().toISOString();
  const row = {
    id,
    name,
    description: String(body.description || prepared.skill.description || '').trim(),
    source_html: prepared.skill.sourceHtml,
    config_schema: prepared.skill.configSchema.length
      ? prepared.skill.configSchema
      : (existing?.config_schema || []),
    default_config: Object.keys(prepared.skill.defaultConfig || {}).length
      ? prepared.skill.defaultConfig
      : (existing?.default_config || {}),
    result_schema: prepared.skill.resultSchema.length
      ? prepared.skill.resultSchema
      : (existing?.result_schema || []),
    user_id: userId,
    is_approved: existing?.is_approved ?? false,
    submitted_at: existing?.submitted_at ?? null,
    updated_at: now,
  };
  if (!existing) row.created_at = now;

  await supabaseRest(env, {
    path: '/rest/v1/question_skills',
    method: 'POST',
    serviceRole: true,
    query: '?on_conflict=id',
    body: row,
    prefer: 'resolution=merge-duplicates,return=representation',
  });

  return {
    success: true,
    skill: { ...rowToSkill(row, { includeHtml: true }), scope: 'mine' },
    warnings: prepared.warnings,
    message: 'Saved to your private skill library (not submitted for public review).',
  };
}

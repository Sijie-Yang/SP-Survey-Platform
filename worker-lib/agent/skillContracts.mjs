/** Resolve immutable custom-skill contracts into survey question snapshots. */

import { supabaseRest } from '../supabaseUserClient.mjs';
import { getPresetResultSchema } from './presetSkillSchemas.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

export function skillQuestions(config) {
  return (config?.pages || []).flatMap((page) => page.elements || [])
    .filter((q) => q?.type === 'skillquestion' && q.skillId);
}

function hydratePresetQuestion(question) {
  const schema = getPresetResultSchema(question.skillId);
  question.skillContractVersion = Number(question.skillContractVersion) || 1;
  question.skillRevision = Number(question.skillRevision) || 1;
  if (schema) question.skillResultSchema = schema;
}

export async function hydrateSkillContracts(env, surveyConfig, userId) {
  const config = clone(surveyConfig);
  const questions = skillQuestions(config);
  questions.forEach((q) => { delete q.skillHtml; });
  const ids = [...new Set(questions
    .map((q) => String(q.skillId || ''))
    .filter((id) => id && !id.startsWith('preset_')))];

  // Always snapshot preset resultSchema (parity with browser hydrateSkillContractSnapshots).
  questions.forEach((q) => {
    if (String(q.skillId).startsWith('preset_')) hydratePresetQuestion(q);
  });

  if (!ids.length) return config;

  const encodedIds = ids.map((id) => encodeURIComponent(id)).join(',');
  const rows = await supabaseRest(env, {
    path: '/rest/v1/question_skills',
    serviceRole: true,
    query: `?id=in.(${encodedIds})&select=*`,
  });
  const currentById = new Map((rows || []).map((row) => [String(row.id), row]));

  for (const question of questions) {
    const id = String(question.skillId);
    if (id.startsWith('preset_')) continue;
    const current = currentById.get(id);
    if (!current || (!current.is_approved && current.user_id !== userId)) {
      // A historical question may outlive a deleted/private Skill. Its frozen
      // contract remains authoritative; never replace it with guessed data.
      if (Number(question.skillRevision) > 0 && Array.isArray(question.skillResultSchema)) continue;
      throw Object.assign(new Error(`Skill is not accessible: ${id}`), { status: 400, code: 'SKILL_NOT_ACCESSIBLE' });
    }
    const requested = Number(question.skillRevision) || Number(current.current_revision) || 1;
    let contract = current;
    if (requested !== Number(current.current_revision || 1)) {
      const versions = await supabaseRest(env, {
        path: '/rest/v1/question_skill_versions',
        serviceRole: true,
        query: `?skill_id=eq.${encodeURIComponent(id)}&revision=eq.${requested}&select=*`,
      });
      contract = versions?.[0];
      if (!contract) {
        throw Object.assign(new Error(`Skill revision not found: ${id}@${requested}`), { status: 400, code: 'SKILL_REVISION_NOT_FOUND' });
      }
    }
    question.skillRevision = requested;
    question.skillContractVersion = Number(contract.contract_version) || 1;
    question.skillResultSchema = contract.result_schema || [];
  }
  return config;
}

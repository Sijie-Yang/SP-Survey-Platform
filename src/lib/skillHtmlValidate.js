/**
 * Hard rules for custom skill HTML / schemas (AI + manual save).
 */

import { normalizeSkillSchemaArray } from './skillAnswerBridge';

const ALT_ANSWER_TYPES_RE = /skill-result|skillResult|SP_SURVEY_SKILL_RESULT|skill_answer|skill-answer/;

/**
 * @param {string} sourceHtml
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateSkillSourceHtml(sourceHtml) {
  const html = String(sourceHtml || '');
  const errors = [];
  const warnings = [];

  if (!html.trim()) {
    errors.push('sourceHtml is empty');
    return { ok: false, errors, warnings };
  }

  if (!/SPSkill\s*\.\s*setAnswer\s*\(/.test(html)) {
    errors.push(
      'HTML must call SPSkill.setAnswer(...) to record answers. '
      + 'Do not use parent.postMessage with skill-result / skillResult / SP_SURVEY_SKILL_RESULT.',
    );
  }

  if (ALT_ANSWER_TYPES_RE.test(html) && !/SPSkill\s*\.\s*setAnswer\s*\(/.test(html)) {
    errors.push('Remove custom postMessage answer protocols; use SPSkill.setAnswer only.');
  } else if (ALT_ANSWER_TYPES_RE.test(html)) {
    warnings.push('HTML still mentions alternate postMessage answer types — prefer SPSkill.setAnswer only.');
  }

  if (!/spskill-init|SPSkill\s*\.\s*getConfig|SPSkill\s*\.\s*getImages/.test(html)) {
    warnings.push(
      'Prefer document.addEventListener("spskill-init", ...) or SPSkill.getConfig()/getImages() for init/media.',
    );
  }

  // Heuristic: packing many named task modes into one skill
  const modeHits = (html.match(/\b(attention_map|route_trace|budget_lab|flash_reveal|cue_detective)\b/g) || []);
  const uniqueModes = new Set(modeHits);
  if (uniqueModes.size >= 3) {
    warnings.push(
      `This HTML looks like ${uniqueModes.size} task modes in one skill. `
      + 'Prefer one focused skill per task (save multiple skills, multiple skillquestion items).',
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Normalize + validate a skill payload before save / AI apply.
 * @returns {{ ok: boolean, errors: string[], warnings: string[], skill: object }}
 */
export function prepareSkillForSave(raw = {}) {
  const errors = [];
  const warnings = [];
  const htmlCheck = validateSkillSourceHtml(raw.sourceHtml || raw.source_html || '');
  errors.push(...htmlCheck.errors);
  warnings.push(...htmlCheck.warnings);

  const configSchema = normalizeSkillSchemaArray(raw.configSchema || raw.config_schema || []);
  const resultSchema = normalizeSkillSchemaArray(
    raw.resultSchema || raw.result_schema || [],
    { defaultType: 'text' },
  );

  if (Array.isArray(raw.configSchema) && raw.configSchema.some((x) => typeof x === 'string')) {
    warnings.push('configSchema had string keys — normalized to {key,label,type} objects.');
  }
  if (Array.isArray(raw.resultSchema) && raw.resultSchema.some((x) => typeof x === 'string')) {
    warnings.push('resultSchema had string keys — normalized to {key,label,type} objects.');
  }

  const defaultConfig = (raw.defaultConfig && typeof raw.defaultConfig === 'object')
    ? raw.defaultConfig
    : ((raw.default_config && typeof raw.default_config === 'object') ? raw.default_config : {});

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    skill: {
      ...raw,
      sourceHtml: String(raw.sourceHtml || raw.source_html || ''),
      configSchema,
      resultSchema,
      defaultConfig,
    },
  };
}

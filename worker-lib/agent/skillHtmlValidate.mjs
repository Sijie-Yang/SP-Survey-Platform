/**
 * Hard rules for custom skill HTML (MCP skill_save).
 * Keep in sync with src/lib/skillHtmlValidate.js
 */

import { isKnownSkillResultType, KNOWN_SKILL_RESULT_TYPE_IDS } from './skillResultTypes.mjs';

const ALT_ANSWER_TYPES_RE = /skill-result|skillResult|SP_SURVEY_SKILL_RESULT|skill_answer|skill-answer/;

function normalizeSkillSchemaArray(raw, { defaultType = 'string' } = {}) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string' && item.trim()) {
        return { key: item.trim(), label: item.trim(), type: defaultType };
      }
      if (item && typeof item === 'object' && item.key) {
        return {
          key: String(item.key),
          label: item.label != null ? String(item.label) : String(item.key),
          type: item.type != null ? String(item.type) : defaultType,
          ...(item.options ? { options: item.options } : {}),
        };
      }
      return null;
    })
    .filter(Boolean);
}

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

  const modeHits = (html.match(/\b(attention_map|route_trace|budget_lab|flash_reveal|cue_detective)\b/g) || []);
  const uniqueModes = new Set(modeHits);
  if (uniqueModes.size >= 3) {
    warnings.push(
      `This HTML looks like ${uniqueModes.size} task modes in one skill. `
      + 'Prefer one focused skill per task (skill_save multiple times + multiple skillquestion items).',
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function prepareSkillForSave(raw = {}) {
  const htmlCheck = validateSkillSourceHtml(raw.sourceHtml || raw.source_html || '');
  const warnings = [...htmlCheck.warnings];
  const configSchema = normalizeSkillSchemaArray(raw.configSchema || raw.config_schema || []);
  const resultSchema = normalizeSkillSchemaArray(
    raw.resultSchema || raw.result_schema || [],
    { defaultType: 'text' },
  );
  const unknownTypes = [...new Set(
    resultSchema
      .map((f) => String(f.type || '').trim())
      .filter((t) => t && !isKnownSkillResultType(t)),
  )];
  if (unknownTypes.length) {
    warnings.push(
      `Unknown resultSchema type(s): ${unknownTypes.join(', ')}. `
      + `Known types: ${KNOWN_SKILL_RESULT_TYPE_IDS.join(', ')}. `
      + 'Skill will still save; undeclared fields get readable summary + raw JSON only.',
    );
  }
  return {
    ok: htmlCheck.ok,
    errors: htmlCheck.errors,
    warnings,
    skill: {
      ...raw,
      sourceHtml: String(raw.sourceHtml || raw.source_html || ''),
      analysisHtml: String(raw.analysisHtml || raw.analysis_html || ''),
      configSchema,
      resultSchema,
      defaultConfig: (raw.defaultConfig && typeof raw.defaultConfig === 'object')
        ? raw.defaultConfig
        : ((raw.default_config && typeof raw.default_config === 'object') ? raw.default_config : {}),
    },
  };
}

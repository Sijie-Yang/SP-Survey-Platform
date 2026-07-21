/**
 * Thin catalog of skill resultSchema field types.
 * Used for editor self-check, analysis routing, and export shapes.
 * Unknown types are allowed (warning only) — skills stay free-form.
 */

export const SKILL_RESULT_TYPES = {
  number: {
    id: 'number',
    shape: 'number',
    analysis: 'histogram',
    export: 'scalar',
  },
  boolean: {
    id: 'boolean',
    shape: 'boolean',
    analysis: 'yesNo',
    export: 'scalar',
  },
  choice: {
    id: 'choice',
    shape: 'string',
    analysis: 'frequency',
    export: 'scalar',
  },
  text: {
    id: 'text',
    shape: 'string',
    analysis: 'textList',
    export: 'scalar',
  },
  count: {
    id: 'count',
    shape: 'array|number',
    analysis: 'count',
    export: 'scalar',
  },
  color: {
    id: 'color',
    shape: 'hex string',
    analysis: 'colorChips',
    export: 'scalar',
  },
  scaleGroup: {
    id: 'scaleGroup',
    shape: '{dimensionId: number}',
    analysis: 'scaleBars',
    export: 'perKey',
  },
  points: {
    id: 'points',
    shape: '[{x,y,label?}] normalized 0–1',
    analysis: 'densityOverlay',
    export: 'perPoint',
  },
  path: {
    id: 'path',
    shape: '[{x,y,t?}] normalized 0–1',
    analysis: 'pathOverlay',
    export: 'perPoint',
  },
  allocation: {
    id: 'allocation',
    shape: '{label: number}',
    analysis: 'allocationBars',
    export: 'perItem',
  },
  rankedList: {
    id: 'rankedList',
    shape: 'ordered string[]',
    analysis: 'rankingBorda',
    export: 'perRank',
  },
};

export const KNOWN_SKILL_RESULT_TYPE_IDS = Object.keys(SKILL_RESULT_TYPES);

/** Types that already had SkillFieldSummary support before archetypes. */
export const LEGACY_SKILL_RESULT_TYPES = [
  'number', 'boolean', 'choice', 'text', 'count', 'color', 'scaleGroup', 'string',
];

/** Types that need archetype-specific analysis / export. */
export const ARCHETYPE_SKILL_RESULT_TYPES = ['points', 'path', 'allocation', 'rankedList'];

export function isKnownSkillResultType(type) {
  const t = String(type || '').trim();
  if (!t) return false;
  if (t === 'string') return true; // alias of text
  return Object.prototype.hasOwnProperty.call(SKILL_RESULT_TYPES, t);
}

/**
 * Soft-validate a value against a declared result type.
 * Never used to block save — only editor self-check / analysis routing.
 * @returns {{ ok: boolean, detail: string }}
 */
export function validateSkillResultValue(type, value) {
  const t = String(type || '').trim() || 'text';
  if (value === undefined || value === null) {
    return { ok: false, detail: 'missing' };
  }

  switch (t) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n)
        ? { ok: true, detail: String(n) }
        : { ok: false, detail: 'not a number' };
    }
    case 'boolean':
      return typeof value === 'boolean'
        ? { ok: true, detail: value ? 'true' : 'false' }
        : { ok: false, detail: 'not boolean' };
    case 'choice':
    case 'text':
    case 'string':
      return (typeof value === 'string' || typeof value === 'number')
        ? { ok: true, detail: String(value).slice(0, 80) }
        : { ok: false, detail: 'not a string' };
    case 'count': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return { ok: true, detail: String(value) };
      }
      if (Array.isArray(value)) {
        return { ok: true, detail: `${value.length} items` };
      }
      return { ok: false, detail: 'expected number or array' };
    }
    case 'color': {
      const s = String(value);
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)
        ? { ok: true, detail: s }
        : { ok: false, detail: 'expected #hex color' };
    }
    case 'scaleGroup':
    case 'allocation': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, detail: 'expected object map' };
      }
      const keys = Object.keys(value);
      if (!keys.length) return { ok: false, detail: 'empty object' };
      const numeric = keys.filter((k) => Number.isFinite(Number(value[k])));
      return numeric.length
        ? { ok: true, detail: `${numeric.length} keys` }
        : { ok: false, detail: 'no numeric values' };
    }
    case 'points': {
      if (!Array.isArray(value)) return { ok: false, detail: 'expected array' };
      const pts = value.filter((p) => p && typeof p === 'object'
        && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
      return pts.length
        ? { ok: true, detail: `${pts.length} points` }
        : { ok: false, detail: 'no valid {x,y} points' };
    }
    case 'path': {
      if (!Array.isArray(value)) return { ok: false, detail: 'expected array' };
      const pts = value.filter((p) => p && typeof p === 'object'
        && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
      return pts.length >= 2
        ? { ok: true, detail: `${pts.length} vertices` }
        : { ok: false, detail: 'need ≥2 {x,y} vertices' };
    }
    case 'rankedList': {
      if (!Array.isArray(value)) return { ok: false, detail: 'expected array' };
      const items = value.filter((x) => x != null && String(x).trim());
      return items.length
        ? { ok: true, detail: `${items.length} ranks` }
        : { ok: false, detail: 'empty ranked list' };
    }
    default:
      // Unknown type — accept any non-null value
      return { ok: true, detail: 'custom/unknown type' };
  }
}

/**
 * Check an answer object against a resultSchema array.
 * @returns {{ recorded: boolean, fields: Array<{key,label,type,ok,detail}> }}
 */
export function checkAnswerAgainstResultSchema(answer, resultSchema = []) {
  const recorded = answer != null && typeof answer === 'object'
    && !Array.isArray(answer)
    && Object.keys(answer).length > 0;
  const schema = Array.isArray(resultSchema) ? resultSchema : [];
  if (!schema.length) {
    return {
      recorded,
      fields: recorded
        ? [{ key: '_', label: 'answer', type: 'object', ok: true, detail: `${Object.keys(answer).length} keys` }]
        : [{ key: '_', label: 'answer', type: 'object', ok: false, detail: 'no answer yet' }],
    };
  }
  const fields = schema.map((f) => {
    const key = f.key;
    const val = answer && typeof answer === 'object' ? answer[key] : undefined;
    const check = validateSkillResultValue(f.type, val);
    return {
      key,
      label: f.label || key,
      type: f.type || 'text',
      ok: check.ok,
      detail: check.detail,
    };
  });
  return { recorded, fields };
}

/** One-line catalog for prompts / MCP descriptions. */
export function skillResultTypesCatalogText() {
  return KNOWN_SKILL_RESULT_TYPE_IDS.map((id) => {
    const t = SKILL_RESULT_TYPES[id];
    return `- ${id}: ${t.shape} → analysis:${t.analysis}, export:${t.export}`;
  }).join('\n');
}

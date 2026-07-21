/**
 * Suggested SP-Bench dimension template + method freeze helpers.
 * Dimensions are editable; freeze snapshots into sp_bench_methods.
 */

export const SUGGESTED_DIMENSIONS = [
  {
    key: 'scene_type',
    name_en: 'Scene / street type',
    name_zh: '场景/街道类型',
    group_key: 'objective',
    label_type: 'category',
    value_range: { choices: ['residential', 'commercial', 'mixed', 'park', 'highway', 'alley', 'waterfront'] },
    metrics: ['macro_f1', 'balanced_accuracy'],
    weight: 1,
    prompt_field: 'scene_type',
    required: true,
    sort_order: 10,
  },
  {
    key: 'green_view_ratio',
    name_en: 'Green view ratio',
    name_zh: '绿视率',
    group_key: 'objective',
    label_type: 'continuous',
    value_range: { min: 0, max: 1 },
    metrics: ['mae', 'rmse', 'spearman'],
    weight: 1,
    prompt_field: 'green_view_ratio',
    required: true,
    sort_order: 20,
  },
  {
    key: 'sky_ratio',
    name_en: 'Sky ratio',
    name_zh: '天空率',
    group_key: 'objective',
    label_type: 'continuous',
    value_range: { min: 0, max: 1 },
    metrics: ['mae', 'rmse', 'spearman'],
    weight: 1,
    prompt_field: 'sky_ratio',
    required: false,
    sort_order: 30,
  },
  {
    key: 'enclosure',
    name_en: 'Enclosure',
    name_zh: '围合度',
    group_key: 'objective',
    label_type: 'continuous',
    value_range: { min: 1, max: 7 },
    metrics: ['mae', 'rmse', 'spearman'],
    weight: 1,
    prompt_field: 'enclosure',
    required: false,
    sort_order: 40,
  },
  {
    key: 'safety',
    name_en: 'Perceived safety',
    name_zh: '安全感',
    group_key: 'subjective',
    label_type: 'continuous',
    value_range: { min: 1, max: 7 },
    metrics: ['mae', 'rmse', 'spearman', 'pearson'],
    weight: 1.5,
    prompt_field: 'safety',
    required: true,
    sort_order: 50,
  },
  {
    key: 'beauty',
    name_en: 'Perceived beauty',
    name_zh: '美观',
    group_key: 'subjective',
    label_type: 'continuous',
    value_range: { min: 1, max: 7 },
    metrics: ['mae', 'rmse', 'spearman', 'pearson'],
    weight: 1.5,
    prompt_field: 'beauty',
    required: true,
    sort_order: 60,
  },
  {
    key: 'vitality',
    name_en: 'Perceived vitality',
    name_zh: '活力',
    group_key: 'subjective',
    label_type: 'continuous',
    value_range: { min: 1, max: 7 },
    metrics: ['mae', 'rmse', 'spearman', 'pearson'],
    weight: 1.2,
    prompt_field: 'vitality',
    required: true,
    sort_order: 70,
  },
  {
    key: 'walkability',
    name_en: 'Walkability',
    name_zh: '步行友好',
    group_key: 'subjective',
    label_type: 'continuous',
    value_range: { min: 1, max: 7 },
    metrics: ['mae', 'rmse', 'spearman', 'pearson'],
    weight: 1.2,
    prompt_field: 'walkability',
    required: false,
    sort_order: 80,
  },
  {
    key: 'risk_cues',
    name_en: 'Risk cues',
    name_zh: '风险线索',
    group_key: 'cognition',
    label_type: 'multi_label',
    value_range: { choices: ['traffic', 'crime', 'darkness', 'construction', 'flooding', 'none'] },
    metrics: ['macro_f1'],
    weight: 1,
    prompt_field: 'risk_cues',
    required: false,
    sort_order: 90,
  },
  {
    key: 'affordances',
    name_en: 'Affordances',
    name_zh: '可供性',
    group_key: 'cognition',
    label_type: 'multi_label',
    value_range: { choices: ['walk', 'sit', 'cycle', 'cross', 'socialize', 'exercise'] },
    metrics: ['macro_f1'],
    weight: 1,
    prompt_field: 'affordances',
    required: false,
    sort_order: 100,
  },
];

export function buildJsonSchemaFromDimensions(dimensions = []) {
  const properties = {};
  const required = [];
  for (const dim of dimensions.filter((d) => d.enabled !== false)) {
    const field = dim.prompt_field || dim.key;
    if (dim.label_type === 'category') {
      properties[field] = {
        type: 'string',
        enum: dim.value_range?.choices || undefined,
      };
    } else if (dim.label_type === 'multi_label') {
      properties[field] = {
        type: 'array',
        items: { type: 'string', enum: dim.value_range?.choices || undefined },
      };
    } else if (dim.label_type === 'pairwise') {
      properties[field] = {
        type: 'object',
        properties: {
          preferred: { type: 'string', enum: ['A', 'B', 'tie'] },
          confidence: { type: 'number' },
        },
        required: ['preferred'],
      };
    } else {
      properties[field] = {
        type: 'number',
        minimum: dim.value_range?.min,
        maximum: dim.value_range?.max,
      };
    }
    if (dim.required) required.push(field);
  }
  properties.rationale = { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
}

export function buildPromptTemplate(dimensions = []) {
  const lines = dimensions
    .filter((d) => d.enabled !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((d) => {
      const field = d.prompt_field || d.key;
      if (d.label_type === 'category') {
        return `- ${field}: one of ${(d.value_range?.choices || []).join(', ')}`;
      }
      if (d.label_type === 'multi_label') {
        return `- ${field}: array subset of ${(d.value_range?.choices || []).join(', ')}`;
      }
      if (d.label_type === 'pairwise') {
        return `- ${field}: { preferred: "A"|"B"|"tie", confidence?: number }`;
      }
      const min = d.value_range?.min;
      const max = d.value_range?.max;
      return `- ${field}: number${min != null && max != null ? ` in [${min}, ${max}]` : ''}`;
    });

  return [
    'You are evaluating an urban streetscape image for SP-Bench.',
    'Return ONLY a JSON object (no markdown) with these fields:',
    ...lines,
    '- rationale: short evidence-based explanation (<= 80 words)',
    'Use visible evidence only. If uncertain, pick the closest valid value.',
  ].join('\n');
}

export function freezeMethodPayload({
  version,
  title,
  dimensions,
  notes = '',
}) {
  const dims = (dimensions || [])
    .filter((d) => d.enabled !== false)
    .map((d) => ({ ...d }));
  return {
    version,
    title: title || `SP-Bench ${version}`,
    status: 'frozen',
    dimensions: dims,
    prompt_template: buildPromptTemplate(dims),
    json_schema: buildJsonSchemaFromDimensions(dims),
    scoring_config: {
      normalize: 'weighted_mean',
      groups: ['objective', 'subjective', 'cognition'],
    },
    notes,
    frozen_at: new Date().toISOString(),
  };
}

export function validateItemLabels(labels, dimensions = []) {
  const errors = [];
  const data = labels && typeof labels === 'object' ? labels : {};
  for (const dim of dimensions.filter((d) => d.enabled !== false && d.required)) {
    const field = dim.prompt_field || dim.key;
    const value = data[field];
    if (value == null || value === '') {
      errors.push(`Missing required label: ${field}`);
      continue;
    }
    if (dim.label_type === 'continuous') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`${field} must be a number`);
      } else {
        const min = dim.value_range?.min;
        const max = dim.value_range?.max;
        if (min != null && value < min) errors.push(`${field} must be >= ${min}`);
        if (max != null && value > max) errors.push(`${field} must be <= ${max}`);
      }
    }
    if (dim.label_type === 'category' && dim.value_range?.choices?.length
      && !dim.value_range.choices.includes(value)) {
      errors.push(`${field} must be one of: ${dim.value_range.choices.join(', ')}`);
    }
    if (dim.label_type === 'multi_label' && !Array.isArray(value)) {
      errors.push(`${field} must be an array`);
    }
  }
  return { ok: errors.length === 0, errors };
}

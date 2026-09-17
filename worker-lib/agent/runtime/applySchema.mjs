import {
  buildApplyToolSchema,
  classifyApplyContractError,
  classifySubmitDraftError,
  describeApplyShape,
  describeToolArgShape,
  expandSurveyConfigForTools,
  publicOperationEntries,
  schemaAccepts,
} from '../../../scripts/platform-schema-core.mjs';
import { PLATFORM_SCHEMA } from '../../platformSchema.generated.mjs';

const SLIDER_TYPES = new Set(['slidergroup', 'imageslidergroup', 'mediaslidergroup']);

export const SLIDER_DIMENSION_CONTRACT = {
  requiredOn: [...SLIDER_TYPES],
  item: '{id, label, left, right, min?, max?, step?}',
  requiredItemFields: ['id', 'label', 'left', 'right'],
  example: [
    { id: 'attr_a', label: 'Attribute A', left: 'Low', right: 'High' },
    { id: 'attr_b', label: 'Attribute B', left: 'Low', right: 'High' },
  ],
  note: 'dimensions must be a non-empty array of non-empty strings. Editor blanks stay []. Do not reuse a leftover street-scene illustration unless the study is about that.',
};

const SLIDER_DIMENSION_FIELD = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    required: ['id', 'label', 'left', 'right'],
    properties: {
      id: { type: 'string' },
      label: { type: 'string', description: 'Display name shown above the slider and in settings' },
      left: { type: 'string', description: 'Left pole label' },
      right: { type: 'string', description: 'Right pole label' },
      min: { type: 'number' },
      max: { type: 'number' },
      step: { type: 'number' },
    },
  },
  default: SLIDER_DIMENSION_CONTRACT.example,
  example: SLIDER_DIMENSION_CONTRACT.example,
};

export {
  buildApplyToolSchema,
  classifyApplyContractError,
  classifySubmitDraftError,
  describeApplyShape,
  describeToolArgShape,
  expandSurveyConfigForTools,
  publicOperationEntries,
  schemaAccepts,
};

export function applyToolContract(policy = {}) {
  return buildApplyToolSchema(PLATFORM_SCHEMA, {
    mode: policy.mode || 'agent',
    allowReplaceConfig: policy.allowReplaceConfig !== false,
  });
}

export function publicOperationContracts(mode = 'agent') {
  const entries = publicOperationEntries(PLATFORM_SCHEMA);
  const filtered = mode === 'generate'
    ? entries.filter(([id]) => id === 'replaceConfig')
    : entries;
  const surveyConfig = expandSurveyConfigForTools(PLATFORM_SCHEMA);
  return Object.fromEntries(filtered.map(([id, contract]) => {
    const properties = { ...(contract.properties || {}) };
    if (properties.surveyConfig) properties.surveyConfig = surveyConfig;
    return [id, { ...contract, properties }];
  }));
}

export function questionsCapabilitySchema() {
  const questionFields = PLATFORM_SCHEMA.questionFields || {};
  const questionFieldGroups = PLATFORM_SCHEMA.questionFieldGroups || {};
  const questionTypes = Object.fromEntries(
    Object.entries(PLATFORM_SCHEMA.questionTypes || {}).map(([id, definition]) => {
      const defaults = { ...(definition.defaults || {}) };
      return [id, {
        label: definition.label,
        group: definition.group,
        traits: definition.traits || [],
        defaults,
        fields: Object.fromEntries((definition.allFields || []).map((name) => [name, {
          ...(name === 'dimensions' && SLIDER_TYPES.has(id)
            ? SLIDER_DIMENSION_FIELD
            : (questionFields[name] || {})),
          default: defaults[name],
        }])),
      }];
    }),
  );
  return {
    questionFields: {
      ...questionFields,
      dimensions: SLIDER_DIMENSION_FIELD,
    },
    questionFieldGroups,
    questionTypes,
    sliderDimensions: SLIDER_DIMENSION_CONTRACT,
  };
}

export function capabilityHasContent(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== 'object') return true;
  return Object.values(value).some((child) => capabilityHasContent(child));
}

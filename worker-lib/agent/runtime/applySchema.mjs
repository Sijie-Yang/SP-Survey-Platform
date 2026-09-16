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
    Object.entries(PLATFORM_SCHEMA.questionTypes || {}).map(([id, definition]) => [id, {
      label: definition.label,
      group: definition.group,
      traits: definition.traits || [],
      defaults: definition.defaults || {},
      fields: Object.fromEntries((definition.allFields || []).map((name) => [name, {
        ...(questionFields[name] || {}),
        default: definition.defaults?.[name],
      }])),
    }]),
  );
  return {
    questionFields,
    questionFieldGroups,
    questionTypes,
  };
}

export function capabilityHasContent(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== 'object') return true;
  return Object.values(value).some((child) => capabilityHasContent(child));
}

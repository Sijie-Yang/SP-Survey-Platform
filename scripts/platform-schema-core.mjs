function assert(condition, message) {
  if (!condition) throw new Error(`Invalid platform schema: ${message}`);
}

function unique(values) {
  return [...new Set(values)];
}

export function validateRegistry(registry) {
  const typeIds = Object.keys(registry.questionTypes || {});
  assert(typeIds.length > 0, 'at least one question type is required');
  assert(new Set(typeIds).size === typeIds.length, 'question type IDs must be unique');

  const fieldIds = new Set(Object.keys(registry.questionFields || {}));
  const groups = registry.questionFieldGroups || {};
  Object.entries(groups).forEach(([groupId, fields]) => {
    assert(Array.isArray(fields), `field group ${groupId} must be an array`);
    fields.forEach((field) => assert(
      fieldIds.has(field),
      `field group ${groupId} references unknown field ${field}`,
    ));
  });

  Object.entries(registry.questionTypes || {}).forEach(([typeId, definition]) => {
    assert(definition.label && definition.group, `${typeId} needs label and group`);
    (definition.fieldGroups || []).forEach((groupId) => {
      assert(groups[groupId], `${typeId} references unknown field group ${groupId}`);
    });
    (definition.fields || []).forEach((field) => {
      assert(fieldIds.has(field), `${typeId} references unknown field ${field}`);
    });
    Object.keys(definition.defaults || {}).forEach((field) => {
      assert(
        fieldIds.has(field) || field === 'type',
        `${typeId} default references unknown field ${field}`,
      );
    });
  });

  const publicOperations = Object.entries(registry.operationContracts || {})
    .filter(([, contract]) => contract.public)
    .map(([id]) => id);
  assert(publicOperations.length > 0, 'at least one public operation is required');
  Object.entries(registry.operationContracts || {}).forEach(([id, contract]) => {
    assert(contract.properties?.op?.const === id, `${id} op const must match its ID`);
    assert(contract.required?.includes('op'), `${id} must require op`);
  });
  return registry;
}

export function buildArtifact(registry) {
  validateRegistry(registry);
  const artifact = JSON.parse(JSON.stringify(registry));
  Object.values(artifact.questionTypes).forEach((definition) => {
    definition.traits = unique(definition.traits || []);
    definition.allFields = unique([
      ...(definition.fieldGroups || []).flatMap(
        (groupId) => artifact.questionFieldGroups[groupId] || [],
      ),
      ...(definition.fields || []),
    ]);
  });
  return artifact;
}

export function asObjectSchema(entity) {
  return {
    type: 'object',
    properties: entity.fields || {},
    ...(entity.required?.length ? { required: entity.required } : {}),
    additionalProperties: true,
  };
}

export function buildOperationSchemas(artifact) {
  const entries = Object.entries(artifact.operationContracts);
  const publicEntries = entries.filter(([, contract]) => contract.public);
  const operationTypes = publicEntries.map(([id]) => id);
  const properties = {};
  const toolProperty = (schema) => {
    if (!schema?.$ref) return schema;
    if (schema.$ref === '#/entities/page'
      || schema.$ref === '#/entities/survey'
      || schema.$ref === '#/questionTypes') {
      return { type: 'object' };
    }
    return schema;
  };
  publicEntries.forEach(([, contract]) => {
    Object.entries(contract.properties || {}).forEach(([key, schema]) => {
      if (key !== 'op' && properties[key] === undefined) properties[key] = toolProperty(schema);
    });
  });
  return {
    operationTypes,
    itemSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: operationTypes },
        ...properties,
      },
      required: ['op'],
    },
    contractSchema: {
      oneOf: publicEntries.map(([, contract]) => ({
        type: 'object',
        properties: {
          ...contract.properties,
          op: { type: 'string', enum: [contract.properties.op.const] },
        },
        required: contract.required,
      })),
    },
  };
}

export function publicOperationEntries(artifact) {
  return Object.entries(artifact?.operationContracts || {})
    .filter(([, contract]) => contract?.public);
}

export function expandSurveyConfigForTools(artifact) {
  const survey = artifact?.entities?.survey || {};
  const page = artifact?.entities?.page || {};
  const questionTypes = Object.keys(artifact?.questionTypes || {});
  return {
    type: 'object',
    additionalProperties: true,
    required: survey.required?.length ? survey.required : ['pages'],
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      locale: { type: 'string', enum: ['en', 'zh'] },
      pages: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: true,
          required: page.required?.length ? page.required : ['name', 'elements'],
          properties: {
            name: { type: 'string', minLength: 1 },
            title: { type: 'string' },
            elements: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: true,
                required: ['type', 'name'],
                properties: {
                  type: questionTypes.length
                    ? { type: 'string', enum: questionTypes }
                    : { type: 'string' },
                  name: { type: 'string', minLength: 1 },
                  title: { type: 'string' },
                  dimensions: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      required: ['id', 'label', 'left', 'right'],
                      properties: {
                        id: { type: 'string' },
                        label: { type: 'string' },
                        left: { type: 'string' },
                        right: { type: 'string' },
                        min: { type: 'number' },
                        max: { type: 'number' },
                        step: { type: 'number' },
                      },
                    },
                  },
                  scaleMin: { type: 'number' },
                  scaleMax: { type: 'number' },
                  scaleStep: { type: 'number' },
                  imageCount: { type: 'integer', minimum: 1 },
                  imageSelectionMode: {
                    type: 'string',
                    enum: ['huggingface_random', 'huggingface_manual'],
                  },
                  choices: { type: 'array' },
                  columns: { type: 'array' },
                },
              },
            },
          },
        },
      },
    },
  };
}

function operationItemSchema(contract, surveyConfigSchema) {
  const properties = { ...(contract.properties || {}) };
  if (properties.op?.const) {
    properties.op = { type: 'string', enum: [properties.op.const] };
  }
  if (properties.surveyConfig) {
    properties.surveyConfig = surveyConfigSchema;
  }
  return {
    type: 'object',
    additionalProperties: true,
    properties,
    required: contract.required || ['op'],
  };
}

export function buildApplyToolSchema(artifact, {
  mode = 'agent',
  allowReplaceConfig = true,
} = {}) {
  const generate = mode === 'generate';
  const publicEntries = publicOperationEntries(artifact);
  const allowed = generate
    ? publicEntries.filter(([id]) => id === 'replaceConfig')
    : allowReplaceConfig
      ? publicEntries
      : publicEntries.filter(([id]) => id !== 'replaceConfig');
  const surveyConfigSchema = expandSurveyConfigForTools(artifact);
  const items = allowed.map(([, contract]) => operationItemSchema(contract, surveyConfigSchema));
  const operations = generate
    ? {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: items[0] || { type: 'object', required: ['op', 'surveyConfig'] },
    }
    : {
      type: 'array',
      minItems: 1,
      items: items.length === 1 ? items[0] : { oneOf: items },
    };
  const allowedOps = allowed.map(([id]) => id);
  const description = generate
    ? 'Save a complete survey with exactly one replaceConfig. operations[0] must be {op:"replaceConfig", surveyConfig:{title, pages:[{name, elements:[{type, name}]}]}}. Use expectedDraftUpdatedAt from survey_get_draft.'
    : allowReplaceConfig
      ? 'Apply operations and save the draft. Incremental ops for small edits; one replaceConfig only for a complete redesign. Requires expectedDraftUpdatedAt from survey_get_draft.'
      : 'Apply incremental operations and save the draft. Do not use replaceConfig. Requires expectedDraftUpdatedAt from survey_get_draft.';
  return {
    parameters: {
      type: 'object',
      additionalProperties: true,
      required: ['expectedDraftUpdatedAt', 'operations'],
      properties: {
        expectedDraftUpdatedAt: { type: 'string' },
        operations,
      },
    },
    description,
    allowedOps,
    surveyConfigSchema,
  };
}

export function describeToolArgShape(value) {
  const rootType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const keys = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
    : [];
  let operationsType = 'missing';
  if (Object.prototype.hasOwnProperty.call(value || {}, 'operations')) {
    if (value.operations === null) operationsType = 'null';
    else if (Array.isArray(value.operations)) operationsType = 'array';
    else operationsType = typeof value.operations;
  }
  let surveyConfigType = 'missing';
  if (Object.prototype.hasOwnProperty.call(value || {}, 'surveyConfig')) {
    if (value.surveyConfig === null) surveyConfigType = 'null';
    else if (Array.isArray(value.surveyConfig)) surveyConfigType = 'array';
    else surveyConfigType = typeof value.surveyConfig;
  }
  return {
    rootType,
    keys,
    operationsType,
    operationsLength: Array.isArray(value?.operations) ? value.operations.length : null,
    ops: Array.isArray(value?.operations)
      ? value.operations.map((operation) => operation?.op || null)
      : null,
    surveyConfigType,
    hasTopLevelSurveyConfig: surveyConfigType === 'object',
    pageCount: Array.isArray(value?.surveyConfig?.pages) ? value.surveyConfig.pages.length : null,
    wrappedIn: value?.arguments ? 'arguments' : (value?.parameters ? 'parameters' : null),
  };
}

export function describeApplyShape(args) {
  const shape = describeToolArgShape(args);
  const operations = Array.isArray(args?.operations) ? args.operations : null;
  return {
    ...shape,
    expectedDraftUpdatedAt: typeof args?.expectedDraftUpdatedAt,
    ops: operations
      ? operations.map((operation) => ({
        op: operation?.op || null,
        hasSurveyConfig: Boolean(operation?.surveyConfig && typeof operation.surveyConfig === 'object'),
        pageCount: Array.isArray(operation?.surveyConfig?.pages)
          ? operation.surveyConfig.pages.length
          : null,
      }))
      : shape.ops,
  };
}

export function classifySubmitDraftError(args) {
  const receivedShape = describeToolArgShape(args);
  if (!args?.expectedDraftUpdatedAt) {
    return {
      code: 'GENERATE_CONTRACT',
      path: 'expectedDraftUpdatedAt',
      expected: { type: 'string' },
      receivedShape,
      retryAction: 'reload_draft',
      repairHint: 'Call survey_get_draft and pass its draftUpdatedAt as expectedDraftUpdatedAt.',
      message: 'Generate submit requires expectedDraftUpdatedAt from the current draft.',
    };
  }
  if (!args.surveyConfig || typeof args.surveyConfig !== 'object' || Array.isArray(args.surveyConfig)) {
    return {
      code: 'GENERATE_CONTRACT',
      path: 'surveyConfig',
      expected: { type: 'object', required: ['pages'] },
      receivedShape,
      retryAction: 'repair_args',
      repairHint: 'Send surveyConfig as an object with title and a non-empty pages array.',
      message: 'Generate submit requires a surveyConfig object.',
    };
  }
  if (!Array.isArray(args.surveyConfig.pages) || args.surveyConfig.pages.length === 0) {
    return {
      code: 'GENERATE_CONTRACT',
      path: 'surveyConfig.pages',
      expected: { type: 'array', minItems: 1 },
      receivedShape,
      retryAction: 'repair_args',
      repairHint: 'surveyConfig.pages must contain at least one named page with typed elements.',
      message: 'Generate submit rejects an empty pages array.',
    };
  }
  return null;
}

export function classifyApplyContractError(args, {
  mode = 'agent',
  allowReplaceConfig = true,
} = {}) {
  const operations = Array.isArray(args?.operations) ? args.operations : null;
  const receivedShape = describeApplyShape(args);
  if (mode === 'generate') {
    if (!operations || operations.length !== 1) {
      return {
        code: 'GENERATE_CONTRACT',
        path: 'operations',
        expected: { length: 1, op: 'replaceConfig' },
        receivedShape,
        retryAction: 'repair_args',
        repairHint: 'Send operations as a one-item array: [{op:"replaceConfig", surveyConfig:{title, pages:[...]}}].',
        message: 'Generate requires exactly one replaceConfig operation.',
      };
    }
    const operation = operations[0] || {};
    if (operation.op !== 'replaceConfig') {
      return {
        code: 'GENERATE_CONTRACT',
        path: 'operations[0].op',
        expected: 'replaceConfig',
        receivedShape,
        retryAction: 'repair_args',
        repairHint: 'Change operations[0].op to replaceConfig and put the full survey in operations[0].surveyConfig.',
        message: 'Generate rejects incremental operations such as addPage.',
      };
    }
    if (!operation.surveyConfig || typeof operation.surveyConfig !== 'object') {
      return {
        code: 'GENERATE_CONTRACT',
        path: 'operations[0].surveyConfig',
        expected: { type: 'object', required: ['pages'] },
        receivedShape,
        retryAction: 'repair_args',
        repairHint: 'Add operations[0].surveyConfig with a pages array of named pages and typed elements.',
        message: 'Generate replaceConfig is missing surveyConfig.',
      };
    }
    if (!Array.isArray(operation.surveyConfig.pages)) {
      return {
        code: 'GENERATE_CONTRACT',
        path: 'operations[0].surveyConfig.pages',
        expected: { type: 'array', minItems: 1 },
        receivedShape,
        retryAction: 'repair_args',
        repairHint: 'surveyConfig.pages must be an array of {name, elements}.',
        message: 'Generate replaceConfig.surveyConfig.pages must be an array.',
      };
    }
    return null;
  }
  if (
    mode === 'adjust'
    && !allowReplaceConfig
    && (operations || []).some((operation) => operation?.op === 'replaceConfig')
  ) {
    return {
      code: 'ADJUST_CONTRACT',
      path: 'operations',
      expected: { incremental: true },
      receivedShape,
      retryAction: 'repair_args',
      repairHint: 'Use incremental operations (updateQuestion, addPage, …). replaceConfig is allowed only for an explicit full redesign.',
      message: 'Adjust mode requires incremental operations unless the user explicitly requested a complete redesign.',
    };
  }
  return null;
}

export function schemaAccepts(schema, value) {
  if (!schema || typeof schema !== 'object') return true;
  if (schema.oneOf) return schema.oneOf.some((option) => schemaAccepts(option, value));
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return false;
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) return false;
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) return false;
    return schema.items ? value.every((item) => schemaAccepts(schema.items, item)) : true;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    for (const key of schema.required || []) {
      if (value[key] === undefined) return false;
    }
    return Object.entries(schema.properties || {}).every(([key, child]) => (
      value[key] === undefined || schemaAccepts(child, value[key])
    ));
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return false;
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) return false;
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
    return true;
  }
  if (schema.type === 'number' || schema.type === 'integer') return typeof value === 'number';
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (Array.isArray(schema.enum)) return schema.enum.includes(value);
  return true;
}

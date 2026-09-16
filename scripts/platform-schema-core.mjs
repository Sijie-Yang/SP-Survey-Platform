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

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  OPERATION_ITEM_SCHEMA,
  OPERATION_TYPES,
  PLATFORM_SCHEMA,
  PLATFORM_SCHEMA_HASH,
  QUESTION_TYPE_IDS,
} from '../../platformSchema.generated.mjs';
import { DESIGN_CAPABILITIES } from '../../designProtocol.mjs';
import { createDesignerTools } from './designerTools.mjs';
import { buildArtifact } from '../../../scripts/platform-schema-core.mjs';

const source = JSON.parse(
  await readFile(new URL('../../../src/lib/platformSchema/registry.json', import.meta.url), 'utf8'),
);

test('Worker artifact is a deterministic expansion of the canonical registry', () => {
  const expected = JSON.parse(JSON.stringify(source));
  Object.values(expected.questionTypes).forEach((definition) => {
    definition.traits = [...new Set(definition.traits || [])];
    definition.allFields = [...new Set([
      ...(definition.fieldGroups || []).flatMap((group) => expected.questionFieldGroups[group] || []),
      ...(definition.fields || []),
    ])];
  });
  assert.deepEqual(PLATFORM_SCHEMA, expected);
  const digest = createHash('sha256').update(JSON.stringify(PLATFORM_SCHEMA)).digest('hex');
  assert.equal(PLATFORM_SCHEMA_HASH, `sha256:${digest}`);
});

test('Worker capabilities use generated question and operation IDs', () => {
  assert.equal(QUESTION_TYPE_IDS.length, 34);
  assert.deepEqual(DESIGN_CAPABILITIES.questionTypes, QUESTION_TYPE_IDS);
  assert.deepEqual(DESIGN_CAPABILITIES.operations, OPERATION_TYPES);
  assert.equal(DESIGN_CAPABILITIES.platformSchemaHash, PLATFORM_SCHEMA_HASH);
});

test('designer operation tool consumes the generated item schema', () => {
  const tool = createDesignerTools({}).find((item) => item.name === 'survey_apply_operations');
  assert.deepEqual(tool.parameters.properties.operations.items, OPERATION_ITEM_SCHEMA);
  assert.deepEqual(OPERATION_ITEM_SCHEMA.properties.op.enum, OPERATION_TYPES);
});

test('one registry addition propagates through compiled field and question contracts', () => {
  const extended = JSON.parse(JSON.stringify(source));
  extended.questionFields.newResearchSetting = {
    type: 'string',
    default: 'standard',
  };
  extended.questionTypes.researchnote = {
    label: 'Research Note',
    group: 'advanced',
    traits: ['display'],
    fieldGroups: ['common'],
    fields: ['newResearchSetting'],
    defaults: { newResearchSetting: 'standard' },
  };
  const artifact = buildArtifact(extended);
  assert.equal(artifact.questionTypes.researchnote.defaults.newResearchSetting, 'standard');
  assert.equal(
    artifact.questionTypes.researchnote.allFields.includes('newResearchSetting'),
    true,
  );
});

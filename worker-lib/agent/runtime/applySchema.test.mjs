import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PLATFORM_SCHEMA } from '../../platformSchema.generated.mjs';
import { createDesignerTools } from './designerTools.mjs';
import {
  applyToolContract,
  schemaAccepts,
} from './applySchema.mjs';
import { applyAssistantModeToTools, getAssistantModePolicy } from './modes.mjs';

function roundTrip(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('generate apply contract', () => {
  it('serializes operations capabilities with replaceConfig.surveyConfig.pages', async () => {
    const tool = createDesignerTools({ assistantMode: 'generate' })
      .find((item) => item.name === 'survey_capabilities');
    const operations = roundTrip(await tool.execute({ domain: 'operations' }));
    assert.equal(operations.schema.submit, 'survey_submit_generated_draft');
    assert.equal(operations.schema.required.includes('surveyConfig'), true);
    assert.equal(operations.schema.surveyConfig.required.includes('pages'), true);
    assert.equal(operations.schema.contracts, undefined);
    assert.equal(operations.schema.allowedOps.includes('addPage'), false);

    const questions = roundTrip(await tool.execute({ domain: 'questions' }));
    assert.ok(questions.schema.questionTypeIds.includes('rating'));
    assert.ok(questions.schema.types.rating);
    assert.equal(questions.schema.questionFields, undefined);
    assert.equal(questions.schema.commonFields, undefined);
    assert.ok(questions.schema.sliderDimensions.requiredItemFields.includes('label'));
    assert.equal(questions.schema.types.imageslidergroup.editorBlankDefaults.dimensions.length, 0);
    assert.equal(questions.schema.types.imageslidergroup.answerOptions, 'researcher_defined');
    const slider = await tool.execute({ domain: 'questions', questionType: 'imageslidergroup' });
    assert.equal(slider.schema.minimumExample.dimensions[0].id, 'attr_a');
    assert.equal(slider.schema.illustrations.streetScene.dimensions[0].id, 'safety');

    const skills = roundTrip(await tool.execute({ domain: 'skills' }));
    assert.ok(Array.isArray(skills.schema.resultSchemaTypes));
    assert.ok(skills.schema.resultSchemaTypes.includes('rating'));
    assert.equal(skills.schema.skillResultFamilies, undefined);
  });

  it('rejects empty capability domains', async () => {
    const tool = createDesignerTools({}).find((item) => item.name === 'survey_capabilities');
    await assert.rejects(
      () => tool.execute({ domain: 'missing' }),
      (error) => error.code === 'CAPABILITIES_EMPTY',
    );
  });

  it('gives generate providers a schema that rejects addPage and missing surveyConfig', () => {
    const { parameters } = applyToolContract({ mode: 'generate' });
    const valid = {
      expectedDraftUpdatedAt: '2026-09-16T00:00:00Z',
      operations: [{
        op: 'replaceConfig',
        surveyConfig: {
          title: 'Park study',
          pages: [{
            name: 'p1',
            elements: [{ type: 'rating', name: 'q1' }],
          }],
        },
      }],
    };
    assert.equal(schemaAccepts(parameters, valid), true);
    assert.equal(schemaAccepts(parameters, {
      expectedDraftUpdatedAt: '2026-09-16T00:00:00Z',
      operations: [{ op: 'addPage', page: { name: 'p1' } }],
    }), false);
    assert.equal(schemaAccepts(parameters, {
      expectedDraftUpdatedAt: '2026-09-16T00:00:00Z',
      operations: [{ op: 'replaceConfig' }],
    }), false);
    assert.equal(schemaAccepts(parameters, {
      expectedDraftUpdatedAt: '2026-09-16T00:00:00Z',
      operations: [],
    }), false);
    assert.equal(schemaAccepts(parameters, {
      expectedDraftUpdatedAt: '2026-09-16T00:00:00Z',
      operations: [valid.operations[0], valid.operations[0]],
    }), false);
  });

  it('keeps extra survey fields and forbids adjust replaceConfig unless redesign', async () => {
    const generate = applyToolContract({ mode: 'generate' });
    assert.equal(generate.parameters.properties.operations.items.properties.surveyConfig.additionalProperties, true);
    const apply = applyAssistantModeToTools([{
      name: 'survey_apply_operations',
      execute: async (args) => args,
    }], getAssistantModePolicy('adjust'));
    await assert.rejects(
      () => apply[0].execute({
        operations: [{ op: 'replaceConfig', surveyConfig: { pages: [] } }],
      }),
      (error) => error.code === 'ADJUST_CONTRACT',
    );
  });

  it('exposes only the generate submit tool and a consistent overview contract', async () => {
    const tools = createDesignerTools({ assistantMode: 'generate' });
    assert.deepEqual(tools.map((tool) => tool.name), [
      'survey_capabilities',
      'survey_get_draft',
      'survey_validate',
      'survey_submit_generated_draft',
      'survey_preview_urls',
    ]);
    const overview = roundTrip(await tools[0].execute({ domain: 'overview' }));
    const text = JSON.stringify(overview);
    assert.equal(overview.generateApply.tool, 'survey_submit_generated_draft');
    assert.equal(overview.capabilities.submit.tool, 'survey_submit_generated_draft');
    assert.equal(overview.capabilities.operations, undefined);
    assert.equal(/Prefer deterministic operations/i.test(text), false);
    assert.equal(/survey_apply_operations/.test(text), false);
    assert.ok(overview.generateApply.surveyConfig.required.includes('pages'));
    assert.ok(overview.generateApply.surveyConfig.properties.pages.items.properties.elements.items.properties.dimensions);
    assert.equal(overview.capabilities.sliderDimensions.requiredItemFields.includes('label'), true);
    assert.ok(overview.capabilities.generationContractVersion);
    assert.equal(overview.capabilities.supportMatrix.surveyDraft.includes('survey_submit_generated_draft'), true);
    assert.equal(overview.capabilities.supportMatrix.mediaLibrary.includes('read'), true);
  });

  it('exposes question field groups from the registry artifact', () => {
    assert.ok(PLATFORM_SCHEMA.questionFieldGroups.common.includes('name'));
    assert.equal(PLATFORM_SCHEMA.operations, undefined);
    assert.ok(PLATFORM_SCHEMA.operationContracts.replaceConfig);
  });
});

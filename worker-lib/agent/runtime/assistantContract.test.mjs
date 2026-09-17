import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyOperations } from '../../designProtocol.mjs';
import { evaluateSurveyContract } from '../../answerability.mjs';
import {
  getGenerationContract,
  listGenerationContracts,
  GENERATION_CONTRACT_VERSION,
} from '../../generationContracts.mjs';
import { validateSurveyConfig } from '../../designProtocol.mjs';
import { compactJsonForModel } from './toolArgs.mjs';
import { createDesignerTools } from './designerTools.mjs';
import { summarizeWorkingCopy } from './taskIntent.mjs';

describe('generation contracts', () => {
  it('has a minimum answerable example for every question type', () => {
    for (const contract of listGenerationContracts()) {
      if (['expression', 'image', 'mediadisplay'].includes(contract.type)) continue;
      const report = evaluateSurveyContract({
        title: contract.type,
        pages: [{ name: 'p1', elements: [{ ...contract.minimumExample, name: `${contract.type}_q` }] }],
      }, { mode: 'generate', strictAll: true });
      assert.equal(report.ok, true, `${contract.type}: ${JSON.stringify(report.errors)}`);
    }
    assert.equal(GENERATION_CONTRACT_VERSION, '1.1.0');
  });

  it('rejects slider, matrix, ranking, allocation, and unknown types consistently in validate and submit', () => {
    const bad = {
      title: 'Bad',
      pages: [{
        name: 'p1',
        elements: [
          { type: 'imageslidergroup', name: 's1', dimensions: [] },
          { type: 'imageslidergroup', name: 's2', dimensions: [{ id: 'dim_1', label: { en: 'A' }, left: 'L' }] },
          { type: 'imageslidergroup', name: 's3', dimensions: 'safety' },
          { type: 'imageslidergroup', name: 's4', dimensions: [null] },
          { type: 'matrix', name: 'm1', rows: [], columns: [] },
          { type: 'ranking', name: 'r1', choices: [] },
          { type: 'pointallocation', name: 'a1', choices: [], budget: 100 },
          { type: 'not_a_real_type', name: 'u1', title: 'Unknown' },
        ],
      }],
    };
    const validate = validateSurveyConfig(bad, { mode: 'generate', strictAll: true });
    const submit = evaluateSurveyContract(bad, { mode: 'generate', strictAll: true });
    assert.equal(validate.valid, false);
    assert.equal(submit.ok, false);
    const blob = submit.errors.map((item) => `${item.question} ${item.path} ${item.reason}`).join('\n');
    assert.match(blob, /needs a non-empty dimensions|dimensions must be an array/);
    assert.match(blob, /label must be a non-empty string/);
    assert.match(blob, /must be an array of objects/);
    assert.match(blob, /must be an object/);
    assert.match(blob, /rows is not answerable/);
    assert.match(blob, /ranking choices is not answerable/);
    assert.match(blob, /allocation choices is not answerable/);
    assert.match(blob, /not_a_real_type/);
    assert.equal(submit.coveredTypes.includes('not_a_real_type'), false);
    assert.doesNotThrow(() => validateSurveyConfig(bad, { mode: 'generate', strictAll: true }));
  });

  it('maps documented dimension aliases without rewriting existing ids', () => {
    const report = evaluateSurveyContract({
      pages: [{
        name: 'p1',
        elements: [{
          type: 'imageslidergroup',
          name: 'keep_id',
          imageSelectionMode: 'huggingface_random',
          dimensions: [{ id: 'legacy_safe', text: 'Safety', leftLabel: 'Unsafe', rightLabel: 'Safe' }],
        }],
      }],
    }, { mode: 'generate', strictAll: true });
    assert.equal(report.ok, true);
    assert.equal(report.surveyConfig.pages[0].elements[0].dimensions[0].id, 'legacy_safe');
    assert.equal(report.surveyConfig.pages[0].elements[0].dimensions[0].label, 'Safety');
  });
});

describe('context compaction and queries', () => {
  it('keeps draft catalog and a continue-read entry after compaction', async () => {
    const pages = Array.from({ length: 20 }, (_, index) => ({
      name: `p${index}`,
      title: `Page ${index}`,
      elements: [{
        type: 'imageslidergroup',
        name: `q${index}`,
        title: 'Rate',
        dimensions: getGenerationContract('imageslidergroup').minimumExample.dimensions,
      }],
    }));
    const compact = JSON.parse(compactJsonForModel({
      summary: 'Draft loaded',
      platformSchemaHash: 'sha256:test',
      draftUpdatedAt: 'rev-1',
      surveyConfig: { title: 'Huge', pages },
    }, { maxChars: 800 }));
    assert.equal(compact.truncated, true);
    assert.equal(compact.draftUpdatedAt, 'rev-1');
    assert.ok(compact.catalog.length);
    assert.equal(compact.next.read.tool, 'survey_get_draft');
  });

  it('capabilities can load one type and cache a repeat', async () => {
    const tool = createDesignerTools({ assistantMode: 'generate' })
      .find((item) => item.name === 'survey_capabilities');
    const first = await tool.execute({ domain: 'questions', questionType: 'imageslidergroup' });
    const second = await tool.execute({ domain: 'questions', questionType: 'imageslidergroup' });
    assert.equal(first.schema.minimumExample.dimensions[0].label, 'Attribute A');
    assert.equal(second.cached, true);
    const skills = await tool.execute({ domain: 'skills', skillId: 'preset_image_preference_slider' });
    assert.equal(skills.schema.imageCount, 2);
  });

  it('reads unsaved working copy without saving', async () => {
    const tools = createDesignerTools({
      projectId: 'p1',
      assistantMode: 'adjust',
      editorContext: {
        draftUpdatedAt: 'rev-9',
        pageName: 'p1',
        questionName: 'slider_q',
        workingCopy: {
          type: 'imageslidergroup',
          name: 'slider_q',
          dimensions: [{ id: 'unsaved', label: 'Unsaved', left: 'L', right: 'R' }],
        },
      },
    });
    const draft = await tools.find((item) => item.name === 'survey_get_draft')
      .execute({ view: 'workingCopy' });
    assert.equal(draft.saved, false);
    assert.equal(draft.workingCopy.dimensions[0].id, 'unsaved');
    assert.match(summarizeWorkingCopy({
      dirty: true,
      workingCopy: draft.workingCopy,
    }), /unsaved/);
  });
});

describe('theme merge and failed writes', () => {
  it('merges primary color and keeps other theme fields', () => {
    const result = applyOperations({
      title: 'T',
      theme: { primaryColor: '#111111', secondaryColor: '#222222', accentColor: '#333333' },
      pages: [{ name: 'p1', elements: [] }],
    }, [{ op: 'setTheme', theme: { primaryColor: '#abcdef' } }]);
    assert.deepEqual(result.surveyConfig.theme, {
      primaryColor: '#abcdef',
      secondaryColor: '#222222',
      accentColor: '#333333',
    });
  });

  it('leaves the original draft unchanged when a generate contract fails', () => {
    const original = {
      title: 'Original',
      pages: [{
        name: 'p1',
        elements: [{
          type: 'imageslidergroup',
          name: 'keep',
          dimensions: [{ id: 'legacy_safe', label: 'Safety', left: 'U', right: 'S' }],
        }],
      }],
    };
    const snapshot = JSON.stringify(original);
    const submit = createDesignerTools({
      assistantMode: 'generate',
      generateGoal: { minPages: 1, uniqueNames: true, coverMostTypes: false, answerTypes: [] },
      projectId: 'p1',
    }).find((tool) => tool.name === 'survey_submit_generated_draft');
    return submit.execute({
      expectedDraftUpdatedAt: 't',
      surveyConfig: {
        title: 'Broken',
        pages: [{ name: 'p1', elements: [{ type: 'imageslidergroup', name: 'new', dimensions: [] }] }],
      },
    }).then(() => {
      throw new Error('should reject');
    }, (error) => {
      assert.equal(error.code === 'GENERATE_GOAL' || error.code === 'UNANSWERABLE_QUESTION', true);
      assert.equal(JSON.stringify(original), snapshot);
      assert.equal(original.pages[0].elements[0].dimensions[0].id, 'legacy_safe');
    });
  });
});

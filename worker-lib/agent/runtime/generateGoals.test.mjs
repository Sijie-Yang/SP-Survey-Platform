import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDesignerTools } from './designerTools.mjs';
import { getGenerationContract } from '../../generationContracts.mjs';
import {
  evaluateGenerateGoals,
  parseGenerateGoals,
  summarizeSurveyConfig,
} from './generateGoals.mjs';

function sliderDimensions() {
  return [
    { id: 'pleasant', label: 'Pleasantness', left: 'Unpleasant', right: 'Pleasant' },
  ];
}

function elementForType(type, name) {
  const example = getGenerationContract(type).minimumExample || { type, name };
  return { ...example, name };
}

function page(name, type = 'rating') {
  return {
    name,
    elements: [elementForType(type, `${name}_q`)],
  };
}

describe('generate goal acceptance', () => {
  it('parses an 8-page majority-type request', () => {
    const goals = parseGenerateGoals('重新生成一个至少 8 页、覆盖多数题型的问卷');
    assert.equal(goals.minPages, 8);
    assert.equal(goals.coverMostTypes, true);
    assert.ok(goals.answerTypes.length > 10);
  });

  it('rejects 1 page, 7 pages, empty shells, and repeated types', () => {
    const goals = parseGenerateGoals('重新生成一个至少 8 页、覆盖多数题型的问卷');
    assert.equal(evaluateGenerateGoals({ pages: [page('p1')] }, goals).ok, false);
    assert.equal(evaluateGenerateGoals({
      pages: Array.from({ length: 7 }, (_, index) => page(`p${index + 1}`)),
    }, goals).ok, false);
    assert.equal(evaluateGenerateGoals({
      pages: Array.from({ length: 8 }, (_, index) => ({ name: `p${index + 1}`, elements: [] })),
    }, goals).ok, false);
    assert.equal(evaluateGenerateGoals({
      pages: Array.from({ length: 8 }, (_, index) => page(`p${index + 1}`, 'rating')),
    }, goals).ok, false);
  });

  it('accepts eight effective pages with enough answer types', () => {
    const goals = parseGenerateGoals('重新生成一个至少 8 页、覆盖多数题型的问卷');
    const types = goals.answerTypes.slice(0, goals.coverMostTypes ? Math.ceil(goals.answerTypes.length / 2) : 8);
    const pages = types.map((type, index) => ({
      name: `p${index + 1}`,
      elements: [elementForType(type, `q${index + 1}`)],
    }));
    while (pages.length < 8) {
      pages.push({
        name: `extra${pages.length}`,
        elements: [elementForType(types[0], `extra_q${pages.length}`)],
      });
    }
    const result = evaluateGenerateGoals({ title: 'Coverage', pages }, goals);
    assert.equal(result.ok, true);
    assert.ok(result.pageCount >= 8);
  });

  it('rejects slider groups that omit dimension labels', () => {
    const goals = parseGenerateGoals('生成一个街景问卷');
    const empty = evaluateGenerateGoals({
      pages: [{
        name: 'p1',
        elements: [{ type: 'imageslidergroup', name: 'q1', dimensions: [] }],
      }],
    }, goals);
    assert.equal(empty.ok, false);
    assert.ok(empty.errors.some((item) => /dimensions|effective pages/i.test(item.message)));
    const incomplete = evaluateGenerateGoals({
      pages: [{
        name: 'p1',
        elements: [{
          type: 'imageslidergroup',
          name: 'q1',
          dimensions: [{ id: 'dim_1', left: 'Low' }],
        }],
      }],
    }, goals);
    assert.equal(incomplete.ok, false);
    const ok = evaluateGenerateGoals({
      pages: [page('p1', 'imageslidergroup')],
    }, goals);
    assert.equal(ok.ok, true);
  });

  it('blocks generate saves that miss the requested page coverage', async () => {
    const submit = createDesignerTools({
      assistantMode: 'generate',
      generateGoal: parseGenerateGoals('重新生成一个至少 8 页、覆盖多数题型的问卷'),
      projectId: 'p1',
    }).find((tool) => tool.name === 'survey_submit_generated_draft');
    await assert.rejects(
      () => submit.execute({
        expectedDraftUpdatedAt: 't',
        surveyConfig: { title: 'Short', pages: [page('p1')] },
      }),
      (error) => error.code === 'GENERATE_GOAL',
    );
  });

  it('does not fall back to the saved draft when a candidate payload is incomplete', async () => {
    const tools = createDesignerTools({
      projectId: 'p1',
      env: {},
      getDraftImpl: null,
    });
    const validate = tools.find((tool) => tool.name === 'survey_validate');
    await assert.rejects(
      () => validate.execute({ surveyConfig: { title: 'Broken' } }),
      (error) => error.code === 'VALIDATE_CANDIDATE_INCOMPLETE',
    );
    await assert.rejects(
      () => validate.execute({ pages: [{ name: 'p1' }] }),
      (error) => error.code === 'VALIDATE_CANDIDATE_INCOMPLETE',
    );
  });

  it('labels validate targets for current draft vs candidate', async () => {
    const tools = createDesignerTools({
      projectId: 'p1',
      getDraftImpl: null,
    });
    const validate = tools.find((tool) => tool.name === 'survey_validate');
    const candidate = await validate.execute({
      surveyConfig: { title: 'New', pages: [page('p1')] },
    });
    assert.equal(candidate.target, 'candidate');
    assert.equal(candidate.pageCount, 1);
    assert.equal(candidate.summary.includes('Candidate'), true);
    assert.deepEqual(summarizeSurveyConfig({ pages: [page('p1'), page('p2', 'boolean')] }).types.sort(), [
      'boolean',
      'rating',
    ]);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { getAssistantModePolicy, applyAssistantModeToTools } from './modes.mjs';
import { createPlatformTools } from './platformTools.mjs';

const tools = createPlatformTools({
  env: {},
  userId: 'user-1',
  projectId: 'project-1',
  request: new Request('https://sp-survey.org/api/agent/chat'),
});

test('Agent domain registry covers project, template, media, Skill, result, and release work', () => {
  const names = new Set(tools.map((tool) => tool.name));
  [
    'survey_create_project',
    'survey_update_project',
    'survey_duplicate_project',
    'survey_export_project',
    'survey_import_project',
    'survey_create_from_template',
    'media_list',
    'survey_update_media_dataset',
    'skill_list',
    'skill_save',
    'survey_list_responses',
    'survey_results_summary',
    'survey_publish',
    'survey_apply_main_page',
    'survey_delete_project',
  ].forEach((name) => assert.equal(names.has(name), true, name));
});

test('destructive, publish, and source-upload tools carry approval risks', () => {
  const risks = Object.fromEntries(tools.filter((tool) => tool.risk).map((tool) => [
    tool.name,
    tool.risk,
  ]));
  assert.equal(risks.survey_publish, 'publish');
  assert.equal(risks.survey_apply_main_page, 'publish');
  assert.equal(risks.survey_delete_project, 'delete');
  assert.equal(risks.media_delete, 'delete');
  assert.equal(risks.skill_save, 'upload');
  assert.equal(risks.survey_save_as_template, 'upload');
});

test('Question mode sees domain reads but no domain mutations', () => {
  const selected = applyAssistantModeToTools(tools, getAssistantModePolicy('question'));
  assert.equal(selected.some((tool) => tool.name === 'survey_results_summary'), true);
  assert.equal(selected.some((tool) => tool.name === 'survey_export_project'), true);
  assert.equal(selected.some((tool) => tool.name === 'survey_publish'), false);
  assert.equal(selected.some((tool) => tool.name === 'survey_update_project'), false);
});

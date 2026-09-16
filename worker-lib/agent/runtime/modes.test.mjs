import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyAssistantModeToTools,
  assistantModeFromEvents,
  getAssistantModePolicy,
  normalizeAssistantMode,
} from './modes.mjs';

function tools(execute = async (args) => args) {
  return [
    { name: 'survey_get_draft', execute: async () => ({ surveyConfig: {} }) },
    { name: 'survey_preview_urls', execute: async () => ({ urls: {} }) },
    { name: 'survey_apply_operations', execute },
  ];
}

describe('assistant mode policies', () => {
  it('defaults to agent and rejects unknown modes', () => {
    assert.equal(normalizeAssistantMode(), 'agent');
    assert.throws(
      () => normalizeAssistantMode('write-everything'),
      (error) => error.code === 'INVALID_ASSISTANT_MODE',
    );
  });

  it('makes question mode read-only', () => {
    const policy = getAssistantModePolicy('question');
    const selected = applyAssistantModeToTools(tools(), policy);
    assert.deepEqual(
      selected.map((tool) => tool.name),
      ['survey_get_draft', 'survey_preview_urls'],
    );
    assert.equal(policy.requireDraftChange, false);
  });

  it('keeps domain reads and removes domain mutations in question mode', () => {
    const selected = applyAssistantModeToTools([
      { name: 'media_list', minPermission: 'ask', execute: async () => ({}) },
      { name: 'survey_results_summary', minPermission: 'ask', execute: async () => ({}) },
      { name: 'survey_update_media_dataset', minPermission: 'media', execute: async () => ({}) },
      {
        name: 'survey_publish',
        minPermission: 'edit_draft',
        risk: 'publish',
        execute: async () => ({}),
      },
    ], getAssistantModePolicy('question'));
    assert.deepEqual(selected.map((tool) => tool.name), [
      'media_list',
      'survey_results_summary',
    ]);
  });

  it('requires generate mode to save one complete replacement', async () => {
    let received = null;
    const policy = getAssistantModePolicy('generate');
    const apply = applyAssistantModeToTools(tools(async (args) => {
      received = args;
      return { surveyConfig: args.operations[0].surveyConfig };
    }), policy).find((tool) => tool.name === 'survey_apply_operations');

    await assert.rejects(
      () => apply.execute({ operations: [{ op: 'addPage', page: {} }] }),
      /exactly one replaceConfig/,
    );
    await apply.execute({
      operations: [{ op: 'replaceConfig', surveyConfig: { title: 'Complete', pages: [] } }],
    });
    assert.equal(received.operations[0].surveyConfig.title, 'Complete');
    assert.equal(policy.requireDraftChange, true);
  });

  it('keeps adjust incremental unless redesign is explicit', async () => {
    const incremental = { operations: [{ op: 'updateQuestion', patch: { title: 'Shorter' } }] };
    const replacement = {
      operations: [{ op: 'replaceConfig', surveyConfig: { title: 'Redesigned', pages: [] } }],
    };
    const regularApply = applyAssistantModeToTools(
      tools(),
      getAssistantModePolicy('adjust'),
    ).find((tool) => tool.name === 'survey_apply_operations');
    assert.deepEqual(await regularApply.execute(incremental), incremental);
    await assert.rejects(() => regularApply.execute(replacement), /incremental operations/);

    const redesignApply = applyAssistantModeToTools(
      tools(),
      getAssistantModePolicy('adjust', { explicitRedesign: true }),
    ).find((tool) => tool.name === 'survey_apply_operations');
    assert.deepEqual(await redesignApply.execute(replacement), replacement);
  });

  it('restores the latest echoed mode from session events', () => {
    assert.equal(assistantModeFromEvents([
      { type: 'session.start', payload: { assistantMode: 'agent' } },
      { type: 'user.message', payload: { assistantMode: 'question' } },
    ]), 'question');
  });
});

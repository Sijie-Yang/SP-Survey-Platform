import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  annotateHistoryForModel,
  classifyUserIntent,
  currentTaskMessage,
  QUESTION_MODE_WRITE_REFUSED,
  requestsDraftChange,
} from './taskIntent.mjs';
import { applyAssistantModeToTools, getAssistantModePolicy } from './modes.mjs';

describe('task boundaries', () => {
  it('keeps prior rejected writes as background only', () => {
    const history = annotateHistoryForModel([
      { role: 'user', content: '把标题改成公园感知', metadata: { questionModeWriteRefused: true } },
      { role: 'assistant', content: QUESTION_MODE_WRITE_REFUSED },
      { role: 'user', content: '现在有几页' },
    ]);
    assert.match(history[0].content, /Prior task — rejected/);
    assert.match(history[0].content, /Do not execute this request/);
    assert.match(history.at(-1).content, /现在有几页/);
    assert.equal(classifyUserIntent('现在有几页', 'agent').write, false);
    assert.equal(requestsDraftChange('现在有几页'), false);
  });

  it('classifies draft edits, explanations, and mixed goals separately', () => {
    assert.equal(classifyUserIntent('把标题改成公园感知').goal, 'draft_edit');
    assert.equal(classifyUserIntent('主题色改成蓝色').draftWrite, true);
    assert.equal(classifyUserIntent('设为必答').draftWrite, true);
    assert.equal(classifyUserIntent('告诉我如何发布但不要实际发布').goal, 'answer');
    assert.equal(classifyUserIntent('解释发布和删除区别').write, false);
    const mixed = classifyUserIntent('现在有几页？再加一页知情同意');
    assert.equal(mixed.goal, 'mixed');
    assert.equal(mixed.draftWrite, true);
    assert.ok(mixed.goals.includes('answer'));
    assert.equal(classifyUserIntent('把标题改成公园感知', 'question').readOnly, true);
    assert.equal(annotateHistoryForModel([{ role: 'user', content: 'x' }])[0].content.includes('unknown'), true);
  });

  it('does not expose publish tools for page-count questions', () => {
    const intent = classifyUserIntent('现在有几页', 'agent');
    const policy = getAssistantModePolicy('agent', {
      goalRequiresDraftChange: intent.write,
      denyPublish: intent.pageCount,
    });
    const selected = applyAssistantModeToTools([
      { name: 'survey_get_draft', execute: async () => ({}) },
      { name: 'survey_publish', minPermission: 'edit_draft', risk: 'publish', execute: async () => ({}) },
    ], policy);
    assert.equal(policy.requireDraftChange, false);
    assert.ok(selected.some((tool) => tool.name === 'survey_get_draft'));
    assert.equal(selected.some((tool) => tool.name === 'survey_publish'), false);
    assert.match(currentTaskMessage('现在有几页'), /only request to execute now/);
  });

  it('classifies regenerate / generate with modifiers and keeps how-to as answer', () => {
    assert.equal(classifyUserIntent('重新生成一个至少 8 页、覆盖多数题型的问卷').draftWrite, true);
    assert.equal(classifyUserIntent('请重新生成一份覆盖多数题型、至少八页的问卷').draftWrite, true);
    assert.equal(classifyUserIntent('Regenerate a survey with at least 8 pages covering most question types').draftWrite, true);
    assert.equal(classifyUserIntent('Please design a survey about sidewalk comfort').draftWrite, true);
    assert.equal(classifyUserIntent('告诉我如何设计问卷').goal, 'answer');
    assert.equal(classifyUserIntent('这个问卷现在有几页').goal, 'answer');
  });
});

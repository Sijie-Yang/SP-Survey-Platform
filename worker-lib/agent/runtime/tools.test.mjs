import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createToolRegistry, permissionAllows } from './tools.mjs';

describe('tool registry', () => {
  it('blocks shell-like names', async () => {
    assert.throws(() => createToolRegistry([{ name: 'shell', execute: async () => 1 }]), /blocked/i);
    const reg = createToolRegistry([{ name: 'survey_get_draft', execute: async () => ({ ok: true }) }]);
    await assert.rejects(() => reg.execute('bash', {}), /not allowed/i);
  });

  it('enforces permission ranks', async () => {
    const reg = createToolRegistry([
      { name: 'survey_apply_operations', minPermission: 'edit_draft', execute: async () => ({ applied: [] }) },
    ]);
    await assert.rejects(
      () => reg.execute('survey_apply_operations', {}, { permission: 'ask' }),
      /Permission/,
    );
    const result = await reg.execute('survey_apply_operations', {}, { permission: 'edit_draft' });
    assert.deepEqual(result.applied, []);
  });

  it('permissionAllows ranks', () => {
    assert.equal(permissionAllows('media', 'edit_draft'), true);
    assert.equal(permissionAllows('ask', 'media'), false);
  });

  it('keeps execution metadata internal and invokes approval gates', async () => {
    const requested = [];
    const reg = createToolRegistry([{
      name: 'survey_publish',
      minPermission: 'edit_draft',
      risk: 'publish',
      domain: 'survey',
      executionMode: 'exclusive',
      execute: async () => ({ success: true }),
    }]);

    assert.equal(reg.list()[0].risk, undefined);
    assert.equal(reg.get('survey_publish').executionMode, 'exclusive');
    await reg.execute('survey_publish', { confirm: true }, {
      permission: 'edit_draft',
      toolCallId: 'call-1',
      approvalGate: async (request) => requested.push(request),
    });
    assert.equal(requested[0].risk, 'publish');
    assert.equal(requested[0].name, 'survey_publish');
  });
});

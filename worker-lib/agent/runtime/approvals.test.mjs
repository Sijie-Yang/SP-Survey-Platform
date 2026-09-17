import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requiresApproval } from './approvals.mjs';

describe('agent approval policy', () => {
  it('gates publish, destructive deletion, and real uploads', () => {
    assert.equal(requiresApproval({ risk: 'publish' }), true);
    assert.equal(requiresApproval({ risk: 'delete' }), true);
    assert.equal(requiresApproval({ risk: 'upload' }), true);
    assert.equal(requiresApproval({ risk: 'draft' }), false);
    assert.equal(requiresApproval({}), false);
  });
});

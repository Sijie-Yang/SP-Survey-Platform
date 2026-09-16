import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { siliconProgressStatuses } from './runner.mjs';

describe('silicon run status guards', () => {
  it('only treats queued, draft, and running as active', () => {
    assert.deepEqual(siliconProgressStatuses(), ['queued', 'draft', 'running']);
    assert.equal(siliconProgressStatuses().includes('cancelled'), false);
    assert.equal(siliconProgressStatuses().includes('completed'), false);
    assert.equal(siliconProgressStatuses().includes('partial'), false);
  });
});

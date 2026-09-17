import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExecutionPlan,
  countsFromUnits,
  eventCountsFromUnits,
  unitKey,
} from './executionPlan.mjs';

describe('silicon execution plan', () => {
  it('counts personas x repeats x supported trials and skips unsupported types', () => {
    const plan = buildExecutionPlan({
      persona_ids: ['p1', 'p2'],
      repeats: 2,
      question_names: ['comfort', 'note', 'html'],
      survey_snapshot: {
        pages: [{
          elements: [
            { type: 'imagerating', name: 'comfort', trialCount: 3 },
            { type: 'text', name: 'note' },
            { type: 'html', name: 'html' },
          ],
        }],
      },
    });
    assert.equal(plan.total, 16);
    assert.equal(plan.units.filter((unit) => unit.question_name === 'comfort').length, 12);
    assert.equal(plan.units.filter((unit) => unit.question_name === 'note').length, 4);
    assert.equal(plan.questions.find((item) => item.name === 'comfort').trials, 3);
  });

  it('aggregates processed and valid separately and ignores retries of the same saved unit', () => {
    const units = [
      { status: 'saved' },
      { status: 'saved' },
      { status: 'failed' },
      { status: 'skipped' },
      { status: 'pending' },
      { status: 'unknown' },
    ];
    const counts = countsFromUnits(units);
    assert.deepEqual(counts, {
      processed: 4,
      valid: 2,
      failed: 1,
      skipped: 1,
      unknown: 1,
      pending: 1,
      total: 6,
    });
    assert.deepEqual(eventCountsFromUnits(units), {
      answer: 2,
      skip: 1,
      error: 1,
      processed: 4,
      hydrated: true,
    });
    assert.equal(unitKey({
      persona_id: 'a',
      repeat_index: 2,
      question_name: 'q',
      trial_index: 3,
    }), 'a:2:q:3');
  });
});

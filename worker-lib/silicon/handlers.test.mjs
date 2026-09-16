import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { siliconResponsesToCsv } from './handlers.mjs';

describe('silicon export', () => {
  it('writes an independent CSV that is not a survey_responses dump', () => {
    const csv = siliconResponsesToCsv([
      {
        participant_id: 'silicon_abc_1',
        persona_id: 'p1',
        repeat_index: 1,
        status: 'ok',
        responses: { q1: 5, q2: ['a', 'b'] },
      },
    ]);
    assert.match(csv, /participant_id,persona_id,repeat_index,status,question,answer/);
    assert.match(csv, /silicon_abc_1,p1,1,ok,q1,5/);
    assert.doesNotMatch(csv, /survey_responses/);
  });
});

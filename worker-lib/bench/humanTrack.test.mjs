import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listHumanTasks, countHumanTasks } from './humanTrack.mjs';
import { scoreTask, kendallTauB } from './agreementMetrics.mjs';
import { TASK_SCHEMA } from '../../src/lib/benchHumanTrack.js';

function task(over = {}) {
  return {
    schema: TASK_SCHEMA,
    task_id: 'ffffffff-safe',
    version: '2026-10-22',
    project: { id: 'spoofed', name: 'Spoofed' },
    question: { name: 'safe', type: 'imagepicker', family: 'imagepicker', title: '<b>Which</b> looks safer?', attribute_key: '', attribute_label: '' },
    comparison: 'item_scores',
    n_human: 40,
    items: Array.from({ length: 6 }, (_, i) => ({ item_key: `img_${i}.jpg`, image_url: `https://media.sp-survey.org/a/img_${i}.jpg`, value: 20 + i, spread: 1, n: 30, private_note: 'x' })),
    ...over,
  };
}

describe('SP-Bench human track endpoint', () => {
  it('lists valid tasks only, with the real project id and no extra fields', async () => {
    let seenQuery = '';
    const rest = async (_env, { path, query, serviceRole }) => {
      assert.equal(path, '/rest/v1/projects');
      assert.equal(serviceRole, true);
      seenQuery = query;
      return [
        { id: 'abcd1234-0000-4000-8000-000000000000', name: 'Street study', spBenchTasks: { a: task(), b: task({ n_human: 3 }), c: { schema: 'nope' } } },
        { id: 'eeee5555-0000-4000-8000-000000000000', name: 'Other', spBenchTasks: null },
      ];
    };
    const tasks = await listHumanTasks({}, { rest });
    assert.match(seenQuery, /metadata->spBenchTasks=not\.is\.null/);
    assert.match(seenQuery, /select=id,name,spBenchTasks:metadata->spBenchTasks/);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].task_id, 'abcd1234-safe');
    assert.deepEqual(tasks[0].project, { id: 'abcd1234-0000-4000-8000-000000000000', name: 'Street study' });
    assert.equal(tasks[0].question.title, 'Which looks safer?');
    assert.equal('private_note' in tasks[0].items[0], false);
  });

  it('counts zero when the database is unreachable', async () => {
    assert.equal(await countHumanTasks({}, { rest: async () => { throw new Error('down'); } }), 0);
  });

  it('scores with the shared agreement library', () => {
    const t = task();
    const exact = Object.fromEntries(t.items.map((it) => [it.item_key, it.value]));
    assert.equal(scoreTask(t, exact).headline, 1);
    assert.equal(kendallTauB([1, 2, 3], [3, 2, 1]), -1);
  });
});

/**
 * Public task list for SP-Bench's human-agreement track.
 *
 * A project owner publishes a task from the Results page; the frozen task is
 * kept in that project's metadata (`spBenchTasks`). This endpoint gathers the
 * valid ones. Only per-image aggregates are stored there, never individual
 * answers, and every task is re-shaped through `publicTask` so nothing else
 * in the metadata can leak. No new table is needed.
 */
import { supabaseRest } from '../supabaseUserClient.mjs';
import { taskId, tasksFromProjectMetadata } from '../../src/lib/benchHumanTrack.js';

const MAX_PROJECTS = 500;

export async function listHumanTasks(env, { rest = supabaseRest } = {}) {
  const rows = await rest(env, {
    path: '/rest/v1/projects',
    serviceRole: true,
    query: `?metadata->spBenchTasks=not.is.null&select=id,name,spBenchTasks:metadata->spBenchTasks&limit=${MAX_PROJECTS}`,
  });
  const tasks = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const task of tasksFromProjectMetadata(row.spBenchTasks)) {
      // The project fields and the id prefix come from the row itself, not
      // from what was stored, so one project cannot pose as another.
      const t = {
        ...task,
        task_id: taskId(row.id, task.question.name, task.question.attribute_key),
        project: { id: row.id, name: row.name || '' },
      };
      if (seen.has(t.task_id)) continue;
      seen.add(t.task_id);
      tasks.push(t);
    }
  }
  tasks.sort((a, b) => a.task_id.localeCompare(b.task_id));
  return tasks;
}

export async function countHumanTasks(env, opts) {
  try {
    return (await listHumanTasks(env, opts)).length;
  } catch {
    return 0;
  }
}

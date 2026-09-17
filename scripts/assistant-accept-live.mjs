/**
 * Live Assistant accept for the three planned DashScope free models.
 * Requires SP_ACCEPT_TOKEN and SP_ACCEPT_PROJECT. Does not invent keys.
 *
 *   SP_ACCEPT_TOKEN=... SP_ACCEPT_PROJECT=... node scripts/assistant-accept-live.mjs
 */
const BASE = process.env.SP_ACCEPT_BASE || 'http://127.0.0.1:3001';
const TOKEN = process.env.SP_ACCEPT_TOKEN || '';
const PROJECT = process.env.SP_ACCEPT_PROJECT || '';
const MODELS = [
  { provider: 'qwen-dashscope', model: 'deepseek-v3.2' },
  { provider: 'qwen-dashscope', model: 'deepseek-v4-pro' },
  { provider: 'qwen-dashscope', model: 'qwen3.6-flash' },
];

const TASKS = [
  {
    id: 'generate-8',
    assistantMode: 'generate',
    message: '重新生成一个至少 8 页、覆盖多数题型的街景视觉感知问卷。每道 slider 必须有完整 dimensions[{id,label,left,right}]。',
  },
  {
    id: 'adjust-slider',
    assistantMode: 'adjust',
    message: '只改第一道 imageslidergroup 的 dimensions，保留其他题目和答案 id。',
  },
  {
    id: 'adjust-settings',
    assistantMode: 'adjust',
    message: '把问卷语言改成 zh，主题主色改成 #0d47a1，不要改其他颜色；给第一道图片题 trialCount=3。',
  },
];

async function chat(task, route) {
  const res = await fetch(`${BASE}/api/agent/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectId: PROJECT,
      message: task.message,
      assistantMode: task.assistantMode,
      provider: route.provider,
      model: route.model,
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

if (!TOKEN || !PROJECT) {
  console.log(JSON.stringify({
    skipped: true,
    reason: 'SP_ACCEPT_TOKEN or SP_ACCEPT_PROJECT is missing. Offline contract tests already passed.',
    models: MODELS,
  }, null, 2));
  process.exit(0);
}

const report = [];
for (const route of MODELS) {
  const row = { ...route, tasks: [] };
  for (const task of TASKS) {
    const started = Date.now();
    try {
      const result = await chat(task, route);
      row.tasks.push({
        id: task.id,
        status: result.status,
        code: result.data?.code || result.data?.error || null,
        draftMutated: Boolean(result.data?.latestDraft || result.data?.draftMutated),
        ms: Date.now() - started,
      });
    } catch (error) {
      row.tasks.push({ id: task.id, status: 0, code: String(error.message), ms: Date.now() - started });
    }
  }
  report.push(row);
}
console.log(JSON.stringify({ base: BASE, project: PROJECT, report }, null, 2));

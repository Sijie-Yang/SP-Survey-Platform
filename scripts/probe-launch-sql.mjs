// Probe shared Supabase for update2 incremental objects. Never prints secrets.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotenv() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

loadDotenv();

const url = (process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!url || !key) {
  console.log(JSON.stringify({
    ok: false,
    reason: 'missing_env',
    hasUrl: Boolean(url),
    hasServiceRole: Boolean(key),
  }, null, 2));
  process.exit(2);
}

async function rest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
  return { status: res.status, data };
}

function present(result) {
  if (result.status >= 200 && result.status < 300) return { present: true, status: result.status };
  const message = result.data?.message || result.data?.code || '';
  const missing = /does not exist|PGRST202|PGRST204|schema cache|Could not find/i.test(JSON.stringify(result.data || {}));
  return { present: !missing && result.status !== 404, status: result.status, message: String(message).slice(0, 160) };
}

const checks = {};

checks.silicon_runs = present(await rest('/rest/v1/silicon_runs?select=id&limit=1'));
checks.silicon_runs_lease_columns = present(await rest('/rest/v1/silicon_runs?select=claimed_by,lease_expires_at,execution_plan,progress_total&limit=1'));
checks.silicon_answer_units = present(await rest('/rest/v1/silicon_answer_units?select=id&limit=1'));
checks.claim_silicon_run = present(await rest('/rest/v1/rpc/claim_silicon_run', {
  method: 'POST',
  body: {
    p_run_id: '00000000-0000-0000-0000-000000000000',
    p_claimed_by: 'schema-probe',
    p_lease_seconds: 30,
  },
}));
checks.claim_silicon_unit = present(await rest('/rest/v1/rpc/claim_silicon_unit', {
  method: 'POST',
  body: {
    p_run_id: '00000000-0000-0000-0000-000000000000',
    p_claimed_by: 'schema-probe',
    p_lease_seconds: 30,
  },
}));
checks.ai_agent_inbox = present(await rest('/rest/v1/ai_agent_inbox?select=id,target,status&limit=1'));
checks.ai_agent_inbox_payload = present(await rest('/rest/v1/ai_agent_inbox?select=payload&limit=1'));
checks.ai_runs_parent = present(await rest('/rest/v1/ai_runs?select=parent_run_id,inbox_id,assistant_mode,mode&limit=1'));
checks.save_project_draft = present(await rest('/rest/v1/rpc/save_project_draft', {
  method: 'POST',
  body: {
    p_project_id: '__probe_missing__',
    p_survey_config: {},
    p_expected_draft_updated_at: null,
    p_writer: { source: 'probe' },
    p_client_mutation_id: null,
  },
}));

const incrementals = {
  'supabase/ai_agent_inbox_after_run.sql': checks.ai_agent_inbox.present,
  'supabase/ai_agent_inbox_payload.sql': Boolean(checks.ai_agent_inbox_payload.present && checks.ai_runs_parent.present),
  'supabase/save_project_draft_revision_id.sql': checks.save_project_draft.present,
  'supabase/silicon_background_runs.sql': Boolean(
    checks.silicon_answer_units.present
    && checks.silicon_runs_lease_columns.present
    && checks.claim_silicon_run.present
    && checks.claim_silicon_unit.present,
  ),
};

console.log(JSON.stringify({
  ok: true,
  supabaseHost: new URL(url).host,
  checks,
  incrementals,
  applyNeeded: Object.entries(incrementals).filter(([, applied]) => !applied).map(([name]) => name),
}, null, 2));

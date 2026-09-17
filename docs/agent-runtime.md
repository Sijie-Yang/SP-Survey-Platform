# SP-Survey Agent runtime

The in-browser Assistant uses a Worker-native implementation of the observable
DeepSeek Harness lifecycle. `pi-ai` remains the provider/model bridge; SP-Survey
remains the authority for projects, survey JSON, media, Skills, results, and
publishing.

## Platform contract

`src/lib/platformSchema/registry.json` is the canonical machine-readable
contract. It defines project/survey/page/theme/media/Skill entities, every
supported question type and editable field, defaults, response-revision keys,
and deterministic draft operations.

Run:

```bash
npm run schema:sync
npm run schema:check
```

The generator writes the browser and Worker artifacts with the same SHA-256
hash. A feature that adds a setting should update the registry, add a custom
renderer only when an ordinary schema-driven control is insufficient, then add
a semantic test.

## Modes

- `agent`: autonomous domain work; publishing, deletion, and Skill/source
  uploads pause at an approval gate.
- `generate`: creates one complete survey through `replaceConfig`, validates,
  repairs, saves, verifies, and stops.
- `adjust`: preserves unrelated draft data and uses incremental operations
  unless the user explicitly requests a complete redesign.
- `question`: read-only registry; mutation tools are not sent to the model.

The selected mode is stored on sessions/runs when the current migration is
installed and is always present in append-only events.

## Durable lifecycle

Each run records `turn.start/end`, `step.start/end`, model messages, exact tool
calls/results, retries, compaction, steering, approvals, usage, and terminal
status in `ai_session_events`. UI messages and model replay are projections of
that event stream.

Cloudflare Queue `sp-agent-runs` processes at most three model/tool steps per
delivery. The checkpoint is persisted on `ai_runs` and carried in the next
message. A crash can therefore resume without replaying completed side effects.
Read-only calls may run in parallel; mutations remain exclusive. Interrupted
exclusive calls are recorded as unknown outcomes and must be verified before a
retry.

The browser starts a run with `POST /api/agent/chat` and receives
`202 {sessionId,runId}`. It then polls the session event cursor. Refreshing or
switching projects does not own execution; reconnecting only restores the
server state.

Control endpoints:

- `GET /api/agent/sessions/:id?after=<seq>`
- `GET /api/agent/runs/:id`
- `POST /api/agent/sessions/:id/steer`
- `POST /api/agent/runs/:id/cancel`
- `GET /api/agent/runs/:id/approvals`
- `POST /api/agent/approvals/:id`

## Deployment

Apply the additive SQL files in the documented order, including the latest
`supabase/ai_runtime.sql`. Create the queue once:

```bash
npx wrangler queues create sp-agent-runs
```

`wrangler.jsonc` binds it as `AGENT_QUEUE` and registers the same Worker as
consumer. Local Node development uses `waitUntil` with the same HTTP contract.

Before deployment:

```bash
npm run schema:check
npm run catalog:check
npm test -- --watchAll=false --runInBand
npm run build
npx wrangler deploy --dry-run
```

Keep `BYOK_ENCRYPTION_KEY`, Supabase keys, and R2 credentials in Worker secrets.
Never place them in queue payloads, events, stored provider profiles, or logs.

## Feature flags

Assistant and Silicon are independent. Browser toggles live in Assistant
settings (`sp-assistant-enabled`, `sp-silicon-experimental`). Silicon stays
an experimental pretest tab; it never writes `survey_responses`.

On-demand design checks (research design / participant flow / analysis export)
are local and read-only. They do not rewrite the draft and do not call a model.

## Supported provider routes

The Worker runtime only promises routes that `resolveModelRoute` marks
supported and that the catalog/tests cover (OpenAI-compatible completions,
Responses, and Anthropic messages, including the Qwen token-plan and DeepSeek
catalog entries). Untested custom endpoints may still be stored, but the UI
must not treat them as guaranteed.

The browser polls `GET /api/agent/sessions/:id?after=<seq>` and accumulates
events. Assistant text is batched by bytes/time (`createTextBatcher`); the
runtime does not persist one row per token.

## Silicon pretest contract

A Silicon run freezes the saved draft, project media/dataset folders, personas,
model route, and runtime version. Media assignment follows participant folder /
fixed-url rules. Unsupported question types, conditionals, and multi-trial set
assignment are rejected before the run starts. Answers are claimed atomically
per persona/repeat. Cancelled runs cannot be written back to `running`. Budget
exhaustion finishes as `partial`. Export JSON/CSV is independent of human
results.

SQL in `supabase/ai_runtime.sql` and `supabase/silicon_samples.sql` is
additive and is not applied by this change set. Queue binding remains
`AGENT_QUEUE` / `sp-agent-runs` in `wrangler.jsonc`.

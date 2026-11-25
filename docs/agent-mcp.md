# SP-Survey Platform — Codex / Agent Product

Two ways to design surveys with AI:

1. **In-browser Assistant** — Harness/pi-ai provider runtime, write-only keys, durable sessions, and a Worker-native draft tool loop
2. **Connect Codex / Claude / Cursor** via OAuth-protected remote MCP

Silicon pretests use VLM personas and isolated `silicon_*` tables. They never write to `survey_responses`.

Billing is not included. You use your own AI account in both paths.

## From page to data (SP-Scheme)

The recommended way for an agent (Claude Code, Codex, Cursor) to run a study is
the same one SP-Survey Studio uses: the whole study is one web page built to the
SP-Scheme spec. The agent never handles file bytes in the chat; zips and data go
through short-lived signed links and `curl`.

1. `sp_scheme_spec` returns the spec (`text`) and this recipe (`steps`). Build
   `index.html` to the spec. If it uses stimulus files, zip it with them, keeping
   their folders (`images/street_01.jpg`).
2. Import it:
   - one page: `sp_scheme_import { html }`
   - a zip: `sp_scheme_upload_url`, then
     ```bash
     curl -X PUT --data-binary @study.zip '<uploadUrl>'
     ```
     then `sp_scheme_import { uploadId }`.

   Without `projectId` a new project is created; with `projectId` the page of
   that project is replaced. The zip's files go to the project media library in
   their folders (same keys and entries as an upload in the browser).
3. Read `summary`. When `imported` is `false`, nothing was written: fix
   `fixHint.problems` and import again. When `summary.asIs` is `true`, the page
   did not follow SP-Scheme and was imported as it is: answers are recorded but
   not analysed; fix `summary.problems` and import again for analysis.
4. `survey_publish { projectId, expectedDraftUpdatedAt, confirm: true }`
   (`draftUpdatedAt` comes back from the import). Share `links.participant`
   (the custom `/s/<slug>` link when the project has one). `links.studio` is the
   owner's project page (preview, media, link, data).
5. Later, `survey_download_url { projectId }`, then
   ```bash
   curl -L -o data.zip '<downloadUrl>'
   ```
   The ZIP holds `README.txt` (what every file and column means),
   `responses_wide.csv`, `responses_raw.json`, `stimuli.csv`, `survey.json`,
   `page.html` (for a page), `references.bib` and `CITATION.cff`. It has the same
   rows as Studio's download and the Results page: silicon pretest runs never,
   the researcher's own practice runs only with `includePractice: true`.

Signed links are HMAC-SHA256 tokens bound to the user (and the project for
downloads). Upload links last 30 minutes and accept up to 50 MB (a zip may
expand to at most 100 MB); download links last 15 minutes. Anyone holding a
download link can fetch the data until it expires, so do not share it.

`survey_get_draft` shows an imported page as `spSite.html: { id, bytes, note }`
to keep the agent's context small. `survey_replace_draft` keeps the stored page
while `spSite.id` is unchanged; `sp_scheme_import` replaces it.

Publishing a page that has no question pages needs
`supabase/release_site_pages.sql` once (see the checklist below). Until then
`survey_publish` answers with `SITE_PAGES_SQL_REQUIRED`.

## Deploy checklist

### 1. Supabase SQL

Run in order:

1. `supabase/admin_projects_rls.sql` (if not already applied)
2. `supabase/agent_mcp_platform.sql`
3. `supabase/survey_public_rpcs.sql`
4. `supabase/ai_runtime.sql`
5. `supabase/silicon_samples.sql`
6. `supabase/question_skills_analysis_html.sql` (optional legacy `analysis_html` support)
7. `supabase/release_site_pages.sql` (after `project_collaborators.sql`; lets SP-Scheme pages be published)

### 2. Wrangler secrets / vars

`wrangler.jsonc` already sets plaintext `APP_URL`, `MCP_RESOURCE`, and `SUPABASE_URL`.
**Do not rely on plaintext Variables in the Cloudflare dashboard** — they are wiped on every deploy.

```bash
wrangler secret put BYOK_ENCRYPTION_KEY        # 32 random bytes, base64
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# optional:
# wrangler secret put BYOK_ENCRYPTION_KEY_ID   # default 1
# wrangler secret put MCP_SIGNING_SECRET       # signs MCP upload/download links; default: a key derived from SUPABASE_SERVICE_ROLE_KEY
```

After deploy, verify: `https://sp-survey.org/oauth/db-check`

Generate a key:

```bash
openssl rand -base64 32
```

### 3. Deploy

```bash
npm run deploy
```

## User flows

### Codex

1. Sign in at `/admin`
2. Open **AI & Integrations** (`/admin/integrations`)
3. Copy the MCP endpoint + config snippet into `~/.codex/config.toml`
4. Run `codex mcp login sp_survey`
5. Approve scopes on `/oauth/mcp`
6. Ask Codex to create/edit, validate, and share the preview / live URL (managed projects need a release before participants see draft changes)

### Claude Code

1. Sign in at `/admin` → **AI & Integrations**
2. Add the remote HTTP MCP (user scope recommended):

```bash
claude mcp add --transport http sp_survey "https://<host>/mcp" --scope user
```

3. In Claude Code: `/mcp` → `sp_survey` → **Authenticate** → Approve on `/oauth/mcp`
4. Ask Claude Code to use `sp_survey` (start with `survey_capabilities`)

### Cursor

1. Sign in at `/admin` → **AI & Integrations**
2. Merge into `~/.cursor/mcp.json` (or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "sp_survey": {
      "url": "https://<host>/mcp"
    }
  }
}
```

3. Cursor **Settings → Tools & MCP** → **Connect / Authenticate** on `sp_survey` → Approve on `/oauth/mcp`
4. In a new Agent chat, ask Cursor to use `sp_survey` (start with `survey_capabilities`)

### Platform Assistant

1. Open **AI & Integrations**
2. Add any supported Web/BYOK provider and save its key securely
3. Choose **Agent**, **Generate**, **Adjust**, or **Question**
4. Use the builder chat panel. Hosted runs execute through Cloudflare Queue and
   reconnect from append-only server events after refresh/project switching.
   Publish, destructive deletion, and Skill/source upload require approval.

The platform schema, lifecycle, control endpoints, and deployment workflow are
documented in [`docs/agent-runtime.md`](agent-runtime.md).

## Save vs Publish to Main Page

| Surface | Behavior |
|---------|----------|
| Admin save / Codex write | Updates the draft. Legacy projects remain live on save until their first release; managed projects keep the previous release live. |
| Preview / View live / Share `/survey?project=` | Released config and media for managed projects; latest config for legacy projects. Owner sign-in does not bypass the participant view. |
| **Publish to Main Page** (project menu) | Homepage listing application + admin approval |
| MCP `survey_publish` | Atomically releases a version and media snapshot, enabling version management; distinct from homepage listing. |

## MCP tools

**SP-Scheme: page to data** (recommended)

| Tool | Scope | What it does |
|------|-------|--------------|
| `sp_scheme_spec` | `surveys:read` | The SP-Scheme spec text and the five-step recipe |
| `sp_scheme_upload_url` | `surveys:write` | Signed PUT link (30 min, 50 MB) for a zip or page; returns a `curl` line |
| `sp_scheme_import` | `surveys:write` + `media:write` | `{ html }` or `{ uploadId }`, optional `projectId`, `name`, `allowHosts`; same check as Studio; nothing is written when it fails |
| `survey_publish` | `surveys:publish` | Release; returns `links.participant` and `links.studio` |
| `survey_download_url` | `results:read` | Signed GET link (15 min) to one data ZIP; returns a `curl` line |

**Design**

- `survey_capabilities` — `spSchemeWorkflow` first, then question types + `mediaAssignment` for classic per-question editing
- `survey_get_draft`, `survey_validate`
- `survey_apply_operations`, `survey_replace_draft`
- `survey_acquire_lease`, `survey_release_lease`
- `survey_preview_urls` — `participant` (slug-aware), `studio`, `admin`, `liveSurvey`
- `survey_publish` / `survey_list_versions` / `survey_rollback` — release drafts, inspect history, or restore as a new release; publish and rollback require `expectedDraftUpdatedAt` from the reviewed draft

**Project lifecycle (own projects only)**

- `survey_list_projects`, `survey_create_project`
- `survey_update_project` — name, description, metadata
- `survey_duplicate_project` — optional `copyMedia: true`
- `survey_export_project` / `survey_import_project`
- `survey_import_qualtrics` — new project from a Qualtrics `.qsf` (JSON object or text); returns `qualtricsReport` with questions not converted and logic to rebuild
- `survey_delete_project` — `confirm: true`

**Templates & Main Page**

- `survey_list_templates`, `survey_get_template`, `survey_create_from_template`
- `survey_save_as_template` — `confirm: true`; pending admin review
- `template_publish` — **platform admins only** (checked on the server against `admins`); `confirm: true`. Publishes an owned project as an approved template shown on the homepage (`showOnLanding`, default true), or overwrites `templateId` from the project (config, details, media copied to `templates/<id>/`). Templates are created online in Supabase, so no repository sync or pull request is needed. Everyone else uses `survey_save_as_template`.
- `survey_apply_main_page` — `confirm: true` + `onlineStart`/`onlineEnd`

**Media** (`media:write` for mutate)

- `media_list`, `media_import_from_template` (preferred) / `media_delete` (`confirm: true`), `media_upload` (base64, max 8MB — **real files only; never AI-generated placeholders**)
- Media sources: published templates, project Media Dataset, or Admin → 预览媒体库. Agents must not synthesize images and upload them.
- `survey_get_media_dataset` / `survey_update_media_dataset` — folder tags `set` | `category` (Admin Media Dataset)
- Larger video/audio: Admin Media Dataset (MCP base64 cap)

**Skills**

- `skill_list`, `skill_get` (optional immutable `revision`), `skill_save` (`confirm: true`) — private library; no auto public review
- Survey questions: `skillquestion` + `skillId` (`preset_*` or library id). Never put `skillHtml` on the draft.
- `skill_save` requires a non-empty typed `resultSchema` and matching non-empty object `exampleAnswer`, and is **rejected** unless `sourceHtml` calls `SPSkill.setAnswer(object)`. Each substantive save creates an immutable revision. One task per skill; no `skill-result` postMessage protocols.
- Declare exactly one `resultSchema` field, with its type from: `number`, `rating`, `boolean`, `choice`, `text`, `count`, `color`, `scaleGroup`, `points`, `path`, `polygon`, `bbox`, `allocation`, `rankedList`, `multiChoice`, `matrix`, `mediaMatrix`, `mediaChoice`, `mediaRankedList`, `timeRanges`, `timeSeries`, `pairwiseChoice`, `pairwisePreference`, `bestWorst`, or `compositeBlocks`. It must match an existing native question/results/export family; `json`, legacy `pairwise`, and `analysisHtml` are rejected. Use `compositeBlocks` or separate Skills when appropriate. See `survey_capabilities.skillAnalysisGuide`.
- Include `imageUrl` in answers for per-stimulus grouping.

**Results** (`results:read`)

- `survey_list_responses`, `survey_export_responses` (`json` | `wide_csv` | `both` | `long_csv` | `summary_csv` | `analysis_bundle` | `dataset_package`, optional `questionName`), `survey_results_summary`
- `silicon_list_runs`, `silicon_run_responses` — read-only view of silicon-sample pretest runs (runs are started in the browser)

`dataset_package` returns the citable package from Results → Export (README, LICENSE, CITATION.cff, datapackage.json, anonymised data, stimuli manifest) using the dataset details saved on the project. Stimulus image files are not bundled.

**Python SDK** — `sdk/python` (`pip install spsurvey`) wraps these tools; see its README.

Results tools accept an optional `surveyRevision`. Typed exports and summaries select one recorded revision when several designs occur in a project, and return `surveyRevision` / `availableRevisions` so callers can switch explicitly. Raw `json` exports and response listings retain all revisions unless filtered. An unknown explicit revision returns `UNKNOWN_SURVEY_REVISION`. Where a saved question contract exists, its question names, scales and Skill schema drive analysis instead of today's draft. Historical records without a saved contract still require manual verification.

`analysis_bundle` uses the same package builder as Admin Results Analysis: raw JSON, wide CSV, per-question tables, quality checks, methods, manifest, `data_dictionary.json` and `analysis_plan.json`. The latter records export filters and included submissions; it is not a preregistration.

The summary tool remains a lightweight inspection endpoint; use the exported tables for offline analysis and Admin Results Analysis for charts.

**Destructive results** (`surveys:write`)

- `survey_delete_response` — `confirm: true` (requires write scope, not `results:read`)

**Other**

- `credentials_status` (hint only)

Do not confuse: **save = draft (managed projects)** · **`survey_publish` = participant release** · **`survey_save_as_template` = template review** · **`template_publish` = admin publishes a template directly** · **`survey_apply_main_page` = homepage listing**.

Visual pipeline: upload → tag folders (`survey_update_media_dataset`) → design with `mediaAssignmentMode` set/category → validate.

MCP never calls the in-platform LLM (no nested-agent loops).

## Models catalog and Silicon pretests

The in-browser Assistant and Silicon Samples share the checked-in, versioned catalog in `worker-lib/agent/runtime/catalog.generated.mjs`. It is generated from the exact `@earendil-works/pi-ai` npm artifact used by the pinned DeepSeek Harness release: 39 upstream providers and 1,354 models, plus the SP `Qwen DashScope` endpoint derived from Qwen Token Plan's complete 18-model inventory (40 providers and 1,372 routed models in total).

- Web/API-key models use the pinned `pi-ai` implementations directly: `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`, and `mistral-conversations`
- Provider protocol, endpoint, compatibility flags, reasoning controls, headers, and streaming event parsing are resolved per model from the same artifact as DeepSeek Harness
- Tool turns replay pi-ai's original assistant messages (including reasoning/signatures); pi-ai retries are disabled so the SP runtime owns visible retries and cancellation
- Provider keys are encrypted per user and write-only from the browser
- Custom gateways require HTTPS; private, local, link-local, and redirecting endpoints are rejected
- Native-auth providers such as Bedrock, Vertex, Azure, Codex OAuth, and Copilot OAuth remain synchronized internally but are hidden and blocked as `AUTH_UNSUPPORTED`
- Assistant sessions pin provider, model, and reasoning effort; explicit switches are recorded as events
- Assistant edits always load the current draft and save via optimistic `expectedDraftUpdatedAt` operations
- Hosted Assistant requests return `202 {sessionId,runId}` and run through `sp-agent-runs`; checkpoints, steering, cancellation, approvals, and transcripts are server-backed
- The canonical platform contract is generated from `src/lib/platformSchema/registry.json`; run `npm run schema:check` to prevent browser/Worker drift
- Silicon only allows image-capable models, snapshots the saved draft and project media, enforces response/token limits, and stores output separately
- Set `AGENT_RUNTIME=0` to use the legacy JSON chat handler while rolling back the new runtime

Refresh and verify the checked-in model catalog with:

```bash
npm run catalog:sync
npm run catalog:check
```

The sync is deterministic and records the Harness/pi-ai versions, commits, npm integrity, source manifest hash, and generated payload hash. Review model removals, protocol changes, default changes, and capability reductions before committing an updated snapshot. Attribution is recorded in `THIRD_PARTY_NOTICES.md`.

## Security notes

- MCP tokens are opaque, audience-bound Platform tokens (not the Supabase service role)
- BYOK keys are AES-256-GCM encrypted; plaintext never returned after store
- R2 mutating routes require auth and `{userId}/` prefix ownership when Supabase is configured
- `surveys:publish` is required to update a managed participant release or restore a version
- MCP upload/download links are signed (HMAC-SHA256), expire (30 / 15 minutes) and are bound to the user, and downloads to one project whose ownership is checked again; staged uploads live under `_mcp-staging/<userId>/` and are deleted after import
- `template_publish` checks the `admins` table on the server; the client cannot claim admin rights

## Local development

```bash
npm run dev   # CRA :3000 + Express :3001 (agent bridge included)
```

Express proxies `/api/agent/*`, `/oauth/*`, `/mcp`, and `/.well-known/*` to the same Worker handlers.


## Custom interaction authoring (2026-09-10)

The admin navigation now calls Skills **Custom interactions / 自定义交互**. MCP IDs and tools remain `skill_*`; existing Skill IDs, frozen revisions and stored answers are preserved.

- Use native questions and built-in perception tasks directly in Survey Builder. Import a built-in only to create an editable custom copy.
- Choose one supported result family first. Declare its bounds/options/dimensions/budget, provide a matching `exampleAnswer`, then implement the HTML interaction with `SPSkill.setAnswer(object)`.
- Save-time validation checks native settings and example values. The participant iframe validates single-field custom answers against the effective schema plus researcher config. Invalid answers clear the question's current answer instead of satisfying Required.
- The editor provides valid rating, numeric and choice starters, an interactive preview, and native analysis/export for the test answer. Preview does not create a survey response. Admin review uses the same preview panel.
- Custom interactions currently store one answer per question. For separately recorded rounds, use separate questions or a native type with platform trials; do not overwrite earlier rounds inside one HTML answer.
- Iframes run with `allow-scripts` only, without same-origin access. The SDK accepts init messages only from the parent. CSP blocks fetch/XHR, external scripts, forms and nested frames; HTTP(S)/data/blob media remain allowed for existing stimuli. Use self-contained scripts, platform-provided media and the SDK. This is isolation hardening, not a complete network-exfiltration or submission-authenticity guarantee.
- No schema migration is required for this update. Historical answers are not rewritten. New exported summaries identify `analysis_algorithm_version=2026-09-10.1`; corrected calculations may differ from older exports.

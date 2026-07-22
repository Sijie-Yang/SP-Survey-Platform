# SP-Survey Platform — Codex / Agent Product

Two ways to design surveys with AI:

1. **Connect your Codex** via OAuth-protected remote MCP
2. **Platform Assistant** with your own OpenAI / OpenRouter key (encrypted server-side)

Billing is not included. You use your own AI account in both paths.

## Deploy checklist

### 1. Supabase SQL

Run in order:

1. `supabase/admin_projects_rls.sql` (if not already applied)
2. `supabase/agent_mcp_platform.sql`
3. `supabase/survey_public_rpcs.sql`
4. `supabase/question_skills_analysis_html.sql` (optional `analysis_html` for skill-authored Results Analysis views)

### 2. Wrangler secrets / vars

`wrangler.jsonc` already sets plaintext `APP_URL`, `MCP_RESOURCE`, and `SUPABASE_URL`.
**Do not rely on plaintext Variables in the Cloudflare dashboard** — they are wiped on every deploy.

```bash
wrangler secret put BYOK_ENCRYPTION_KEY        # 32 random bytes, base64
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# optional:
# wrangler secret put BYOK_ENCRYPTION_KEY_ID   # default 1
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
6. Ask Codex to create/edit, validate, and share the preview / live URL (saves are live immediately)

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
2. Paste OpenAI (`sk-…`) or OpenRouter (`sk-or-…`) key → **Save securely**
3. Use the builder chat panel (no localStorage key storage in platform mode)

## Save vs Publish to Main Page

| Surface | Behavior |
|---------|----------|
| Admin save / Codex write | Dual-writes `survey_config` + `survey_config_draft` — **live immediately** |
| Preview / View live / Share `/survey?project=` | Always latest via `get_survey_project` |
| **Publish to Main Page** (project menu) | Homepage listing application + admin approval |
| MCP `survey_publish` | Optional version snapshot for rollback only — **not** required for share links |

## MCP tools

**Design**

- `survey_capabilities` — **call first**; question types + `mediaAssignment`
- `survey_get_draft`, `survey_validate`
- `survey_apply_operations`, `survey_replace_draft`
- `survey_acquire_lease`, `survey_release_lease`
- `survey_preview_urls`
- `survey_publish` / `survey_list_versions` / `survey_rollback` — optional **version snapshots** only

**Project lifecycle (own projects only)**

- `survey_list_projects`, `survey_create_project`
- `survey_update_project` — name, description, metadata
- `survey_duplicate_project` — optional `copyMedia: true`
- `survey_export_project` / `survey_import_project`
- `survey_delete_project` — `confirm: true`

**Templates & Main Page**

- `survey_list_templates`, `survey_get_template`, `survey_create_from_template`
- `survey_save_as_template` — `confirm: true`; pending admin review
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

- `survey_list_responses`, `survey_export_responses` (`json` | `wide_csv` | `both` | `long_csv` | `summary_csv` | `analysis_bundle`, optional `questionName`), `survey_results_summary`
- Not full Admin analysis (no charts / TrueSkill). Export for offline analysis.

**Destructive results** (`surveys:write`)

- `survey_delete_response` — `confirm: true` (requires write scope, not `results:read`)

**Other**

- `credentials_status` (hint only)

Do not confuse: **save = live share** · **`survey_publish` = version snapshot** · **`survey_save_as_template` = template review** · **`survey_apply_main_page` = homepage listing**.

Visual pipeline: upload → tag folders (`survey_update_media_dataset`) → design with `mediaAssignmentMode` set/category → validate.

MCP never calls the in-platform LLM (no nested-agent loops).

## Security notes

- MCP tokens are opaque, audience-bound Platform tokens (not the Supabase service role)
- BYOK keys are AES-256-GCM encrypted; plaintext never returned after store
- R2 mutating routes require auth and `{userId}/` prefix ownership when Supabase is configured
- `surveys:publish` is only needed for optional version snapshots / rollback, not for live share URLs

## Local development

```bash
npm run dev   # CRA :3000 + Express :3001 (agent bridge included)
```

Express proxies `/api/agent/*`, `/oauth/*`, `/mcp`, and `/.well-known/*` to the same Worker handlers.

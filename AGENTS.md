# Agent guide — SP-Survey Platform

This repository hosts the multi-user SP-Survey Platform. External agents (Codex, Cursor) should use the **remote MCP** or **Agent HTTP API**, not direct Supabase service-role access.

## Preferred workflow (Codex)

1. User signs in and connects Codex / Claude Code / Cursor via `/admin/integrations`
2. Agent calls MCP tools on `https://<host>/mcp`
3. New study (recommended): `sp_scheme_spec` → build one `index.html` → `sp_scheme_import` (`{ html }`, or a zip via `sp_scheme_upload_url` + `curl -X PUT --data-binary @study.zip '<uploadUrl>'` then `{ uploadId }`) → fix `summary.problems` / `fixHint` and re-import with `projectId` and `expectedDraftUpdatedAt` (required once published; unchanged media are not uploaded again) → `survey_publish` (`confirm: true`) → share `links.participant` → later `survey_download_url` + `curl -L -o data.zip '<downloadUrl>'` and analyse the files (`README.txt` explains them)
4. Classic per-question editing: always `survey_capabilities` then `survey_get_draft` (retain `draftUpdatedAt`). An imported page shows as `spSite.html: { id, bytes, note }`; keep `spSite.id` in `survey_replace_draft` to keep it. Only `sp_scheme_import` changes the page (its HTML and `allowedHosts`)
5. Prefer `survey_apply_operations` over full `survey_replace_draft`
6. Media: prefer `media_import_from_template` or existing project / Admin 预览媒体库. `media_upload` only for real researcher files — **never AI-generate images to upload**. Then `media_list` / `survey_update_media_dataset` (folder tags for set/category)
7. Skills: prefer `preset_*` on `skillquestion`. Custom: `skill_save` with exactly one typed `resultSchema` field + matching object `exampleAnswer`, then use only `skillId` — never put `skillHtml` on the question. HTML **must** call `SPSkill.setAnswer(object)` (no `skill-result` postMessage); one task per skill. Interaction may be novel, but the result field and its settings must map exactly to one existing native question/results/export family — rating `rating`; numeric/count `number`/`count`; annotation `points`/`path`/`polygon`/`bbox`; media `rating`/`number`/`boolean`/`scaleGroup`/`mediaChoice`/`mediaRankedList`/`mediaMatrix`+`imageUrl`; structured `multiChoice`/`matrix`/`rankedList`/`allocation`/`compositeBlocks`; comparison `pairwiseChoice`/`pairwisePreference`/`bestWorst`; color `color`; video `timeRanges`/`timeSeries`. New revisions may not use `json`, legacy `pairwise`, or `analysisHtml`; use `compositeBlocks`, separate Skills, or redesign unmatched answers (`survey_capabilities.skillAnalysisGuide`).
8. Results: `survey_list_responses` / `survey_export_responses` / `survey_results_summary` (`results:read`)
9. Never send API keys, HuggingFace tokens, fal keys, or Supabase credentials
10. For version-managed projects, saves update the draft only. Review it, then explicitly release with survey_publish to update the participant URL. Legacy projects remain live on save until their first release.
11. `survey_publish` with `confirm: true` releases a version plus media manifest and enables version management. It is separate from Publish to Main Page.

## Local config example

```toml
# ~/.codex/config.toml
mcp_oauth_credentials_store = "keyring"

[mcp_servers.sp_survey]
url = "https://sp-survey.org/mcp"
auth = "oauth"
scopes = ["surveys:read", "surveys:write", "surveys:publish", "media:write", "results:read"]
```

```bash
codex mcp login sp_survey
```

## Shared design protocol

Pure modules live under `src/lib/designProtocol/` (mirrored for Workers in `worker-lib/designProtocol.mjs`).

## Do not

- Call `/api/agent/chat` from Codex (browser assistant only)
- Bypass optimistic concurrency (`expectedDraftUpdatedAt`)
- Confuse **Save as Template** / **Publish to Main Page** / **`survey_publish`** (participant release plus version snapshot)
- Use `template_publish` unless the user is a platform admin (checked on the server) who owns the project; it publishes an approved template directly, online, with no repo sync (`surveys:publish`; overwriting `templateId` needs `overwrite: true`). Others use `survey_save_as_template` (review)
- Share or log signed upload/download links; they are credentials until they expire
- Expose or log BYOK ciphertext/plaintext

See `docs/agent-mcp.md` for the full tool catalog.

## SP-Bench

Platform-admin benchmark (not MCP). Schema `supabase/sp_bench.sql`, APIs under `/api/bench/*`, admin tab on `/admin-dashboard`, public page `/bench` behind `public_enabled`. See `docs/sp-bench.md`.

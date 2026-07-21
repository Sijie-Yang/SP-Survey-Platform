# Agent guide — SP-Survey Platform

This repository hosts the multi-user SP-Survey Platform. External agents (Codex, Cursor) should use the **remote MCP** or **Agent HTTP API**, not direct Supabase service-role access.

## Preferred workflow (Codex)

1. User signs in and connects Codex via `/admin/integrations`
2. Codex calls MCP tools on `https://<host>/mcp`
3. Always `survey_capabilities` then `survey_get_draft` (retain `draftUpdatedAt`)
4. Prefer `survey_apply_operations` over full `survey_replace_draft`
5. Media: prefer `media_import_from_template` or existing project / Admin 预览媒体库. `media_upload` only for real researcher files — **never AI-generate images to upload**. Then `media_list` / `survey_update_media_dataset` (folder tags for set/category)
6. Skills: prefer `preset_*` on `skillquestion`. Custom: `skill_save` then `skillId` — never put `skillHtml` on the question. `skill_save` HTML **must** call `SPSkill.setAnswer` (no `skill-result` postMessage); one task per skill. Declare `resultSchema` types (`points`/`path`/`allocation`/`rankedList`/…) so analysis/export reuse native charts; optional `analysisHtml` for novel shapes (`survey_capabilities.skillAnalysisGuide`)
7. Results: `survey_list_responses` / `survey_export_responses` / `survey_results_summary` (`results:read`)
8. Never send API keys, HuggingFace tokens, fal keys, or Supabase credentials
9. Saves update the live share URL immediately
10. Optional: `survey_publish` with `confirm: true` = version snapshot only

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
- Confuse **Save as Template** / **Publish to Main Page** / **`survey_publish`** (version snapshot)
- Expose or log BYOK ciphertext/plaintext

See `docs/agent-mcp.md` for the full tool catalog.

## SP-Bench

Platform-admin benchmark (not MCP). Schema `supabase/sp_bench.sql`, APIs under `/api/bench/*`, admin tab on `/admin-dashboard`, public page `/bench` behind `public_enabled`. See `docs/sp-bench.md`.

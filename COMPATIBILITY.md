# Compatibility & Safe Releases

How to ship updates while existing researchers and live surveys keep working.

**Rule of thumb:** read old data safely, write new data correctly, repair optionally, delete carefully, run SQL before frontend.

---

## 1. Compatibility principles

| Layer | Do | Don't |
|-------|----|-------|
| Supabase schema | Additive only (`ADD COLUMN … DEFAULT`, new tables, new policies) | Drop/rename columns or change meaning of existing fields without a migration path |
| RLS | Add new policies first; verify owner + admin paths; then tighten | Rely on UI-only checks; silent 0-row UPDATEs |
| R2 keys | Keep prefixes stable: `{userId}/{projectId}/…`, `templates/{templateId}/…` | Delete under `templates/` from project flows; reuse keys across owners |
| Survey JSON | New fields optional; normalize on load | Require new fields for old projects to open |
| Response keys | Keep question `name` stable once live data exists | Silently rename live question IDs |
| Live links | `/survey?project=…` behavior unchanged | Change query params or auth for public take |

Before every release ask: *If a user never clicks any new button, can they still open, take, and export an old project?*

---

## 2. What is safe vs breaking

### Usually safe (ship anytime)

- UI polish, Admin copy, sorting, empty states
- New optional tools (feature CSV on R2, researcher-only SAM pre-annotate)
- Additive DB columns / tables with defaults
- New Admin repair actions that are explicit and reversible in intent

### Breaking (need a plan)

- Changing question `name` / page `name` semantics
- Changing R2 key layout or public URL shape
- Removing or renaming `survey_config` / `image_dataset_config` fields that old clients read
- Tightening RLS so owners or admins lose access
- Deleting storage that might be shared (templates vs projects)

### Breaking-change playbook

1. **Compatible read** — old projects still open without migration.
2. **Correct write** — create / duplicate / import no longer produce bad data.
3. **Optional repair** — Admin one-click fix (e.g. duplicate question IDs) with clear success/failure (must verify rows updated).
4. **User note** — short in-app or release note: when to repair, whether re-save is needed, impact on collected responses.
5. **Never** silently rewrite response keys, silently delete R2 under another prefix, or silently change live link meaning.

---

## 3. Release order

1. **SQL first** — run scripts under `supabase/` in Supabase SQL Editor (idempotent where possible). Confirm policies/tables exist.
2. **API / Worker** — deploy `worker.js` / `server.js` in the same window as the frontend when behavior changes.
3. **Frontend** — deploy the SPA (e.g. Cloudflare Pages).
4. **Smoke test** (below).
5. **Announce** only if users must take action (repair, re-save, re-collect).

Prefer small, reversible commits on `main` over large mixed releases.

---

## 4. Pre-release checklist

Copy into the PR or release note:

- [ ] Old `survey_config` without new fields still loads in Builder and live survey
- [ ] Existing responses still map to the same question `name`s
- [ ] Project delete / clear / media delete only touch `{userId}/{projectId}/` (never `templates/` unless explicitly allowed)
- [ ] Template import does not copy template URLs into project ownership incorrectly
- [ ] Live URL `?project=` still works for an unchanged published project
- [ ] Admin writes that must persist use `.select()` (or equivalent) and fail if 0 rows (RLS false success)
- [ ] New SQL is checked into `supabase/` and marked run/not-run for production
- [ ] Worker/server and frontend agree on R2 delete guards and list sort if those changed

### Post-deploy smoke (≈5 minutes)

1. Open one **old** project in Builder → save once.
2. Open its **live** link → submit a test response (or preview if live is frozen).
3. Open Results / export for that project.
4. If this release includes Admin repair: run it on a copy or known-bad project and confirm DB actually updated.
5. Spot-check Image Dataset: list, natural sort, no template assets deleted.

---

## 5. Database migrations (`supabase/`)

| Script | Purpose |
|--------|---------|
| `supabase/spatial_intelligence.sql` | Spatial settings table; features live on R2 CSV, not legacy feature tables |
| `supabase/admin_projects_rls.sql` | `admins` + `is_platform_admin()` + admin SELECT/UPDATE/DELETE on `projects` |
| `supabase/template_media_folders.sql` | `templates.image_dataset_config` for folder / set / category tags on templates |

Conventions:

- Scripts should be **re-runnable** (`IF NOT EXISTS`, `DROP POLICY IF EXISTS` + recreate).
- Comment at top: symptom, cause, steps after run.
- Prefer additive policies; document any intentional drop of legacy tables as **optional**.
- After RLS changes: verify both **project owner** and **platform admin** paths.

---

## 6. Storage (R2) contracts

| Prefix | Owner | Who may delete |
|--------|--------|----------------|
| `{userId}/{projectId}/…` | That project | Project owner flows; admin only with care |
| `templates/{templateId}/…` | Template library | Template maintenance only (`allowTemplateKeys: true`) |

- Project `preloadedImages` must not permanently own template URLs; sanitize on load when needed.
- Feature CSVs: `{userId}/{projectId}/features/{model}.csv` and `templates/{templateId}/features/{model}.csv`.
- SAM / heavy AI: researcher tooling only — **not** in live participant surveys.

---

## 7. Survey config & responses

- Treat question `name` as a **stable API** once the project has (or may have) responses.
- Duplicate page/question: allocate **globally unique** names (see `src/lib/questionNames.js`); do not naively append `_1`.
- Structural edits that rename or remove live questions: warn that existing answers may misalign; prefer a **new project** for a new study wave.
- Normalize on read for optional fields; default missing arrays/objects so Builder does not crash.

---

## 8. Communicating with users

| Change type | Communication |
|-------------|----------------|
| Pure UI / new optional tools | Optional changelog |
| Repair available for known bad data | In-app banner or Admin note + when to click repair |
| Question ID / schema repair | “Re-save after repair”; mention response key risk if names change |
| Live survey behavior change | Avoid if possible; otherwise announce before deploy |

Do not promise “no impact” if question names or storage ownership change.

---

## 9. Rollback

- **Frontend:** redeploy previous Pages build.
- **Worker:** redeploy previous worker version.
- **SQL:** usually **not** rolled back by dropping columns; instead fix forward. Only reverse a policy if it blocks access — keep a copy of the previous policy text in the PR.
- **R2:** deletions are hard to undo; prefer soft-disable in app over bulk delete in releases.

---

## 10. PR note template (breaking or data-touching)

```text
## Compatibility
- Read path: …
- Write path: …
- User action required: none | repair | re-save | re-collect
- SQL to run: supabase/….sql (yes/no, already on prod?)
- R2 prefix impact: none | project only | templates (explicit)
```

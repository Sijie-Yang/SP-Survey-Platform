# Media Set/Category Pipeline — Release Smoke Checklist

Use with [COMPATIBILITY.md](../COMPATIBILITY.md) §4 before shipping folder/set/category changes.

## Pre-flight

- [ ] `supabase/template_media_folders.sql` run in production Supabase (or confirmed already present)
- [ ] `npm run test:ci` passes
- [ ] `npm run test:media-pipeline` passes
- [ ] `npm run build` succeeds

## Functional smoke (~5 minutes)

1. **Legacy project** — open a project with no `imageDatasetConfig` / `mediaAssignmentMode: group`; save, take survey, export.
2. **Set mode** — tag a folder `set` with exactly N direct files; question `mediaAssignmentMode: set`, `imageCount: N`; preview shows one whole set; submit and confirm `shown_media_set` in response + CSV.
3. **Category mode** — tag two folders `category`; set `mediaPerCategory`; preview/export include `shown_media_categories`.
4. **Template round-trip** — save project as template with folder tags → import into new project → tags and relative paths preserved; re-import does not duplicate files.
5. **Draft resume** — start survey, answer page 1, reload, Continue → set/category metadata still present on submit.
6. **R2 delete guard** — clear/delete project media; confirm `templates/` objects untouched; nested same-name files delete only the selected key.

## Notes

- Record SQL status in the release note: `template_media_folders.sql` run / not-run.
- CI workflow: `.github/workflows/ci.yml` (tests + smoke pattern + build + SQL idempotency grep).

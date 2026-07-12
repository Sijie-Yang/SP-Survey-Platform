# 论文库 — Admin Smoke

Live Deep Search (Semantic Scholar + Crossref) is disabled. This checklist covers the paper library UI only.

Literature intake: use Scopus offline — see [`research/scopus/SEARCH.md`](../research/scopus/SEARCH.md) and drop CSVs in `research/scopus/exports/`.

## Before testing

1. Run in Supabase SQL Editor (once):
   - [`supabase/admin_projects_rls.sql`](../supabase/admin_projects_rls.sql) (if `is_platform_admin()` is missing)
   - [`supabase/research_papers.sql`](../supabase/research_papers.sql)
2. No `SEMANTIC_SCHOLAR_API_KEY` / `CROSSREF_MAILTO` needed for library browse / review / draft.

## Smoke

1. Open **平台管理 → 论文库**.
2. Candidate queue and Paper library sections load (empty is OK if no rows).
3. Filter by title / DOI / venue works when rows exist.
4. Approve / reject updates `research_papers.status`.
5. On an approved paper, **Draft template** (BYOK) creates an unpublished template and sets `template_id`.
6. Approve that draft under **模板管理**.

## Compatibility notes

- Write path: `research_papers` (admin RLS only)
- `research_paper_scans` may stay empty until an importer exists
- SQL to run: `supabase/research_papers.sql` (yes/no, already on prod?)

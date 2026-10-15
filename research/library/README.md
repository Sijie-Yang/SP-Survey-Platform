# Paper library

`public/research/library.json` is the single source of truth for the paper
library at `/papers` and Admin → 论文库, in the same way
`public/project_templates/` is for templates. The online table
`research_papers` is synced from it.

```text
research/scopus/exports/*.csv ── npm run research:filter ──▶ research/scopus/shortlists/*_library_coarse.json (v6 rules)
research/library/overrides.json   papers kept or dropped by hand, with reasons
public/project_templates/*.json   "doi" of each paper template
        └── npm run research:library ──▶ public/research/library.json
                                          └── Admin → 论文库 → 从文件同步 ──▶ research_papers
research_papers ── Admin → 论文库 → 导出线上改动 ──▶ npm run research:library:merge <file> ──▶ overrides.json
```

## What each paper records

- `inclusion.via` says why the paper is in the library:
  - `scopus_v6`: selected by the coarse filter (see `research/scopus/README.md`).
  - `manual_seed`: listed in `research/scopus/seeds.md`.
  - `template`: the paper behind a template, kept whatever the search rules do.
  - `legacy_import`: in the online library since the 2026-07-12 import under an earlier filter version.
  - `admin_added`: added in Admin, then exported back to the repo.
  - `manual`: any other hand-kept paper.
- `inclusion.reason` gives the reason in words. Online, the same record sits in `raw_meta.library`.
- `template_id` is set by the build from the template files' `doi`, plus `template_links` in `overrides.json` for templates that have no file. Do not link paper templates by hand online; give the template a `doi` instead.

## Everyday tasks

| Task | Steps |
|------|-------|
| Add a paper template | Put `"doi"` in the template JSON (and the DOI URL in `"website"`), then `npm run research:library`. If the paper is not in the Scopus export, the build asks for an `include` entry with `via: "template"` and `paper` metadata in `overrides.json`. |
| Keep or drop a paper | Add an entry with a `reason` to `include` or `exclude` in `overrides.json`, then `npm run research:library`. |
| New Scopus export | `npm run research:rebuild` (filter, enrich, library). |
| Bring online changes back | Admin → 论文库 → 导出线上改动, then `npm run research:library:merge <downloaded file>` and `npm run research:library`. |
| Publish the file online | Commit and deploy, then Admin → 论文库 → 从文件同步. The dialog previews additions, updates and online-only papers; online-only papers are archived only if you tick them. Nothing is deleted. |

`npm run research:library:check` validates without writing. The build fails if
a template's paper is missing, a template is linked to two papers, or an
override has no reason.

## Freezing a version for a paper

For a study such as SP-Bench, cite the commit of `public/research/library.json`
you used and report `count` and `counts_by_inclusion` from the file header.

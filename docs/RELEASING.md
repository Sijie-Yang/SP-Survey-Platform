# Releasing SP-Survey

sp-survey.org deploys from `main` automatically (Cloudflare Workers build). A **release** is the extra step that gives a state of `main` a version number researchers can cite and a reviewer can check out.

## When to cut one

- Before a paper that used the platform is submitted (so the Methods can name a version).
- When analysis or export output changes (a schema string in `src/lib/` changed).
- Otherwise roughly every few months.

## Version numbers

`MAJOR.MINOR.PATCH`. While the platform is `0.x`, bump MINOR for anything that changes computed numbers or export columns, PATCH for everything else.

Three places carry the version and must agree (tests check the first two):

| File | Field |
| --- | --- |
| `package.json` | `"version"` |
| `src/lib/platformCitation.js` | `PLATFORM_VERSION` |
| `sdk/python/pyproject.toml` and `sdk/python/spsurvey/__init__.py` | `version` / `__version__` (only when the SDK changed) |

## Steps

1. On a branch: bump the version in the files above and add a section to `CHANGELOG.md` (what changed for researchers, any SQL to run, any change in computed numbers).
2. Open a PR, wait for CI, merge.
3. Tag `main`: `git tag -a v0.2.0 -m "SP-Survey 0.2.0" && git push origin v0.2.0`, then create a GitHub release from the tag with the changelog section as notes.
4. **DOI (optional, once Zenodo is connected).** With the Zenodo–GitHub integration switched on for this repository, each GitHub release is archived automatically and gets a version DOI. Put the *concept* DOI (the one that always resolves to the latest version) in the Cloudflare build variable `REACT_APP_PLATFORM_DOI`; every citation and export then includes it. The methods paper is not cited anywhere until it is published; once it is, put its DOI in `REACT_APP_PLATFORM_PAPER_DOI` and every citation, export and Methods draft adds it.
5. **Python SDK (only if `sdk/python` changed).** `cd sdk/python && python -m build && python -m twine upload dist/*`.

## SQL

Releases never run SQL. If a release needs a `supabase/*.sql` file, the changelog says so and the operator runs it by hand before (additive changes) or after (removals) deploying. Every SQL file is idempotent, so running it twice is safe.

## Rolling back

Revert the merge on `main`; the next deploy restores the previous Worker and front end. Data written by the newer version stays in Supabase, which is why schema changes are additive only.

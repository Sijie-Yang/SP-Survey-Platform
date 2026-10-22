# Contributing to SP-Survey Platform

Thank you for helping. SP-Survey is research infrastructure: people publish papers on numbers this code computes, so the bar is "a reviewer could reproduce it", not "it works on my machine".

## Ground rules

1. **Deterministic over generative.** Anything that must be right (statistics, image-name mapping, exports, scoring) is plain code with tests. A language model may draft text or code for a researcher to review; it is never the only thing standing between a participant's answer and the data file.
2. **No synthetic stimuli.** Never upload, bundle or suggest AI-generated images as survey stimuli or template media. Use the researcher's own files or openly licensed photographs, and record the source (see [docs/template-contributing.md](docs/template-contributing.md)).
3. **Participants first.** Do not add tracking, fingerprinting or third-party scripts to participant pages. Anything that leaves a participant's browser must be listed in the informed-consent text the researcher controls.
4. **One number, one implementation.** If a figure appears on the Results page, in an export and in the SDK, all three call the same function. Add to `src/lib/` and import it; do not re-derive.
5. **Small, reviewable pull requests.** One feature or fix per PR, with tests and, for UI changes, a screenshot at desktop and phone width.

## Setup

```bash
npm ci
cp .env.example .env.local          # fill in your own Supabase project + R2 bucket (optional for UI work)
npm start                           # React app on :3000
npx wrangler dev                    # Worker (API, /mcp, media) on :8787
```

The SQL in `supabase/` is applied by hand in the Supabase SQL editor. Every file must be safe to run twice (`CREATE OR REPLACE`, `IF NOT EXISTS`, `DROP ... IF EXISTS`); `npm run sql:check` enforces this.

## Tests

| What | Command |
| --- | --- |
| React + library tests | `npm run test:ci` (one file: `CI=true npx react-scripts test src/lib/foo.test.js --watchAll=false`) |
| Worker, agent runtime, silicon | `npm run test:agent` |
| SP-Bench scoring | `npm run test:bench` |
| Python SDK | `pip install "./sdk/python[test]" && python -m pytest -q sdk/python` |
| SQL idempotency | `npm run sql:check` |
| Generated catalogs | `npm run catalog:check && npm run schema:check` |
| Worker bundle | `npx wrangler deploy --dry-run --outdir=.wrangler-dry-run` |

CI runs all of these on every pull request. A few UI suites are slow and can time out when the machine is busy; re-run them alone before assuming a real failure. Never skip or delete a test to get green.

## Where things live

- `src/lib/` — pure functions: analysis, exports, scoring, citation. Most new logic belongs here.
- `src/components/`, `src/pages/` — React (MUI). Strings go through the i18n dictionaries (`src/contexts/*I18n.js`); Chinese and English are both required.
- `worker.js`, `worker-lib/` — Cloudflare Worker: REST API, `/mcp`, OAuth, silicon runs, media.
- `supabase/` — SQL to run by hand. Name new files after the feature, not a date.
- `public/project_templates/` — built-in templates ([guide](docs/template-contributing.md)).
- `sdk/python/` — the `spsurvey` package; it only wraps `/mcp` tools.
- `docs/` — topic docs and [architecture decision records](docs/adr/README.md).

## Pull request checklist

- [ ] Tests added or updated; the commands above pass locally.
- [ ] New SQL is idempotent and mentioned in the PR body ("run `supabase/x.sql`").
- [ ] Chinese and English strings both present.
- [ ] UI change: screenshot at 1280 px and 390 px.
- [ ] A change in how a number is computed bumps the relevant schema/version string and is noted in the PR body, because it changes published results.
- [ ] No secrets, API keys or participant data in the diff or screenshots.

## Licence

By contributing you agree that your contribution is released under the repository licence ([CC BY 4.0](LICENSE)).

## Citing

If you use the platform in research, cite it; see the **Cite** button on any Results page or [`src/lib/platformCitation.js`](src/lib/platformCitation.js).

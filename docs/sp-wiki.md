# SP-Wiki and Doc / News Submission

`/docs` is the public SP-Wiki. Existing research concepts, methods and paper-template guides remain available without a database migration. Signed-in users can propose a complete replacement of a page's editorial text, submit a new tutorial, or submit research news at `/contribute`. `/docs/doc-news-submission` explains the workflow in English and Chinese. The news page links to the news submission form.

The Wiki and contribution workspace share a collapsible navigation tree: paper cases (illustrated guides and template references), submissions, and SP-Wiki topics. Parent buttons only expand/collapse; leaf links open pages. Direct links and browser history reveal the active branch, and breadcrumbs link to the corresponding overview. The sidebar uses one scroll area; on mobile the same tree opens in a drawer and closes after selecting a page. Submission query changes select the matching form and navigation item.

## Enable the feature

1. Ensure the existing `supabase/admin_projects_rls.sql` and `supabase/news_posts.sql` migrations have been applied. Platform administrator membership continues to use `is_platform_admin()`.
2. Apply `supabase/wiki_submissions.sql` through the normal database migration workflow. It is transactional and may be reapplied. It adds the wiki, submission, review-event and revision tables, plus Markdown format and contributor fields on `news_posts`. It does not change existing news content or survey projects.
3. Deploy the application. Visit **Admin Dashboard → Doc / News 审核** using a platform administrator account. A normal signed-in account should see the submission form and only its own requests.
4. Submit a sample edit, return it with feedback, resubmit it, and approve it in a staging environment before enabling production contributions.

Until the migration is applied, the public bundled guides still work. The submission form and moderation tab explain that submissions are not enabled. No service-role credential belongs in the browser or in this workflow.

## Publication and review

- User-facing fields: language, title, summary, Markdown body, public contributor name and optional bundled survey-template association. The contributor must confirm permission to publish text and media.
- Review-only fields: rationale, source/permission notes, original source snapshot, feedback and audit events. These are visible only to the author and platform administrators.
- States: `pending` → `approved`, `changes_requested` or `rejected`. An author may revise a returned/rejected/pending request. Resubmission creates a new submission version and returns it to `pending`. Published requests are immutable; further edits require a new proposal.
- Approval is publication. There is no separate unreviewed public draft. An approved doc creates/updates `wiki_pages` and appends `wiki_page_revisions`; approved news creates a published `news_posts` entry. These writes and the review event happen atomically in one transaction.
- New tutorials have a stable generated `/docs/community-<uuid>` address and appear in the community section. News has `/news/community-<uuid>`. English and Chinese wiki revisions are independent; new community pages fall back to their available language when needed.
- Existing pages retain their original URLs and sidebar grouping. Paper pages retain the original full citation and native read-only template preview. Published edits also retain the relevant screenshots, scoring examples and current template settings. Editorial changes do not change survey JSON, media, responses or release state.
- Images use public URLs in Markdown (`![caption](https://...)`). The first version does not upload files or accept arbitrary HTML, scripts, iframes or custom widgets. Use authorized research assets; keep participant data and credentials out of articles.

## Concurrency and access control

`save_content_submission(id, expectedVersion, input)` authenticates the author and checks ownership and optimistic concurrency. Author and submission-ID transaction locks serialize creation. It does not accept client-provided status, reviewer, ownership or publication fields. New requests require version zero. There is a limit of 20 active requests per author at creation.

`review_content_submission(id, expectedVersion, decision, note)` checks administrator membership inside PostgreSQL. Only a pending request with the expected version can be reviewed. Feedback is required for a return/rejection. A per-page-and-language transaction lock and base revision check prevent an older proposal from overwriting a newer publication.

The review screen shows the actual current document beside the proposal, plus the original snapshot and audit trail. When bundled source text (revision zero) has changed since submission, the screen blocks approval and asks the author to merge. This bundled-source comparison is a UI check; PostgreSQL enforces published community revisions. Deploy source edits before reviewing proposals based on old bundled text.

RLS permits anonymous read of approved pages and their public revision history. Authors/admins may read private submissions and review events. Direct writes to wiki/submission tables are revoked even from the authenticated administrator role; writes go through the validated security-definer RPCs. Existing news-admin editing remains governed by the existing news RLS.

New bundled docs or templates must also be added to `wiki_builtin_pages` in the migration. The integration test checks that this registry matches the application catalogs.

## Validation

```sh
CI=true npm test -- --watchAll=false --runInBand src/pages/ContributePage.test.js src/pages/PlacePulseTutorialPage.test.js
npm run build
```

SQL integration tests run entirely in a temporary local PGlite database (PostgreSQL in WASM). They exercise migrations twice, RLS, anonymous access, ownership, author/admin version conflicts, stale document rejection, resubmission, atomic doc/news publication, audit records and registry consistency:

```sh
npm install --prefix /tmp/sp-wiki-sql --no-audit --no-fund --ignore-scripts @electric-sql/pglite
PGLITE_MODULE=/tmp/sp-wiki-sql/node_modules/@electric-sql/pglite/dist/index.js node scripts/tests/wiki-submissions.mjs
```

Browser acceptance: anonymous login return path; signed-in author submission and feedback; admin comparison and approval; public Markdown tables/images; retained paper citation and template preview; mobile form and article width. Browser fixtures must intercept API writes rather than post test data to production.

## Current limits

Moderation and author lists display the latest 200 matching requests. Notifications are in the author's status list (no email yet). The editor does not persist unsent local drafts. Version history records approved articles but has no one-click rollback; submit and review a new edit to restore earlier text. Removing already-published wiki content requires a follow-up moderation feature or the normal controlled database workflow. Existing news management can archive approved news.

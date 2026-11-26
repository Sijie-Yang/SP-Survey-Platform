/**
 * Paper library, news and wiki tools over MCP (admin only), and the weekly
 * paper scan, against an in-memory Supabase.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { baseEnv, callTool, fakeSupabase } from '../mcp/fakePlatform.testkit.mjs';
import { BACKFILL_FIRST_YEAR, cleanPaperInput, nextBackfillYear, normalizeDoi, runWeeklyPaperScan } from './paperLibrary.mjs';

let db = null;
afterEach(() => { db?.restore(); db = null; });

const ADMIN = [{ user_id: 'u1' }];
const TEMPLATES = [{ id: '2014-naik-streetscore', name: 'Streetscore' }];
const known = (extra = {}) => ({
  id: 'p1',
  doi: '10.1007/978-3-319-46448-0_12',
  title: 'Deep Learning the City',
  authors: ['A. Dubey'],
  year: 2016,
  status: 'approved',
  template_id: null,
  sources: ['scopus'],
  abstract: 'Street view images rated in pairs.',
  keywords: [],
  ...extra,
});

describe('paper input', () => {
  it('normalises DOIs and rejects what is not a DOI', () => {
    assert.equal(normalizeDoi('https://doi.org/10.1109/CVPRW.2014.121'), '10.1109/cvprw.2014.121');
    assert.equal(normalizeDoi('doi: 10.1371/journal.pone.0068400'), '10.1371/journal.pone.0068400');
    assert.equal(normalizeDoi('not a doi'), null);
    const { fields, problems } = cleanPaperInput({ doi: 'x', year: 'soon', status: 'live', title: ' T ' });
    assert.equal(fields.title, 'T');
    assert.equal(problems.length, 3);
    assert.deepEqual(Object.keys(cleanPaperInput({ status: 'approved' }).fields), ['status']);
  });
});

describe('paper_list and paper_save', () => {
  it('are for platform admins only', async () => {
    db = fakeSupabase({ papers: [known()] });
    const list = await callTool(baseEnv(), 'paper_list', {});
    assert.equal(list.isError, true);
    assert.equal(list.body.code, 'ADMIN_ONLY');
    const save = await callTool(baseEnv(), 'paper_save', { papers: [{ title: 'X' }], confirm: true });
    assert.equal(save.body.code, 'ADMIN_ONLY');
    assert.equal(db.tables.research_papers.length, 1);
  });

  it('finds papers by DOI in any letter case, updates only the given fields, and links templates that exist', async () => {
    db = fakeSupabase({ admins: ADMIN, templates: TEMPLATES, papers: [known({ doi: '10.1007/978-3-319-46448-0_12' })] });
    const res = await callTool(baseEnv(), 'paper_save', {
      confirm: true,
      papers: [
        { doi: 'https://doi.org/10.1007/978-3-319-46448-0_12', templateId: '2014-naik-streetscore' },
        { doi: '10.1109/CVPRW.2014.121', title: 'Streetscore', authors: ['N. Naik'], year: 2014, status: 'approved', templateId: '2014-naik-streetscore' },
        { title: 'Unlinked', templateId: 'no-such-template' },
        { doi: 'nope', title: 'Bad' },
      ],
    });
    assert.equal(res.isError, false, JSON.stringify(res.body));
    assert.deepEqual(res.body.results.map((r) => r.result), ['updated', 'inserted', 'error', 'error']);
    assert.match(res.body.results[2].error, /No template/);
    const [old, added] = db.tables.research_papers;
    assert.equal(old.template_id, '2014-naik-streetscore');
    assert.equal(old.title, 'Deep Learning the City');
    assert.equal(old.status, 'approved');
    assert.equal(added.doi, '10.1109/cvprw.2014.121');
    assert.equal(added.status, 'approved');
    assert.equal(added.reviewed_by, 'u1');
    assert.equal(added.paper_url, 'https://doi.org/10.1109/cvprw.2014.121');
    assert.ok(added.analysis_meta && typeof added.analysis_meta === 'object');

    const list = await callTool(baseEnv(), 'paper_list', { linked: true });
    assert.equal(list.body.count, 2);
    const search = await callTool(baseEnv(), 'paper_list', { search: 'streetscore' });
    assert.deepEqual(search.body.papers.map((p) => p.title), ['Streetscore']);
  });

  it('starts new papers as candidates and needs confirm', async () => {
    db = fakeSupabase({ admins: ADMIN });
    const unconfirmed = await callTool(baseEnv(), 'paper_save', { papers: [{ title: 'New study' }] });
    assert.match(unconfirmed.body.error, /confirm:true/);
    const res = await callTool(baseEnv(), 'paper_save', { confirm: true, papers: [{ title: 'New study', year: 2026 }] });
    assert.equal(res.body.inserted, 1);
    assert.equal(db.tables.research_papers[0].status, 'candidate');
    assert.equal(db.tables.research_papers[0].reviewed_by, undefined);
  });

  it('saves reviewed facets, keeps them when the abstract changes, and lists them for tagging', async () => {
    db = fakeSupabase({ admins: ADMIN, papers: [known(), known({ id: 'p2', doi: '10.1/other', title: 'Other' })] });
    const bad = await callTool(baseEnv(), 'paper_save', { confirm: true, papers: [{ id: 'p1', facets: { task: ['guessing'] } }] });
    assert.match(bad.body.results[0].error, /task: "guessing"/);
    const res = await callTool(baseEnv(), 'paper_save', {
      confirm: true,
      papers: [{ id: 'p1', facets: { survey: 'yes', task: ['pairwise'], modality: ['street_view'], concept: ['safety'], participants: ['crowd'], sample: ['gt1000'], country: ['USA'], city: ['Boston'] } }],
    });
    assert.equal(res.body.updated, 1, JSON.stringify(res.body));
    const saved = db.tables.research_papers[0].analysis_meta.facets;
    assert.deepEqual(saved.task, ['pairwise']);
    assert.equal(saved.reviewed_by, 'u1');
    assert.ok(saved.reviewed_at);

    await callTool(baseEnv(), 'paper_save', { confirm: true, papers: [{ id: 'p1', abstract: 'Street view images rated in pairs by 5000 online volunteers.' }] });
    assert.deepEqual(db.tables.research_papers[0].analysis_meta.facets.city, ['Boston']);

    const todo = await callTool(baseEnv(), 'paper_list', { reviewed: false, detail: true });
    assert.deepEqual(todo.body.papers.map((p) => p.id), ['p2']);
    assert.equal(todo.body.papers[0].facets.reviewed, false);
    assert.equal(typeof todo.body.papers[0].abstract, 'string');
    const done = await callTool(baseEnv(), 'paper_list', { reviewed: true, detail: true });
    assert.deepEqual(done.body.papers[0].facets.country, ['USA']);

    await callTool(baseEnv(), 'paper_save', { confirm: true, papers: [{ id: 'p1', facets: null }] });
    assert.equal(db.tables.research_papers[0].analysis_meta.facets, undefined);
  });

  it('will not move a DOI onto another paper', async () => {
    db = fakeSupabase({ admins: ADMIN, papers: [known(), known({ id: 'p2', doi: '10.1/other', title: 'Other' })] });
    const res = await callTool(baseEnv(), 'paper_save', { confirm: true, papers: [{ id: 'p2', doi: '10.1007/978-3-319-46448-0_12' }] });
    assert.equal(res.body.results[0].result, 'error');
    assert.match(res.body.results[0].error, /already belongs/);
    assert.equal(db.tables.research_papers[1].doi, '10.1/other');
  });
});

describe('weekly paper scan', () => {
  it('adds only new papers with a DOI, as candidates, and logs the scan', async () => {
    db = fakeSupabase({ papers: [known()] });
    const queries = [];
    const search = async ({ query, yearFrom, yearTo }) => {
      queries.push({ query, yearFrom, yearTo });
      return {
        sourcesUsed: ['crossref'],
        errors: [],
        papers: [
          { doi: '10.1007/978-3-319-46448-0_12', title: 'Deep Learning the City', year: 2016 },
          { doi: '10.5555/NEW.1', title: 'A new perception survey', year: 2026, sources: ['crossref'], relevance_score: 3 },
          { title: 'No DOI', year: 2026 },
        ],
      };
    };
    const result = await runWeeklyPaperScan(baseEnv(), { now: new Date('2026-11-30T01:00:00Z'), search });
    assert.equal(queries.length > 1, true);
    const recent = queries.filter((q) => q.yearTo === null);
    assert.equal(recent.length > 1, true);
    assert.ok(recent.every((q) => q.yearFrom === 2025));
    // Backfill starts two years back, one year only.
    const older = queries.filter((q) => q.yearTo !== null);
    assert.equal(older.length, recent.length);
    assert.ok(older.every((q) => q.yearFrom === 2024 && q.yearTo === 2024));
    assert.equal(result.backfill.year, 2024);
    assert.equal(result.found, 2);
    assert.equal(result.added, 1);
    assert.equal(result.known, 1);
    const added = db.tables.research_papers.find((p) => p.doi === '10.5555/new.1');
    assert.equal(added.status, 'candidate');
    assert.deepEqual(added.sources, ['weekly_scan', 'crossref']);
    assert.equal(added.scan_id, result.scanId);
    assert.equal(db.tables.research_papers.find((p) => p.id === 'p1').status, 'approved');
    assert.equal(db.tables.research_paper_scans[0].preset, 'weekly');
    assert.equal(db.tables.research_paper_scans[1].preset, 'backfill');
    assert.equal(db.tables.research_paper_scans[1].year_from, 2024);
  });

  it('walks the backfill back one year per run and stops at the first year', async () => {
    const now = new Date('2026-11-30T01:00:00Z');
    db = fakeSupabase({ papers: [], extraTables: { research_paper_scans: [
      { id: 's1', preset: 'weekly', year_from: 2025, hit_count: 5 },
      { id: 's2', preset: 'backfill', year_from: 2024, hit_count: 7 },
      { id: 's3', preset: 'backfill', year_from: 2023, hit_count: 0, error_summary: 'crossref: timeout' },
    ] } });
    // 2023 failed completely, so it is tried again.
    assert.equal(await nextBackfillYear(baseEnv(), now), 2023);
    db.tables.research_paper_scans.push({ id: 's4', preset: 'backfill', year_from: 2023, hit_count: 3 });
    assert.equal(await nextBackfillYear(baseEnv(), now), 2022);
    db.tables.research_paper_scans.push({ id: 's5', preset: 'backfill', year_from: BACKFILL_FIRST_YEAR, hit_count: 1 });
    assert.equal(await nextBackfillYear(baseEnv(), now), null);
  });
});

describe('news_save and wiki_submit', () => {
  const extraTables = () => ({
    news_posts: [{ id: 'n1', slug: 'city-talk', title_en: 'City Talk', status: 'published', body_en: 'x'.repeat(30) }],
    wiki_pages: [{ page_key: 'community-abc', language: 'en', title: 'Old', summary: '', body: 'old body text here', revision: 2 }],
    wiki_builtin_pages: [{ page_key: '2014-naik-streetscore', is_template: true }],
    content_submissions: [],
    content_submission_events: [],
  });
  const BODY = 'A new template rebuilds Streetscore with pairwise safety comparisons.';

  it('saves news as a draft, updates the same draft, and changes a published post only when confirmed', async () => {
    db = fakeSupabase({ admins: ADMIN, extraTables: extraTables() });
    const denied = await callTool(baseEnv(), 'news_save', { titleEn: 'X', bodyEn: BODY, confirm: true }, { userId: 'u2' });
    assert.equal(denied.body.code, 'ADMIN_ONLY');
    const first = await callTool(baseEnv(), 'news_save', { titleEn: 'New template: Streetscore', bodyEn: BODY, titleZh: '新模板', confirm: true });
    assert.equal(first.isError, false, JSON.stringify(first.body));
    assert.equal(first.body.slug, 'new-template-streetscore');
    assert.equal(first.body.status, 'draft');
    const again = await callTool(baseEnv(), 'news_save', { slug: 'new-template-streetscore', titleEn: 'New template: Streetscore', bodyEn: `${BODY} Updated.`, confirm: true });
    assert.equal(again.body.result, 'updated');
    assert.equal(db.tables.news_posts.length, 2);
    assert.equal(db.tables.news_posts[1].content_format, 'markdown');

    const live = await callTool(baseEnv(), 'news_save', { slug: 'city-talk', titleEn: 'City Talk', bodyEn: BODY, confirm: true });
    assert.equal(live.body.code, 'NOT_A_DRAFT');
    const confirmed = await callTool(baseEnv(), 'news_save', { id: 'n1', titleEn: 'City Talk', bodyEn: BODY, confirmLive: true, confirm: true });
    assert.equal(confirmed.body.status, 'published');
    assert.equal(db.tables.news_posts[0].body_en, BODY);
    assert.equal(db.tables.news_posts[0].slug, 'city-talk');
  });

  it('saves wiki pages and edits as pending submissions, and revises a waiting one', async () => {
    db = fakeSupabase({ admins: ADMIN, extraTables: extraTables() });
    const reason = 'New template published this week.';
    const created = await callTool(baseEnv(), 'wiki_submit', { language: 'en', title: 'Streetscore guide', body: BODY, changeReason: reason, templateId: '2014-naik-streetscore', confirm: true });
    assert.equal(created.isError, false, JSON.stringify(created.body));
    assert.equal(created.body.kind, 'doc_new');
    const row = db.tables.content_submissions[0];
    assert.equal(row.status, undefined); // the database default is pending
    assert.equal(row.target_key, `community-${row.id}`);
    assert.equal(row.template_id, '2014-naik-streetscore');
    assert.equal(db.tables.content_submission_events.length, 1);

    const edit = await callTool(baseEnv(), 'wiki_submit', { language: 'en', pageKey: 'community-abc', title: 'Better', body: BODY, changeReason: reason, confirm: true });
    assert.equal(edit.body.kind, 'doc_edit');
    assert.equal(db.tables.content_submissions[1].base_revision, 2);
    assert.equal(db.tables.content_submissions[1].base_content.body, 'old body text here');

    db.tables.content_submissions[0].status = 'pending';
    db.tables.content_submissions[0].version = 1;
    const revised = await callTool(baseEnv(), 'wiki_submit', { language: 'en', submissionId: row.id, title: 'Streetscore guide v2', body: BODY, changeReason: reason, confirm: true });
    assert.equal(revised.isError, false, JSON.stringify(revised.body));
    assert.equal(db.tables.content_submissions[0].title, 'Streetscore guide v2');
    assert.equal(db.tables.content_submissions[0].version, 2);

    const missing = await callTool(baseEnv(), 'wiki_submit', { language: 'zh', pageKey: 'nope', title: 'Nope', body: BODY, changeReason: reason, confirm: true });
    assert.equal(missing.isError, true);
    const listed = await callTool(baseEnv(), 'wiki_list', {});
    assert.equal(listed.body.pages.length, 1);
    assert.deepEqual(listed.body.builtinPageKeys, ['2014-naik-streetscore']);
  });
});

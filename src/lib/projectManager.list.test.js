// The project list reads light columns only; opening a project reads the whole row.
const mockCalls = [];
let mockFailLight = false;

function mockQuery(table) {
  const call = { table, select: null, filters: [] };
  mockCalls.push(call);
  const q = {
    select(cols) { call.select = cols; return q; },
    eq(col, val) { call.filters.push(['eq', col, val]); return q; },
    in(col, val) { call.filters.push(['in', col, val]); return q; },
    or(expr) { call.filters.push(['or', expr]); return q; },
    order() { return q; },
    maybeSingle() {
      const r = mockResult(call);
      return Promise.resolve({ data: r.data ? r.data[0] : null, error: r.error });
    },
    then(resolve, reject) { return Promise.resolve(mockResult(call)).then(resolve, reject); },
  };
  return q;
}

function mockResult(call) {
  if (call.table === 'project_collaborators') return { data: [], error: null };
  if (call.select === '*') {
    return { data: [{ id: 'p1', user_id: 'u1', name: 'Full', survey_config_draft: { pages: [], spSite: { html: '<p>x</p>' } } }], error: null };
  }
  if (mockFailLight) return { data: null, error: { message: 'column projects.public_slug does not exist' } };
  if (call.select === 'id') return { data: [{ id: 'p1' }], error: null };
  return {
    data: [
      {
        id: 'p1', user_id: 'u1', name: 'Page study', updated_at: '2026-11-27T00:00:00Z',
        published_version: 2, release_managed: true, meta_author: 'Zhao et al.', meta_tags: ['a'],
        draft_pages: [{ name: 'start', elements: [{ name: 'q' }] }], live_pages: null,
      },
      { id: 'p2', user_id: 'u1', name: 'Empty', draft_pages: null, live_pages: null },
    ],
    error: null,
  };
}

jest.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table) => mockQuery(table),
  },
}));

const { getUserProjects, getFullProject, SUMMARY_PAGE_HTML } = require('./projectManager');
const { projectKind } = require('./studioProject');
const { countCollectingSurveys } = require('./collectingSurveys');

beforeEach(() => { mockCalls.length = 0; mockFailLight = false; });

test('lists projects without reading configs, page HTML or media lists', async () => {
  const projects = await getUserProjects();
  const projectCalls = mockCalls.filter((c) => c.table === 'projects');
  expect(projectCalls.map((c) => c.select)).not.toContain('*');
  const light = projectCalls.find((c) => c.select !== 'id');
  expect(light.select).not.toMatch(/(^|,)(survey_config|survey_config_draft|survey_config_published|preloaded_images|metadata|image_dataset_config)(,|$)/);
  expect(light.filters).toContainEqual(['eq', 'user_id', 'u1']);

  const [page, empty] = projects;
  expect(page._summary).toBe(true);
  expect(page._surveyConfig.spSite.html).toBe(SUMMARY_PAGE_HTML);
  expect(projectKind(page)).toBe('page');
  expect(projectKind(empty)).toBe('empty');
  expect(page.author).toBe('Zhao et al.');
  expect(page.tags).toEqual(['a']);
  expect(page.preloadedImages).toEqual([]);
  expect(countCollectingSurveys(projects, { userId: 'u1' })).toBe(1);
});

test('falls back to full rows when the light query fails', async () => {
  mockFailLight = true;
  const projects = await getUserProjects();
  expect(projects).toHaveLength(1);
  expect(projects[0]._summary).toBeUndefined();
  expect(projects[0]._surveyConfig.spSite.html).toBe('<p>x</p>');
});

test('getFullProject reads the whole row for a list row only', async () => {
  const plain = { id: 'p9', name: 'already full' };
  expect(await getFullProject(plain)).toBe(plain);
  const full = await getFullProject({ id: 'p1', _summary: true, accessRole: 'collaborator' });
  expect(full._summary).toBeUndefined();
  expect(full.accessRole).toBe('collaborator');
});

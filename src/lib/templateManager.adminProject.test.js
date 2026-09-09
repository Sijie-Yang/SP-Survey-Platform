import { supabase } from './supabase';
import { listAllProjects, updateProjectAdmin } from './templateManager';

jest.mock('./supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('./r2', () => ({}));

function mockProjectQuery(result) {
  const query = {};
  ['update', 'eq', 'is', 'select', 'order'].forEach(method => {
    query[method] = jest.fn(() => query);
  });
  query.maybeSingle = jest.fn().mockResolvedValue(result);
  supabase.from.mockReturnValue(query);
  return query;
}

beforeEach(() => jest.clearAllMocks());

test('admin overview reads the same draft config as participant links', async () => {
  const query = mockProjectQuery({});
  const current = { locale: 'zh', pages: [] };
  query.order.mockResolvedValue({ data: [{
    id: 'project', survey_config: { locale: 'en' }, survey_config_draft: current,
    draft_updated_at: '2026-09-09T12:00:00.000Z',
  }], error: null });
  const [project] = await listAllProjects();
  expect(project.config).toEqual(current);
  expect(project.draftUpdatedAt).toBe('2026-09-09T12:00:00.000Z');
});

test('legacy projects without a draft still load their saved config', async () => {
  const query = mockProjectQuery({});
  query.order.mockResolvedValue({ data: [{
    id: 'legacy', survey_config: { locale: 'zh' }, survey_config_draft: null,
  }], error: null });
  expect((await listAllProjects())[0].config.locale).toBe('zh');
});

test('admin survey saves update the participant draft and legacy config together', async () => {
  const query = mockProjectQuery({ data: { id: 'project' }, error: null });
  const config = { locale: 'zh', pages: [{ name: 'original', elements: [] }] };
  const version = '2026-09-09T12:00:00.000Z';
  await updateProjectAdmin('project', { survey_config: config }, { expectedDraftUpdatedAt: version });
  const saved = query.update.mock.calls[0][0];
  expect(saved.survey_config).toEqual(config);
  expect(saved.survey_config_draft).toEqual(config);
  expect(saved.draft_updated_at).toBe(saved.updated_at);
  expect(saved.last_writer.source).toBe('admin');
  expect(query.eq).toHaveBeenCalledWith('draft_updated_at', version);
  expect(saved).not.toHaveProperty('user_id');
  expect(saved).not.toHaveProperty('survey_config_published');
});

test('metadata edits leave survey revisions untouched', async () => {
  const query = mockProjectQuery({ data: { id: 'project' }, error: null });
  await updateProjectAdmin('project', { name: 'Renamed' });
  const saved = query.update.mock.calls[0][0];
  expect(saved.name).toBe('Renamed');
  expect(saved).not.toHaveProperty('survey_config_draft');
  expect(saved).not.toHaveProperty('draft_updated_at');
});

test('a stale or unauthorized save fails instead of reporting success', async () => {
  const query = mockProjectQuery({ data: null, error: null });
  await expect(updateProjectAdmin('project', { survey_config: { locale: 'zh' } }, {
    expectedDraftUpdatedAt: null,
  })).rejects.toThrow('保存失败');
  expect(query.is).toHaveBeenCalledWith('draft_updated_at', null);
});

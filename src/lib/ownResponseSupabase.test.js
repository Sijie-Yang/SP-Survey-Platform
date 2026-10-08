import { templateToBuiltinJson } from './templateManager';
import {
  DEFAULT_OWN_RESPONSE_TABLE,
  buildOwnResponseTableSql,
  settingsForSave,
  submitParticipantResponse,
} from './ownResponseSupabase';

jest.mock('./supabase', () => ({ supabase: null, saveSurveyResponse: jest.fn() }));
jest.mock('./r2', () => ({ isR2Configured: () => false }));

function jwt(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ role })}.sig`;
}

const payload = {
  project_id: 'proj_1',
  participant_id: 'p_1',
  language: 'en',
  responses: { q1: 4 },
  survey_metadata: { completion_code: 'code-1' },
  displayed_images: { q1: ['a.jpg'] },
};

const ownSink = {
  enabled: true,
  url: 'https://abcd.supabase.co/rest/v1/',
  anonKey: jwt('anon'),
  table: DEFAULT_OWN_RESPONSE_TABLE,
};

function jsonResponse({ ok = true, status = 201, body = '' } = {}) {
  return { ok, status, text: async () => body };
}

test('toggle off uses the platform insert and does not call fetch', async () => {
  const fetchImpl = jest.fn();
  const platformInsert = jest.fn(async () => ({ success: true, storage: 'supabase' }));
  const result = await submitParticipantResponse(payload, { enabled: false, url: ownSink.url, anonKey: ownSink.anonKey }, {
    fetchImpl,
    platformInsert,
  });
  expect(result).toEqual({ success: true, storage: 'supabase' });
  expect(platformInsert).toHaveBeenCalledWith(payload);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('toggle on posts the row to the researcher Supabase and skips the platform insert', async () => {
  const fetchImpl = jest.fn(async () => jsonResponse());
  const platformInsert = jest.fn();
  const result = await submitParticipantResponse({ ...payload, own_response_row_id: '11111111-1111-4111-8111-111111111111' }, ownSink, {
    fetchImpl,
    platformInsert,
  });
  expect(result.success).toBe(true);
  expect(result.storage).toBe('own-supabase');
  expect(platformInsert).not.toHaveBeenCalled();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe(`https://abcd.supabase.co/rest/v1/${DEFAULT_OWN_RESPONSE_TABLE}`);
  expect(init.method).toBe('POST');
  expect(init.headers.apikey).toBe(ownSink.anonKey);
  expect(init.headers.Authorization).toBe(`Bearer ${ownSink.anonKey}`);
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({
    id: '11111111-1111-4111-8111-111111111111',
    project_id: 'proj_1',
    participant_id: 'p_1',
    language: 'en',
    answers: { q1: 4 },
  });
  expect(body.metadata.survey_metadata.completion_code).toBe('code-1');
  expect(body.metadata.displayed_images).toEqual({ q1: ['a.jpg'] });
});

test('a failed researcher insert surfaces an error and does not fall back', async () => {
  const fetchImpl = jest.fn(async () => jsonResponse({ ok: false, status: 401, body: 'permission denied' }));
  const platformInsert = jest.fn();
  const result = await submitParticipantResponse(payload, ownSink, { fetchImpl, platformInsert });
  expect(result.success).toBe(false);
  expect(result.storage).toBe('own-supabase');
  expect(result.error.message).toMatch(/not saved on SP-Survey/i);
  expect(result.error.message).toMatch(/401/);
  expect(platformInsert).not.toHaveBeenCalled();
});

test('network failure and a service_role key do not call the platform insert', async () => {
  const fetchImpl = jest.fn(async () => { throw new Error('offline'); });
  const platformInsert = jest.fn();
  const offline = await submitParticipantResponse(payload, ownSink, { fetchImpl, platformInsert });
  expect(offline.success).toBe(false);
  expect(offline.error.message).toMatch(/network error/i);
  expect(platformInsert).not.toHaveBeenCalled();

  fetchImpl.mockClear();
  const refused = await submitParticipantResponse(payload, { ...ownSink, anonKey: jwt('service_role') }, {
    fetchImpl,
    platformInsert,
  });
  expect(refused.success).toBe(false);
  expect(refused.error.message).toMatch(/service_role/);
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(platformInsert).not.toHaveBeenCalled();
});

test('enabled settings reject an empty URL, http, and a service_role JWT', () => {
  expect(settingsForSave({ enabled: true, url: '', anonKey: jwt('anon') }).error).toBe('empty-url');
  expect(settingsForSave({ enabled: true, url: 'https://abcd.supabase.co', anonKey: '  ' }).error).toBe('empty-key');
  expect(settingsForSave({ enabled: true, url: 'http://abcd.supabase.co', anonKey: jwt('anon') }).error).toBe('https-only');
  expect(settingsForSave({ enabled: true, url: 'https://abcd.supabase.co', anonKey: jwt('service_role') }).error).toBe('service-role');
  const saved = settingsForSave({
    enabled: true,
    url: 'https://abcd.supabase.co/project/rest/v1',
    anonKey: jwt('anon'),
    table: '',
  });
  expect(saved.ok).toBe(true);
  expect(saved.value).toMatchObject({
    enabled: true,
    url: 'https://abcd.supabase.co',
    table: DEFAULT_OWN_RESPONSE_TABLE,
  });
  expect(settingsForSave({ enabled: false, url: '', anonKey: '' }).value).toEqual({ enabled: false });
});

test('researcher SQL is one insert-only table', () => {
  const { sql } = buildOwnResponseTableSql(DEFAULT_OWN_RESPONSE_TABLE);
  const lower = sql.toLowerCase();
  expect(lower).toContain('enable row level security');
  expect(lower).toContain('for insert');
  expect(lower).toContain('to anon');
  expect(lower).toContain('answers jsonb');
  expect(lower).toContain('metadata jsonb');
  expect(lower).toContain('participant_id text');
  expect(lower).toContain('language text');
  expect(lower).not.toMatch(/for\s+(select|update|delete)/);
  expect(buildOwnResponseTableSql('Bad-Name').ok).toBe(false);
});

test('template export strips the researcher Supabase URL and anon key', () => {
  const secretUrl = 'https://owned-responses.supabase.co';
  const secretKey = jwt('anon');
  const json = templateToBuiltinJson({
    id: '2025-yang-thermal',
    name: 'Thermal',
    config: {
      title: 'Thermal',
      ownResponseSupabase: { enabled: true, url: secretUrl, anonKey: secretKey, table: 'sp_survey_responses' },
      pages: [{ name: 'p1', elements: [{ type: 'text', name: 'q1' }] }],
    },
    imageDatasetConfig: {
      own_response_supabase: { url: secretUrl, anonKey: secretKey },
      mediaFolders: ['indoor'],
    },
    ownResponseSupabase: { url: secretUrl, anonKey: secretKey },
  });
  const packed = JSON.stringify(json);
  expect(packed).not.toContain(secretUrl);
  expect(packed).not.toContain(secretKey);
  expect(packed).not.toContain('ownResponseSupabase');
  expect(packed).not.toContain('own_response_supabase');
  expect(json.config.pages[0].elements[0].name).toBe('q1');
  expect(json.imageDatasetConfig.mediaFolders).toEqual(['indoor']);
});

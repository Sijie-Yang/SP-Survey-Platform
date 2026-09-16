import {
  AI_SIDEBAR_WIDTH,
  PROJECT_SIDEBAR_WIDTH,
  buildAssistantModelOptions,
  clearPendingRun,
  credentialConfigured,
  exclusiveSidebarOpen,
  hasAppliedSurveyChange,
  isStaleAssistantRequest,
  latestRunStatus,
  loadingStatusFromEvents,
  parseRoute,
  readPendingRun,
  readSessionId,
  readStoredRoute,
  readUndoSnapshot,
  resolveAssistantRoute,
  routeKey,
  sendBlockReason,
  workspaceChromeWidths,
  writePendingRun,
  writeSessionId,
  writeStoredRoute,
  writeUndoSnapshot,
} from './surveyAssistantUtils';

const directory = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    configured: true,
    models: [
      { id: 'gpt-4o', label: 'GPT-4o', reasoningEfforts: false },
    ],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    configured: true,
    models: [
      {
        id: 'reasoner',
        name: 'Reasoner',
        reasoningEfforts: { low: {}, high: {} },
        defaultEffort: 'high',
      },
    ],
  },
  {
    id: 'native',
    displayName: 'Native',
    configured: true,
    authUnsupported: true,
    models: [{ id: 'secret' }],
  },
];

describe('surveyAssistantUtils', () => {
  test('builds configured model options and skips native-auth providers', () => {
    expect(buildAssistantModelOptions(directory)).toEqual([
      {
        value: 'openai::gpt-4o',
        provider: 'openai',
        model: 'gpt-4o',
        label: 'OpenAI / GPT-4o',
        reasoningEfforts: false,
        defaultEffort: '',
      },
      {
        value: 'deepseek::reasoner',
        provider: 'deepseek',
        model: 'reasoner',
        label: 'DeepSeek / Reasoner',
        reasoningEfforts: { low: {}, high: {} },
        defaultEffort: 'high',
      },
    ]);
  });

  test('resolves stored route when still valid, otherwise defaultRoute', () => {
    expect(resolveAssistantRoute({
      directory,
      storedRoute: 'deepseek::reasoner',
      storedEffort: 'low',
    })).toMatchObject({ route: 'deepseek::reasoner', effort: 'low' });

    expect(resolveAssistantRoute({
      directory,
      storedRoute: 'deepseek::reasoner',
      storedEffort: 'medium',
    })).toMatchObject({ route: 'deepseek::reasoner', effort: 'high' });

    expect(resolveAssistantRoute({
      directory,
      storedRoute: 'gone::model',
      status: { defaultRoute: { provider: 'openai', model: 'gpt-4o', reasoningEffort: '' } },
    })).toMatchObject({ route: 'openai::gpt-4o' });
  });

  test('persists session, route, and undo snapshots per project', () => {
    const storage = new Map();
    const api = {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    };
    writeSessionId(api, 'p1', 'sess-1');
    writeStoredRoute(api, 'p1', 'openai::gpt-4o', 'low');
    writeUndoSnapshot(api, 'p1', { title: 'Before' });

    expect(readSessionId(api, 'p1')).toBe('sess-1');
    expect(readStoredRoute(api, 'p1')).toEqual({ route: 'openai::gpt-4o', effort: 'low' });
    expect(readUndoSnapshot(api, 'p1')).toEqual({ title: 'Before' });
    expect(readSessionId(api, 'p2')).toBe('');
    expect(readUndoSnapshot(api, 'p2')).toBeNull();
  });

  test('persists pending runs per project and reads the latest run status', () => {
    const storage = new Map();
    const api = {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    };
    writePendingRun(api, 'p1', { status: 'running', startedAt: 123, sessionId: 'sess-1' });
    expect(readPendingRun(api, 'p1')).toEqual({
      status: 'running',
      startedAt: 123,
      sessionId: 'sess-1',
    });
    expect(latestRunStatus([
      { type: 'run.status', payload: { status: 'running' } },
      { type: 'assistant.message', payload: { content: 'Done' } },
      { type: 'run.status', payload: { status: 'completed' } },
    ])).toBe('completed');
    expect(hasAppliedSurveyChange([
      { type: 'tool.result', payload: { name: 'survey_get_draft', ok: true } },
      { type: 'tool.result', payload: { name: 'survey_apply_operations', ok: true } },
    ])).toBe(true);
    clearPendingRun(api, 'p1');
    expect(readPendingRun(api, 'p1')).toBeNull();
  });

  test('derives visible run progress from lifecycle events', () => {
    expect(loadingStatusFromEvents([
      { type: 'run.status', payload: { status: 'running' } },
      { type: 'step.start', payload: { step: 1 } },
      { type: 'tool.call', payload: { id: 'call-1', name: 'survey_validate' } },
    ])).toBe('Using survey_validate…');
    expect(loadingStatusFromEvents([
      { type: 'run.status', payload: { status: 'awaiting_approval' } },
    ])).toBe('Waiting for your approval…');
    expect(loadingStatusFromEvents([
      { type: 'tool.call', payload: { id: 'verify', name: 'survey_get_draft', verification: true } },
    ])).toBe('Verifying saved draft…');
  });

  test('isolates stale assistant requests', () => {
    expect(isStaleAssistantRequest(
      { projectId: 'a', generation: 1 },
      { projectId: 'a', generation: 1 },
    )).toBe(false);
    expect(isStaleAssistantRequest(
      { projectId: 'a', generation: 1 },
      { projectId: 'b', generation: 1 },
    )).toBe(true);
    expect(isStaleAssistantRequest(
      { projectId: 'a', generation: 1 },
      { projectId: 'a', generation: 2 },
    )).toBe(true);
  });

  test('blocks send without a project, key, or model', () => {
    expect(sendBlockReason({ hasProject: false, apiKeyValid: true, platformMode: true })).toBe('no-project');
    expect(sendBlockReason({ hasProject: true, apiKeyValid: false, platformMode: true })).toBe('no-key');
    expect(sendBlockReason({
      hasProject: true,
      apiKeyValid: true,
      platformMode: true,
      routeUnavailable: 'missing',
    })).toBe('no-model');
    expect(sendBlockReason({
      hasProject: true,
      apiKeyValid: true,
      platformMode: true,
      routeUnavailable: '',
    })).toBe('');
  });

  test('treats directory/providers as configured credentials', () => {
    expect(credentialConfigured({ configuredProviders: ['openai'] })).toBe(true);
    expect(credentialConfigured({ providers: [{ key_hint: 'sk-…abcd' }] })).toBe(true);
    expect(credentialConfigured({})).toBe(false);
  });

  test('desktop workspace reserves both sidebars; mobile AI overlays', () => {
    expect(workspaceChromeWidths({ projectOpen: true, aiOpen: true, isDesktop: true })).toEqual({
      left: PROJECT_SIDEBAR_WIDTH,
      right: AI_SIDEBAR_WIDTH,
    });
    expect(workspaceChromeWidths({ projectOpen: true, aiOpen: true, isDesktop: false })).toEqual({
      left: PROJECT_SIDEBAR_WIDTH,
      right: 0,
    });
    expect(exclusiveSidebarOpen({ isDesktop: false, otherIsOpen: true })).toEqual({ otherOpen: false });
    expect(exclusiveSidebarOpen({ isDesktop: true, otherIsOpen: true })).toEqual({ otherOpen: true });
  });

  test('parses provider/model route keys', () => {
    expect(routeKey('openai', 'gpt-4o')).toBe('openai::gpt-4o');
    expect(parseRoute('openai::gpt-4o')).toEqual({ provider: 'openai', model: 'gpt-4o' });
    expect(parseRoute('')).toEqual({ provider: '', model: '' });
  });
});

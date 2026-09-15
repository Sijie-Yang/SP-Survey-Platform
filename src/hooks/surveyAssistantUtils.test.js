import {
  AI_SIDEBAR_WIDTH,
  PROJECT_SIDEBAR_WIDTH,
  buildAssistantModelOptions,
  credentialConfigured,
  exclusiveSidebarOpen,
  isStaleAssistantRequest,
  parseRoute,
  readSessionId,
  readStoredRoute,
  readUndoSnapshot,
  resolveAssistantRoute,
  routeKey,
  sendBlockReason,
  workspaceChromeWidths,
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

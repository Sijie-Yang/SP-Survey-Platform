import { act, renderHook, waitFor } from '@testing-library/react';
import useSurveyAssistant from './useSurveyAssistant';
import * as conversationHistory from '../lib/conversationHistory';

jest.mock('../lib/conversationHistory', () => {
  const historyStore = new Map();
  return {
    getConversationHistory: (projectId) => {
      if (!historyStore.has(projectId)) historyStore.set(projectId, []);
      const history = historyStore.get(projectId);
      return {
        addMessage: (role, content, metadata = {}) => {
          history.push({
            id: `${role}-${history.length}`,
            role,
            content,
            timestamp: new Date().toISOString(),
            metadata,
          });
        },
        getAllMessages: () => [...history],
        getFormattedForOpenAI: () => history.map((msg) => ({ role: msg.role, content: msg.content })),
        clear: () => { history.length = 0; },
        export: () => [...history],
      };
    },
    __resetHistory: () => historyStore.clear(),
  };
});

jest.mock('../lib/workingMemory', () => ({
  getWorkingMemory: () => ({
    getContextForAI: () => 'working',
    setSurveyGoal: jest.fn(),
    addIteration: jest.fn(),
    addDesignDecision: jest.fn(),
    export: () => ({}),
    clear: jest.fn(),
  }),
}));

jest.mock('../lib/sessionLearning', () => ({
  getSessionLearning: () => ({
    getRecommendations: () => [],
    getContextForAI: () => 'session',
    recordProjectInteraction: jest.fn(),
    export: () => ({}),
  }),
}));

const mockSendChatMessage = jest.fn();
jest.mock('../lib/chatApi', () => ({
  sendChatMessage: (...args) => mockSendChatMessage(...args),
  validateChatApiKey: jest.fn(),
  triggerMultiAgentReviewStream: jest.fn(),
}));

jest.mock('../lib/designProtocol', () => ({
  postProcessAiConfig: (config) => config,
}));

const mockSaveAiSettings = jest.fn();
jest.mock('../lib/agentApi', () => ({
  saveAiSettings: (...args) => mockSaveAiSettings(...args),
  getCredentialStatus: jest.fn(),
}));

const directory = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    configured: true,
    models: [{ id: 'gpt-4o', label: 'GPT-4o' }],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    configured: true,
    models: [{ id: 'reasoner', label: 'Reasoner', reasoningEfforts: { low: {}, high: {} }, defaultEffort: 'high' }],
  },
];

function project(id) {
  return { id, name: id, category: 'general' };
}

describe('useSurveyAssistant', () => {
  beforeEach(() => {
    conversationHistory.__resetHistory();
    mockSendChatMessage.mockReset();
    mockSaveAiSettings.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    process.env.REACT_APP_SUPABASE_URL = 'https://example.supabase.co';
  });

  afterEach(() => {
    delete process.env.REACT_APP_SUPABASE_URL;
    jest.useRealTimers();
  });

  test('restores session, route, and undo snapshot when switching projects', async () => {
    sessionStorage.setItem('ai_session_p1', 'sess-p1');
    sessionStorage.setItem('ai_route_p1', JSON.stringify({ route: 'deepseek::reasoner', effort: 'low' }));
    sessionStorage.setItem('ai_undo_p1', JSON.stringify({ title: 'Before P1' }));
    sessionStorage.setItem('ai_session_p2', 'sess-p2');
    sessionStorage.setItem('ai_route_p2', JSON.stringify({ route: 'openai::gpt-4o', effort: '' }));

    const onChange = jest.fn();
    const { result, rerender } = renderHook(
      ({ currentProject }) => useSurveyAssistant({
        currentProject,
        surveyConfig: { title: 'Live' },
        onSurveyConfigChange: onChange,
      }),
      { initialProps: { currentProject: project('p2') } },
    );

    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai', 'deepseek'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });

    expect(result.current.selectedRoute).toBe('openai::gpt-4o');
    expect(result.current.aiUndoAvailable).toBe(false);

    rerender({ currentProject: project('p1') });

    await waitFor(() => {
      expect(result.current.selectedRoute).toBe('deepseek::reasoner');
    });
    expect(result.current.selectedEffort).toBe('low');
    expect(result.current.aiUndoAvailable).toBe(true);

    act(() => {
      result.current.handleRevertAiChange();
    });
    expect(onChange).toHaveBeenCalledWith({ title: 'Before P1' });
    expect(result.current.aiUndoAvailable).toBe(false);
    expect(sessionStorage.getItem('ai_undo_p1')).toBeNull();
  });

  test('ignores a late response after the user switches projects', async () => {
    jest.useFakeTimers();
    let resolveSend;
    mockSendChatMessage.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
    const onChange = jest.fn();
    const { result, rerender } = renderHook(
      ({ currentProject, surveyConfig }) => useSurveyAssistant({
        currentProject,
        surveyConfig,
        onSurveyConfigChange: onChange,
      }),
      { initialProps: { currentProject: project('p1'), surveyConfig: { title: 'A' } } },
    );

    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });

    act(() => {
      result.current.setUserMessage('rewrite this survey');
    });

    let pending;
    act(() => {
      pending = result.current.handleSendMessage();
    });
    expect(mockSendChatMessage).toHaveBeenCalled();

    rerender({ currentProject: project('p2'), surveyConfig: { title: 'B' } });

    await act(async () => {
      resolveSend({
        success: true,
        message: 'done',
        intent: 'adjust',
        sessionId: 'late-session',
        surveyConfig: { title: 'Hijacked' },
      });
      jest.advanceTimersByTime(600);
      await pending;
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('ai_session_p2')).toBeFalsy();
    expect(result.current.messages.some((msg) => msg.content === 'done')).toBe(false);
    jest.useRealTimers();
  });

  test('updates survey config after a successful send', async () => {
    mockSendChatMessage.mockResolvedValue({
      success: true,
      message: 'Updated',
      intent: 'adjust',
      sessionId: 'sess-new',
      surveyConfig: { title: 'After AI' },
      draftUpdatedAt: '2026-09-15T06:00:00.000Z',
    });
    const onChange = jest.fn();
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Before AI' },
      onSurveyConfigChange: onChange,
    }));

    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });
    act(() => result.current.setUserMessage('make it shorter'));
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(onChange).toHaveBeenCalledWith(
      { title: 'After AI' },
      {
        persisted: true,
        draftUpdatedAt: '2026-09-15T06:00:00.000Z',
        source: 'assistant',
      },
    );
    expect(sessionStorage.getItem('ai_session_p1')).toBe('sess-new');
    expect(result.current.aiUndoAvailable).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('ai_undo_p1'))).toEqual({ title: 'Before AI' });
    expect(mockSendChatMessage).toHaveBeenCalledWith(
      'make it shorter',
      { title: 'Before AI' },
      expect.any(Array),
      '',
      false,
      '1v1',
      null,
      {},
      expect.objectContaining({
        projectId: 'p1',
        provider: 'openai',
        model: 'gpt-4o',
      }),
    );
  });

  test('keeps the current session route when saving the default model fails', async () => {
    mockSaveAiSettings.mockRejectedValue(new Error('conflict'));
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));

    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai', 'deepseek'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });

    await act(async () => {
      result.current.handleAssistantRouteChange('deepseek::reasoner');
    });

    expect(result.current.selectedRoute).toBe('deepseek::reasoner');
    expect(result.current.selectedEffort).toBe('high');
    expect(JSON.parse(sessionStorage.getItem('ai_route_p1'))).toEqual({
      route: 'deepseek::reasoner',
      effort: 'high',
    });
  });

  test('does not send when no project is selected', async () => {
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: null,
      surveyConfig: { title: 'None' },
      onSurveyConfigChange: jest.fn(),
    }));
    act(() => result.current.setUserMessage('hello'));
    await act(async () => {
      await result.current.handleSendMessage();
    });
    expect(mockSendChatMessage).not.toHaveBeenCalled();
    expect(result.current.blockReason).toBe('no-project');
  });
});

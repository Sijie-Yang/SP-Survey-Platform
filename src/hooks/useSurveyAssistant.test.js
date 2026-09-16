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
        replaceMessages: (messages) => {
          history.splice(0, history.length, ...messages);
          return [...history];
        },
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
const mockTriggerMultiAgentReviewStream = jest.fn();
jest.mock('../lib/chatApi', () => ({
  sendChatMessage: (...args) => mockSendChatMessage(...args),
  validateChatApiKey: jest.fn(),
  triggerMultiAgentReviewStream: (...args) => mockTriggerMultiAgentReviewStream(...args),
}));

jest.mock('../lib/designProtocol', () => ({
  postProcessAiConfig: (config) => config,
}));

const mockSaveAiSettings = jest.fn();
const mockListAiSessions = jest.fn();
const mockGetAiSession = jest.fn();
jest.mock('../lib/agentApi', () => ({
  saveAiSettings: (...args) => mockSaveAiSettings(...args),
  getCredentialStatus: jest.fn(),
  listAiSessions: (...args) => mockListAiSessions(...args),
  getAiSession: (...args) => mockGetAiSession(...args),
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
    mockTriggerMultiAgentReviewStream.mockReset();
    mockSaveAiSettings.mockReset();
    mockListAiSessions.mockReset();
    mockGetAiSession.mockReset();
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

  test('restores a running indicator and messages after refresh', async () => {
    jest.useFakeTimers();
    sessionStorage.setItem('ai_pending_run_p1', JSON.stringify({
      status: 'running',
      startedAt: Date.now(),
      sessionId: 'sess-p1',
    }));
    mockGetAiSession
      .mockResolvedValueOnce({
        events: [{ type: 'run.status', payload: { status: 'running' } }],
        messages: [{ role: 'assistant', content: 'Working…' }],
      })
      .mockResolvedValueOnce({
        events: [{ type: 'run.status', payload: { status: 'completed' } }],
        messages: [{ role: 'assistant', content: 'Done.' }],
      });

    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));

    await act(async () => {});
    expect(result.current.isLoading).toBe(true);
    expect(result.current.loadingStatus).toMatch(/Continuing/);

    await act(async () => {
      jest.advanceTimersByTime(1600);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.messages).toEqual([{ role: 'assistant', content: 'Done.' }]);
    expect(sessionStorage.getItem('ai_pending_run_p1')).toBeNull();
    jest.useRealTimers();
  });

  test('restores the latest hosted conversation after a completed-page refresh', async () => {
    sessionStorage.setItem('ai_session_p1', 'sess-p1');
    mockGetAiSession.mockResolvedValue({
      events: [{ type: 'run.status', payload: { status: 'completed' } }],
      messages: [
        { id: 'event-1', role: 'user', content: 'Design a survey' },
        { id: 'event-2', role: 'assistant', content: 'Survey saved.' },
      ],
    });

    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        { id: 'event-1', role: 'user', content: 'Design a survey' },
        { id: 'event-2', role: 'assistant', content: 'Survey saved.' },
      ]);
    });
    expect(mockGetAiSession).toHaveBeenCalledWith('sess-p1');
  });

  test('streams hosted snapshots into the conversation while a run is in progress', async () => {
    let extras;
    mockSendChatMessage.mockImplementation((...args) => {
      extras = args[8];
      return new Promise(() => {});
    });
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));
    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });
    act(() => result.current.setUserMessage('Generate a safety survey'));
    await act(async () => {
      result.current.handleSendMessage();
    });
    await act(async () => {
      extras.onSnapshot({
        events: [
          { type: 'run.status', payload: { status: 'running' } },
          { type: 'tool.call', payload: { id: '1', name: 'survey_apply_operations' } },
        ],
        messages: [
          { id: 'u1', role: 'user', content: 'Generate a safety survey' },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            tools: [{ id: '1', name: 'survey_apply_operations', status: 'running' }],
          },
        ],
        run: { id: 'run-1', status: 'running' },
      });
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.loadingStatus).toBe('Using survey_apply_operations…');
    expect(result.current.messages[1].tools[0]).toEqual({
      id: '1',
      name: 'survey_apply_operations',
      status: 'running',
    });
  });

  test('keeps conversation display persistence when context enrichment is disabled', async () => {
    localStorage.setItem('contextEnabled_p1', 'false');
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));
    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });
    act(() => result.current.setUserMessage('remember this message'));
    mockSendChatMessage.mockResolvedValue({
      success: true,
      message: 'Remembered.',
      intent: 'question',
      sessionId: 'sess-p1',
    });
    await act(async () => {
      await result.current.handleSendMessage();
    });
    expect(result.current.messages.map((message) => message.content)).toEqual([
      'remember this message',
      'Remembered.',
    ]);
  });

  test('persists the project mode and sends it to the hosted assistant', async () => {
    localStorage.setItem('assistantMode_p1', 'generate');
    mockSendChatMessage.mockResolvedValue({
      success: true,
      message: 'Answer only.',
      intent: 'question',
      assistantMode: 'question',
      sessionId: 'sess-p1',
    });
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));

    expect(result.current.assistantMode).toBe('generate');
    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });
    act(() => {
      result.current.handleAssistantModeChange('question');
      result.current.setUserMessage('Explain the current survey');
    });
    await waitFor(() => {
      expect(localStorage.getItem('assistantMode_p1')).toBe('question');
    });
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(mockSendChatMessage.mock.calls[0][8]).toEqual(expect.objectContaining({
      projectId: 'p1',
      assistantMode: 'question',
    }));
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

  test('does not expose the legacy multi-agent path to the hosted runtime', async () => {
    mockSendChatMessage.mockResolvedValue({
      success: true,
      message: 'Updated',
      intent: 'adjust',
      sessionId: 'sess-new',
      surveyConfig: { title: 'After AI' },
    });
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Before AI' },
      onSurveyConfigChange: jest.fn(),
    }));

    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });
    act(() => {
      result.current.setMultiAgentReviewEnabled(true);
      result.current.setUserMessage('review this survey');
    });
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(mockSendChatMessage.mock.calls[0][4]).toBe(false);
    expect(mockTriggerMultiAgentReviewStream).not.toHaveBeenCalled();
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

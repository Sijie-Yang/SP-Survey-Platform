import {
  cancelAiRun,
  sendAgentChat,
  steerAiSession,
} from './agentApi';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { access_token: 'test-token' } },
      })),
    },
  },
}));

const originalFetch = global.fetch;

function jsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
  });
}

describe('Agent API asynchronous runs', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  test('starts a run and resolves it from the server-backed session', async () => {
    global.fetch
      .mockImplementationOnce(() => jsonResponse({
        success: true,
        queued: true,
        sessionId: 'session-1',
        runId: 'run-1',
        assistantMode: 'generate',
      }, 202))
      .mockImplementationOnce(() => jsonResponse({
        success: true,
        run: {
          id: 'run-1',
          status: 'completed',
          result: {
            assistantMode: 'generate',
            intent: 'generate',
            message: 'Saved.',
            draftUpdatedAt: 'v2',
            draftMutated: true,
            persisted: true,
          },
        },
        events: [],
        messages: [{ role: 'assistant', content: 'Saved.' }],
      }));
    const onStarted = jest.fn();

    const result = await sendAgentChat({
      message: 'Generate a survey',
      projectId: 'project-1',
      assistantMode: 'generate',
      onStarted,
    });

    expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1' }));
    expect(result).toEqual(expect.objectContaining({
      success: true,
      runId: 'run-1',
      draftMutated: true,
      persisted: true,
      message: 'Saved.',
    }));
  });

  test('streams intermediate session snapshots while the run is queued', async () => {
    global.fetch
      .mockImplementationOnce(() => jsonResponse({
        success: true,
        queued: true,
        sessionId: 'session-1',
        runId: 'run-1',
      }, 202))
      .mockImplementationOnce(() => jsonResponse({
        success: true,
        run: { id: 'run-1', status: 'running' },
        events: [
          { type: 'run.status', payload: { status: 'running' } },
          { type: 'tool.call', payload: { id: '1', name: 'survey_get_draft' } },
        ],
        messages: [{
          role: 'assistant',
          content: '',
          tools: [{ id: '1', name: 'survey_get_draft', status: 'running' }],
        }],
      }))
      .mockImplementationOnce(() => jsonResponse({
        success: true,
        run: {
          id: 'run-1',
          status: 'completed',
          result: { message: 'Saved.', draftMutated: true, persisted: true },
        },
        events: [],
        messages: [{ role: 'assistant', content: 'Saved.' }],
      }));
    const onSnapshot = jest.fn();

    const result = await sendAgentChat({
      message: 'Generate a survey',
      projectId: 'project-1',
      onSnapshot,
    });

    expect(onSnapshot).toHaveBeenCalled();
    expect(onSnapshot.mock.calls[0][0].messages[0].tools[0].name).toBe('survey_get_draft');
    expect(result.success).toBe(true);
  });

  test('exposes cancellation and steering endpoints', async () => {
    global.fetch.mockImplementation(() => jsonResponse({ success: true }));
    await cancelAiRun('run-1');
    await steerAiSession('session-1', 'Use fewer pages');
    expect(global.fetch.mock.calls[0][0]).toContain('/api/agent/runs/run-1/cancel');
    expect(global.fetch.mock.calls[1][0]).toContain('/api/agent/sessions/session-1/steer');
  });
});

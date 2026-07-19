/**
 * Chat API for intelligent survey generation/adjustment.
 * Platform mode: uses stored BYOK via /api/agent/chat (Supabase JWT).
 * Self-hosted fallback: legacy /api/openai/chat with apiKey in body.
 */

import { supabase } from './supabase';
import { sendAgentChat } from './agentApi';

const API_BASE_URL =
  process.env.REACT_APP_SERVER_URL
  || process.env.REACT_APP_API_URL
  || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

const isPlatformMode = () => !!supabase;

/**
 * Send a chat message and get AI response
 */
export async function sendChatMessage(
  message,
  currentConfig,
  conversationHistory,
  apiKey,
  enableMultiAgentReview = false,
  reviewMode = '1v1',
  customPrompts = null,
  researchContext = null,
) {
  try {
    if (isPlatformMode()) {
      // Prefer server-stored credentials; if a one-time key is provided,
      // callers should store it first via Integrations.
      return await sendAgentChat({
        message,
        currentConfig,
        conversationHistory,
        researchContext,
        customPrompts,
        enableMultiAgentReview,
        reviewMode,
      });
    }

    const response = await fetch(`${API_BASE_URL}/api/openai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        currentConfig,
        conversationHistory,
        apiKey,
        enableMultiAgentReview,
        reviewMode,
        customPrompts,
        researchContext,
      }),
    });
    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to send message',
    };
  }
}

/**
 * Trigger Multi-Agent Review with Streaming (SSE)
 * Uses POST body (no apiKey in query string).
 */
export async function triggerMultiAgentReviewStream(
  surveyConfig,
  apiKey,
  mode = '1v1',
  maxRounds = 3,
  onEvent,
  customAgents = null,
  userRequest = null,
  researchContext = null,
  projectId = null,
) {
  return new Promise(async (resolve, reject) => {
    try {
      let agentsConfig = customAgents;
      if (!agentsConfig && projectId) {
        agentsConfig = JSON.parse(localStorage.getItem(`customAgents_${projectId}`) || 'null');
      }

      const token = isPlatformMode()
        ? (await supabase.auth.getSession()).data.session?.access_token
        : null;

      // Prefer POST streaming endpoint when available; fall back to EventSource for local Express.
      if (isPlatformMode() && token) {
        const res = await fetch(`${API_BASE_URL}/api/openai/multi-agent-review-stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            surveyConfig,
            mode,
            maxRounds,
            customAgents: agentsConfig,
            userRequest,
            researchContext,
            // apiKey intentionally omitted — server uses stored BYOK when ported
          }),
        });

        if (!res.ok || !res.body) {
          // Fall through to legacy GET if POST not implemented yet
          return legacyEventSource();
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() || '';
          for (const chunk of chunks) {
            const lines = chunk.split('\n');
            let eventType = 'message';
            let dataLine = '';
            lines.forEach((line) => {
              if (line.startsWith('event:')) eventType = line.slice(6).trim();
              if (line.startsWith('data:')) dataLine += line.slice(5).trim();
            });
            if (!dataLine) continue;
            try {
              const data = JSON.parse(dataLine);
              if (onEvent) onEvent(eventType, data);
              if (eventType === 'complete' || eventType === 'done') finalResult = data;
            } catch {
              // ignore parse errors
            }
          }
        }
        resolve(finalResult || { success: true });
        return;
      }

      return legacyEventSource();

      function legacyEventSource() {
        const params = new URLSearchParams({
          surveyConfig: JSON.stringify(surveyConfig),
          mode,
          maxRounds: maxRounds.toString(),
        });
        // Self-hosted only — never put platform keys in query strings.
        if (!isPlatformMode() && apiKey) params.set('apiKey', apiKey);
        if (agentsConfig) params.set('customAgents', JSON.stringify(agentsConfig));
        if (userRequest) params.set('userRequest', userRequest);
        if (researchContext) params.set('researchContext', JSON.stringify(researchContext));

        const eventSource = new EventSource(
          `${API_BASE_URL}/api/openai/multi-agent-review-stream?${params.toString()}`,
        );

        let finalResult = null;
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (onEvent) onEvent('message', data);
          } catch {
            // ignore
          }
        };

        ['progress', 'agent', 'round', 'complete', 'done', 'error'].forEach((type) => {
          eventSource.addEventListener(type, (event) => {
            try {
              const data = JSON.parse(event.data);
              if (onEvent) onEvent(type, data);
              if (type === 'complete' || type === 'done') {
                finalResult = data;
                eventSource.close();
                resolve(finalResult);
              }
              if (type === 'error') {
                eventSource.close();
                reject(new Error(data.error || 'Multi-agent review failed'));
              }
            } catch (err) {
              eventSource.close();
              reject(err);
            }
          });
        });

        eventSource.onerror = () => {
          eventSource.close();
          if (finalResult) resolve(finalResult);
          else reject(new Error('Multi-agent review connection failed'));
        };
      }
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Validate API key — platform stores via agent credentials; local uses OpenAI models ping.
 */
export async function validateChatApiKey(apiKey) {
  try {
    if (isPlatformMode()) {
      const { validateOpenAiCredential, storeOpenAiCredential } = await import('./agentApi');
      const validated = await validateOpenAiCredential(apiKey);
      if (!validated.success) return validated;
      return storeOpenAiCredential(apiKey);
    }

    const response = await fetch(`${API_BASE_URL}/api/openai/validate-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    return await response.json();
  } catch (error) {
    return { success: false, error: error.message || 'Validation failed' };
  }
}

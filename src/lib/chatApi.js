/**
 * Chat API for intelligent survey generation/adjustment
 * Automatically determines user intent and routes to appropriate handler
 */

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

/**
 * Send a chat message and get AI response
 * @param {string} message - User's message
 * @param {Object} currentConfig - Current survey configuration (if any)
 * @param {Array} conversationHistory - Previous messages in OpenAI format
 * @param {string} apiKey - OpenAI API key
 * @param {boolean} enableMultiAgentReview - Whether to trigger multi-agent review after generate/adjust
 * @param {string} reviewMode - Review mode: '1v1' or 'group'
 * @param {Object} customPrompts - Custom system prompts (optional)
 * @returns {Promise<Object>} - { success, intent, surveyConfig?, message, error?, multiAgentReview? }
 */
export async function sendChatMessage(message, currentConfig, conversationHistory, apiKey, enableMultiAgentReview = false, reviewMode = '1v1', customPrompts = null) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/openai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        currentConfig,
        conversationHistory,
        apiKey,
        enableMultiAgentReview,
        reviewMode,
        customPrompts
      })
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to send message'
    };
  }
}

/**
 * Trigger Multi-Agent Review with Streaming (SSE)
 * @param {Object} surveyConfig - Survey configuration to review
 * @param {string} apiKey - OpenAI API key
 * @param {string} mode - Review mode: '1v1' or 'group'
 * @param {number} maxRounds - Maximum number of review rounds
 * @param {Function} onEvent - Callback for each SSE event: (eventType, data) => void
 * @returns {Promise<Object>} - Final result
 */
export async function triggerMultiAgentReviewStream(surveyConfig, apiKey, mode = '1v1', maxRounds = 3, onEvent, customAgents = null) {
  return new Promise((resolve, reject) => {
    try {
      // Load custom agents from localStorage if not provided
      const agentsConfig = customAgents || JSON.parse(localStorage.getItem('customAgents') || 'null');
      
      const params = new URLSearchParams({
        surveyConfig: JSON.stringify(surveyConfig),
        apiKey,
        mode,
        maxRounds: maxRounds.toString()
      });
      
      // Add custom agents if available
      if (agentsConfig) {
        params.append('customAgents', JSON.stringify(agentsConfig));
      }
      
      const eventSource = new EventSource(`${API_BASE_URL}/api/openai/multi-agent-review-stream?${params}`);
      
      let finalResult = null;
      
      // Handle different event types
      eventSource.addEventListener('start', (e) => {
        const data = JSON.parse(e.data);
        if (onEvent) onEvent('start', data);
      });
      
      eventSource.addEventListener('round-start', (e) => {
        const data = JSON.parse(e.data);
        if (onEvent) onEvent('round-start', data);
      });
      
      eventSource.addEventListener('agent-start', (e) => {
        const data = JSON.parse(e.data);
        if (onEvent) onEvent('agent-start', data);
      });
      
      eventSource.addEventListener('agent-review', (e) => {
        const data = JSON.parse(e.data);
        if (onEvent) onEvent('agent-review', data);
      });
      
      eventSource.addEventListener('agent-error', (e) => {
        const data = JSON.parse(e.data);
        if (onEvent) onEvent('agent-error', data);
      });
      
      eventSource.addEventListener('round-summary', (e) => {
        const data = JSON.parse(e.data);
        if (onEvent) onEvent('round-summary', data);
      });
      
      eventSource.addEventListener('revision-start', (e) => {
        const data = JSON.parse(e.data);
        if (onEvent) onEvent('revision-start', data);
      });
      
      eventSource.addEventListener('revision-thinking', (e) => {
        const data = JSON.parse(e.data);
        if (onEvent) onEvent('revision-thinking', data);
      });
      
      eventSource.addEventListener('revision-complete', (e) => {
        const data = JSON.parse(e.data);
        if (onEvent) onEvent('revision-complete', data);
      });
      
      eventSource.addEventListener('revision-error', (e) => {
        const data = JSON.parse(e.data);
        if (onEvent) onEvent('revision-error', data);
      });
      
      eventSource.addEventListener('complete', (e) => {
        const data = JSON.parse(e.data);
        finalResult = data;
        if (onEvent) onEvent('complete', data);
        eventSource.close();
        resolve({ success: true, ...data });
      });
      
      eventSource.addEventListener('error', (e) => {
        const data = e.data ? JSON.parse(e.data) : { message: 'Connection error' };
        if (onEvent) onEvent('error', data);
        eventSource.close();
        reject(new Error(data.message || 'Stream error'));
      });
      
      // Handle connection errors
      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        eventSource.close();
        if (!finalResult) {
          reject(new Error('Connection lost'));
        }
      };
      
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Validate OpenAI API key
 */
export async function validateApiKey(apiKey) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/openai/validate-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey })
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to validate API key'
    };
  }
}


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
 * @returns {Promise<Object>} - { success, intent, surveyConfig?, message, error? }
 */
export async function sendChatMessage(message, currentConfig, conversationHistory, apiKey) {
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
        apiKey
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


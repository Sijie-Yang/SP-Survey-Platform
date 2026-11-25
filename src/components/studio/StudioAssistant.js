import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { AutoAwesome } from '@mui/icons-material';
import ChatAssistant from '../admin/ChatAssistant';
import useSurveyAssistant, { chatPropsFromAssistant } from '../../hooks/useSurveyAssistant';
import { StudioCard, useL } from './studioUi';

const PENDING_KEY = 'sp-studio-assistant-prompt:';

/** The new-study box hands its first message to the study's assistant through this. */
export function queueStudioAssistantPrompt(projectId, text) {
  try {
    window.sessionStorage.setItem(`${PENDING_KEY}${projectId}`, String(text || ''));
  } catch {
    // Without storage the researcher types the message again.
  }
}

function takePendingPrompt(projectId) {
  try {
    const key = `${PENDING_KEY}${projectId}`;
    const text = window.sessionStorage.getItem(key) || '';
    window.sessionStorage.removeItem(key);
    return text;
  } catch {
    return '';
  }
}

/**
 * The platform's built-in Assistant inside a Studio study: the same chat,
 * sessions, model choice and history as the classic editor's sidebar,
 * opening in SP-Scheme mode. `onSaved` reloads the study after a saved change;
 * `onSaveConfig` stores a change the assistant made only locally (an undo).
 */
export default function StudioAssistant({ project, config, onSaved, onSaveConfig }) {
  const L = useL();
  const assistant = useSurveyAssistant({
    currentProject: project,
    surveyConfig: config,
    defaultMode: 'spscheme',
    onSurveyConfigChange: (next, meta = {}) => {
      if (meta?.persisted) onSaved?.();
      else if (next) onSaveConfig?.(next);
    },
  });
  const pending = useRef(null);
  if (pending.current === null) pending.current = project?.id ? takePendingPrompt(project.id) : '';

  // A message typed on the new-study screen: send it once the model is ready,
  // or leave it in the box when no model is available.
  const { apiKeyValid, isLoading, handleSendMessage, setUserMessage } = assistant;
  useEffect(() => {
    const text = pending.current;
    if (!text) return;
    if (!apiKeyValid) {
      setUserMessage?.(text);
      return;
    }
    if (isLoading) return;
    pending.current = '';
    handleSendMessage?.({ message: text, assistantMode: 'spscheme' });
  }, [apiKeyValid, isLoading, handleSendMessage, setUserMessage]);

  return (
    <StudioCard
      data-testid="studio-assistant"
      title={(
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <AutoAwesome color="primary" sx={{ fontSize: 20 }} />
          {L('AI assistant', 'AI 助手')}
        </Box>
      )}
    >
      <Box sx={{ height: { xs: 520, lg: 600 }, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <ChatAssistant variant="content" fillHeight {...chatPropsFromAssistant(assistant)} />
      </Box>
    </StudioCard>
  );
}

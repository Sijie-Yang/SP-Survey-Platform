import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getConversationHistory } from '../lib/conversationHistory';
import { getWorkingMemory } from '../lib/workingMemory';
import { getSessionLearning } from '../lib/sessionLearning';
import { sendChatMessage, validateChatApiKey, triggerMultiAgentReviewStream } from '../lib/chatApi';
import { postProcessAiConfig } from '../lib/designProtocol';
import {
  buildAssistantModelOptions,
  clearUndoSnapshot,
  credentialConfigured,
  isPlatformMode as detectPlatformMode,
  isStaleAssistantRequest,
  parseRoute,
  readSessionId,
  readStoredRoute,
  readUndoSnapshot,
  resolveAssistantRoute,
  sendBlockReason,
  writeSessionId,
  writeStoredRoute,
  writeUndoSnapshot,
} from './surveyAssistantUtils';

function loadProjectFlag(projectId, key, fallback) {
  if (!projectId || typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(`${key}_${projectId}`);
  if (stored === null) return fallback;
  return stored === 'true';
}

function loadProjectString(projectId, key, fallback) {
  if (!projectId || typeof window === 'undefined') return fallback;
  return window.localStorage.getItem(`${key}_${projectId}`) || fallback;
}

function loadProjectNumber(projectId, key, fallback) {
  if (!projectId || typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(`${key}_${projectId}`);
  return stored ? parseInt(stored, 10) : fallback;
}

export default function useSurveyAssistant({
  currentProject,
  surveyConfig,
  onSurveyConfigChange,
  enabled = true,
} = {}) {
  const platformMode = detectPlatformMode();
  const projectId = currentProject?.id || null;

  const [openaiApiKey, setOpenaiApiKey] = useState(() => (
    platformMode ? '' : (typeof window !== 'undefined' ? window.localStorage.getItem('openaiApiKey') || '' : '')
  ));
  const [apiKeyValid, setApiKeyValid] = useState(() => (
    platformMode ? false : (typeof window !== 'undefined' && window.localStorage.getItem('apiKeyValid') === 'true')
  ));
  const [credentialHint, setCredentialHint] = useState('');
  const [assistantDirectory, setAssistantDirectory] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState('');
  const [selectedEffort, setSelectedEffort] = useState('');
  const [aiSessionId, setAiSessionId] = useState(() => readSessionId(
    typeof window !== 'undefined' ? window.sessionStorage : null,
    projectId,
  ));
  const [userMessage, setUserMessage] = useState('');
  const [aiUndoAvailable, setAiUndoAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [conversationMessages, setConversationMessages] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [contextEnabled, setContextEnabled] = useState(() => loadProjectFlag(projectId, 'contextEnabled', true));
  const [multiAgentReviewEnabled, setMultiAgentReviewEnabled] = useState(() => (
    loadProjectFlag(projectId, 'multiAgentReviewEnabled', false)
  ));
  const [reviewMode, setReviewMode] = useState(() => loadProjectString(projectId, 'reviewMode', '1v1'));
  const [maxReviewRounds, setMaxReviewRounds] = useState(() => loadProjectNumber(projectId, 'maxReviewRounds', 3));
  const [customPrompts, setCustomPrompts] = useState(null);

  const conversationHistoryRef = useRef(null);
  const workingMemoryRef = useRef(null);
  const sessionLearningRef = useRef(null);
  const chatEndRef = useRef(null);
  const aiUndoSnapshotRef = useRef(null);
  const isLoadingProjectSettings = useRef(false);
  const lastStatusRef = useRef(null);
  const projectIdRef = useRef(projectId);
  const generationRef = useRef(0);
  const surveyConfigRef = useRef(surveyConfig);
  const onChangeRef = useRef(onSurveyConfigChange);
  const enabledRef = useRef(enabled);

  if (projectIdRef.current !== projectId || enabledRef.current !== enabled) {
    if (projectIdRef.current !== projectId || !enabled) {
      generationRef.current += 1;
    }
    projectIdRef.current = projectId;
    enabledRef.current = enabled;
  }

  useEffect(() => {
    surveyConfigRef.current = surveyConfig;
  }, [surveyConfig]);

  useEffect(() => {
    onChangeRef.current = onSurveyConfigChange;
  }, [onSurveyConfigChange]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const applyResolvedRoute = useCallback((status, nextProjectId) => {
    const stored = readStoredRoute(
      typeof window !== 'undefined' ? window.sessionStorage : null,
      nextProjectId,
    );
    const resolved = resolveAssistantRoute({
      directory: status?.directory || lastStatusRef.current?.directory,
      status: status || lastStatusRef.current,
      storedRoute: stored.route,
      storedEffort: stored.effort,
    });
    if (status?.directory) setAssistantDirectory(status.directory);
    setSelectedRoute(resolved.route);
    setSelectedEffort(resolved.effort);
    return resolved;
  }, []);

  const applyCredentialStatus = useCallback((status) => {
    if (!status) return;
    lastStatusRef.current = status;
    const configured = credentialConfigured(status);
    if (configured) {
      setApiKeyValid(true);
      setCredentialHint(status.openai?.hint || status.defaultRoute?.provider || '');
      setOpenaiApiKey('');
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('openaiApiKey');
        window.localStorage.removeItem('apiKeyValid');
      }
    } else {
      setApiKeyValid(false);
      setCredentialHint('');
    }
    applyResolvedRoute(status, projectIdRef.current);
  }, [applyResolvedRoute]);

  useEffect(() => {
    if (platformMode || !enabled) return undefined;
    if (openaiApiKey && typeof window !== 'undefined') {
      window.localStorage.setItem('openaiApiKey', openaiApiKey);
    }
    return undefined;
  }, [openaiApiKey, platformMode, enabled]);

  useEffect(() => {
    if (platformMode || !enabled) return undefined;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('apiKeyValid', apiKeyValid.toString());
    }
    return undefined;
  }, [apiKeyValid, platformMode, enabled]);

  useEffect(() => {
    if (!enabled || !platformMode) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { getCredentialStatus } = await import('../lib/agentApi');
        const status = await getCredentialStatus();
        if (cancelled || !enabledRef.current || !status) return;
        applyCredentialStatus(status);
      } catch (err) {
        console.warn('Credential status check failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, platformMode, projectId, applyCredentialStatus]);

  useEffect(() => {
    setIsLoading(false);
    setLoadingStatus('');
    setUserMessage('');

    if (!enabled) {
      setAiSessionId('');
      aiUndoSnapshotRef.current = null;
      setAiUndoAvailable(false);
      setSelectedRoute('');
      setSelectedEffort('');
      return;
    }

    const storage = typeof window !== 'undefined' ? window.sessionStorage : null;
    setAiSessionId(readSessionId(storage, projectId));
    const undo = readUndoSnapshot(storage, projectId);
    aiUndoSnapshotRef.current = undo;
    setAiUndoAvailable(Boolean(undo));
    applyResolvedRoute(lastStatusRef.current, projectId);
  }, [enabled, projectId, applyResolvedRoute]);

  useEffect(() => {
    if (!enabled || !projectId) return undefined;
    isLoadingProjectSettings.current = true;
    setContextEnabled(loadProjectFlag(projectId, 'contextEnabled', true));
    setMultiAgentReviewEnabled(loadProjectFlag(projectId, 'multiAgentReviewEnabled', false));
    setReviewMode(loadProjectString(projectId, 'reviewMode', '1v1'));
    setMaxReviewRounds(loadProjectNumber(projectId, 'maxReviewRounds', 3));
    const timer = setTimeout(() => {
      isLoadingProjectSettings.current = false;
    }, 100);
    return () => clearTimeout(timer);
  }, [enabled, projectId]);

  useEffect(() => {
    if (!enabled || !projectId || isLoadingProjectSettings.current) return;
    window.localStorage.setItem(`contextEnabled_${projectId}`, contextEnabled.toString());
  }, [enabled, contextEnabled, projectId]);

  useEffect(() => {
    if (!enabled || !projectId || isLoadingProjectSettings.current) return;
    window.localStorage.setItem(`multiAgentReviewEnabled_${projectId}`, multiAgentReviewEnabled.toString());
  }, [enabled, multiAgentReviewEnabled, projectId]);

  useEffect(() => {
    if (!enabled || !projectId || isLoadingProjectSettings.current) return;
    window.localStorage.setItem(`reviewMode_${projectId}`, reviewMode);
  }, [enabled, reviewMode, projectId]);

  useEffect(() => {
    if (!enabled || !projectId || isLoadingProjectSettings.current) return;
    window.localStorage.setItem(`maxReviewRounds_${projectId}`, maxReviewRounds.toString());
  }, [enabled, maxReviewRounds, projectId]);

  useEffect(() => {
    if (!enabled || !projectId || !contextEnabled) {
      conversationHistoryRef.current = null;
      workingMemoryRef.current = null;
      sessionLearningRef.current = null;
      setConversationMessages([]);
      setRecommendations([]);
      return undefined;
    }
    conversationHistoryRef.current = getConversationHistory(projectId);
    workingMemoryRef.current = getWorkingMemory(projectId);
    sessionLearningRef.current = getSessionLearning();
    setConversationMessages(conversationHistoryRef.current.getAllMessages());
    setRecommendations(sessionLearningRef.current.getRecommendations(currentProject?.category || 'general'));
    return undefined;
  }, [enabled, projectId, contextEnabled, currentProject?.category]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [conversationMessages]);

  const assistantModelOptions = useMemo(
    () => buildAssistantModelOptions(assistantDirectory),
    [assistantDirectory],
  );
  const selectedModelOption = assistantModelOptions.find((route) => route.value === selectedRoute);
  const assistantEffortOptions = selectedModelOption?.reasoningEfforts
    ? Object.keys(selectedModelOption.reasoningEfforts)
    : [];
  const routeUnavailable = platformMode && apiKeyValid && (!selectedRoute || !selectedModelOption)
    ? 'Select a configured model before sending. The previous provider may have been removed.'
    : '';
  const blockReason = sendBlockReason({
    hasProject: Boolean(projectId),
    apiKeyValid,
    platformMode,
    routeUnavailable,
    openaiApiKey,
  });

  const persistAssistantDefault = useCallback(async (provider, model, effort) => {
    try {
      const { saveAiSettings } = await import('../lib/agentApi');
      await saveAiSettings({
        default_provider: provider,
        assistant_provider: provider,
        assistant_model: model,
        assistant_reasoning_effort: effort || null,
      });
    } catch {
      // Session selection stays; default save is best-effort.
    }
  }, []);

  const handleAssistantRouteChange = useCallback((value) => {
    setSelectedRoute(value);
    const hit = assistantModelOptions.find((route) => route.value === value);
    const effort = hit?.defaultEffort
      || (hit?.reasoningEfforts ? Object.keys(hit.reasoningEfforts)[0] : '');
    setSelectedEffort(effort);
    writeStoredRoute(
      typeof window !== 'undefined' ? window.sessionStorage : null,
      projectIdRef.current,
      value,
      effort,
    );
    if (hit) persistAssistantDefault(hit.provider, hit.model, effort);
  }, [assistantModelOptions, persistAssistantDefault]);

  const handleAssistantEffortChange = useCallback((effort) => {
    setSelectedEffort(effort);
    const { provider, model } = parseRoute(selectedRoute);
    writeStoredRoute(
      typeof window !== 'undefined' ? window.sessionStorage : null,
      projectIdRef.current,
      selectedRoute,
      effort,
    );
    if (provider && model) persistAssistantDefault(provider, model, effort);
  }, [persistAssistantDefault, selectedRoute]);

  const refreshConversation = useCallback(() => {
    if (conversationHistoryRef.current) {
      setConversationMessages(conversationHistoryRef.current.getAllMessages());
    }
  }, []);

  const handleValidateApiKey = useCallback(async () => {
    setIsLoading(true);
    const result = await validateChatApiKey(openaiApiKey);
    setIsLoading(false);
    if (result.success) {
      setApiKeyValid(true);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('openai_api_key', openaiApiKey);
      }
      conversationHistoryRef.current?.addMessage('assistant',
        '✅ API key validated! I\'m ready to help you create and modify surveys. Just type what you need!',
        { actionType: 'system' },
      );
    } else {
      setApiKeyValid(false);
      conversationHistoryRef.current?.addMessage('assistant',
        '❌ Invalid API key. Please check and try again in settings.',
        { actionType: 'system', error: true },
      );
    }
    refreshConversation();
  }, [openaiApiKey, refreshConversation]);

  const applySurveyConfig = useCallback((nextConfig, request, metadata = {}) => {
    if (isStaleAssistantRequest(request, { projectId: projectIdRef.current, generation: generationRef.current })) {
      return false;
    }
    if (Object.keys(metadata).length) onChangeRef.current?.(nextConfig, metadata);
    else onChangeRef.current?.(nextConfig);
    return true;
  }, []);

  const handleRevertAiChange = useCallback(() => {
    if (!aiUndoSnapshotRef.current) return;
    const request = { projectId: projectIdRef.current, generation: generationRef.current };
    applySurveyConfig(JSON.parse(JSON.stringify(aiUndoSnapshotRef.current)), request);
    aiUndoSnapshotRef.current = null;
    setAiUndoAvailable(false);
    clearUndoSnapshot(
      typeof window !== 'undefined' ? window.sessionStorage : null,
      projectIdRef.current,
    );
    conversationHistoryRef.current?.addMessage('assistant',
      '↩️ Reverted to the survey configuration before the last AI change.',
      { actionType: 'system' },
    );
    refreshConversation();
  }, [applySurveyConfig, refreshConversation]);

  const handleClearHistory = useCallback(() => {
    conversationHistoryRef.current?.clear();
    setConversationMessages([]);
  }, []);

  const handleDownloadHistory = useCallback(() => {
    const data = conversationHistoryRef.current?.export();
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation_${projectIdRef.current || 'project'}_${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleSendMessage = useCallback(async () => {
    if (!userMessage.trim()) return;
    const request = {
      projectId: projectIdRef.current,
      generation: generationRef.current,
    };
    if (!request.projectId) return;

    const { provider: routeProvider, model: routeModel } = parseRoute(selectedRoute);
    const selectedProvider = assistantDirectory.find((item) => item.id === routeProvider);
    if (platformMode && (!routeProvider || !routeModel || !selectedProvider?.configured)) {
      conversationHistoryRef.current?.addMessage('assistant',
        '⚠️ Select a configured model before sending. The previous provider may have been removed.',
        { actionType: 'system', error: true },
      );
      refreshConversation();
      return;
    }
    if (!apiKeyValid && !(openaiApiKey && !platformMode)) {
      conversationHistoryRef.current?.addMessage('assistant',
        platformMode
          ? '⚠️ Store an OpenAI / OpenRouter key under AI & Integrations first (toolbar AI button).'
          : '⚠️ Please configure and validate your API key in settings first.',
        { actionType: 'system', error: true },
      );
      refreshConversation();
      return;
    }

    conversationHistoryRef.current?.addMessage('user', userMessage, {
      actionType: 'chat',
      timestamp: new Date().toISOString(),
    });
    refreshConversation();

    const currentUserMessage = userMessage;
    setUserMessage('');
    setIsLoading(true);
    setLoadingStatus('Thinking...');

    const stillCurrent = () => !isStaleAssistantRequest(request, {
      projectId: projectIdRef.current,
      generation: generationRef.current,
    });

    try {
      const apiHistory = conversationHistoryRef.current?.getFormattedForOpenAI(10) || [];
      let enrichedHistory = apiHistory;
      if (contextEnabled && workingMemoryRef.current && sessionLearningRef.current) {
        enrichedHistory = [
          { role: 'system', content: sessionLearningRef.current.getContextForAI(currentProject?.category) },
          { role: 'system', content: workingMemoryRef.current.getContextForAI() },
          ...apiHistory,
        ];
      }

      const researchContext = request.projectId
        ? JSON.parse(window.localStorage.getItem(`researchContext_${request.projectId}`) || '{}')
        : {};

      const result = await sendChatMessage(
        currentUserMessage,
        surveyConfigRef.current,
        enrichedHistory,
        openaiApiKey,
        multiAgentReviewEnabled,
        reviewMode,
        customPrompts,
        researchContext,
        {
          projectId: request.projectId,
          sessionId: aiSessionId || null,
          provider: routeProvider || null,
          model: routeModel || null,
          reasoningEffort: selectedEffort || null,
        },
      );

      if (!stillCurrent()) return;

      if (result.sessionId) {
        setAiSessionId(result.sessionId);
        writeSessionId(
          typeof window !== 'undefined' ? window.sessionStorage : null,
          request.projectId,
          result.sessionId,
        );
      }

      if (result.intent === 'generate') {
        setLoadingStatus('Generating survey...');
      } else if (result.intent === 'adjust') {
        setLoadingStatus('Adjusting survey...');
      } else {
        setLoadingStatus('Processing...');
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!stillCurrent()) return;

      setIsLoading(false);
      setLoadingStatus('');

      if (result.success) {
        if (result.chainOfThoughts && conversationHistoryRef.current) {
          const step1Key = result.chainOfThoughts.step1_research || result.chainOfThoughts.step1_understanding;
          if (step1Key) {
            conversationHistoryRef.current.addMessage('assistant',
              `**🧠 Step 1: ${result.intent === 'generate' ? 'Research Analysis' : 'Understanding Adjustment Goal'}**\n\n${step1Key}`,
              { type: 'chain-of-thoughts', step: 1, intent: result.intent },
            );
          }
          const step2Key = result.chainOfThoughts.step2_structure || result.chainOfThoughts.step2_planning;
          if (step2Key) {
            conversationHistoryRef.current.addMessage('assistant',
              `**📐 Step 2: ${result.intent === 'generate' ? 'Survey Structure Planning' : 'Adjustment Planning'}**\n\n${step2Key}`,
              { type: 'chain-of-thoughts', step: 2, intent: result.intent },
            );
          }
          const step3Key = result.chainOfThoughts.step3_generation || result.chainOfThoughts.step3_execution;
          if (step3Key) {
            conversationHistoryRef.current.addMessage('assistant',
              `**🔨 Step 3: ${result.intent === 'generate' ? 'Generation' : 'Execution'}**\n\n${step3Key}`,
              { type: 'chain-of-thoughts', step: 3, intent: result.intent },
            );
          }
        }

        conversationHistoryRef.current?.addMessage('assistant', result.message, {
          actionType: result.intent,
          timestamp: new Date().toISOString(),
        });

        if (result.multiAgentReview?.conversationMessages) {
          result.multiAgentReview.conversationMessages.forEach((msg) => {
            if (conversationHistoryRef.current && msg.content) {
              conversationHistoryRef.current.addMessage(msg.role || 'assistant', msg.content, {
                ...(msg.metadata || {}),
                timestamp: msg.timestamp || new Date().toISOString(),
                isMultiAgent: true,
              });
            }
          });
        }

        refreshConversation();

        if (result.researchContext && request.projectId) {
          window.localStorage.setItem(`researchContext_${request.projectId}`, JSON.stringify(result.researchContext));
          window.dispatchEvent(new CustomEvent('researchContextUpdated', {
            detail: result.researchContext,
          }));
        }

        if (result.surveyConfig) {
          const snapshot = JSON.parse(JSON.stringify(surveyConfigRef.current || {}));
          aiUndoSnapshotRef.current = snapshot;
          setAiUndoAvailable(true);
          writeUndoSnapshot(
            typeof window !== 'undefined' ? window.sessionStorage : null,
            request.projectId,
            snapshot,
          );
          const processedConfig = postProcessAiConfig(result.surveyConfig);
          const persistence = result.draftUpdatedAt
            ? { persisted: true, draftUpdatedAt: result.draftUpdatedAt, source: 'assistant' }
            : {};
          if (!applySurveyConfig(processedConfig, request, persistence)) return;

          if (contextEnabled) {
            if (workingMemoryRef.current) {
              if (result.intent === 'generate') {
                workingMemoryRef.current.setSurveyGoal(currentUserMessage);
              }
              workingMemoryRef.current.addIteration(processedConfig, currentUserMessage);
              if (result.intent === 'adjust') {
                workingMemoryRef.current.addDesignDecision(currentUserMessage, 'User requested adjustment');
              }
            }
            sessionLearningRef.current?.recordProjectInteraction(
              request.projectId,
              currentProject?.category || 'general',
              result.intent === 'generate' ? 'generate_survey' : 'adjust_survey',
            );
          }

          if (multiAgentReviewEnabled && (result.intent === 'generate' || result.intent === 'adjust')) {
            setLoadingStatus('Starting Multi-Agent Review...');
            try {
              const customAgents = request.projectId && window.localStorage.getItem(`customAgents_${request.projectId}`)
                ? JSON.parse(window.localStorage.getItem(`customAgents_${request.projectId}`))
                : null;
              const reviewResearchContext = request.projectId
                ? JSON.parse(window.localStorage.getItem(`researchContext_${request.projectId}`) || '{}')
                : {};

              await triggerMultiAgentReviewStream(
                processedConfig,
                openaiApiKey,
                reviewMode,
                maxReviewRounds,
                (eventType, data) => {
                  if (!stillCurrent() || !conversationHistoryRef.current) return;
                  switch (eventType) {
                    case 'start':
                      conversationHistoryRef.current.addMessage('system',
                        `\n🔄 **Multi-Agent Review Started**\n\nMode: ${data.mode}\nExperts: ${data.totalAgents}\nMax Rounds: ${data.maxRounds}\n`,
                        { type: 'review-start', isMultiAgent: true },
                      );
                      break;
                    case 'round-start':
                      conversationHistoryRef.current.addMessage('system',
                        `\n📋 **Review Round ${data.round}**\n`,
                        { type: 'round-header', isMultiAgent: true, round: data.round },
                      );
                      setLoadingStatus(`Review Round ${data.round}...`);
                      break;
                    case 'agent-start':
                      setLoadingStatus(`${data.emoji} ${data.name} reviewing...`);
                      break;
                    case 'agent-review':
                      conversationHistoryRef.current.addMessage('assistant', data.formatted, {
                        type: 'agent-review',
                        isMultiAgent: true,
                        agentId: data.agentId,
                        round: data.round,
                      });
                      refreshConversation();
                      break;
                    case 'round-summary':
                      conversationHistoryRef.current.addMessage('assistant', data.formatted, {
                        type: 'round-summary',
                        isMultiAgent: true,
                        round: data.round,
                      });
                      refreshConversation();
                      break;
                    case 'revision-start':
                      conversationHistoryRef.current.addMessage('system',
                        `\n🔧 **Survey Designer**: Addressing feedback and revising survey...\n`,
                        { type: 'revision-start', isMultiAgent: true, round: data.round },
                      );
                      refreshConversation();
                      setLoadingStatus('Revising survey...');
                      break;
                    case 'revision-thinking': {
                      const stepTitle = data.step === 1 ? 'Understanding Expert Feedback'
                        : data.step === 2 ? 'Planning Changes' : 'Executing Revision';
                      conversationHistoryRef.current.addMessage('assistant',
                        `**${'🧠📐🔨'[data.step - 1]} Revision Step ${data.step}: ${stepTitle}**\n\n${data.content}`,
                        { type: 'revision-thinking', step: data.step, isMultiAgent: true },
                      );
                      refreshConversation();
                      break;
                    }
                    case 'revision-complete':
                      if (data.chainOfThoughts) {
                        if (data.chainOfThoughts.step1_understanding) {
                          conversationHistoryRef.current.addMessage('assistant',
                            `**🧠 Revision Step 1: Understanding Expert Feedback**\n\n${data.chainOfThoughts.step1_understanding}`,
                            { type: 'revision-cot', step: 1, isMultiAgent: true },
                          );
                        }
                        if (data.chainOfThoughts.step2_planning) {
                          conversationHistoryRef.current.addMessage('assistant',
                            `**📐 Revision Step 2: Planning Changes**\n\n${data.chainOfThoughts.step2_planning}`,
                            { type: 'revision-cot', step: 2, isMultiAgent: true },
                          );
                        }
                        if (data.chainOfThoughts.step3_execution) {
                          conversationHistoryRef.current.addMessage('assistant',
                            `**🔨 Revision Step 3: Executing Revision**\n\n${data.chainOfThoughts.step3_execution}`,
                            { type: 'revision-cot', step: 3, isMultiAgent: true },
                          );
                        }
                      }
                      conversationHistoryRef.current.addMessage('assistant',
                        '🔧 **Survey Designer**: Survey revised based on expert feedback. Ready for next review round.',
                        { type: 'revision-complete', isMultiAgent: true, round: data.round },
                      );
                      refreshConversation();
                      if (data.surveyConfig) {
                        applySurveyConfig(postProcessAiConfig(data.surveyConfig), request);
                      }
                      break;
                    case 'complete':
                      conversationHistoryRef.current.addMessage('system',
                        `\n🎯 **Review Complete**\n\n${data.reason}\n\nFinal Rating: ${data.finalRating}/10\nFinal Verdict: ${data.finalVerdict?.toUpperCase()}\n`,
                        { type: 'review-complete', isMultiAgent: true },
                      );
                      refreshConversation();
                      if (data.surveyConfig) {
                        applySurveyConfig(postProcessAiConfig(data.surveyConfig), request);
                      }
                      break;
                    case 'error':
                    case 'agent-error':
                    case 'revision-error':
                      conversationHistoryRef.current.addMessage('system',
                        `❌ Error: ${data.error || data.message}`,
                        { type: 'error', isMultiAgent: true },
                      );
                      refreshConversation();
                      break;
                    default:
                      break;
                  }
                },
                customAgents,
                currentUserMessage,
                reviewResearchContext,
                request.projectId,
              );
            } catch (error) {
              if (stillCurrent()) {
                conversationHistoryRef.current?.addMessage('system',
                  `❌ Multi-Agent Review failed: ${error.message}`,
                  { type: 'error', isMultiAgent: true },
                );
                refreshConversation();
              }
            } finally {
              if (stillCurrent()) setLoadingStatus('');
            }
          }
        }
      } else if (stillCurrent()) {
        conversationHistoryRef.current?.addMessage('assistant',
          `❌ Error: ${result.error}`,
          { actionType: 'error', error: true },
        );
        refreshConversation();
      }
    } catch (error) {
      if (!stillCurrent()) return;
      setIsLoading(false);
      setLoadingStatus('');
      conversationHistoryRef.current?.addMessage('assistant',
        `❌ Unexpected error: ${error.message}`,
        { actionType: 'error', error: true },
      );
      refreshConversation();
    }
  }, [
    aiSessionId,
    apiKeyValid,
    applySurveyConfig,
    assistantDirectory,
    contextEnabled,
    currentProject?.category,
    customPrompts,
    maxReviewRounds,
    multiAgentReviewEnabled,
    openaiApiKey,
    platformMode,
    refreshConversation,
    reviewMode,
    selectedEffort,
    selectedRoute,
    userMessage,
  ]);

  return {
    enabled,
    isPlatformMode: platformMode,
    messages: conversationMessages,
    userMessage,
    isLoading,
    loadingStatus,
    apiKeyValid,
    openaiApiKey,
    credentialHint,
    modelOptions: assistantModelOptions,
    selectedRoute,
    selectedEffort,
    effortOptions: assistantEffortOptions,
    routeUnavailable,
    blockReason,
    canSend: !blockReason && Boolean(userMessage.trim()) && !isLoading,
    contextEnabled,
    multiAgentReviewEnabled,
    reviewMode,
    maxReviewRounds,
    recommendations,
    conversationHistoryRef,
    workingMemoryRef,
    sessionLearningRef,
    chatEndRef,
    aiUndoAvailable,
    currentProject,
    setUserMessage,
    setOpenaiApiKey,
    setContextEnabled,
    setMultiAgentReviewEnabled,
    setReviewMode,
    setMaxReviewRounds,
    setCustomPrompts,
    handleSendMessage,
    handleValidateApiKey,
    applyCredentialStatus,
    handleAssistantRouteChange,
    handleAssistantEffortChange,
    handleRevertAiChange,
    handleClearHistory,
    handleDownloadHistory,
  };
}

export function chatPropsFromAssistant(assistant) {
  if (!assistant) return {};
  return {
    messages: assistant.messages,
    userMessage: assistant.userMessage,
    isLoading: assistant.isLoading,
    loadingStatus: assistant.loadingStatus,
    apiKeyValid: assistant.apiKeyValid,
    openaiApiKey: assistant.openaiApiKey,
    credentialHint: assistant.credentialHint,
    isPlatformMode: assistant.isPlatformMode,
    contextEnabled: assistant.contextEnabled,
    multiAgentReviewEnabled: assistant.multiAgentReviewEnabled,
    reviewMode: assistant.reviewMode,
    maxReviewRounds: assistant.maxReviewRounds,
    recommendations: assistant.recommendations,
    currentProject: assistant.currentProject,
    conversationHistoryRef: assistant.conversationHistoryRef,
    workingMemoryRef: assistant.workingMemoryRef,
    sessionLearningRef: assistant.sessionLearningRef,
    onMessageChange: assistant.setUserMessage,
    onSendMessage: assistant.handleSendMessage,
    onApiKeyChange: assistant.setOpenaiApiKey,
    onValidateApiKey: assistant.handleValidateApiKey,
    onContextToggle: assistant.setContextEnabled,
    onMultiAgentReviewToggle: assistant.setMultiAgentReviewEnabled,
    onReviewModeChange: assistant.setReviewMode,
    onMaxReviewRoundsChange: assistant.setMaxReviewRounds,
    onClearHistory: assistant.handleClearHistory,
    onDownloadHistory: assistant.handleDownloadHistory,
    onPromptsChange: assistant.setCustomPrompts,
    onCredentialsChange: assistant.applyCredentialStatus,
    chatEndRef: assistant.chatEndRef,
    aiUndoAvailable: assistant.aiUndoAvailable,
    onRevertAiChange: assistant.handleRevertAiChange,
    modelOptions: assistant.modelOptions,
    selectedRoute: assistant.selectedRoute,
    selectedEffort: assistant.selectedEffort,
    effortOptions: assistant.effortOptions,
    onRouteChange: assistant.handleAssistantRouteChange,
    onEffortChange: assistant.handleAssistantEffortChange,
    routeUnavailable: assistant.routeUnavailable,
    blockReason: assistant.blockReason,
  };
}

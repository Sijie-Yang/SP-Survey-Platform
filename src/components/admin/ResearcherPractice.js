import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/defaultV2.min.css';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { PlayArrow, Stop, SkipNext } from '@mui/icons-material';
import registerImageRankingWidget, {
  registerImageRatingWidget,
  registerImageBooleanWidget,
  registerAllExtendedWidgets,
} from '../SurveyCustomComponents';
import { buildSingleQuestionSurvey } from '../../lib/singleQuestionSurvey';
import { saveSurveyResponse } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { getMediaId } from '../../lib/mediaUtils';

let widgetsRegistered = false;
function ensureWidgets() {
  if (widgetsRegistered) return;
  registerImageRankingWidget();
  registerImageRatingWidget();
  registerImageBooleanWidget();
  registerAllExtendedWidgets();
  widgetsRegistered = true;
}

function flattenQuestions(surveyConfig) {
  if (!surveyConfig?.pages) return [];
  return surveyConfig.pages.flatMap((page) =>
    (page.elements || []).map((el) => ({ ...el, _pageName: page.name, _pageTitle: page.title })),
  );
}

function isPracticeable(q) {
  if (!q?.type || !q?.name) return false;
  if (q.type === 'image' || q.type === 'expression' || q.type === 'html' || q.type === 'mediadisplay') {
    return false;
  }
  return true;
}

function newSessionId() {
  return `prac_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Admin workbench: pick any question and infinitely submit researcher responses.
 */
export default function ResearcherPractice({ currentProject, surveyConfig }) {
  const { user } = useAuth();
  const questions = useMemo(
    () => flattenQuestions(surveyConfig).filter(isPracticeable),
    [surveyConfig],
  );

  const [selectedName, setSelectedName] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [participantId, setParticipantId] = useState(null);
  const [model, setModel] = useState(null);
  const [roundMeta, setRoundMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const usedImageKeysRef = useRef(new Set());
  const usedGroupKeysRef = useRef(new Set());
  const roundMetaRef = useRef(null);
  const sessionRef = useRef({ sessionId: null, attemptIndex: 0, participantId: null, questionName: null });

  const selectedQuestion = useMemo(
    () => questions.find((q) => q.name === selectedName) || null,
    [questions, selectedName],
  );

  const active = !!sessionId && !!selectedQuestion;

  const startSession = (questionName) => {
    const sid = newSessionId();
    const pid = `researcher_${user?.id || 'anon'}_${Date.now().toString(36)}`;
    usedImageKeysRef.current = new Set();
    usedGroupKeysRef.current = new Set();
    setSelectedName(questionName);
    setSessionId(sid);
    setAttemptIndex(1);
    setParticipantId(pid);
    setError(null);
    setStatusMsg(null);
    sessionRef.current = {
      sessionId: sid,
      attemptIndex: 1,
      participantId: pid,
      questionName,
    };
    setReloadToken((t) => t + 1);
  };

  const stopSession = () => {
    setSessionId(null);
    setAttemptIndex(0);
    setParticipantId(null);
    setModel(null);
    setRoundMeta(null);
    setStatusMsg('Session stopped. Responses already saved remain in Results.');
    sessionRef.current = { sessionId: null, attemptIndex: 0, participantId: null, questionName: null };
  };

  const loadRound = useCallback(() => {
    if (!selectedQuestion || !sessionId) {
      setModel(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      ensureWidgets();
      const built = buildSingleQuestionSurvey({
        question: selectedQuestion,
        projectImages: currentProject?.preloadedImages || [],
        usedImageKeys: usedImageKeysRef.current,
        usedGroupKeys: usedGroupKeysRef.current,
        randomMedia: true,
        showNavigationButtons: false,
        trackUsed: selectedQuestion.excludePreviouslyUsedImages !== false,
      });
      // Keep practice aligned with live surveys: no SAM for annotation questions.
      if (built.surveyJson?.pages) {
        for (const page of built.surveyJson.pages) {
          for (const el of page.elements || []) {
            if (el.type === 'imageannotation') {
              el.enableSamAssist = false;
            }
          }
        }
      }
      const m = new Model(built.surveyJson);
      m.showPreviewBeforeComplete = false;
      m.showCompletedPage = false;
      // Soft-require: keep isRequired from question config
      setRoundMeta({
        shownImages: built.shownImages,
        shownMediaGroup: built.shownMediaGroup,
        shownMediaCategories: built.shownMediaCategories,
        questionName: selectedQuestion.name,
        questionType: selectedQuestion.type,
      });
      roundMetaRef.current = {
        shownImages: built.shownImages,
        shownMediaGroup: built.shownMediaGroup,
        shownMediaCategories: built.shownMediaCategories,
        questionName: selectedQuestion.name,
        questionType: selectedQuestion.type,
      };
      setModel(m);
    } catch (err) {
      console.error('Practice round failed:', err);
      setError(err.message || 'Failed to load question');
      setModel(null);
    } finally {
      setLoading(false);
    }
  }, [selectedQuestion, sessionId, currentProject?.preloadedImages, currentProject?.id, currentProject?.imageDatasetConfig, reloadToken]);

  useEffect(() => {
    loadRound();
  }, [loadRound]);

  const enrichAndSave = async (surveyData) => {
    const meta = roundMetaRef.current;
    const sess = sessionRef.current;
    if (!meta || !sess.sessionId) throw new Error('No active practice session');

    const questionName = meta.questionName;
    const answerValue = surveyData?.[questionName];
    const pool = currentProject?.preloadedImages || [];
    const shownImages = meta.shownImages || [];
    const shownMediaIds = shownImages.map((u) => {
      if (!u) return null;
      const hit = pool.find((img) => img.url === u || img.name === u);
      return hit ? getMediaId(hit) : String(u).split('?')[0].split('/').pop() || u;
    }).filter(Boolean);
    const enriched = {
      [questionName]: {
        type: meta.questionType,
        answer: answerValue,
        shown_images: shownImages,
        shown_media_ids: shownMediaIds,
        shown_media_group: meta.shownMediaGroup || null,
        shown_media_categories: meta.shownMediaCategories || null,
      },
    };

    const completeData = {
      project_id: currentProject?.id || null,
      participant_id: sess.participantId,
      responses: enriched,
      displayed_images: { [questionName]: meta.shownImages || [] },
      survey_metadata: {
        completion_time: new Date().toISOString(),
        researcher_mode: true,
        practice_mode: true,
        practice_question: questionName,
        session_id: sess.sessionId,
        attempt_index: sess.attemptIndex,
        user_id: user?.id || null,
        user_email: user?.email || null,
      },
    };

    const result = await saveSurveyResponse(completeData);
    if (!result.success) {
      throw new Error(result.error?.message || result.error || 'Save failed');
    }
    return result;
  };

  const submitAndContinue = async () => {
    if (!model || submitting) return;
    setSubmitting(true);
    setError(null);
    setStatusMsg(null);
    try {
      // Validate required fields when possible
      if (!model.validate(true)) {
        setError('Please complete the required fields before submitting.');
        setSubmitting(false);
        return;
      }
      await enrichAndSave(model.data);
      const nextAttempt = sessionRef.current.attemptIndex + 1;
      sessionRef.current = { ...sessionRef.current, attemptIndex: nextAttempt };
      setAttemptIndex(nextAttempt);
      setStatusMsg(`Saved attempt ${nextAttempt - 1}. Loading next…`);
      setModel(null);
      setReloadToken((t) => t + 1);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to save response');
    } finally {
      setSubmitting(false);
    }
  };

  const skipWithoutSave = () => {
    setStatusMsg('Skipped without saving.');
    setModel(null);
    setReloadToken((t) => t + 1);
  };

  if (!currentProject) {
    return <Alert severity="info">Select a project to practice questions.</Alert>;
  }

  if (!questions.length) {
    return (
      <Alert severity="warning">
        This project has no answerable questions yet. Add questions in Survey Builder first.
      </Alert>
    );
  }

  return (
    <Box sx={{ display: 'flex', gap: 2, minHeight: 480, flexDirection: { xs: 'column', md: 'row' } }}>
      <Paper variant="outlined" sx={{ width: { xs: '100%', md: 300 }, flexShrink: 0, maxHeight: 640, overflow: 'auto' }}>
        <Box sx={{ p: 2, pb: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>Questions</Typography>
          <Typography variant="caption" color="text.secondary">
            Select a question, then submit as many times as you want. Each submit is saved as a researcher practice response.
          </Typography>
        </Box>
        <Divider />
        <List dense disablePadding>
          {questions.map((q) => (
            <ListItemButton
              key={q.name}
              selected={selectedName === q.name}
              onClick={() => startSession(q.name)}
            >
              <ListItemText
                primary={q.title || q.name}
                secondary={`${q.type} · ${q.name}`}
                primaryTypographyProps={{ noWrap: true, fontSize: 14 }}
                secondaryTypographyProps={{ noWrap: true, fontSize: 11 }}
              />
            </ListItemButton>
          ))}
        </List>
      </Paper>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {!selectedQuestion && (
          <Alert severity="info">Choose a question on the left to start practicing.</Alert>
        )}

        {selectedQuestion && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 2 }}>
              <Typography variant="h6" sx={{ flex: 1, minWidth: 160 }}>
                {selectedQuestion.title || selectedQuestion.name}
              </Typography>
              {active && (
                <>
                  <Chip size="small" color="primary" label={`Attempt ${attemptIndex}`} />
                  <Chip size="small" variant="outlined" label={`Session …${sessionId.slice(-6)}`} />
                </>
              )}
              {active ? (
                <Button size="small" color="error" startIcon={<Stop />} onClick={stopSession}>
                  Stop
                </Button>
              ) : (
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<PlayArrow />}
                  onClick={() => startSession(selectedQuestion.name)}
                >
                  Start
                </Button>
              )}
            </Stack>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {statusMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setStatusMsg(null)}>{statusMsg}</Alert>}

            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
              </Box>
            )}

            {!loading && model && (
              <Box
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  bgcolor: 'white',
                  p: 1,
                  mb: 2,
                  '& .sd-body': { padding: '12px !important' },
                }}
              >
                <Survey model={model} />
              </Box>
            )}

            {active && !loading && model && (
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  disabled={submitting}
                  onClick={submitAndContinue}
                >
                  {submitting ? 'Saving…' : 'Submit & Next'}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<SkipNext />}
                  disabled={submitting}
                  onClick={skipWithoutSave}
                >
                  Skip (no save)
                </Button>
              </Stack>
            )}

            {roundMeta?.shownImages?.length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                Shown media: {roundMeta.shownImages.map((u) => String(u).split('/').pop()).join(', ')}
              </Typography>
            )}
          </Paper>
        )}
      </Box>
    </Box>
  );
}

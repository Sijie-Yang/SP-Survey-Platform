import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AutoAwesome from '@mui/icons-material/AutoAwesome';
import useReviewSettings from '../../hooks/useReviewSettings';
import { isPlatformMode } from '../../hooks/surveyAssistantUtils';
import CheckCircle from '@mui/icons-material/CheckCircle';
import Close from '@mui/icons-material/Close';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Insights from '@mui/icons-material/Insights';
import PhotoLibrary from '@mui/icons-material/PhotoLibrary';
import PlayCircleOutline from '@mui/icons-material/PlayCircleOutline';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import RestartAlt from '@mui/icons-material/RestartAlt';
import RocketLaunch from '@mui/icons-material/RocketLaunch';
import Science from '@mui/icons-material/Science';
import Share from '@mui/icons-material/Share';
import TipsAndUpdates from '@mui/icons-material/TipsAndUpdates';
import ViewQuilt from '@mui/icons-material/ViewQuilt';
import { useNavigate } from 'react-router-dom';
import { AdminPageHeader } from './AdminPageLayout';
import AdminGuideTour from './AdminGuideTour';
import { useRegion } from '../../contexts/RegionContext';
import { useAuth } from '../../contexts/AuthContext';
import { tf } from '../../contexts/adminI18n';
import { useStreetLevelText } from '../../contexts/streetLevelI18n';
import { supabase } from '../../lib/supabase';
import {
  CHECKLIST_KEYS,
  GUIDE_PROGRESS_EVENT,
  computeGuideChecklist,
  loadGuidePrefs,
  loadGuideProgress,
  resetGuidePrefs,
  saveGuidePrefs,
} from '../../lib/adminGuide';

const TAB = { media: 1, builder: 2, share: 3, results: 4, practice: 5 };
const STREET_LEVEL_OPEN = 'Open street-level panel';

/** The card lives inside the lazily rendered Dataset tab, so poll briefly for its button. */
function revealButtonByText(label, attempts = 20) {
  const button = Array.from(document.querySelectorAll('button')).find((node) => node.textContent.trim() === label);
  if (button) {
    button.scrollIntoView({ block: 'center', behavior: 'smooth' });
    button.focus({ preventScroll: true });
    return;
  }
  if (attempts > 0) setTimeout(() => revealButtonByText(label, attempts - 1), 150);
}

function useResponseCount(projectId) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setCount(null);
    if (!projectId || !supabase) return undefined;
    supabase
      .from('survey_responses')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .then(({ count: total, error }) => {
        if (!cancelled && !error) setCount(total || 0);
      }, () => {});
    return () => { cancelled = true; };
  }, [projectId]);
  return count;
}

function useGuideProgress(projectId) {
  const [progress, setProgress] = useState(() => loadGuideProgress(projectId));
  useEffect(() => {
    setProgress(loadGuideProgress(projectId));
    const refresh = () => setProgress(loadGuideProgress(projectId));
    window.addEventListener(GUIDE_PROGRESS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(GUIDE_PROGRESS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [projectId]);
  return progress;
}

function StepBadge({ icon, done }) {
  return (
    <Box
      sx={{
        flexShrink: 0,
        width: 36,
        height: 36,
        borderRadius: '50%',
        bgcolor: done ? 'success.main' : 'primary.main',
        color: 'primary.contrastText',
        display: 'grid',
        placeItems: 'center',
        '& svg': { fontSize: 20 },
      }}
    >
      {done ? <CheckCircle /> : icon}
    </Box>
  );
}

function SectionCard({ title, icon, onHide, hideLabel, children, sx }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 1.5, height: '100%', ...sx }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Box sx={{ color: 'primary.main', display: 'inline-flex' }}>{icon}</Box>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>{title}</Typography>
        {onHide && (
          <Tooltip title={hideLabel}>
            <IconButton size="small" onClick={onHide} aria-label={`${hideLabel}: ${title}`}>
              <Close fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      {children}
    </Paper>
  );
}

function QuickStart({ t, actions }) {
  const rows = [
    { text: t.guideQuick1, label: t.guideQuick1Action, onClick: actions.openProjects },
    { text: t.guideQuick2, label: tf(t.guideOpenTab, { tab: t.tabMedia }), onClick: () => actions.goTo(TAB.media) },
    { text: t.guideQuick3, label: tf(t.guideOpenTab, { tab: t.tabBuilder }), onClick: () => actions.goTo(TAB.builder) },
    { text: t.guideQuick4, label: t.guideQuick4Action, onClick: actions.openPreview },
    { text: t.guideQuick5, label: tf(t.guideOpenTab, { tab: t.tabShare }), onClick: () => actions.goTo(TAB.share) },
  ];
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t.guideQuickLead}</Typography>
      <Stack component="ol" spacing={1} sx={{ m: 0, pl: 2.5 }}>
        {rows.map((row) => (
          <Typography key={row.text} component="li" variant="body2">
            {row.text}{' '}
            {row.onClick && (
              <Button size="small" onClick={row.onClick} sx={{ textTransform: 'none', py: 0, minWidth: 0 }}>
                {row.label}
              </Button>
            )}
          </Typography>
        ))}
      </Stack>
    </>
  );
}

function Checklist({ t, checklist, actions }) {
  const { items, doneCount, total } = checklist;
  const rows = {
    media: { label: t.guideCheckMedia, detail: items.media.done ? tf(t.guideCheckMediaDone, { n: items.media.count }) : t.guideCheckMediaTodo, tab: TAB.media },
    questions: { label: t.guideCheckQuestions, detail: items.questions.done ? tf(t.guideCheckQuestionsDone, { n: items.questions.count }) : null, tab: TAB.builder },
    preview: { label: t.guideCheckPreview, onClick: actions.openPreview },
    published: { label: t.guideCheckPublished, detail: items.published.version ? tf(t.guideCheckPublishedDone, { n: items.published.version }) : null, tab: TAB.share },
    shared: { label: t.guideCheckShared, tab: TAB.share },
    responses: {
      label: t.guideCheckResponses,
      detail: items.responses.done ? tf(t.guideCheckResponsesDone, { n: items.responses.count })
        : items.responses.unknown ? t.guideCheckResponsesUnknown : null,
      tab: TAB.results,
    },
  };
  return (
    <>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <LinearProgress
          variant="determinate"
          value={(doneCount / total) * 100}
          sx={{ flex: 1, height: 6, borderRadius: 3 }}
          aria-label={t.guideChecklistTitle}
        />
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {tf(t.guideChecklistProgress, { done: doneCount, total })}
        </Typography>
      </Stack>
      {doneCount === total && <Alert severity="success" sx={{ mb: 1, py: 0 }}>{t.guideChecklistAllDone}</Alert>}
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {CHECKLIST_KEYS.map((key) => {
          const row = rows[key];
          const done = items[key].done;
          const go = row.onClick || (() => actions.goTo(row.tab));
          return (
            <Box
              component="li"
              key={key}
              data-testid={`guide-check-${key}`}
              data-done={done ? 'true' : 'false'}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.35 }}
            >
              {done
                ? <CheckCircle color="success" fontSize="small" aria-label={t.guideStatusDone} />
                : <RadioButtonUnchecked color="disabled" fontSize="small" aria-label={t.guideStatusTodo} />}
              <Box
                component="button"
                type="button"
                onClick={go}
                sx={{
                  all: 'unset',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: done ? 400 : 600,
                  color: done ? 'text.secondary' : 'text.primary',
                  '&:hover': { color: 'primary.main', textDecoration: 'underline' },
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.light', borderRadius: 0.5 },
                }}
              >
                {row.label}
              </Box>
              {row.detail && (
                <Typography variant="caption" color="text.secondary" noWrap>· {row.detail}</Typography>
              )}
            </Box>
          );
        })}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        {t.guideChecklistHint}
      </Typography>
    </>
  );
}

function WorkflowStep({ t, step }) {
  return (
    <Paper
      variant="outlined"
      data-testid={`guide-step-${step.id}`}
      sx={{ p: 2, borderRadius: 1.5, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}
    >
      <StepBadge icon={step.icon} done={step.done} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
          <Typography fontWeight={700}>{step.title}</Typography>
          <Typography color="text.secondary">— {step.headline}</Typography>
          {step.tag && <Chip size="small" variant="outlined" label={step.tag} />}
          {step.done != null && (
            <Chip
              size="small"
              color={step.done ? 'success' : 'default'}
              variant={step.done ? 'filled' : 'outlined'}
              label={step.done ? t.guideStatusDone : t.guideStatusTodo}
            />
          )}
        </Stack>
        <Typography variant="body2" sx={{ mb: 0.25 }}>
          <Box component="span" fontWeight={600}>{t.guideWhyLabel}: </Box>
          <Box component="span" color="text.secondary">{step.why}</Box>
        </Typography>
        <Typography variant="body2">
          <Box component="span" fontWeight={600}>{t.guideDoLabel}: </Box>
          <Box component="span" color="text.secondary">{step.what}</Box>
        </Typography>
        {step.extra && (
          <Typography variant="body2" sx={{ mt: 0.25 }}>
            <Box component="span" fontWeight={600}>{step.extra.label}: </Box>
            <Box component="span" color="text.secondary">{step.extra.text}</Box>
          </Typography>
        )}
        {step.hint && (
          <Alert severity="info" icon={<TipsAndUpdates fontSize="small" />} sx={{ mt: 1, py: 0 }}>
            {step.hint}
          </Alert>
        )}
        {step.buttons.length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
            {step.buttons.map((button, i) => (
              <Button
                key={button.label}
                size="small"
                variant={i === 0 ? 'contained' : 'outlined'}
                startIcon={button.icon}
                onClick={button.onClick}
                sx={{ textTransform: 'none' }}
              >
                {button.label}
              </Button>
            ))}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}

function AssistantSection({ t, assistantEnabled, reviewEnabled = false, onOpenAssistant, navigate }) {
  const modes = [
    { label: t.aiSidebarModeAgent, body: t.guideAiAgent },
    { label: t.aiSidebarModeGenerate, body: t.guideAiGenerate },
    { label: t.aiSidebarModeAdjust, body: t.guideAiAdjust },
    { label: t.aiSidebarModeQuestion, body: t.guideAiQuestion },
    ...(reviewEnabled ? [{ label: t.aiSidebarModeReview, body: t.guideAiReview }] : []),
  ];
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2.5, borderRadius: 1.5, border: '2px solid', borderColor: 'primary.main', mb: 3 }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <AutoAwesome color="primary" fontSize="small" />
        <Typography variant="h6" fontWeight={700}>{t.guideAiTitle}</Typography>
      </Stack>
      {!assistantEnabled && <Alert severity="info" sx={{ mb: 1.5 }}>{t.guideAiOff}</Alert>}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t.guideAiLead}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25, mb: 1.5 }}>
        {modes.map((mode) => (
          <Box
            key={mode.label}
            sx={{ p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.default' }}
          >
            <Chip size="small" color="primary" label={mode.label} sx={{ mb: 0.5, fontWeight: 700 }} />
            <Typography variant="body2" color="text.secondary">{mode.body}</Typography>
          </Box>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
        {t.guideAiSetupHint}
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        {assistantEnabled && onOpenAssistant && (
          <Button size="small" variant="contained" startIcon={<AutoAwesome />} onClick={onOpenAssistant} sx={{ textTransform: 'none' }}>
            {t.guideAiOpen}
          </Button>
        )}
        <Button size="small" variant="outlined" onClick={() => navigate('/admin/integrations')} sx={{ textTransform: 'none' }}>
          {t.guideAiSetup}
        </Button>
      </Stack>
      <Accordion
        disableGutters
        elevation={0}
        sx={{ bgcolor: 'transparent', '&:before': { display: 'none' }, borderTop: '1px solid', borderColor: 'divider' }}
      >
        <AccordionSummary expandIcon={<ExpandMore />} sx={{ px: 0 }}>
          <Typography variant="body2" fontWeight={600}>{t.guideMcpTitle}</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0, pt: 0 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t.guideMcpBody}</Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              bgcolor: 'background.default',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              fontSize: 12.5,
              whiteSpace: 'pre-wrap',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {t.guideMcpExample}
          </Box>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}

/**
 * Introduction tab: step-by-step guide to the Admin workflow with
 * first-time aids (quick start, self-ticking checklist, top-bar tour).
 */
export default function AdminIntroduction({
  onGoToTab,
  currentProject = null,
  surveyConfig = null,
  assistantEnabled = true,
  siliconEnabled = false,
  onOpenAssistant,
  onOpenProjects,
  onOpenPreview,
  onOpenSilicon,
}) {
  const navigate = useNavigate();
  const { t } = useRegion();
  const tsl = useStreetLevelText();
  const { user } = useAuth();
  const userId = user?.id || 'anonymous';
  const reviewSettings = useReviewSettings(user?.id || null);
  const reviewEnabled = isPlatformMode() && reviewSettings.enabled;
  const [prefs, setPrefs] = useState(() => loadGuidePrefs(userId));
  const [tourOpen, setTourOpen] = useState(false);
  const progress = useGuideProgress(currentProject?.id);
  const responseCount = useResponseCount(currentProject?.id);

  useEffect(() => { setPrefs(loadGuidePrefs(userId)); }, [userId]);

  useEffect(() => {
    if (prefs.tourDone) return undefined;
    const timer = setTimeout(() => setTourOpen(true), 700);
    return () => clearTimeout(timer);
  }, [prefs.tourDone]);

  const updatePrefs = useCallback((patch) => setPrefs(saveGuidePrefs(userId, patch)), [userId]);
  const closeTour = useCallback(() => {
    setTourOpen(false);
    updatePrefs({ tourDone: true });
  }, [updatePrefs]);
  const restartGuide = () => {
    resetGuidePrefs(userId);
    setPrefs(saveGuidePrefs(userId, { quickstartHidden: false }));
    setTourOpen(true);
  };

  const checklist = useMemo(
    () => computeGuideChecklist({ project: currentProject, surveyConfig, progress, responseCount }),
    [currentProject, surveyConfig, progress, responseCount],
  );
  const { items } = checklist;
  const goTo = (tab) => onGoToTab?.(tab);
  const actions = {
    goTo,
    openProjects: onOpenProjects,
    openPreview: onOpenPreview || (() => goTo(TAB.practice)),
  };

  const showQuickstart = prefs.quickstartHidden === false
    || (prefs.quickstartHidden == null && !items.published.done);
  const showChecklist = !prefs.checklistHidden;

  const openTabButton = (tabKey, tab, icon) => ({
    label: tf(t.guideOpenTab, { tab: t[tabKey] }),
    onClick: () => goTo(tab),
    icon,
  });

  const steps = [
    {
      id: 'media',
      icon: <PhotoLibrary />,
      title: t.tabMedia,
      headline: t.guideMediaHeadline,
      tag: t.guideOptional,
      why: t.guideMediaWhy,
      what: t.guideMediaDo,
      done: items.media.done,
      extra: {
        label: tsl('Street-level imagery'),
        text: tsl('Pick points on our own map or paste Google Street View URLs, then a small helper on your computer downloads the views (no API key) into this media library with location metadata.'),
      },
      hint: items.media.done ? null : t.guideMediaEmpty,
      buttons: [
        openTabButton('tabMedia', TAB.media),
        {
          label: tsl('Street-level imagery'),
          onClick: () => {
            goTo(TAB.media);
            revealButtonByText(tsl(STREET_LEVEL_OPEN));
          },
        },
      ],
    },
    {
      id: 'builder',
      icon: <ViewQuilt />,
      title: t.tabBuilder,
      headline: t.guideBuilderHeadline,
      why: t.guideBuilderWhy,
      what: t.guideBuilderDo,
      done: items.questions.done,
      hint: items.questions.done ? null : t.guideBuilderEmpty,
      buttons: [
        openTabButton('tabBuilder', TAB.builder),
        ...(assistantEnabled && onOpenAssistant ? [{ label: t.guideAiOpen, onClick: onOpenAssistant, icon: <AutoAwesome /> }] : []),
      ],
    },
    {
      id: 'try',
      icon: <PlayCircleOutline />,
      title: t.tabPractice,
      headline: t.guideTryHeadline,
      tag: t.guideBeforeShare,
      why: t.guideTryWhy,
      what: t.guideTryDo,
      done: items.preview.done,
      hint: items.preview.done || !items.questions.done ? null : t.guideTryEmpty,
      buttons: [
        ...(onOpenPreview ? [{ label: t.guidePreviewAction, onClick: onOpenPreview }] : []),
        openTabButton('tabPractice', TAB.practice),
      ],
    },
    {
      id: 'silicon',
      icon: <Science />,
      title: t.tabSilicon,
      headline: t.guideSiliconHeadline,
      tag: t.guideOptional,
      why: t.guideSiliconWhy,
      what: t.guideSiliconDo,
      done: null,
      hint: siliconEnabled ? null : t.guideSiliconOff,
      buttons: siliconEnabled && onOpenSilicon
        ? [{ label: tf(t.guideOpenTab, { tab: t.tabSilicon }), onClick: onOpenSilicon }]
        : [],
    },
    {
      id: 'share',
      icon: <Share />,
      title: t.tabShare,
      headline: t.guideShareHeadline,
      why: t.guideShareWhy,
      what: t.guideShareDo,
      done: items.published.done,
      hint: items.published.done ? null : t.guideShareEmpty,
      buttons: [openTabButton('tabShare', TAB.share)],
    },
    {
      id: 'results',
      icon: <Insights />,
      title: t.tabResults,
      headline: t.guideResultsHeadline,
      why: t.guideResultsWhy,
      what: t.guideResultsDo,
      done: items.responses.unknown ? null : items.responses.done,
      hint: items.responses.done || items.responses.unknown ? null : t.guideResultsEmpty,
      buttons: [openTabButton('tabResults', TAB.results)],
    },
  ];

  return (
    <Box>
      <AdminPageHeader
        icon={<RocketLaunch />}
        title={t.guideTitle}
        description={t.guideBody}
        actions={(
          <>
            {!showQuickstart && (
              <Button size="small" onClick={() => updatePrefs({ quickstartHidden: false })} sx={{ textTransform: 'none' }}>
                {t.guideShowQuickstart}
              </Button>
            )}
            {!showChecklist && (
              <Button size="small" onClick={() => updatePrefs({ checklistHidden: false })} sx={{ textTransform: 'none' }}>
                {t.guideShowChecklist}
              </Button>
            )}
            <Button size="small" variant="outlined" onClick={() => setTourOpen(true)} sx={{ textTransform: 'none' }}>
              {t.guideStartTour}
            </Button>
          </>
        )}
      />

      {(showQuickstart || showChecklist) && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: showQuickstart && showChecklist ? '3fr 2fr' : '1fr' },
            gap: 2,
            mb: 3,
          }}
        >
          {showQuickstart && (
            <SectionCard
              title={t.guideQuickTitle}
              icon={<RocketLaunch fontSize="small" />}
              onHide={() => updatePrefs({ quickstartHidden: true })}
              hideLabel={t.guideHide}
              sx={{ bgcolor: 'background.default' }}
            >
              <QuickStart t={t} actions={actions} />
            </SectionCard>
          )}
          {showChecklist && (
            <SectionCard
              title={t.guideChecklistTitle}
              icon={<CheckCircle fontSize="small" />}
              onHide={() => updatePrefs({ checklistHidden: true })}
              hideLabel={t.guideHide}
            >
              <Checklist t={t} checklist={checklist} actions={actions} />
            </SectionCard>
          )}
        </Box>
      )}

      <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>{t.guideStepsTitle}</Typography>
      <Stack spacing={1.5} sx={{ mb: 3 }}>
        {steps.map((step) => <WorkflowStep key={step.id} t={t} step={step} />)}
      </Stack>

      <AssistantSection
        t={t}
        assistantEnabled={assistantEnabled}
        reviewEnabled={reviewEnabled}
        onOpenAssistant={onOpenAssistant}
        navigate={navigate}
      />

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button
          size="small"
          startIcon={<RestartAlt />}
          onClick={restartGuide}
          data-tour="guide-restart"
          sx={{ textTransform: 'none' }}
        >
          {t.guideRestart}
        </Button>
        <Typography variant="caption" color="text.secondary">{t.guideRestartHint}</Typography>
      </Stack>

      <AdminGuideTour open={tourOpen} onClose={closeTour} />
    </Box>
  );
}

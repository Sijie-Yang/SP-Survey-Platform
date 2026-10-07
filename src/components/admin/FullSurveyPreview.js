import React, { useMemo, useState } from 'react';
import { Box, Slider, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';
import { setViewportLayoutField, updateSurveyText, VIEWPORT_LAYOUT_LIMITS, viewportSlot } from '../../lib/viewportLayout';
import SurveyPreview from './SurveyPreview';

/** Format studio for the whole survey. Text and order are shared; sizes are per viewport. */
export default function FullSurveyPreview({ config, currentProject, onConfigChange }) {
  const { t } = useRegion();
  const [viewport, setViewport] = useState('desktop');
  const slot = viewportSlot(config, viewport);
  const limits = VIEWPORT_LAYOUT_LIMITS[viewport];
  const viewportLabel = viewport === 'mobile' ? t.previewMobile : t.previewDesktop;
  const labels = useMemo(() => ({
    questionText: t.previewQuestionText,
    questionDescription: t.previewQuestionDescription,
    pageTitle: t.previewPageTitle,
    pageDescription: t.previewPageDescription,
    surveyTitle: t.previewSurveyTitle,
    surveyDescription: t.previewSurveyDescription,
    editSurveyTitle: t.previewEditSurveyTitle,
    editSurveyDescription: t.previewEditSurveyDescription,
    moveUp: t.previewMoveUp,
    moveDown: t.previewMoveDown,
    reorderQuestion: t.previewReorderQuestion,
    reorderPage: t.previewReorderPage,
    moveQuestionUp: t.previewMoveQuestionUp,
    moveQuestionDown: t.previewMoveQuestionDown,
    movePageUp: t.previewMovePageUp,
    movePageDown: t.previewMovePageDown,
    mediaAssignment: t.previewMediaAssignment,
  }), [t]);

  const changeField = (field) => (_event, value) => {
    onConfigChange?.(setViewportLayoutField(config, viewport, field, value));
  };
  const changeSurveyField = (field) => (event) => {
    onConfigChange?.(updateSurveyText(config, field, event.target.value));
  };
  const questionMax = Math.min(limits.questionWidth[1], slot.contentWidth);

  return (
    <Box>
      <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} alignItems="center" sx={{ mb: 0.5 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={viewport}
          onChange={(_event, next) => { if (next) setViewport(next); }}
          aria-label={t.previewDevice}
        >
          <ToggleButton value="desktop">
            <DesktopWindowsIcon fontSize="small" sx={{ mr: 0.75 }} />
            {t.previewDesktop}
          </ToggleButton>
          <ToggleButton value="mobile">
            <SmartphoneIcon fontSize="small" sx={{ mr: 0.75 }} />
            {t.previewMobile}
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="body2" data-preview-sizing="">
          {tf(t.previewSizing, { viewport: viewportLabel })}
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        {t.previewFormatOnly}
      </Typography>

      <Stack spacing={1.25} sx={{ mb: 2, maxWidth: 560 }}>
        <TextField
          size="small"
          fullWidth
          label={t.previewSurveyTitle}
          value={config?.title || ''}
          onChange={changeSurveyField('title')}
        />
        <TextField
          size="small"
          fullWidth
          label={t.previewSurveyDescription}
          value={config?.description || ''}
          onChange={changeSurveyField('description')}
        />
        <TextField
          size="small"
          fullWidth
          label={t.previewLogoUrl}
          value={config?.logo || ''}
          onChange={changeSurveyField('logo')}
          placeholder="https://example.com/logo.png"
          helperText={t.previewLogoHelp}
        />
      </Stack>

      <Box sx={{ mb: 2, maxWidth: 560 }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
          <Typography variant="body2" id="sp-preview-content-width" sx={{ flex: 1 }}>
            {t.previewContentWidth}
          </Typography>
          <Typography variant="body2" data-preview-content-width="" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {slot.contentWidth} px
          </Typography>
        </Stack>
        <Slider
          size="small"
          aria-labelledby="sp-preview-content-width"
          aria-label={t.previewContentWidth}
          value={slot.contentWidth}
          min={limits.contentWidth[0]}
          max={limits.contentWidth[1]}
          step={10}
          onChange={changeField('contentWidth')}
        />
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5, mt: 1 }}>
          <Typography variant="body2" id="sp-preview-question-width" sx={{ flex: 1 }}>
            {t.previewQuestionWidth}
          </Typography>
          <Typography variant="body2" data-preview-question-width="" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {slot.questionWidth} px
          </Typography>
        </Stack>
        <Slider
          size="small"
          aria-labelledby="sp-preview-question-width"
          aria-label={t.previewQuestionWidth}
          value={slot.questionWidth}
          min={Math.min(limits.questionWidth[0], questionMax)}
          max={questionMax}
          step={10}
          onChange={changeField('questionWidth')}
        />
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5, mt: 1 }}>
          <Typography variant="body2" id="sp-preview-media-size" sx={{ flex: 1 }}>
            {t.previewMediaSize}
          </Typography>
          <Typography variant="body2" data-preview-media-size="" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {slot.mediaMaxHeight} px
          </Typography>
        </Stack>
        <Slider
          size="small"
          aria-labelledby="sp-preview-media-size"
          aria-label={t.previewMediaSize}
          value={slot.mediaMaxHeight}
          min={limits.mediaMaxHeight[0]}
          max={limits.mediaMaxHeight[1]}
          step={10}
          onChange={changeField('mediaMaxHeight')}
        />
      </Box>

      <SurveyPreview
        interactive
        config={config}
        currentProject={currentProject}
        onConfigChange={onConfigChange}
        viewport={viewport}
        contentWidth={slot.contentWidth}
        questionWidth={slot.questionWidth}
        mediaMaxHeight={slot.mediaMaxHeight}
        labels={labels}
      />
    </Box>
  );
}

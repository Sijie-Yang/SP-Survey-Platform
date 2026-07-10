import React, { useEffect, useMemo, useState } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/defaultV2.min.css';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import registerImageRankingWidget, {
  registerImageRatingWidget, registerImageBooleanWidget, registerAllExtendedWidgets,
} from '../SurveyCustomComponents';
import {
  applyMediaToElement,
  defaultMediaCount,
  filterPoolForQuestion,
  isCuratedMediaMode,
  resolveCuratedImages,
} from '../../lib/surveyMediaInjection';
import { clampQuestionImageCount } from '../../lib/questionTypeConstraints';
import { normalizeBuilderQuestion } from '../../lib/surveyStorage';

let widgetsRegistered = false;
function ensureWidgets() {
  if (widgetsRegistered) return;
  registerImageRankingWidget();
  registerImageRatingWidget();
  registerImageBooleanWidget();
  registerAllExtendedWidgets();
  widgetsRegistered = true;
}

function resolvePreviewImages(question, projectImages) {
  const count = clampQuestionImageCount(
    question.type,
    question,
    question.imageCount ?? defaultMediaCount(question),
  );
  if (isCuratedMediaMode(question) && question.selectedImageUrls?.length) {
    return resolveCuratedImages(question, projectImages).slice(0, count);
  }
  const pool = filterPoolForQuestion(projectImages || [], question);
  return pool.slice(0, count);
}

/** Mirror SurveyPreview panel conversions for composite image/media types. */
function toPreviewElement(element) {
  if (element.type === 'imageboolean' && element.imageHtml) {
    return {
      type: 'panel',
      name: `${element.name}_panel`,
      title: 'See below images:',
      description: element.description,
      state: 'expanded',
      elements: [
        { type: 'html', name: `${element.name}_images`, html: element.imageHtml },
        {
          type: 'boolean',
          name: element.name,
          title: element.title,
          isRequired: element.isRequired,
          labelTrue: element.labelTrue || 'Yes',
          labelFalse: element.labelFalse || 'No',
          valueTrue: element.valueTrue,
          valueFalse: element.valueFalse,
        },
      ],
    };
  }
  if (element.type === 'imagerating' && element.imageHtml) {
    return {
      type: 'panel',
      name: `${element.name}_panel`,
      title: 'See below images:',
      description: element.description,
      state: 'expanded',
      elements: [
        { type: 'html', name: `${element.name}_images`, html: element.imageHtml },
        {
          type: 'rating',
          name: element.name,
          title: element.title,
          isRequired: element.isRequired,
          rateMin: element.rateMin || 1,
          rateMax: element.rateMax || 5,
          minRateDescription: element.minRateDescription,
          maxRateDescription: element.maxRateDescription,
        },
      ],
    };
  }
  if (element.type === 'imagematrix' && element.imageHtml) {
    return {
      type: 'panel',
      name: `${element.name}_panel`,
      title: 'See below images:',
      description: element.description,
      state: 'expanded',
      elements: [
        { type: 'html', name: `${element.name}_images`, html: element.imageHtml },
        {
          type: 'matrix',
          name: element.name,
          title: element.title,
          isRequired: element.isRequired,
          columns: element.columns,
          rows: element.rows,
        },
      ],
    };
  }
  if (element.type === 'mediarating' && element.imageHtml) {
    return {
      type: 'panel',
      name: `${element.name}_panel`,
      title: 'See below images:',
      description: element.description,
      state: 'expanded',
      elements: [
        { type: 'html', name: `${element.name}_images`, html: element.imageHtml },
        {
          type: 'rating',
          name: element.name,
          title: element.title,
          isRequired: element.isRequired,
          rateMin: element.rateMin || 1,
          rateMax: element.rateMax || 5,
          minRateDescription: element.minRateDescription,
          maxRateDescription: element.maxRateDescription,
        },
      ],
    };
  }
  if (element.type === 'mediaboolean' && element.imageHtml) {
    return {
      type: 'panel',
      name: `${element.name}_panel`,
      title: 'See below images:',
      description: element.description,
      state: 'expanded',
      elements: [
        { type: 'html', name: `${element.name}_images`, html: element.imageHtml },
        {
          type: 'boolean',
          name: element.name,
          title: element.title,
          isRequired: element.isRequired,
          labelTrue: element.labelTrue || 'Yes',
          labelFalse: element.labelFalse || 'No',
          valueTrue: element.valueTrue,
          valueFalse: element.valueFalse,
        },
      ],
    };
  }
  if (element.type === 'imageslidergroup' && element.imageHtml) {
    return {
      type: 'panel',
      name: `${element.name}_panel`,
      title: 'See below images:',
      description: element.description,
      state: 'expanded',
      elements: [
        { type: 'html', name: `${element.name}_images`, html: element.imageHtml },
        {
          type: 'slidergroup',
          name: element.name,
          title: element.title,
          isRequired: element.isRequired,
          dimensions: element.dimensions || [],
          scaleMin: element.scaleMin ?? 1,
          scaleMax: element.scaleMax ?? 7,
        },
      ],
    };
  }
  if (element.type === 'imagepointallocation' && element.imageHtml) {
    return {
      type: 'panel',
      name: `${element.name}_panel`,
      title: 'See below images:',
      description: element.description,
      state: 'expanded',
      elements: [
        { type: 'html', name: `${element.name}_images`, html: element.imageHtml },
        {
          type: 'pointallocation',
          name: element.name,
          title: element.title,
          isRequired: element.isRequired,
          choices: element.choices || [],
          budget: element.budget ?? 100,
        },
      ],
    };
  }
  return element;
}

/**
 * Live single-question SurveyJS preview for the question editor (non-skill types).
 */
export default function QuestionParticipantPreview({ question, currentProject }) {
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);

  const previewKey = useMemo(() => {
    try {
      return JSON.stringify({
        type: question?.type,
        title: question?.title,
        description: question?.description,
        imageSelectionMode: question?.imageSelectionMode,
        selectedImageUrls: question?.selectedImageUrls,
        imageCount: question?.imageCount,
        mediaType: question?.mediaType,
        displayMode: question?.displayMode,
        rateMin: question?.rateMin,
        rateMax: question?.rateMax,
        labelTrue: question?.labelTrue,
        labelFalse: question?.labelFalse,
        multiSelect: question?.multiSelect,
        choices: question?.choices,
        rows: question?.rows,
        columns: question?.columns,
        dimensions: question?.dimensions,
        scaleMin: question?.scaleMin,
        scaleMax: question?.scaleMax,
        budget: question?.budget,
        allowedTools: question?.allowedTools,
        minAnnotations: question?.minAnnotations,
        maxAnnotations: question?.maxAnnotations,
        beforeLabel: question?.beforeLabel,
        afterLabel: question?.afterLabel,
        exposureSeconds: question?.exposureSeconds,
        isRequired: question?.isRequired,
        maxLength: question?.maxLength,
        minRateDescription: question?.minRateDescription,
        maxRateDescription: question?.maxRateDescription,
      });
    } catch {
      return String(Date.now());
    }
  }, [question]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      try {
        ensureWidgets();
        if (!question?.type) {
          setModel(null);
          return;
        }
        const element = normalizeBuilderQuestion(JSON.parse(JSON.stringify(question)));
        if (!element.name) element.name = 'preview_q';
        const projectImages = currentProject?.preloadedImages || [];
        const images = resolvePreviewImages(question, projectImages);
        if (images.length) {
          applyMediaToElement(element, images);
        }
        const previewEl = toPreviewElement(element);
        const surveyJson = {
          showNavigationButtons: false,
          showCompletedPage: false,
          pages: [{ name: 'p1', elements: [previewEl] }],
        };
        const m = new Model(surveyJson);
        m.mode = 'display';
        m.showPreviewBeforeComplete = false;
        if (!cancelled) {
          setError(null);
          setModel(m);
        }
      } catch (err) {
        console.error('Question preview failed:', err);
        if (!cancelled) {
          setError(err.message || 'Preview failed');
          setModel(null);
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewKey, currentProject?.preloadedImages]);

  if (error) {
    return <Alert severity="warning" sx={{ py: 0.5 }}>{error}</Alert>;
  }
  if (!model) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'white',
        p: 1,
        '& .sd-root-modern': { ['--sjs-font-size']: '14px' },
        '& .sd-body': { padding: '8px !important' },
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
        Live preview — uses curated files when set, otherwise a sample from the project media pool.
      </Typography>
      <Survey model={model} />
    </Box>
  );
}

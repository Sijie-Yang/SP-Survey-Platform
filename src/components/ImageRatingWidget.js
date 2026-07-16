import React, { useId } from 'react';
import { Box, Typography } from '@mui/material';
import { resolveQuestionImageChoices } from '../lib/questionImageChoices';

/**
 * SurveyJS defaultV2 "labels" rating look (1–5 buttons), same as preview panel conversion.
 * Implemented with sd-rating CSS classes — embedding SurveyQuestionRating outside a
 * <Survey> tree does not reliably paint the rate items.
 */
export function SurveyJsRatingControl({
  rateMin = 1,
  rateMax = 5,
  minRateDescription = '',
  maxRateDescription = '',
  value,
  onChange,
}) {
  const groupId = useId();
  const min = Number(rateMin) || 1;
  const max = Number(rateMax) || 5;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const values = [];
  for (let v = lo; v <= hi; v += 1) values.push(v);

  const selected = value === undefined || value === null || value === ''
    ? null
    : Number(value);

  return (
    <Box
      className="sd-scrollable-container sd-rating sd-rating--wrappable sp-surveyjs-rating"
      sx={{
        mt: 1.5,
        width: '100%',
        '& fieldset': {
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '4px',
          border: 0,
          margin: 0,
          padding: 0,
          minInlineSize: 0,
        },
      }}
    >
      <fieldset role="radiogroup" aria-label="Rating">
        {minRateDescription ? (
          <span className="sd-rating__item-text sd-rating__min-text">{minRateDescription}</span>
        ) : null}
        {values.map((v) => {
          const isSelected = selected === v;
          return (
            <label
              key={v}
              className={[
                'sd-rating__item',
                'sd-rating__item--allowhover',
                'sd-rating__item--fixed-size',
                isSelected ? 'sd-rating__item--selected' : '',
              ].filter(Boolean).join(' ')}
            >
              <input
                type="radio"
                className="sv-visuallyhidden"
                name={groupId}
                value={v}
                checked={isSelected}
                onChange={() => onChange?.(v)}
              />
              <span className="sd-rating__item-text">{v}</span>
            </label>
          );
        })}
        {maxRateDescription ? (
          <span className="sd-rating__item-text sd-rating__max-text">{maxRateDescription}</span>
        ) : null}
      </fieldset>
    </Box>
  );
}

/** Same `.sp-image-gallery` path as imageHtml / mediarating (imagePickerLayout). */
function ImageStimulus({ question, trialStimulusMedia = null }) {
  const images = resolveQuestionImageChoices(question, trialStimulusMedia);
  // Multi-trial: never prefer stale question.imageHtml over the active trial set.
  if (!trialStimulusMedia?.length && question.imageHtml) {
    return (
      <Box
        className="sp-imagerating-html"
        sx={{ mb: 2 }}
        dangerouslySetInnerHTML={{ __html: question.imageHtml }}
      />
    );
  }

  if (!images.length) {
    return (
      <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
        <Typography>No images available for rating</Typography>
      </Box>
    );
  }

  return (
    <Box className="sp-image-gallery" sx={{ mb: 2 }}>
      {images.map((item, index) => (
        <Box
          key={`${item.imageLink}_${item.value || index}`}
          className="sp-image-gallery__item"
        >
          <Box className="sp-image-gallery__image-container">
            <Box component="img" src={item.imageLink} alt={`Image ${index + 1}`} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export default function ImageRatingWidget({ question, value, onValueChanged, trialStimulusMedia = null }) {
  const images = resolveQuestionImageChoices(question, trialStimulusMedia);
  const hasHtml = !trialStimulusMedia?.length && Boolean(question?.imageHtml);
  if (!hasHtml && !images.length) {
    return (
      <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
        <Typography>No images available for rating</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      <ImageStimulus question={question} trialStimulusMedia={trialStimulusMedia} />
      <SurveyJsRatingControl
        rateMin={question.rateMin ?? 1}
        rateMax={question.rateMax ?? 5}
        minRateDescription={question.minRateDescription || ''}
        maxRateDescription={question.maxRateDescription || ''}
        value={value}
        onChange={onValueChanged}
      />
    </Box>
  );
}

/**
 * Pure helpers for SurveyApp completion payload construction.
 * Keeps media metadata contracts testable without SurveyJS/DOM.
 */

/** Map SurveyJS image_N choice values back to shown image URLs/names. */
export function mapImageChoiceAnswerToNames(answerValue, shownImages) {
  if (!shownImages || shownImages.length === 0) return answerValue;

  const mapSingleValue = (value) => {
    if (typeof value !== 'string') return value;
    const match = value.match(/^image_(\d+)$/);
    if (!match) return value;
    const imageIndex = parseInt(match[1], 10);
    return shownImages[imageIndex] || value;
  };

  if (Array.isArray(answerValue)) {
    return answerValue.map(mapSingleValue);
  }
  return mapSingleValue(answerValue);
}

function resolveShownMediaIds(shownImages, preloadedImages = []) {
  const pool = preloadedImages || [];
  return (shownImages || []).map((u) => {
    if (!u) return null;
    const hit = pool.find((img) => img.url === u || img.name === u);
    return hit?.media_id || hit?.key || String(u).split('?')[0].split('/').pop() || u;
  }).filter(Boolean);
}

/**
 * Build per-question enriched response objects and top-level displayed_* mirrors.
 *
 * @returns {{
 *   enrichedResponses: Object,
 *   displayed_images: Object,
 *   displayed_media_groups: Object,
 *   displayed_media_categories: Object,
 * }}
 */
export function enrichSurveyResponses({
  responses = {},
  questionTypeMap = {},
  displayedImages = {},
  displayedMediaGroups = {},
  displayedMediaCategories = {},
  preloadedImages = [],
} = {}) {
  const enrichedResponses = Object.entries(responses || {}).reduce((acc, [questionName, answerValue]) => {
    const shownImages = displayedImages[questionName] || [];
    const mappedAnswer = mapImageChoiceAnswerToNames(answerValue, shownImages);
    acc[questionName] = {
      type: questionTypeMap[questionName] || null,
      answer: mappedAnswer,
      shown_images: shownImages,
      shown_media_ids: resolveShownMediaIds(shownImages, preloadedImages),
      shown_media_set: displayedMediaGroups[questionName] || null,
      shown_media_group: displayedMediaGroups[questionName] || null,
      shown_media_categories: displayedMediaCategories[questionName] || null,
    };
    return acc;
  }, {});

  return {
    enrichedResponses,
    displayed_images: { ...(displayedImages || {}) },
    displayed_media_groups: { ...(displayedMediaGroups || {}) },
    displayed_media_categories: { ...(displayedMediaCategories || {}) },
  };
}

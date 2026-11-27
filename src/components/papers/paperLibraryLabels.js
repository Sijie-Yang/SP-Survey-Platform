import { facetLabel } from '../../lib/templateFacets';

/**
 * Names for the paper library cards and their bars. Bars use the template
 * facet vocabulary (templateFacets.js), including the location names.
 */

export const CARD_TITLES = {
  year: { en: 'Year', zh: '发表年份' },
  concept: { en: 'Perception', zh: '感知概念' },
  task: { en: 'Question type', zh: '提问方式' },
  modality: { en: 'What people see', zh: '看什么' },
  participants: { en: 'Participants', zh: '参与者' },
  sample: { en: 'Sample size', zh: '样本量' },
  country: { en: 'Study location', zh: '研究地点' },
  city: { en: 'City', zh: '城市' },
};

export function barLabel(zh, dimension, id, fallback) {
  const label = facetLabel(dimension, id, zh);
  return label && label !== id ? label : (fallback || id);
}

export function cardTitle(zh, dimension) {
  const t = CARD_TITLES[dimension];
  if (!t) return dimension;
  return zh ? t.zh : t.en;
}

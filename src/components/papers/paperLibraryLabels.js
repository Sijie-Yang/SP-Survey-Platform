import { facetLabel } from '../../lib/templateFacets';

/**
 * Names for the paper library cards and their bars. Bars use the template
 * facet vocabulary (templateFacets.js), including the location names.
 */

export const CARD_TITLES = {
  year: { en: 'Year', zh: '发表年份' },
  concept: { en: 'Perception', zh: '感知概念' },
  scene: { en: 'Scene', zh: '场景' },
  modality: { en: 'Stimulus', zh: '刺激材料' },
  task: { en: 'Response format', zh: '回答方式' },
  setting: { en: 'Setting', zh: '实施方式' },
  participants: { en: 'Participants', zh: '参与者' },
  sample: { en: 'Sample size', zh: '样本量' },
  country: { en: 'Experiment location: country / region', zh: '实验地点：国家或地区' },
  city: { en: 'Experiment location: city', zh: '实验地点：城市' },
  team_org: { en: 'Research team: institution', zh: '研究团队单位' },
  team_country: { en: 'Research team: country / region', zh: '研究团队地区' },
};

/** One line under each card title: the question the category answers. */
export const CARD_QUESTIONS = {
  concept: { en: 'What participants judge or feel', zh: '让参与者评价或感受什么' },
  scene: { en: 'What kind of place is studied', zh: '研究的是哪类地方' },
  modality: { en: 'What participants are shown or played', zh: '给参与者看或听什么材料' },
  task: { en: 'How participants answer', zh: '参与者怎么作答' },
  setting: { en: 'How participants take part', zh: '参与者在什么条件下参加' },
  participants: { en: 'Who answers', zh: '答题的是什么人' },
  sample: { en: 'How many people answered', zh: '多少人答题' },
  country: { en: 'Where participants took part', zh: '参与者在哪里参加实验' },
  city: { en: 'Where participants took part', zh: '参与者在哪里参加实验' },
  team_org: { en: "The authors' institutions", zh: '作者所在单位' },
  team_country: { en: "Where the authors' institutions are", zh: '作者单位所在的国家或地区' },
};

export function cardQuestion(zh, dimension) {
  const q = CARD_QUESTIONS[dimension];
  return q ? (zh ? q.zh : q.en) : '';
}

export function barLabel(zh, dimension, id, fallback) {
  const label = facetLabel(dimension, id, zh);
  return label && label !== id ? label : (fallback || id);
}

export function cardTitle(zh, dimension) {
  const t = CARD_TITLES[dimension];
  if (!t) return dimension;
  return zh ? t.zh : t.en;
}

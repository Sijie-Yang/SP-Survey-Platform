/**
 * Plain bilingual names for the paper library cards and their bars.
 * Keys are `${dimension}:${id}`; anything missing falls back to the English
 * taxonomy label.
 */
const ZH = {
  'perception:safety': '安全感',
  'perception:greenness': '绿化',
  'perception:walkability': '步行友好',
  'perception:aesthetics': '美观',
  'perception:thermal': '热舒适',
  'perception:comfort': '舒适',
  'perception:preference': '视觉偏好',
  'perception:enclosure': '围合 / 开敞',
  'perception:liveliness': '活力',
  'perception:restorativeness': '恢复性',
  'perception:complexity': '视觉复杂度',
  'perception:oppressiveness': '压抑感',
  'responseProtocol:rating_scale': '打分',
  'responseProtocol:pairwise': '两两比较',
  'responseProtocol:ranking': '排序',
  'responseProtocol:discrete_choice': '选择实验',
  'responseProtocol:categorical_annotation': '分类标注',
  'responseProtocol:open_ended': '开放回答',
  'stimulus:street_view': '街景图',
  'stimulus:photo': '照片',
  'stimulus:vr': 'VR',
  'stimulus:panorama': '全景 / 360°',
  'stimulus:rendered': '渲染图',
  'scale:street': '街道',
  'scale:neighborhood': '社区',
  'scale:city': '城市整体',
  'scale:building': '建筑立面',
  'scale:indoor': '室内',
  'scale:campus': '校园',
  'countries:china': '中国',
  'countries:usa': '美国',
  'countries:uk': '英国',
  'countries:japan': '日本',
  'countries:korea': '韩国',
  'countries:singapore': '新加坡',
  'countries:australia': '澳大利亚',
  'countries:netherlands': '荷兰',
  'countries:germany': '德国',
  'countries:france': '法国',
  'countries:spain': '西班牙',
  'countries:italy': '意大利',
  'countries:sweden': '瑞典',
  'countries:austria': '奥地利',
};

export const CARD_TITLES = {
  year: { en: 'Year', zh: '发表年份' },
  perception: { en: 'Perception', zh: '感知概念' },
  responseProtocol: { en: 'Question type', zh: '提问方式' },
  stimulus: { en: 'What people see', zh: '看什么' },
  scale: { en: 'Spatial scale', zh: '空间尺度' },
  countries: { en: 'Study location', zh: '研究地点' },
};

export function barLabel(zh, dimension, id, fallback) {
  if (zh && ZH[`${dimension}:${id}`]) return ZH[`${dimension}:${id}`];
  return fallback || id;
}

export function cardTitle(zh, dimension) {
  const t = CARD_TITLES[dimension];
  if (!t) return dimension;
  return zh ? t.zh : t.en;
}

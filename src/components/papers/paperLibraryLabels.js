import { facetLabel } from '../../lib/templateFacets';

/**
 * Names for the paper library cards and their bars. Bars use the template
 * facet vocabulary (templateFacets.js); countries are stored in English and
 * get a Chinese name here when we know one.
 */
const COUNTRY_ZH = {
  China: '中国',
  USA: '美国',
  UK: '英国',
  Japan: '日本',
  'South Korea': '韩国',
  Singapore: '新加坡',
  Australia: '澳大利亚',
  Netherlands: '荷兰',
  Germany: '德国',
  France: '法国',
  Spain: '西班牙',
  Italy: '意大利',
  Sweden: '瑞典',
  Austria: '奥地利',
  Canada: '加拿大',
  Chile: '智利',
  Portugal: '葡萄牙',
  Finland: '芬兰',
  Israel: '以色列',
  Malaysia: '马来西亚',
  'Sri Lanka': '斯里兰卡',
  'Hong Kong': '中国香港',
  Taiwan: '中国台湾',
  Brazil: '巴西',
  India: '印度',
  Iran: '伊朗',
  Turkey: '土耳其',
  Switzerland: '瑞士',
  Denmark: '丹麦',
  Norway: '挪威',
  Belgium: '比利时',
  Poland: '波兰',
  Greece: '希腊',
  'New Zealand': '新西兰',
  Mexico: '墨西哥',
  Colombia: '哥伦比亚',
  Vietnam: '越南',
  Thailand: '泰国',
  Indonesia: '印度尼西亚',
  Egypt: '埃及',
  'South Africa': '南非',
  'Saudi Arabia': '沙特阿拉伯',
  'United Arab Emirates': '阿联酋',
  Ireland: '爱尔兰',
  'Czech Republic': '捷克',
  Hungary: '匈牙利',
  Russia: '俄罗斯',
};

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
  if (dimension === 'country') return (zh && COUNTRY_ZH[id]) || id;
  const label = facetLabel(dimension, id, zh);
  return label && label !== id ? label : (fallback || id);
}

export function cardTitle(zh, dimension) {
  const t = CARD_TITLES[dimension];
  if (!t) return dimension;
  return zh ? t.zh : t.en;
}

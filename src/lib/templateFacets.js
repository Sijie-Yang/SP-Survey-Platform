/*
 * Facets: ONE fixed vocabulary for classifying templates and papers
 * (decided 2026-11-28). Templates store them as "dimension:value" strings in
 * templates.tags; papers in analysis_meta.facets (paperFacets.js). No SQL.
 *
 * Each dimension answers one question, and the values inside a dimension do
 * not overlap:
 *   concept       what participants judge or feel (grouped, see CONCEPT_GROUPS)
 *   scene         what kind of place is studied
 *   modality      what material participants are shown or played
 *   task          how participants answer
 *   setting       under what conditions they take part
 *   participants  who they are
 *   sample        how many people answered (one bucket)
 *   country/city  where the experiment was run (where participants took part),
 *                 not where the images are from and not the authors' address
 *   team_org / team_country  the authors' institutions (papers only)
 *
 * To add a value, add one entry here: the /templates filters, the paper
 * library cards and the admin editor all read this list. "open" dimensions
 * accept new values; the others only take listed ids. Ids of the earlier
 * vocabulary are still understood: LEGACY_TAGS maps each to its new tag(s).
 */

/** The six groups of the Perception dimension, in display order. */
export const CONCEPT_GROUPS = [
  { id: 'overall', en: "Overall evaluation", zh: "总体评价" },
  { id: 'emotion', en: "Evoked emotion", zh: "情绪类" },
  { id: 'microclimate', en: "Thermal & microclimate", zh: "微气候类" },
  { id: 'environment', en: "Environment evaluation", zh: "环境评价类" },
  { id: 'design', en: "Design quality", zh: "设计品质类" },
  { id: 'use', en: "Use & place", zh: "使用与场所类" },
];

export const FACET_DIMENSIONS = [
  {
    key: 'source', en: 'Source', zh: '来源', single: true, templatesOnly: true, values: [
      { id: 'paper', en: "Paper replication", zh: "论文复现" },
      { id: 'ai', en: "AI-generated", zh: "AI 生成" },
      { id: 'demo', en: "Demo", zh: "演示" },
    ],
  },
  {
    key: 'concept', en: "Perception", zh: "感知概念", values: [
      { id: 'preference', group: 'overall', en: "Preference", zh: "偏好" },
      { id: 'overall_quality', group: 'overall', en: "Overall quality", zh: "总体质量" },
      { id: 'satisfaction', group: 'overall', en: "Satisfaction", zh: "满意度" },
      { id: 'comfort', group: 'overall', en: "Comfort", zh: "舒适" },
      { id: 'safety', group: 'emotion', en: "Safe", zh: "安全感" },
      { id: 'beauty', group: 'emotion', en: "Beautiful", zh: "美观" },
      { id: 'liveliness', group: 'emotion', en: "Lively", zh: "活力" },
      { id: 'wealth', group: 'emotion', en: "Wealthy", zh: "富裕" },
      { id: 'boring', group: 'emotion', en: "Boring", zh: "无聊" },
      { id: 'depressing', group: 'emotion', en: "Depressing", zh: "压抑" },
      { id: 'emotion', group: 'emotion', en: "Emotion & stress", zh: "情绪与压力" },
      { id: 'restoration', group: 'emotion', en: "Restoration", zh: "复愈" },
      { id: 'wellbeing', group: 'emotion', en: "Mental health & wellbeing", zh: "心理健康与幸福感" },
      { id: 'thermal_comfort', group: 'microclimate', en: "Thermal comfort", zh: "热舒适" },
      { id: 'thermal_affordance', group: 'microclimate', en: "Thermal affordance", zh: "热可供性" },
      { id: 'microclimate', group: 'microclimate', en: "Microclimate inference", zh: "微气候推断" },
      { id: 'greenery', group: 'environment', en: "Greenery", zh: "绿化感" },
      { id: 'naturalness', group: 'environment', en: "Naturalness", zh: "自然度" },
      { id: 'shade', group: 'environment', en: "Shade", zh: "遮阴" },
      { id: 'traffic', group: 'environment', en: "Traffic", zh: "交通" },
      { id: 'materials', group: 'environment', en: "Materials", zh: "材料" },
      { id: 'sound', group: 'environment', en: "Sound", zh: "声音" },
      { id: 'light', group: 'environment', en: "Light", zh: "光照" },
      { id: 'color', group: 'environment', en: "Colour", zh: "色彩" },
      { id: 'imageability', group: 'design', en: "Imageability", zh: "可识别性" },
      { id: 'enclosure', group: 'design', en: "Enclosure", zh: "围合感" },
      { id: 'human_scale', group: 'design', en: "Human scale", zh: "人性尺度" },
      { id: 'transparency', group: 'design', en: "Transparency", zh: "通透性" },
      { id: 'complexity', group: 'design', en: "Complexity", zh: "复杂度" },
      { id: 'openness', group: 'design', en: "Openness", zh: "开敞" },
      { id: 'order', group: 'design', en: "Order", zh: "秩序感" },
      { id: 'walkability', group: 'use', en: "Walkability", zh: "可步行性" },
      { id: 'bikeability', group: 'use', en: "Bikeability", zh: "可骑行性" },
      { id: 'accessibility', group: 'use', en: "Accessibility & inclusion", zh: "无障碍与包容" },
      { id: 'sense_of_place', group: 'use', en: "Sense of place", zh: "场所感" },
    ],
  },
  {
    key: 'scene', en: "Scene", zh: "场景", values: [
      { id: 'street', en: "Streets", zh: "街道" },
      { id: 'public_space', en: "Neighbourhoods & public spaces", zh: "社区与公共空间" },
      { id: 'nature', en: "Nature & green space", zh: "自然与绿地" },
      { id: 'building', en: "Building exteriors", zh: "建筑外观" },
      { id: 'indoor', en: "Interiors", zh: "室内" },
      { id: 'window_view', en: "Window views", zh: "窗景" },
    ],
  },
  {
    key: 'modality', en: "Stimulus", zh: "刺激材料", values: [
      { id: 'street_view', en: "Street-view imagery", zh: "街景图像" },
      { id: 'scene_photo', en: "Photographs", zh: "实拍照片" },
      { id: 'rendered', en: "Rendered or edited images", zh: "渲染或合成图" },
      { id: 'video', en: "Video", zh: "视频" },
      { id: 'audio', en: "Audio", zh: "声音" },
      { id: 'map', en: "Map", zh: "地图" },
    ],
  },
  {
    key: 'task', en: "Response format", zh: "回答方式", values: [
      { id: 'rating', en: "Rating", zh: "逐个评分" },
      { id: 'pairwise', en: "Pairwise comparison", zh: "两两比较" },
      { id: 'choose_from_set', en: "Choice or ranking", zh: "多选一或排序" },
      { id: 'annotation', en: "Annotation", zh: "标注" },
      { id: 'open_ended', en: "Open answers", zh: "文字或访谈" },
      { id: 'questionnaire', en: "General questionnaire", zh: "一般问卷" },
      { id: 'measures', en: "Behavioural & physiological measures", zh: "行为与生理测量" },
    ],
  },
  {
    key: 'setting', en: "Setting", zh: "实施方式", values: [
      { id: 'online', en: "Online", zh: "线上" },
      { id: 'lab', en: "Lab", zh: "实验室" },
      { id: 'vr', en: "Immersive VR", zh: "沉浸式 VR" },
      { id: 'in_situ', en: "On site", zh: "实地" },
    ],
  },
  {
    key: 'participants', en: "Participants", zh: "参与者", values: [
      { id: 'public', en: "General public", zh: "普通公众" },
      { id: 'locals', en: "Local residents & users", zh: "当地居民与使用者" },
      { id: 'students', en: "Students", zh: "学生" },
      { id: 'experts', en: "Professionals", zh: "专业人士" },
      { id: 'specific', en: "Specific groups", zh: "特定人群" },
    ],
  },
  {
    key: 'sample', en: "Sample size", zh: "样本量", single: true, values: [
      { id: 'lt100', en: "< 100", zh: "< 100" },
      { id: '100to300', en: "100–299", zh: "100–299" },
      { id: '300to500', en: "300–499", zh: "300–499" },
      { id: '500to1000', en: "500–1,000", zh: "500–1,000" },
      { id: 'gt1000', en: "> 1,000", zh: "> 1,000" },
    ],
  },
  { key: 'country', en: 'Country / region', zh: '国家或地区', open: true, values: [] },
  { key: 'city', en: 'City', zh: '城市', open: true, values: [] },
  { key: 'team_org', en: 'Research team: institution', zh: '研究团队单位', open: true, papersOnly: true, values: [] },
  { key: 'team_country', en: 'Research team: country / region', zh: '研究团队地区', open: true, papersOnly: true, values: [] },
];

/** The dimensions a template carries (everything except the papers-only ones). */
export const TEMPLATE_DIMENSIONS = FACET_DIMENSIONS.filter((d) => !d.papersOnly);

/**
 * Tags of the vocabulary used until 2026-11-28 → their tag(s) now. An empty
 * list means the tag was dropped. Stored old tags are read through this map,
 * and tools that still send old ids are accepted and saved as the new ones.
 */
export const LEGACY_TAGS = {
  'concept:aesthetics': ['concept:beauty'],
  'concept:likability': ['concept:preference'],
  'concept:live_nearby': ['concept:preference'],
  'concept:pleasantness': ['concept:emotion'],
  'concept:happiness': ['concept:emotion'],
  'concept:enjoyment': ['concept:emotion'],
  'concept:protection': ['concept:safety'],
  'concept:soundscape': ['concept:sound'],
  'concept:quietness': ['concept:sound'],
  'concept:vividness': ['concept:liveliness'],
  'concept:street_activity': ['concept:liveliness'],
  'concept:class': ['concept:wealth'],
  'concept:monotony': ['concept:boring'],
  'concept:oppressiveness': ['concept:depressing'],
  'concept:extensiveness': ['concept:openness'],
  'concept:street_wall_continuity': ['concept:enclosure'],
  'concept:uniqueness': ['concept:imageability'],
  'concept:landmark': ['concept:imageability'],
  'concept:place': ['concept:sense_of_place'],
  'concept:cycling': ['concept:bikeability'],
  'concept:inclusivity': ['concept:accessibility'],
  'concept:playability': ['concept:accessibility'],
  'concept:building_facade': ['scene:building'],
  'concept:street_design': ['scene:street'],
  'concept:night': [],
  'concept:question_framing': [],
  'concept:practicality': [],
  'modality:panorama': ['modality:scene_photo'],
  'modality:vr': ['setting:vr'],
  'modality:in_situ': ['setting:in_situ'],
  'modality:indoor': ['scene:indoor'],
  'modality:window_view': ['scene:window_view'],
  'task:multi_rating': ['task:rating'],
  'task:map_annotation': ['task:annotation'],
  'task:custom_page': [],
  'participants:crowd': ['participants:public', 'setting:online'],
  'participants:lab': ['setting:lab'],
  'participants:residents': ['participants:locals'],
  'sample:100to1000': [],
};

/** Sample-size bucket for a number of people (null when there is no number). */
export function sampleBucket(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 1) return null;
  if (x < 100) return 'lt100';
  if (x < 300) return '100to300';
  if (x < 500) return '300to500';
  if (x <= 1000) return '500to1000';
  return 'gt1000';
}

const BY_KEY = Object.fromEntries(FACET_DIMENSIONS.map((d) => [d.key, d]));

export function facetTag(key, value) {
  return `${key}:${String(value).trim()}`;
}

/** Is this tag one of ours ("dimension:value" with a known dimension)? */
export function isFacetTag(tag) {
  const i = String(tag || '').indexOf(':');
  return i > 0 && !!BY_KEY[String(tag).slice(0, i)];
}

/** One tag in today's vocabulary: [] (dropped), itself, or its replacements. */
export function upgradeFacetTag(tag) {
  const t = String(tag || '');
  return Object.prototype.hasOwnProperty.call(LEGACY_TAGS, t) ? LEGACY_TAGS[t] : [t];
}

/**
 * { dimension: [values] } with old ids replaced by today's. Every dimension
 * named in the input stays in the result (possibly empty); values that an old
 * id adds to ANOTHER dimension (old "participants: crowd" also means
 * "setting: online") are returned separately in `added`.
 */
export function upgradeFacets(facets) {
  const out = {};
  const added = {};
  for (const [key, raw] of Object.entries(facets || {})) {
    const values = Array.isArray(raw) ? raw : [raw];
    out[key] = out[key] || [];
    for (const v of values) {
      const value = String(v ?? '').trim();
      if (!value) continue;
      for (const tag of upgradeFacetTag(facetTag(key, value))) {
        const i = tag.indexOf(':');
        const k = tag.slice(0, i);
        const target = k === key ? out : added;
        target[k] = target[k] || [];
        if (!target[k].includes(tag.slice(i + 1))) target[k].push(tag.slice(i + 1));
      }
    }
  }
  return { facets: out, added };
}

/** { dimension: [values] } from a tag list; old ids are upgraded, unknown values of closed dimensions are dropped. */
export function parseFacets(tags) {
  const out = {};
  for (const stored of tags || []) {
    if (!isFacetTag(stored)) continue;
    for (const tag of upgradeFacetTag(stored)) {
      const i = tag.indexOf(':');
      const key = tag.slice(0, i);
      const value = tag.slice(i + 1).trim();
      const dim = BY_KEY[key];
      if (!dim || !value) continue;
      if (!dim.open && !dim.values.some((v) => v.id === value)) continue;
      out[key] = out[key] || [];
      if (!out[key].includes(value)) out[key].push(value);
    }
  }
  for (const key of Object.keys(out)) if (BY_KEY[key].single) out[key] = out[key].slice(0, 1);
  return out;
}

/** Replace the facet tags in a tag list, keeping any other tags. */
export function withFacets(tags, facets) {
  const others = (tags || []).filter((t) => !isFacetTag(t));
  const next = [];
  for (const dim of TEMPLATE_DIMENSIONS) {
    const values = [...new Set((facets?.[dim.key] || []).map((v) => String(v).trim()).filter(Boolean))];
    for (const v of dim.single ? values.slice(0, 1) : values) next.push(facetTag(dim.key, v));
  }
  return [...others, ...next];
}

/** The Perception group a concept id belongs to (null for an unknown id). */
export function conceptGroup(id) {
  return BY_KEY.concept.values.find((v) => v.id === id)?.group || null;
}

/**
 * Display names for the open country / region values (country and
 * team_country), which are stored in English. China means mainland China; Hong Kong,
 * Macau and Taiwan are separate places.
 */
const LOCATION_EN = { China: 'Mainland China' };
const LOCATION_ZH = {
  China: '中国内地',
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
  'Hong Kong': '香港',
  Macau: '澳门',
  Taiwan: '台湾',
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
  UAE: '阿联酋',
  Slovenia: '斯洛文尼亚',
  Iraq: '伊拉克',
  Bangladesh: '孟加拉国',
  Jordan: '约旦',
  Romania: '罗马尼亚',
  Cyprus: '塞浦路斯',
  Oman: '阿曼',
  Philippines: '菲律宾',
  Lithuania: '立陶宛',
  Pakistan: '巴基斯坦',
  Bulgaria: '保加利亚',
  Argentina: '阿根廷',
  Algeria: '阿尔及利亚',
  Luxembourg: '卢森堡',
  Qatar: '卡塔尔',
  Peru: '秘鲁',
  Serbia: '塞尔维亚',
  Estonia: '爱沙尼亚',
  Kenya: '肯尼亚',
  Cuba: '古巴',
  Nepal: '尼泊尔',
  Tanzania: '坦桑尼亚',
  Croatia: '克罗地亚',
  Latvia: '拉脱维亚',
  Uzbekistan: '乌兹别克斯坦',
  Slovakia: '斯洛伐克',
  Botswana: '博茨瓦纳',
  Syria: '叙利亚',
  Lebanon: '黎巴嫩',
  Ethiopia: '埃塞俄比亚',
  Nigeria: '尼日利亚',
  Uganda: '乌干达',
  Libya: '利比亚',
  Namibia: '纳米比亚',
  'Sierra Leone': '塞拉利昂',
  'Papua New Guinea': '巴布亚新几内亚',
  Ghana: '加纳',
  Morocco: '摩洛哥',
  Tunisia: '突尼斯',
  Kuwait: '科威特',
  Bahrain: '巴林',
  Ukraine: '乌克兰',
  Iceland: '冰岛',
  Malta: '马耳他',
  Kazakhstan: '哈萨克斯坦',
  Ecuador: '厄瓜多尔',
  Uruguay: '乌拉圭',
  Cambodia: '柬埔寨',
  Myanmar: '缅甸',
  Mongolia: '蒙古',
};

/** Label for a value in the current language (cities and institutions show the value itself). */
export function facetLabel(key, value, zh) {
  if (key === 'country' || key === 'team_country') return (zh ? LOCATION_ZH[value] : LOCATION_EN[value]) || value;
  const v = BY_KEY[key]?.values.find((x) => x.id === value);
  return v ? (zh ? v.zh : v.en) : value;
}

export function dimensionLabel(key, zh) {
  const d = BY_KEY[key];
  return d ? (zh ? d.zh : d.en) : key;
}

/**
 * Source when no source: tag is set yet, from the old category field:
 * AI Template / Urban Theory / SP-Scheme → ai; Demo / Platform / Custom → demo.
 */
export function templateSource(tpl) {
  const tagged = parseFacets(tpl?.tags).source?.[0];
  if (tagged) return tagged;
  const raw = String(tpl?.rawCategory || tpl?.category || '').toLowerCase();
  if (/sp[\s_-]?scheme/i.test(`${tpl?.name || ''} ${tpl?.id || ''}`)) return 'ai';
  if (/\bai\b/.test(raw) || raw.includes('urban theory')) return 'ai';
  if (raw.includes('demo') || raw.includes('platform') || raw.includes('custom')) return 'demo';
  return 'paper';
}

/** Values present across a list of templates for one dimension, most used first. */
export function facetCounts(templates, key) {
  const counts = new Map();
  for (const tpl of templates) {
    for (const v of (key === 'source' ? [templateSource(tpl)] : (parseFacets(tpl.tags)[key] || []))) {
      counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per template, one column per dimension (values joined by "; "), for review work. */
export function templatesToCsv(templates) {
  const header = ['id', 'name', 'author', 'year', 'paper_url', ...TEMPLATE_DIMENSIONS.map((d) => d.key)];
  const lines = [header.join(',')];
  for (const tpl of templates || []) {
    const facets = parseFacets(tpl.tags);
    const source = templateSource(tpl);
    lines.push([
      tpl.id, tpl.name, tpl.author, tpl.year, tpl.website || tpl.paper_url || '',
      ...TEMPLATE_DIMENSIONS.map((d) => (d.key === 'source' ? source : (facets[d.key] || []).join('; '))),
    ].map(csvCell).join(','));
  }
  return `﻿${lines.join('\n')}\n`;
}

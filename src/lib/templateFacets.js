/*
 * Template facets: one fixed vocabulary for classifying templates (and later
 * papers). Stored as "dimension:value" strings in templates.tags, so no SQL.
 *
 * To add a dimension, add one entry to FACET_DIMENSIONS: the /templates filters,
 * the row labels and the admin editor all read this list. "open" dimensions
 * (country, city) accept new values; the others only take listed ids.
 */

export const FACET_DIMENSIONS = [
  {
    key: 'source', en: 'Source', zh: '来源', single: true, values: [
      { id: 'paper', en: "Paper replication", zh: "论文复现" },
      { id: 'ai', en: "AI-generated", zh: "AI 生成" },
      { id: 'demo', en: "Demo", zh: "演示" },
    ],
  },
  {
    key: 'modality', en: 'Stimulus', zh: '刺激模态', values: [
      { id: 'street_view', en: "Street view", zh: "街景" },
      { id: 'panorama', en: "Panorama", zh: "全景" },
      { id: 'video', en: "Video", zh: "视频" },
      { id: 'window_view', en: "Window view", zh: "窗景" },
      { id: 'indoor', en: "Indoor", zh: "室内" },
      { id: 'scene_photo', en: "Other scene photos", zh: "其他场景照片" },
      { id: 'map', en: "Map", zh: "地图" },
      { id: 'in_situ', en: "In situ", zh: "实地" },
    ],
  },
  {
    key: 'task', en: 'Question type', zh: '提问方式', values: [
      { id: 'pairwise', en: "Pairwise comparison", zh: "两两比较" },
      { id: 'rating', en: "Single-image rating", zh: "单图评分" },
      { id: 'multi_rating', en: "Multi-scale rating", zh: "多维评分" },
      { id: 'choose_from_set', en: "Choose / rank from a set", zh: "多图选择或排序" },
      { id: 'questionnaire', en: "Questionnaire scales", zh: "问卷量表" },
      { id: 'map_annotation', en: "Map annotation", zh: "地图标点" },
      { id: 'custom_page', en: "Custom page", zh: "自定义页面" },
    ],
  },
  {
    key: 'concept', en: 'Perception', zh: '感知概念', values: [
      { id: 'safety', en: "Safety", zh: "安全" },
      { id: 'comfort', en: "Comfort", zh: "舒适" },
      { id: 'cycling', en: "Cycling", zh: "骑行" },
      { id: 'walkability', en: "Walkability", zh: "可步行" },
      { id: 'greenery', en: "Greenery", zh: "绿化" },
      { id: 'naturalness', en: "Naturalness", zh: "自然度" },
      { id: 'preference', en: "Preference", zh: "偏好" },
      { id: 'beauty', en: "Beauty", zh: "美观" },
      { id: 'aesthetics', en: "Aesthetics", zh: "审美" },
      { id: 'liveliness', en: "Liveliness", zh: "活力" },
      { id: 'wealth', en: "Wealth", zh: "富裕" },
      { id: 'boring', en: "Boring", zh: "无聊" },
      { id: 'depressing', en: "Depressing", zh: "压抑" },
      { id: 'live_nearby', en: "Live nearby", zh: "愿意住附近" },
      { id: 'thermal_comfort', en: "Thermal comfort", zh: "热舒适" },
      { id: 'restoration', en: "Restoration", zh: "复愈" },
      { id: 'inclusivity', en: "Inclusivity", zh: "包容性" },
      { id: 'accessibility', en: "Accessibility", zh: "无障碍" },
      { id: 'practicality', en: "Practicality", zh: "实用" },
      { id: 'playability', en: "Playability", zh: "可玩性" },
      { id: 'pleasantness', en: "Pleasantness", zh: "愉悦" },
      { id: 'happiness', en: "Happiness", zh: "快乐" },
      { id: 'quietness', en: "Quietness", zh: "安静" },
      { id: 'class', en: "Class", zh: "阶层" },
      { id: 'uniqueness', en: "Uniqueness", zh: "独特性" },
      { id: 'imageability', en: "Imageability", zh: "可意象性" },
      { id: 'enclosure', en: "Enclosure", zh: "围合感" },
      { id: 'human_scale', en: "Human scale", zh: "人性尺度" },
      { id: 'transparency', en: "Transparency", zh: "通透性" },
      { id: 'complexity', en: "Complexity", zh: "复杂度" },
      { id: 'openness', en: "Openness", zh: "开敞" },
      { id: 'monotony', en: "Monotony", zh: "单调" },
      { id: 'extensiveness', en: "Extensiveness", zh: "开阔" },
      { id: 'vividness', en: "Vividness", zh: "生动" },
      { id: 'oppressiveness', en: "Oppressiveness", zh: "压迫感" },
      { id: 'building_facade', en: "Building facade", zh: "建筑立面" },
      { id: 'street_wall_continuity', en: "Street-wall continuity", zh: "街墙连续性" },
      { id: 'street_design', en: "Street design", zh: "街道设计" },
      { id: 'street_activity', en: "Street activity", zh: "街道活动" },
      { id: 'protection', en: "Protection", zh: "保护" },
      { id: 'enjoyment', en: "Enjoyment", zh: "享受" },
      { id: 'landmark', en: "Landmark", zh: "地标" },
      { id: 'likability', en: "Likability", zh: "喜爱度" },
      { id: 'night', en: "Night", zh: "夜间" },
      { id: 'color', en: "Colour", zh: "色彩" },
      { id: 'question_framing', en: "Question framing", zh: "提问措辞" },
      { id: 'place', en: "Place", zh: "地点" },
    ],
  },
  {
    key: 'participants', en: 'Participants', zh: '参与者', values: [
      { id: 'crowd', en: "Online crowd", zh: "众包在线" },
      { id: 'residents', en: "Local residents", zh: "本地居民" },
      { id: 'experts', en: "Expert raters", zh: "专家评审" },
      { id: 'lab', en: "Lab participants", zh: "实验室被试" },
      { id: 'students', en: "Students", zh: "学生" },
    ],
  },
  {
    key: 'sample', en: 'Sample size', zh: '样本量', single: true, values: [
      { id: 'lt100', en: "< 100", zh: "< 100" },
      { id: '100to1000', en: "100\u20131,000", zh: "100–1,000" },
      { id: 'gt1000', en: "> 1,000", zh: "> 1,000" },
    ],
  },
  { key: 'country', en: 'Country', zh: '国家', open: true, values: [] },
  { key: 'city', en: 'City', zh: '城市', open: true, values: [] },
];

const BY_KEY = Object.fromEntries(FACET_DIMENSIONS.map((d) => [d.key, d]));

export function facetTag(key, value) {
  return `${key}:${String(value).trim()}`;
}

/** Is this tag one of ours ("dimension:value" with a known dimension)? */
export function isFacetTag(tag) {
  const i = String(tag || '').indexOf(':');
  return i > 0 && !!BY_KEY[String(tag).slice(0, i)];
}

/** { dimension: [values] } from a tag list; unknown values of closed dimensions are dropped. */
export function parseFacets(tags) {
  const out = {};
  for (const tag of tags || []) {
    if (!isFacetTag(tag)) continue;
    const i = tag.indexOf(':');
    const key = tag.slice(0, i);
    const value = tag.slice(i + 1).trim();
    const dim = BY_KEY[key];
    if (!value) continue;
    if (!dim.open && !dim.values.some((v) => v.id === value)) continue;
    (out[key] = out[key] || []).push(value);
  }
  return out;
}

/** Replace the facet tags in a tag list, keeping any other tags. */
export function withFacets(tags, facets) {
  const others = (tags || []).filter((t) => !isFacetTag(t));
  const next = [];
  for (const dim of FACET_DIMENSIONS) {
    const values = [...new Set((facets?.[dim.key] || []).map((v) => String(v).trim()).filter(Boolean))];
    for (const v of dim.single ? values.slice(0, 1) : values) next.push(facetTag(dim.key, v));
  }
  return [...others, ...next];
}

/** Label for a value in the current language (open dimensions show the value itself). */
export function facetLabel(key, value, zh) {
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
  const header = ['id', 'name', 'author', 'year', 'paper_url', ...FACET_DIMENSIONS.map((d) => d.key)];
  const lines = [header.join(',')];
  for (const tpl of templates || []) {
    const facets = parseFacets(tpl.tags);
    const source = templateSource(tpl);
    lines.push([
      tpl.id, tpl.name, tpl.author, tpl.year, tpl.website || tpl.paper_url || '',
      ...FACET_DIMENSIONS.map((d) => (d.key === 'source' ? source : (facets[d.key] || []).join('; '))),
    ].map(csvCell).join(','));
  }
  return `﻿${lines.join('\n')}\n`;
}

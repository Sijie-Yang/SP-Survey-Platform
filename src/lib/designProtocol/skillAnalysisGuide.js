/**
 * Platform reference pack for AI skill authors.
 * Describes how each resultSchema type is analyzed and exported natively,
 * so GPT/Codex skills (and analysisHtml) match platform conventions.
 */

import { SKILL_RESULT_TYPES, skillResultTypesCatalogText } from '../skillResultTypes';

export const SKILL_ANALYSIS_VISUAL_CONVENTIONS = [
  'Tabs per stimulus (imageUrl / shown_images) when multiple media items appear.',
  'Show n= response counts; prefer mean ± SD for numeric aggregates.',
  'Use plain HTML/CSS/JS only — no external CDNs, no network fetches.',
  'Labels should work in English; Chinese optional via simple locale sniff.',
  'Keep layout compact; report height via parent postMessage {source:"sp-survey-skill", type:"height", px}.',
  'analysisHtml augments platform typed summaries — do not hide the raw-data fallback.',
];

/** Per-type analysis + export conventions mirroring native question types. */
export const SKILL_TYPE_ANALYSIS_GUIDE = {
  number: {
    shape: SKILL_RESULT_TYPES.number.shape,
    analysis: 'Histogram + mean/median/SD (same as rating / numeric).',
    longExport: 'One row per response: value=<number>',
    summaryExport: 'mean, sd, min, max, n',
    exampleLong: { value: 72 },
  },
  boolean: {
    shape: SKILL_RESULT_TYPES.boolean.shape,
    analysis: 'Yes/No frequency bars.',
    longExport: 'One row: value=true|false',
    summaryExport: 'yes_count, no_count, yes_pct',
    exampleLong: { value: true },
  },
  choice: {
    shape: SKILL_RESULT_TYPES.choice.shape,
    analysis: 'Choice frequency bars (same as radiogroup).',
    longExport: 'One row: value=<choice>',
    summaryExport: 'per-choice count + pct',
    exampleLong: { value: 'park' },
  },
  text: {
    shape: SKILL_RESULT_TYPES.text.shape,
    analysis: 'Scrollable text answer list.',
    longExport: 'One row: value=<text>',
    summaryExport: 'n_nonempty',
    exampleLong: { value: 'busy sidewalk' },
  },
  count: {
    shape: SKILL_RESULT_TYPES.count.shape,
    analysis: 'Total / mean count (array length or number).',
    longExport: 'One row: value=<count>',
    summaryExport: 'mean_count, total',
    exampleLong: { value: 3 },
  },
  color: {
    shape: SKILL_RESULT_TYPES.color.shape,
    analysis: 'Color chips with frequency.',
    longExport: 'One row: value=#RRGGBB',
    summaryExport: 'per-hex count',
    exampleLong: { value: '#4A90D9' },
  },
  scaleGroup: {
    shape: SKILL_RESULT_TYPES.scaleGroup.shape,
    analysis: 'Per-dimension average bars (semantic differential / slider group).',
    longExport: 'One row per dimension: attribute=<key>, value=<number>',
    summaryExport: 'per-dimension mean ± SD',
    exampleLong: { attribute: 'pleasant', value: 68 },
  },
  points: {
    shape: SKILL_RESULT_TYPES.points.shape,
    analysis: 'Density / point overlay on the stimulus image, split by label; tabs per image (same as annotation).',
    longExport: 'One row per point: x, y, label (optional), image_url',
    summaryExport: 'per-image label_count; total points',
    exampleLong: { x: 0.42, y: 0.31, label: 'entrance', image_url: 'https://…/scene.jpg' },
  },
  path: {
    shape: SKILL_RESULT_TYPES.path.shape,
    analysis: 'Polyline overlay on stimulus + length/directness stats (annotation line style).',
    longExport: 'One row per vertex: x, y, t (optional), seq, image_url',
    summaryExport: 'mean path length, mean directness, n',
    exampleLong: { x: 0.1, y: 0.8, t: 0, seq: 0, image_url: 'https://…/scene.jpg' },
  },
  allocation: {
    shape: SKILL_RESULT_TYPES.allocation.shape,
    analysis: 'Mean bars per budget item (same as point-allocation).',
    longExport: 'One row per item: choice_key, choice_label, points',
    summaryExport: 'per-item mean points, n',
    exampleLong: { choice_key: 'trees', choice_label: 'Trees', points: 40 },
  },
  rankedList: {
    shape: SKILL_RESULT_TYPES.rankedList.shape,
    analysis: 'Ranking distribution + Borda scores (same as ranking questions).',
    longExport: 'One row per rank position: rank (1-based), option, value=pipe-joined full order',
    summaryExport: 'avg_rank, borda, count per option; kendall_w when enough raters',
    exampleLong: { rank: 1, option: 'Scene A', value: 'Scene A|Scene B|Scene C' },
  },
};

/**
 * Full prompt / MCP text: catalog + per-type analysis/export + visual conventions.
 */
export function buildSkillAnalysisGuideText() {
  const lines = [
    'RESULT SCHEMA TYPE CATALOG (declare the closest type so the platform reuses native analysis/export):',
    skillResultTypesCatalogText(),
    '',
    'PLATFORM ANALYSIS + EXPORT CONVENTIONS BY TYPE:',
  ];
  for (const [id, g] of Object.entries(SKILL_TYPE_ANALYSIS_GUIDE)) {
    lines.push(
      `• ${id} — shape: ${g.shape}`,
      `  analysis: ${g.analysis}`,
      `  long CSV: ${g.longExport}`,
      `  summary: ${g.summaryExport}`,
      `  example: ${JSON.stringify(g.exampleLong)}`,
    );
  }
  lines.push('', 'VISUAL CONVENTIONS FOR analysisHtml (optional skill-authored analysis view):');
  for (const c of SKILL_ANALYSIS_VISUAL_CONVENTIONS) {
    lines.push(`- ${c}`);
  }
  lines.push(
    '',
    'When a field has no matching native type, still declare the closest type OR leave type as text,',
    'and optionally ship analysisHtml that reads SPAnalysis.getResponses(). Prefer declaring types over inventing new chart systems.',
    'Answers should include imageUrl (or shown_images) for per-stimulus grouping when media is involved.',
  );
  return lines.join('\n');
}

/** Compact blurb for survey_capabilities / skill_save descriptions. */
export function skillAnalysisGuideBlurb() {
  return (
    'Declare resultSchema[].type from: '
    + Object.keys(SKILL_TYPE_ANALYSIS_GUIDE).join(', ')
    + '. Platform reuses native analysis/export for these. '
    + 'Optional analysisHtml + SPAnalysis.getResponses() for novel shapes. '
    + 'Always include imageUrl for media-linked answers.'
  );
}

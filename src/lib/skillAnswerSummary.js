/**
 * Human-readable summaries for skill answers (preview-before-complete + results).
 */

import { stripSkillAnswerContext } from './skillMediaUtils';

const MODE_LABELS = {
  attention_map: '感知点标记',
  route_trace: '路线描绘',
  budget_lab: '微改造预算',
  flash_reveal: '渐显识别',
  cue_detective: '线索排序',
};

function fmtNum(n, digits = 2) {
  const x = Number(n);
  if (Number.isNaN(x)) return String(n);
  return Number.isInteger(x) ? String(x) : x.toFixed(digits);
}

/**
 * @param {unknown} answer
 * @returns {string[]}
 */
export function summarizeSkillAnswer(answer) {
  if (answer == null || answer === '') return ['（未作答）'];
  if (typeof answer !== 'object') return [String(answer)];

  const lines = [];
  const mode = answer.mode != null ? String(answer.mode) : '';
  if (mode) lines.push(`任务：${MODE_LABELS[mode] || mode}`);

  if (Array.isArray(answer.points)) {
    lines.push(`标记 ${answer.points.length} 个位置`);
    if (answer.counts && typeof answer.counts === 'object') {
      const parts = Object.entries(answer.counts).map(([k, v]) => `${k}×${v}`);
      if (parts.length) lines.push(`分类：${parts.join('，')}`);
    }
  }

  if (Array.isArray(answer.path)) {
    lines.push(`路线轨迹 ${answer.path.length} 个采样点`);
    if (answer.pathLength != null) lines.push(`路径长度 ${fmtNum(answer.pathLength)}`);
    if (answer.directness != null) lines.push(`直达度 ${fmtNum(answer.directness)}`);
  }

  if (answer.allocations && typeof answer.allocations === 'object') {
    const parts = Object.entries(answer.allocations)
      .filter(([, v]) => Number(v) > 0)
      .map(([k, v]) => `${k} ${v}`);
    lines.push(parts.length ? `预算：${parts.join('，')}` : '预算：未分配');
    if (answer.total != null) lines.push(`合计 ${answer.total} / 100`);
    if (answer.priority) lines.push(`最高项：${answer.priority}`);
  }

  if (answer.recognitionMs != null || answer.sceneType != null) {
    if (answer.recognitionMs != null) {
      lines.push(`识别用时 ${Math.round(Number(answer.recognitionMs))} ms`);
    }
    if (answer.revealRatio != null) {
      lines.push(`画面清晰约 ${Math.round(Number(answer.revealRatio) * 100)}%`);
    }
    if (answer.sceneType) lines.push(`场景判断：${answer.sceneType}`);
  }

  if (Array.isArray(answer.rankedCues) && answer.rankedCues.length) {
    lines.push(`线索顺序：${answer.rankedCues.join(' → ')}`);
  }

  if (Array.isArray(answer.ratings) && answer.ratings.length) {
    const parts = answer.ratings.map((d) => {
      const label = d.label || d.id || `${d.left || ''}/${d.right || ''}`;
      return `${label}=${d.value}`;
    });
    lines.push(`评分：${parts.join('，')}`);
  }

  if (Array.isArray(answer.words) && answer.words.length) {
    lines.push(`词条：${answer.words.join('，')}`);
  }
  if (answer.choice != null && answer.choice !== '') {
    lines.push(`选择：${answer.choice}`);
  }
  if (typeof answer.text === 'string' && answer.text.trim()) {
    lines.push(`文字：${answer.text.trim()}`);
  }

  if (answer.preference != null) lines.push(`偏好值：${answer.preference}`);
  if (answer.elapsedMs != null) {
    lines.push(`用时 ${Math.round(Number(answer.elapsedMs) / 1000)} 秒`);
  }

  // Fallback: remaining measurement fields (skip huge arrays already covered)
  if (lines.length <= (mode ? 1 : 0)) {
    const clean = stripSkillAnswerContext(answer);
    const skip = new Set(['mode', 'points', 'path', 'allocations', 'counts', 'weights', 'ratings', 'words']);
    Object.entries(clean || {}).forEach(([k, v]) => {
      if (skip.has(k)) return;
      if (v == null) return;
      if (Array.isArray(v)) {
        lines.push(`${k}：${v.length} 项`);
        return;
      }
      if (typeof v === 'object') {
        lines.push(`${k}：${JSON.stringify(v)}`);
        return;
      }
      lines.push(`${k}：${v}`);
    });
  }

  if (!lines.length) lines.push('（已作答，详见原始数据）');
  return lines;
}

/** Single-line summary for tables / SurveyJS displayValue. */
export function summarizeSkillAnswerOneLine(answer) {
  return summarizeSkillAnswer(answer).join(' · ');
}

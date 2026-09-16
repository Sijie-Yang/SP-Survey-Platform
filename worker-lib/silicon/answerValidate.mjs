export const SILICON_SUPPORTED_TYPES = Object.freeze([
  'rating', 'imagerating', 'mediarating',
  'number',
  'boolean', 'imageboolean', 'mediaboolean',
  'radiogroup', 'dropdown', 'imagepicker', 'mediapicker',
  'checkbox', 'imagecheckbox', 'mediacheckbox',
  'ranking', 'imageranking', 'mediaranking',
]);

const RATING_TYPES = new Set(['rating', 'imagerating', 'mediarating', 'number']);
const BOOLEAN_TYPES = new Set(['boolean', 'imageboolean', 'mediaboolean']);
const SINGLE_CHOICE_TYPES = new Set(['radiogroup', 'dropdown', 'imagepicker', 'mediapicker']);
const MULTI_CHOICE_TYPES = new Set(['checkbox', 'imagecheckbox', 'mediacheckbox']);
const RANKING_TYPES = new Set(['ranking', 'imageranking', 'mediaranking']);

function choiceValues(question) {
  const raw = question.choices || question.rateValues || question.options || [];
  return (Array.isArray(raw) ? raw : []).map((item) => {
    if (item == null) return '';
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return String(item.value ?? item.text ?? '');
  }).filter(Boolean);
}

export function classifyQuestion(question = {}) {
  const type = question.type || '';
  if (!SILICON_SUPPORTED_TYPES.includes(type)) {
    return { supported: false, reason: `Type ${type || 'unknown'} is outside the Silicon pretest whitelist` };
  }
  if (question.visibleIf || question.enableIf) {
    return { supported: false, reason: 'Conditional questions are not supported in Silicon pretest yet' };
  }
  if (Number(question.trialCount || 0) > 1 || question.mediaAssignmentMode === 'set') {
    return { supported: false, reason: 'Multi-trial / set media assignment is not supported in Silicon pretest yet' };
  }
  return { supported: true };
}

export function validateSiliconAnswer(question, answer) {
  const kind = classifyQuestion(question);
  if (!kind.supported) return { ok: false, skipped: true, reason: kind.reason };
  const type = question.type;
  if (answer == null || answer === '') return { ok: false, reason: 'Empty answer' };

  if (RATING_TYPES.has(type)) {
    const n = Number(answer);
    if (!Number.isFinite(n)) return { ok: false, reason: 'Expected a number' };
    const min = Number(question.rateMin ?? question.min ?? 1);
    const max = Number(question.rateMax ?? question.max ?? 5);
    if (n < min || n > max) return { ok: false, reason: `Expected a number between ${min} and ${max}` };
    return { ok: true, answer: n };
  }
  if (BOOLEAN_TYPES.has(type)) {
    if (typeof answer === 'boolean') return { ok: true, answer };
    if (answer === 'true' || answer === 'yes' || answer === 1) return { ok: true, answer: true };
    if (answer === 'false' || answer === 'no' || answer === 0) return { ok: true, answer: false };
    return { ok: false, reason: 'Expected boolean' };
  }
  const values = choiceValues(question);
  if (SINGLE_CHOICE_TYPES.has(type)) {
    const value = typeof answer === 'object' ? answer.value ?? answer.text : answer;
    if (!values.includes(String(value))) return { ok: false, reason: 'Answer is not an allowed choice' };
    return { ok: true, answer: String(value) };
  }
  if (MULTI_CHOICE_TYPES.has(type)) {
    if (!Array.isArray(answer)) return { ok: false, reason: 'Expected an array' };
    const normalized = answer.map((item) => String(typeof item === 'object' ? item.value ?? item.text : item));
    if (normalized.some((item) => !values.includes(item))) return { ok: false, reason: 'Answer contains a choice outside the list' };
    return { ok: true, answer: normalized };
  }
  if (RANKING_TYPES.has(type)) {
    if (!Array.isArray(answer)) return { ok: false, reason: 'Expected an array' };
    const normalized = answer.map((item) => String(typeof item === 'object' ? item.value ?? item.text : item));
    if (new Set(normalized).size !== normalized.length) return { ok: false, reason: 'Ranking answers must be unique' };
    if (normalized.some((item) => !values.includes(item))) return { ok: false, reason: 'Ranking contains a choice outside the list' };
    return { ok: true, answer: normalized };
  }
  return { ok: false, reason: `Unsupported answer contract for ${type}` };
}

export function collectQuestions(surveyConfig, names = null) {
  const wanted = Array.isArray(names) && names.length ? new Set(names) : null;
  const out = [];
  for (const page of surveyConfig?.pages || []) {
    for (const el of page.elements || []) {
      if (wanted && !wanted.has(el.name)) continue;
      if (['html', 'expression', 'image', 'mediadisplay'].includes(el.type)) continue;
      out.push(el);
    }
  }
  return out;
}

export function unsupportedQuestionReport(surveyConfig, names = null) {
  return collectQuestions(surveyConfig, names)
    .map((question) => ({ name: question.name, type: question.type, ...classifyQuestion(question) }))
    .filter((item) => !item.supported);
}

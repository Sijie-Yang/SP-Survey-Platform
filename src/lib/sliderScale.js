const GENERIC_DIMENSION_ID = /^(dim(?:ension)?_?\d+|d\d+|scale_?\d+)$/i;
const SLIDER_TYPES = new Set(['slidergroup', 'imageslidergroup', 'mediaslidergroup']);

function text(value) {
  return value == null ? '' : String(value).trim();
}

export function dimensionPoles(dimension = {}) {
  return {
    left: text(dimension.left ?? dimension.low),
    right: text(dimension.right ?? dimension.high),
  };
}

export function dimensionDisplayName(dimension = {}, index = 0, { locale } = {}) {
  const label = text(dimension.label || dimension.text || dimension.name || dimension.title);
  if (label) return label;
  const { left, right } = dimensionPoles(dimension);
  if (left && right) return `${left} ↔ ${right}`;
  if (left || right) return left || right;
  const id = text(dimension.id);
  if (id && !GENERIC_DIMENSION_ID.test(id)) return id;
  return locale === 'zh' ? `维度 ${index + 1}` : `Dimension ${index + 1}`;
}

export function dimensionIncomplete(dimension = {}) {
  const label = text(dimension.label || dimension.text || dimension.name || dimension.title);
  const { left, right } = dimensionPoles(dimension);
  return !label || !left || !right;
}

export function normalizeSliderDimension(dimension, index = 0) {
  if (dimension == null || typeof dimension !== 'object' || Array.isArray(dimension)) {
    return { id: `dim_${index + 1}` };
  }
  const next = { ...dimension };
  const mappedLabel = text(next.label || next.text || next.name || next.title);
  if (mappedLabel && !text(next.label)) next.label = mappedLabel;
  if (!text(next.id)) {
    const fromValue = text(next.value);
    next.id = fromValue || mappedLabel.replace(/\s+/g, '_').slice(0, 40) || `dim_${index + 1}`;
  }
  return next;
}

export function normalizeSliderQuestion(question) {
  if (!question || !SLIDER_TYPES.has(question.type) || !Array.isArray(question.dimensions)) {
    return question;
  }
  return {
    ...question,
    dimensions: question.dimensions.map((item, index) => normalizeSliderDimension(item, index)),
  };
}

export function persistSliderAliases(surveyConfig) {
  if (!surveyConfig || !Array.isArray(surveyConfig.pages)) return surveyConfig;
  return {
    ...surveyConfig,
    pages: surveyConfig.pages.map((page) => ({
      ...page,
      elements: (page.elements || []).map((element) => normalizeSliderQuestion(element)),
    })),
  };
}

export function matrixItemLabel(item, index = 0, kind = 'Row') {
  if (item == null) return `${kind} ${index + 1}`;
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  return text(item.text || item.label || item.value) || `${kind} ${index + 1}`;
}

/** Effective bounds shared by rendering and answer validation. */
export function sliderScale(dimension = {}, question = {}) {
  const min = dimension.min ?? question.scaleMin ?? 1;
  const max = dimension.max ?? question.scaleMax ?? 7;
  const step = dimension.step ?? question.scaleStep ?? 1;
  const valid = Number.isFinite(min) && Number.isFinite(max) && max > min && Number.isFinite(step) && step > 0;
  const midpoint = valid ? Number(Math.min(max, min + Math.round((max - min) / (2 * step)) * step).toPrecision(12)) : 0;
  return { min, max, step, midpoint, valid };
}

export function sliderGroupAnswerValid(value, question, requireAll = false) {
  if (value == null) return !requireAll;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  return (question.dimensions || []).every((d) => {
    const v = value[d.id];
    if (v == null || v === '') return !requireAll;
    const { min, max, step, valid } = sliderScale(d, question);
    const ticks = (v - min) / step;
    return valid && typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
      && (v === max || Math.abs(ticks - Math.round(ticks)) < 1e-7);
  });
}

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

const UNSUPPORTED = new Set([
  'imageannotation',
  'html',
  'expression',
]);

export function classifyQuestion(question = {}) {
  const type = question.type || '';
  if (UNSUPPORTED.has(type)) return { supported: false, reason: `Type ${type} needs a browser` };
  if (type === 'skillquestion') {
    return { supported: false, reason: 'Skill questions need their browser runtime and typed result contract' };
  }
  return { supported: true };
}

export function validateSiliconAnswer(question, answer) {
  const kind = classifyQuestion(question);
  if (!kind.supported) return { ok: false, skipped: true, reason: kind.reason };
  const type = question.type;
  if (answer == null || answer === '') return { ok: false, reason: 'Empty answer' };

  if (['rating', 'imagerating', 'mediarating', 'number'].includes(type)) {
    const n = Number(answer);
    if (!Number.isFinite(n)) return { ok: false, reason: 'Expected a number' };
    return { ok: true, answer: n };
  }
  if (['boolean', 'imageboolean', 'mediaboolean'].includes(type)) {
    if (typeof answer === 'boolean') return { ok: true, answer };
    if (answer === 'true' || answer === 'yes' || answer === 1) return { ok: true, answer: true };
    if (answer === 'false' || answer === 'no' || answer === 0) return { ok: true, answer: false };
    return { ok: false, reason: 'Expected boolean' };
  }
  if (['checkbox', 'imagecheckbox', 'mediacheckbox', 'ranking', 'imageranking', 'mediaranking'].includes(type)) {
    if (!Array.isArray(answer)) return { ok: false, reason: 'Expected an array' };
    return { ok: true, answer };
  }
  if (typeof answer === 'object') return { ok: true, answer };
  return { ok: true, answer };
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

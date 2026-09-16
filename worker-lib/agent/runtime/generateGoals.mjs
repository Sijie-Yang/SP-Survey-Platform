import { PLATFORM_SCHEMA } from '../../platformSchema.generated.mjs';

const DISPLAY_TYPES = new Set(
  Object.entries(PLATFORM_SCHEMA.questionTypes || {})
    .filter(([, definition]) => (definition.traits || []).includes('display'))
    .map(([id]) => id)
    .concat(['expression', 'image', 'mediadisplay']),
);

export function answerQuestionTypes(schema = PLATFORM_SCHEMA) {
  return Object.entries(schema.questionTypes || {})
    .filter(([id, definition]) => !DISPLAY_TYPES.has(id) && !(definition.traits || []).includes('display'))
    .map(([id]) => id);
}

export function parseGenerateGoals(message, schema = PLATFORM_SCHEMA) {
  const text = String(message || '');
  const pageMatch = text.match(/(?:至少|at\s+least)\s*(\d+)\s*(?:页|pages?)/i)
    || text.match(/(\d+)\s*(?:页|pages?)/i);
  const minPages = pageMatch ? Math.max(1, Number(pageMatch[1])) : 1;
  const coverMostTypes = /覆盖多数题型|most(?:\s+supported)?\s+question\s+types|majority of (?:the\s+)?(?:question\s+)?types/i.test(text);
  return {
    minPages,
    uniqueNames: true,
    coverMostTypes,
    answerTypes: answerQuestionTypes(schema),
  };
}

export function summarizeSurveyConfig(surveyConfig = {}) {
  const pages = Array.isArray(surveyConfig.pages) ? surveyConfig.pages : [];
  const elements = pages.flatMap((page) => (
    Array.isArray(page?.elements) ? page.elements.map((element) => ({ page, element })) : []
  ));
  const types = [...new Set(elements.map(({ element }) => element?.type).filter(Boolean))];
  return {
    pageCount: pages.length,
    questionCount: elements.length,
    types,
    pages,
    elements,
  };
}

function looksInventedUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
    && !/huggingface|supabase|r2\.dev|sp-survey/i.test(value);
}

function isAnswerElement(element) {
  const type = String(element?.type || '');
  if (!type || DISPLAY_TYPES.has(type)) return false;
  if (type === 'skillquestion') {
    return /^preset_/.test(String(element.skillId || ''));
  }
  const urls = [
    element?.imageLink,
    ...(Array.isArray(element?.imageLinks) ? element.imageLinks : []),
    ...(Array.isArray(element?.choices) ? element.choices.map((choice) => choice?.imageLink || choice?.url) : []),
  ];
  if (urls.some(looksInventedUrl)) return false;
  return true;
}

function isEffectivePage(page) {
  const name = String(page?.name || '').trim();
  if (!name) return false;
  return (page.elements || []).some(isAnswerElement);
}

export function evaluateGenerateGoals(surveyConfig, goals, schema = PLATFORM_SCHEMA) {
  const parsed = goals || parseGenerateGoals('', schema);
  const summary = summarizeSurveyConfig(surveyConfig);
  const errors = [];
  const pageNames = [];
  const questionNames = [];
  const covered = new Set();

  for (const page of summary.pages) {
    const pageName = String(page?.name || '').trim();
    if (!pageName) errors.push({ path: 'pages', message: 'Every page needs a stable unique name.' });
    else if (pageNames.includes(pageName)) {
      errors.push({ path: `pages.${pageName}`, message: `Duplicate page name "${pageName}".` });
    } else pageNames.push(pageName);
    for (const element of page?.elements || []) {
      const questionName = String(element?.name || '').trim();
      if (!questionName) {
        errors.push({ path: `pages.${pageName}.elements`, message: 'Every question needs a stable unique name.' });
      } else if (questionNames.includes(questionName)) {
        errors.push({ path: questionName, message: `Duplicate question name "${questionName}".` });
      } else questionNames.push(questionName);
      if (isAnswerElement(element)) covered.add(element.type);
    }
  }

  const effectivePages = summary.pages.filter(isEffectivePage);
  if (effectivePages.length < (parsed.minPages || 1)) {
    errors.push({
      path: 'pages',
      message: `Need at least ${parsed.minPages} effective pages with answer questions; found ${effectivePages.length}.`,
    });
  }

  const answerTypes = parsed.answerTypes || answerQuestionTypes(schema);
  const requiredCoverage = parsed.coverMostTypes
    ? Math.ceil(answerTypes.length / 2)
    : 0;
  if (requiredCoverage && covered.size < requiredCoverage) {
    errors.push({
      path: 'elements.type',
      message: `Need ${requiredCoverage} distinct answer types (denominator ${answerTypes.length}); covered ${covered.size}. Repeated or display-only types do not count.`,
    });
  }

  return {
    ok: errors.length === 0,
    pageCount: summary.pageCount,
    questionCount: summary.questionCount,
    types: summary.types,
    coveredTypes: [...covered],
    answerTypeDenominator: answerTypes.length,
    requiredCoverage,
    uncoveredTypes: answerTypes.filter((type) => !covered.has(type)),
    errors,
  };
}

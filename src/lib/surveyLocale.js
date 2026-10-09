/**
 * Participant-facing survey language (independent of admin UI region).
 * Stored on survey JSON as `locale`. Default is English.
 */

import { attachSurveyMarkdown } from './surveyMarkdown';
import { interfaceDictionary, normalizeUiLanguage, surveyJsLocale } from './uiLanguages';

export const SURVEY_UI_LANGUAGE_EN = 'en';
export const SURVEY_UI_LANGUAGE_ZH = 'zh';

export function resolveSurveyUiLanguage(source) {
  if (source && typeof source.getPropertyValue === 'function') {
    const chrome = source.getPropertyValue('spChromeLanguage');
    if (chrome) return normalizeUiLanguage(chrome);
  }
  const raw = typeof source === 'string'
    ? source
    : (source?.locale
      ?? (typeof source?.getPropertyValue === 'function' ? source.getPropertyValue('locale') : '')
      ?? '');
  return normalizeUiLanguage(raw);
}

export function resolveSurveyJsLocale(source) {
  return surveyJsLocale(resolveSurveyUiLanguage(source));
}

export function surveyUiStrings(source) {
  return interfaceDictionary(resolveSurveyUiLanguage(source));
}

export function applySurveyLocale(model, source) {
  if (!model) return;
  const locale = resolveSurveyJsLocale(source || model);
  try {
    model.locale = locale;
  } catch { /* ignore */ }
  attachSurveyMarkdown(model);
}

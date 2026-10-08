import { Model } from 'survey-core';
import {
  acceptModelTranslations,
  applyLanguageToSurveyModel,
  applyParticipantLanguage,
  confirmTranslation,
  deleteLanguageVersion,
  languageChoiceVisible,
  editTranslation,
  mergeMachineTranslations,
  participantLanguages,
  participantMayUseLanguage,
  reconcileTranslations,
  resolveParticipantLanguage,
  setTranslationLanguages,
  surveyLanguageMetadata,
  translationAccuracyNotice,
  translationPublishFindings,
} from './surveyTranslations';
import { requestSurveyTranslations } from './surveyTranslationApi';
import { applySurveyLocale } from './surveyLocale';

function survey() {
  return {
    title: 'Hello',
    description: 'How does this street feel?',
    completionMessage: 'Thank you.',
    locale: 'en',
    pages: [{
      name: 'page1',
      elements: [{
        type: 'radiogroup',
        name: 'q1',
        title: 'Pick one',
        description: 'Choose a code',
        visibleIf: '{other} = 1',
        rateMin: 1,
        rateMax: 7,
        choices: [
          { value: 'code_a', text: 'Apple' },
          'plain',
        ],
        minRateDescription: 'Low',
        maxRateDescription: 'High',
      }, {
        type: 'slidergroup',
        name: 'q2',
        title: 'Rate the block',
        dimensions: [{ id: 'safe', label: 'Safety', left: 'Unsafe', right: 'Safe', min: 1, max: 7 }],
      }],
    }],
  };
}

function withZh(config) {
  const translations = reconcileTranslations({
    ...config,
    translations: {
      sourceLanguage: 'en',
      targetLanguages: ['zh', 'ja'],
      enabledLanguages: ['en', 'zh'],
      entries: {},
    },
  });
  const titled = editTranslation(translations, 'survey.title', 'zh', '你好');
  const choice = editTranslation(titled, 'question:q1:choice:code_a', 'zh', '苹果');
  const plain = editTranslation(choice, 'question:q1:choice:plain', 'zh', '纯文本');
  const japanese = editTranslation(plain, 'survey.title', 'ja', 'こんにちは');
  return { ...config, translations: japanese };
}

describe('survey translations', () => {
  test('applying a translation keeps option codes, logic, and numbers', () => {
    const config = withZh(survey());
    const shown = applyParticipantLanguage(config, 'zh');
    const question = shown.pages[0].elements[0];
    expect(question.choices[0].value).toBe('code_a');
    expect(question.choices[0].text).toBe('苹果');
    expect(question.choices[1]).toEqual({ value: 'plain', text: '纯文本' });
    expect(question.visibleIf).toBe('{other} = 1');
    expect(question.rateMin).toBe(1);
    expect(question.rateMax).toBe(7);
    expect(question.name).toBe('q1');
    expect(shown.pages[0].elements[1].dimensions[0]).toMatchObject({ id: 'safe', min: 1, max: 7, label: 'Safety' });

    const model = new Model(config);
    applyLanguageToSurveyModel(model, config, 'zh');
    const live = model.getQuestionByName('q1');
    expect(live.choices[0].value).toBe('code_a');
    expect(live.choices[0].text).toBe('苹果');
    expect(live.choices[1].value).toBe('plain');
    expect(live.choices[1].text).toBe('纯文本');
    expect(live.visibleIf).toBe('{other} = 1');
  });

  test('reviewed text is not overwritten when the source changes', () => {
    const config = survey();
    config.translations = {
      sourceLanguage: 'en',
      targetLanguages: ['zh'],
      enabledLanguages: ['en', 'zh'],
      entries: {
        'survey.title': {
          sourceText: 'Hello',
          byLanguage: {
            zh: { text: '已审阅的标题', status: 'reviewed', humanEdited: false },
          },
        },
      },
    };
    const changed = { ...config, title: 'Hello there' };
    const next = reconcileTranslations(changed);
    expect(next.entries['survey.title'].sourceText).toBe('Hello there');
    expect(next.entries['survey.title'].byLanguage.zh.text).toBe('已审阅的标题');
    expect(next.entries['survey.title'].byLanguage.zh.status).toBe('machine');
    const generated = mergeMachineTranslations(next, 'zh', { 'survey.title': '新的机器翻译' });
    expect(generated.entries['survey.title'].byLanguage.zh.text).toBe('已审阅的标题');
  });

  test('a participant cannot pick a language the researcher disabled', () => {
    const config = withZh(survey());
    expect(participantMayUseLanguage(config, 'ja')).toBe(false);
    expect(participantMayUseLanguage(config, 'zh')).toBe(true);
    expect(resolveParticipantLanguage(config, 'ja')).toBe('en');
    expect(participantLanguages(config).map((item) => item.id)).toEqual(['en', 'zh']);
    expect(applyParticipantLanguage(config, 'ja').title).toBe('Hello');
    expect(applyParticipantLanguage(config, 'zh').title).toBe('你好');
  });

  test('answerLanguage is stored apart from condition and region', () => {
    const meta = surveyLanguageMetadata({
      answerLanguage: 'zh',
      questionAnswerLanguages: { q1: 'en', q2: 'zh' },
      publishedVersion: 4,
    });
    expect(meta).toEqual({
      published_version: 4,
      answerLanguage: 'zh',
      questionAnswerLanguages: { q1: 'en', q2: 'zh' },
    });
    expect(meta.condition).toBeUndefined();
    expect(meta.region).toBeUndefined();
  });

  test('machine output cannot replace numbers or unknown ids', () => {
    const items = [{ id: 'survey.title', text: 'Score 5 {q1}' }];
    expect(acceptModelTranslations(items, {
      translations: { 'survey.title': '得分五', 'question:q1:choice:code_a': 'hacked' },
    }).accepted).toEqual({});
    expect(acceptModelTranslations(items, {
      translations: { 'survey.title': '得分 5 {q1}' },
    }).accepted).toEqual({ 'survey.title': '得分 5 {q1}' });
  });

  test('publish lists missing and unreviewed translations', () => {
    const config = withZh(survey());
    config.translations = confirmTranslation(config.translations, 'survey.title', 'zh');
    const findings = translationPublishFindings(config);
    expect(findings.unreviewed.some((row) => row.id === 'question:q1:choice:code_a' && row.language === 'zh')).toBe(true);
    expect(findings.missing.some((row) => row.id === 'survey.description' && row.language === 'zh')).toBe(true);
    expect(findings.unreviewed.some((row) => row.id === 'survey.title' && row.language === 'zh')).toBe(false);
    expect(findings.unreviewed.some((row) => row.id === 'survey.title' && row.language === 'ja')).toBe(true);
    expect(findings.missing.some((row) => row.language === 'ja')).toBe(true);
    expect(participantMayUseLanguage(config, 'ja')).toBe(false);
  });

  test('does not call the assistant when it is not configured', async () => {
    const post = jest.fn();
    const result = await requestSurveyTranslations({
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      items: [{ id: 'survey.title', text: 'Hello' }],
    }, {
      getCredentialStatus: async () => ({ assistantConfigured: false }),
      post,
    });
    expect(result.configured).toBe(false);
    expect(result.translations).toEqual({});
    expect(post).not.toHaveBeenCalled();
  });

  test('repeated language switches keep the source and each translation paired', () => {
    const base = survey();
    base.pages[0].elements.push({ type: 'text', name: 'anchor', title: 'Stay on this page' });
    base.pages.push({ name: 'page2', elements: [{ type: 'text', name: 'q3', title: 'Second page' }] });
    const config = withZh(base);
    config.translations = setTranslationLanguages(config, {
      sourceLanguage: 'en',
      targetLanguages: ['zh', 'ja'],
      enabledLanguages: ['en', 'zh', 'ja'],
    });
    const model = new Model(config);
    model.currentPageNo = 1;
    expect(model.currentPage.name).toBe('page2');
    const sequence = ['zh', 'en', 'zh', 'en', 'ja', 'en', 'zh', 'ja', 'en'];
    sequence.forEach((lang) => {
      applyLanguageToSurveyModel(model, config, lang);
      applySurveyLocale(model, { locale: lang });
      const question = model.getQuestionByName('q1');
      if (lang === 'zh') {
        expect(model.title).toBe('你好');
        expect(question.choices[0].text).toBe('苹果');
      } else if (lang === 'ja') {
        expect(model.title).toBe('こんにちは');
        expect(question.choices[0].text).toBe('Apple');
      } else {
        expect(model.title).toBe('Hello');
        expect(question.choices[0].text).toBe('Apple');
      }
      expect(question.choices[0].value).toBe('code_a');
      expect(question.visibleIf).toBe('{other} = 1');
      expect(config.title).toBe('Hello');
      expect(model.currentPageNo).toBe(1);
      expect(model.currentPage.name).toBe('page2');
    });
  });

  test('editor language switches keep each translation with its language', () => {
    const config = withZh(survey());
    const edited = editTranslation(config.translations, 'survey.description', 'ja', '説明');
    const switched = setTranslationLanguages(
      { ...config, translations: edited },
      { sourceLanguage: 'en', targetLanguages: ['ja', 'zh'], enabledLanguages: ['en', 'zh', 'ja'] },
    );
    expect(switched.entries['survey.title'].byLanguage.zh.text).toBe('你好');
    expect(switched.entries['survey.title'].byLanguage.ja.text).toBe('こんにちは');
    expect(switched.entries['survey.description'].byLanguage.ja.text).toBe('説明');
    const back = setTranslationLanguages(
      { ...survey(), translations: switched },
      { sourceLanguage: 'zh', targetLanguages: ['en', 'ja'], enabledLanguages: ['zh', 'ja'] },
    );
    expect(back.sourceLanguage).toBe('zh');
    expect(back.entries['survey.title'].byLanguage.ja.text).toBe('こんにちは');
    expect(back.targetLanguages).not.toContain('zh');
  });

  test('update can replace a generated language and delete removes that choice', () => {
    const config = withZh(survey());
    config.translations = confirmTranslation(config.translations, 'survey.title', 'zh');
    const updated = mergeMachineTranslations(
      config.translations,
      'zh',
      { 'survey.title': '更新后的标题' },
      { forceIds: ['survey.title'] },
    );
    expect(updated.entries['survey.title'].byLanguage.zh.text).toBe('更新后的标题');
    expect(updated.entries['survey.title'].byLanguage.zh.status).toBe('machine');
    const removed = deleteLanguageVersion(updated, 'zh');
    const next = { ...config, translations: removed };
    expect(participantMayUseLanguage(next, 'zh')).toBe(false);
    expect(participantLanguages(next).map((item) => item.id)).toEqual(['en']);
    expect(removed.entries['survey.title'].byLanguage.zh).toBeUndefined();
    expect(applyParticipantLanguage(next, 'zh').title).toBe('Hello');
    expect(languageChoiceVisible(0)).toBe(true);
    expect(languageChoiceVisible(1)).toBe(false);
  });

  test('the notice says translations can be inaccurate until reviewed', () => {
    expect(translationAccuracyNotice('zh')).toContain('可能不准确');
    expect(translationAccuracyNotice('en')).toContain('inaccurate');
    expect(translationAccuracyNotice('en').toLowerCase()).not.toContain('pool');
    expect(translationAccuracyNotice('zh')).not.toContain('合并');
  });
});

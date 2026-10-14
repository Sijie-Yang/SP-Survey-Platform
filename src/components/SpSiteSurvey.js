import React, { useMemo } from 'react';
import SpSiteFrame from './SpSiteFrame';
import { buildSiteQuestions } from '../lib/spSite';
import { collectSurveyDataWithTrials, isTrialsAnswer, persistTrialsAnswer } from '../lib/trialNavigation';

/**
 * Participant view of an SP-Scheme site. The SurveyJS model stays headless:
 * answers from the site land on it, and SPSite.complete() completes it, so the
 * normal submission path (drafts, enrichment, response contract) is unchanged.
 */
export default function SpSiteSurvey({ model, surveyJson, language }) {
  const questions = useMemo(() => buildSiteQuestions(surveyJson, { language }), [surveyJson, language]);
  const initialAnswers = useMemo(() => {
    const names = new Set(questions.map((q) => q.name));
    return Object.fromEntries(Object.entries(collectSurveyDataWithTrials(model) || {}).filter(([name]) => names.has(name)));
    // Read once per model; later answers flow from the site.
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps

  // SurveyJS drops values that are not among a question's rendered choices when it
  // completes; nothing is rendered here and SpSiteFrame has already validated them.
  model.clearInvisibleValues = 'none';

  const onAnswer = (name, stored, { trial } = {}) => {
    const question = model.getQuestionByName(name);
    if (stored == null) {
      model.clearValue(name);
      return;
    }
    if (question && isTrialsAnswer(stored)) {
      // Same convention as TrialShell: the full rounds live in the trials store,
      // the question holds the active round's flat value (folded back on submit).
      const index = Number(trial) || 0;
      persistTrialsAnswer(question, stored, index);
      model.setValue(name, stored.trials[index]?.value ?? null);
      return;
    }
    model.setValue(name, stored);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: '#fff' }} data-testid="sp-site-survey">
      <SpSiteFrame
        html={surveyJson.spSite.html}
        allowedHosts={surveyJson.spSite.allowedHosts || []}
        questions={questions}
        survey={{
          title: model.title || surveyJson.title || '',
          description: model.description || '',
          language: language || surveyJson.locale || 'en',
        }}
        initialAnswers={initialAnswers}
        onAnswer={onAnswer}
        onComplete={() => { model.doComplete(); }}
        title={model.title || 'Survey'}
      />
    </div>
  );
}

import React, { useMemo, useRef, useState } from 'react';
import SpSiteFrame from './SpSiteFrame';
import { buildSiteQuestions, siteMatchLevel, siteMediaFolders } from '../lib/spSite';
import { collectSurveyDataWithTrials, isTrialsAnswer, persistTrialsAnswer } from '../lib/trialNavigation';

/** Response key holding the page's own requests when no adapter mapped them. */
export const SP_SITE_REQUESTS_KEY = '__sp_requests';
export const SP_SITE_REQUESTS_MAX = 500;
const SP_SITE_REQUEST_MAX_CHARS = 20000;
/** A request to one of these paths means the page is done (when nothing else says so). */
export const SP_SITE_DEFAULT_COMPLETE_ON = '(finish|complete|submit|done|final)';

/** The request the page sent, trimmed so the response stays a sane size. */
export function captureRecord(request, at = new Date().toISOString()) {
  let data = request?.data;
  try {
    const text = JSON.stringify(data === undefined ? null : data);
    if (text.length > SP_SITE_REQUEST_MAX_CHARS) data = { truncated: true, text: text.slice(0, SP_SITE_REQUEST_MAX_CHARS) };
  } catch {
    data = String(data);
  }
  return { at, kind: String(request?.kind || ''), method: String(request?.method || ''), url: String(request?.url || '').slice(0, 2000), data };
}

export function completesOn(url, pattern) {
  const source = pattern == null || pattern === '' ? SP_SITE_DEFAULT_COMPLETE_ON : String(pattern);
  if (source === 'never') return false;
  try {
    return new RegExp(source, 'i').test(String(url || '').split('?')[0]);
  } catch {
    return false;
  }
}

/**
 * Participant view of an SP-Scheme site. The SurveyJS model stays headless:
 * answers from the site land on it, and SPSite.complete() completes it, so the
 * normal submission path (drafts, enrichment, response contract) is unchanged.
 * Requests the page sends that no adapter maps are kept raw on the response.
 */
export default function SpSiteSurvey({ model, surveyJson, language, mediaPool = [] }) {
  const questions = useMemo(() => buildSiteQuestions(surveyJson, { language }), [surveyJson, language]);
  const media = useMemo(() => siteMediaFolders(mediaPool, surveyJson), [mediaPool, surveyJson]);
  const match = useMemo(() => siteMatchLevel(surveyJson), [surveyJson]);
  const initialAnswers = useMemo(() => {
    const names = new Set(questions.map((q) => q.name));
    return Object.fromEntries(Object.entries(collectSurveyDataWithTrials(model) || {}).filter(([name]) => names.has(name)));
    // Read once per model; later answers flow from the site.
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps
  const [captured, setCaptured] = useState(() => (Array.isArray(model.getValue(SP_SITE_REQUESTS_KEY)) ? model.getValue(SP_SITE_REQUESTS_KEY).length : 0));
  const done = useRef(false);

  // SurveyJS drops values that are not among a question's rendered choices when it
  // completes; nothing is rendered here and SpSiteFrame has already validated them.
  model.clearInvisibleValues = 'none';

  const complete = () => {
    if (done.current) return;
    done.current = true;
    model.doComplete();
  };

  const onAnswer = (name, stored, { trial } = {}) => {
    const question = model.getQuestionByName(name);
    if (stored == null) {
      model.clearValue(name);
      return;
    }
    if (question && isTrialsAnswer(stored) && trial != null) {
      // Same convention as TrialShell: the full rounds live in the trials store,
      // the question holds the active round's flat value (folded back on submit).
      const index = Number(trial) || 0;
      persistTrialsAnswer(question, stored, index);
      model.setValue(name, stored.trials[index]?.value ?? null);
      return;
    }
    model.setValue(name, stored);
  };

  const onCapture = (request) => {
    const list = Array.isArray(model.getValue(SP_SITE_REQUESTS_KEY)) ? model.getValue(SP_SITE_REQUESTS_KEY) : [];
    if (list.length < SP_SITE_REQUESTS_MAX) {
      model.setValue(SP_SITE_REQUESTS_KEY, [...list, captureRecord(request)]);
      setCaptured(list.length + 1);
    }
    // With no mapped questions, the page's own "finish" request ends the survey.
    if (match.level === 'none' && completesOn(request?.url, surveyJson.spSite?.completeOn)) complete();
  };

  const zh = /^zh/i.test(language || surveyJson.locale || '');
  const showBar = match.level === 'none';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: '#fff', display: 'flex', flexDirection: 'column' }} data-testid="sp-site-survey">
      <div style={{ flex: 1, minHeight: 0 }}>
        <SpSiteFrame
          html={surveyJson.spSite.html}
          allowedHosts={surveyJson.spSite.allowedHosts || []}
          questions={questions}
          media={media}
          survey={{
            title: model.title || surveyJson.title || '',
            description: model.description || '',
            language: language || surveyJson.locale || 'en',
          }}
          initialAnswers={initialAnswers}
          onAnswer={onAnswer}
          onCapture={onCapture}
          onComplete={complete}
          title={model.title || 'Survey'}
        />
      </div>
      {showBar && (
        <div
          data-testid="sp-site-raw-bar"
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderTop: '1px solid #e0e0e0', background: '#fafafa', fontSize: 13, color: '#444' }}
        >
          <span style={{ flex: 1 }}>
            {zh
              ? `SP-Survey 正在原样记录本页发送的数据（${captured} 条）。做完后请点“完成并提交”。`
              : `SP-Survey is recording what this page sends (${captured} so far). Click “Finish and submit” when you are done.`}
          </span>
          <button
            type="button"
            onClick={complete}
            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #1976d2', background: '#1976d2', color: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            {zh ? '完成并提交' : 'Finish and submit'}
          </button>
        </div>
      )}
    </div>
  );
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  draftsMatch,
  normalizeDraftTimestamp,
  normalizeSurveyForCompare,
  verifySavedDraft,
} from './draftVerify.mjs';

const survey = {
  title: 'Street safety',
  locale: 'en',
  pages: [{
    name: 'page_perception',
    elements: [
      {
        name: 'safety_rating',
        type: 'imagerating',
        title: 'How safe?',
        rateMin: 1,
        rateMax: 5,
        choices: [{ value: 'a', text: 'A' }, { value: 'b', text: 'B' }],
        mediaFolder: 'allowed',
        trialCount: 2,
      },
    ],
  }],
};

test('treats equivalent ISO timestamps as the same draft version', () => {
  assert.equal(
    normalizeDraftTimestamp('2026-09-15T13:24:21.808Z'),
    normalizeDraftTimestamp('2026-09-15T13:24:21.808+00:00'),
  );
});

test('ignores empty logo after sanitization but not locale or question content', () => {
  const intended = { draftUpdatedAt: '2026-09-15T13:24:21.808Z', surveyConfig: survey };
  const emptyLogo = draftsMatch(intended, {
    draftUpdatedAt: '2026-09-15T13:24:21.808+00:00',
    surveyConfig: { ...survey, logo: '' },
  });
  assert.equal(emptyLogo.ok, true);
  assert.equal(emptyLogo.reason, 'exact');

  const localeChanged = draftsMatch(intended, {
    draftUpdatedAt: '2026-09-15T13:24:21.808Z',
    surveyConfig: { ...survey, locale: 'zh' },
  });
  assert.equal(localeChanged.ok, false);
  assert.equal(localeChanged.reason, 'mismatch');
});

test('does not accept a same-structure draft with different title, scale, choices, folder, or trial', () => {
  const intended = { draftUpdatedAt: '2026-09-16T01:00:00.000Z', surveyConfig: {
    ...survey,
    title: 'Updated title',
    pages: [{
      name: 'page_perception',
      elements: [{
        ...survey.pages[0].elements[0],
        title: 'Rate the street',
        rateMax: 7,
        choices: [{ value: 'a', text: 'Low' }, { value: 'b', text: 'High' }],
        mediaFolder: 'safety',
        trialCount: 4,
      }],
    }],
  } };
  const stale = {
    draftUpdatedAt: '2026-09-16T01:00:00.000Z',
    surveyConfig: survey,
  };
  const match = draftsMatch(intended, stale);
  assert.equal(match.ok, false);
  assert.equal(match.reason, 'mismatch');
  assert.notEqual(
    JSON.stringify(normalizeSurveyForCompare(intended.surveyConfig)),
    JSON.stringify(normalizeSurveyForCompare(stale.surveyConfig)),
  );
});

test('retries a delayed re-read and then accepts the persisted semantic draft', async () => {
  const intended = {
    draftUpdatedAt: '2026-09-15T13:24:21.808Z',
    revisionId: 'rev_abc',
    surveyConfig: survey,
  };
  const reads = [
    { draftUpdatedAt: '2026-09-15T13:00:00.000Z', surveyConfig: { pages: [] } },
    { ...intended, draftUpdatedAt: '2026-09-15T13:24:21.808+00:00' },
  ];
  const result = await verifySavedDraft({
    intended,
    readDraft: async () => reads.shift(),
    delayMs: 1,
    sleep: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'exact');
  assert.equal(result.verified, true);
});

test('returns unverified when the re-read stays stale after retries', async () => {
  const result = await verifySavedDraft({
    intended: { draftUpdatedAt: '2026-09-16T01:00:00.000Z', surveyConfig: survey },
    readDraft: async () => ({
      draftUpdatedAt: '2026-09-15T13:00:00.000Z',
      surveyConfig: survey,
    }),
    retries: 1,
    delayMs: 1,
    sleep: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unverified');
  assert.equal(result.verified, false);
});

test('fails immediately when the persisted survey is a different questionnaire', async () => {
  const result = await verifySavedDraft({
    intended: { draftUpdatedAt: '2026-09-15T13:24:21.808Z', surveyConfig: survey },
    readDraft: async () => ({
      draftUpdatedAt: '2026-09-15T13:24:21.808Z',
      surveyConfig: { pages: [{ name: 'other', elements: [{ name: 'q1', type: 'text' }] }] },
    }),
    retries: 2,
    sleep: async () => {
      throw new Error('mismatch must not retry');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mismatch');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { draftsMatch, normalizeDraftTimestamp, verifySavedDraft } from './draftVerify.mjs';

const survey = {
  title: 'Street safety',
  pages: [{
    name: 'page_perception',
    elements: [
      { name: 'safety_rating', type: 'imagerating' },
      { name: 'hazard_annotation', type: 'imageannotation' },
    ],
  }],
};

test('treats equivalent ISO timestamps as the same draft version', () => {
  assert.equal(
    normalizeDraftTimestamp('2026-09-15T13:24:21.808Z'),
    normalizeDraftTimestamp('2026-09-15T13:24:21.808+00:00'),
  );
});

test('accepts a re-read whose extra fields differ after save sanitization', () => {
  const match = draftsMatch(
    { draftUpdatedAt: '2026-09-15T13:24:21.808Z', surveyConfig: survey },
    {
      draftUpdatedAt: '2026-09-15T13:24:21.808+00:00',
      surveyConfig: { ...survey, logo: '', locale: 'zh' },
    },
  );
  assert.equal(match.ok, true);
  assert.equal(match.reason, 'structural');
});

test('retries a stale re-read and then accepts the persisted draft', async () => {
  const reads = [
    { draftUpdatedAt: '2026-09-15T13:00:00.000Z', surveyConfig: { pages: [] } },
    { draftUpdatedAt: '2026-09-15T13:24:21.808+00:00', surveyConfig: survey },
  ];
  const result = await verifySavedDraft({
    intended: { draftUpdatedAt: '2026-09-15T13:24:21.808Z', surveyConfig: survey },
    readDraft: async () => reads.shift(),
    delayMs: 1,
    sleep: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'exact');
});

test('fails only when the persisted survey is missing or a different questionnaire', async () => {
  const result = await verifySavedDraft({
    intended: { draftUpdatedAt: '2026-09-15T13:24:21.808Z', surveyConfig: survey },
    readDraft: async () => ({
      draftUpdatedAt: '2026-09-15T13:24:21.808Z',
      surveyConfig: { pages: [{ name: 'other', elements: [{ name: 'q1', type: 'text' }] }] },
    }),
    retries: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mismatch');
});

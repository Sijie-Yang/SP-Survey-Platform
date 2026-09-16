import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickMediaForSilicon,
  pickTrialMediaForSilicon,
  preflightMediaForQuestions,
  questionNeedsShownMedia,
  seededShuffle,
} from './mediaAssign.mjs';

describe('silicon media assignment', () => {
  it('is deterministic for the same seed', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    assert.deepEqual(seededShuffle(pool, 7), seededShuffle(pool, 7));
    assert.notDeepEqual(seededShuffle(pool, 7), seededShuffle(pool, 8));
  });

  it('picks a stable subset per question', () => {
    const pool = [{ url: 'https://x/1.jpg' }, { url: 'https://x/2.jpg' }, { url: 'https://x/3.jpg' }];
    const a = pickMediaForSilicon({ pool, question: { name: 'q1', imageCount: 2 }, seed: 42 });
    const b = pickMediaForSilicon({ pool, question: { name: 'q1', imageCount: 2 }, seed: 42 });
    assert.deepEqual(a, b);
    assert.equal(a.length, 2);
  });

  it('does not pick images outside the allowed folder or replace fixed urls', () => {
    const pool = [
      { url: 'https://x/allowed-1.jpg', folder: 'allowed' },
      { url: 'https://x/nested.jpg', folder: 'allowed/nested' },
      { url: 'https://x/other-1.jpg', folder: 'other' },
    ];
    const folderPick = pickMediaForSilicon({
      pool,
      question: { name: 'q1', imageCount: 2, mediaFolders: ['allowed'] },
      seed: 1,
    });
    assert.deepEqual(folderPick.sort(), ['https://x/allowed-1.jpg', 'https://x/nested.jpg']);
    const emptyFolders = pickMediaForSilicon({
      pool,
      question: { name: 'q1', imageCount: 2, mediaFolders: [] },
      seed: 1,
    });
    assert.equal(emptyFolders.length, 2);
    const missingFolder = pickMediaForSilicon({
      pool,
      question: { name: 'q1', imageCount: 2, mediaFolders: ['missing'] },
      seed: 1,
    });
    assert.deepEqual(missingFolder, []);
    const fixed = pickMediaForSilicon({
      pool,
      question: {
        name: 'q2',
        imageSelectionMode: 'huggingface_manual',
        selectedImageUrls: ['https://x/outside.jpg'],
      },
      seed: 99,
    });
    assert.deepEqual(fixed, ['https://x/outside.jpg']);
  });

  it('preflights missing media sources without inventing a successful run', () => {
    const survey = {
      pages: [{ elements: [{ type: 'imagerating', name: 'q1', imageCount: 1, mediaFolders: [] }] }],
    };
    const empty = preflightMediaForQuestions({
      surveyConfig: survey,
      questionNames: ['q1'],
      pool: [],
    });
    assert.equal(empty.ok, false);
    assert.equal(empty.errors[0].code, 'no_media_source');
    const folder = preflightMediaForQuestions({
      surveyConfig: {
        pages: [{ elements: [{ type: 'imagerating', name: 'q1', imageCount: 1, mediaFolders: ['missing'] }] }],
      },
      questionNames: ['q1'],
      pool: [{ url: 'https://x/1.jpg', folder: 'street' }],
    });
    assert.equal(folder.ok, false);
    assert.equal(folder.errors[0].code, 'folder_empty');
    const preview = preflightMediaForQuestions({
      surveyConfig: survey,
      questionNames: ['q1'],
      pool: [{ url: 'https://preview/1.jpg' }],
    });
    assert.equal(preview.ok, true);
  });

  it('flags image questions that must have media before the model is called', () => {
    assert.equal(questionNeedsShownMedia({ type: 'imagerating' }), true);
    assert.equal(questionNeedsShownMedia({ type: 'imageslidergroup' }), true);
    assert.equal(questionNeedsShownMedia({ type: 'rating' }), false);
    assert.equal(questionNeedsShownMedia({ type: 'rating', imageCount: 2 }), true);
  });

  it('picks one set and distinct trials when asked', () => {
    const pool = [
      { url: 'https://x/sun-1.jpg', folder: 'sun' },
      { url: 'https://x/sun-2.jpg', folder: 'sun' },
      { url: 'https://x/shade-1.jpg', folder: 'shade' },
      { url: 'https://x/shade-2.jpg', folder: 'shade' },
    ];
    const setPick = pickMediaForSilicon({
      pool,
      question: { name: 'qset', imageCount: 2, mediaAssignmentMode: 'set' },
      seed: 3,
      dataset: { folderTags: { sun: { set: 'sun' }, shade: { set: 'shade' } } },
    });
    assert.equal(setPick.length, 2);
    assert.equal(new Set(setPick.map((url) => url.includes('/sun-') ? 'sun' : 'shade')).size, 1);
    const trials = pickTrialMediaForSilicon({
      pool,
      question: { name: 'qtrial', imageCount: 1, trialCount: 2 },
      seed: 9,
    });
    assert.equal(trials.length, 2);
    assert.equal(trials[0].length, 1);
    assert.notDeepEqual(trials[0], trials[1]);
  });
});

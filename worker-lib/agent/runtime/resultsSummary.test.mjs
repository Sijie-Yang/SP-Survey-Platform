import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compactJsonForModel } from './toolArgs.mjs';
import { parseResultsQuery } from '../resultsHandlers.mjs';

describe('results summary tools', () => {
  it('parses version, date, practice, quality, question, and dimension filters', () => {
    const filters = parseResultsQuery({
      projectId: 'p1',
      view: 'question',
      dataSource: 'human',
      includePractice: false,
      excludeFlagged: true,
      dateFrom: '2026-09-01',
      dateTo: '2026-09-17',
      timezone: 'UTC',
      sessionId: 's1',
      surveyRevision: 'v2',
      questionName: 'walk',
      dimensionId: 'safety',
    });
    assert.equal(filters.view, 'question');
    assert.equal(filters.surveyRevision, 'v2');
    assert.equal(filters.questionName, 'walk');
    assert.equal(filters.dimensionId, 'safety');
    assert.equal(filters.excludeFlagged, true);
    assert.equal(filters.includePractice, false);
  });

  it('compacts large result payloads without dropping scope or counts', () => {
    const catalog = Array.from({ length: 30 }, (_, i) => ({
      name: `q${i}`,
      title: `Question ${i}`,
      type: 'rating',
      number: i + 1,
      method: 'scalar_distribution',
      nAnswered: 4,
    }));
    const payload = {
      kind: 'results',
      view: 'overview',
      success: true,
      scope: { projectId: 'p1', dataSource: 'human', surveyRevision: 'v2' },
      counts: { nResponses: 12, nParticipants: 8, nTrials: 20 },
      catalog,
      questions: catalog,
    };
    const compact = JSON.parse(compactJsonForModel(payload, { maxChars: 1500 }));
    assert.equal(compact.kind, 'results');
    assert.equal(compact.scope.projectId, 'p1');
    assert.equal(compact.counts.nResponses, 12);
    assert.ok(compact.catalog.length < 30);
    assert.equal(compact.next.read.tool, 'survey_results_summary');
    assert.equal(String(JSON.stringify(compact)).includes('q29'), false);
  });
});

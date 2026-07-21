import { buildQuestionLongCsv, buildQuestionSummaryCsv } from './questionSummaryExport';

describe('custom skill archetypes — long + summary', () => {
  const question = {
    name: 'street1',
    type: 'skillquestion',
    skillId: 'skill_custom_points',
    skillResultSchema: [
      { key: 'marks', label: 'Marks', type: 'points' },
      { key: 'budget', label: 'Budget', type: 'allocation' },
      { key: 'order', label: 'Order', type: 'rankedList' },
      { key: 'score', label: 'Score', type: 'number' },
    ],
  };

  const rows = [{
    participant_id: 'p1',
    created_at: '2026-01-01T00:00:00Z',
    responses: {
      street1: {
        answer: {
          imageUrl: 'https://cdn.example/scene.jpg',
          marks: [
            { x: 0.2, y: 0.3, label: 'door' },
            { x: 0.7, y: 0.5, label: 'tree' },
          ],
          budget: { trees: 40, seats: 60 },
          order: ['A', 'B', 'C'],
          score: 72,
        },
        shown_images: ['https://cdn.example/scene.jpg'],
      },
    },
  }];

  test('long CSV expands points / allocation / rankedList and keeps answer_json', () => {
    const long = buildQuestionLongCsv(question, rows, null);
    expect(long).toContain('answer_json');
    expect(long).toContain('field_type');
    expect(long).toContain('points');
    expect(long).toContain('allocation');
    expect(long).toContain('rankedList');
    expect(long).toContain('door');
    expect(long).toContain('trees');
    expect(long).toContain('scene.jpg');
    // header + answer_json row + 2 points + 2 allocation + 3 ranks
    expect(long.trim().split('\n').length).toBeGreaterThanOrEqual(8);
  });

  test('summary CSV aggregates by media and archetype metrics', () => {
    const summary = buildQuestionSummaryCsv(question, rows);
    expect(summary).toContain('scene.jpg');
    expect(summary).toContain('label_count');
    expect(summary).toContain('score');
    expect(summary).toContain('avg_rank');
  });

  test('path field expands vertices and summarizes length', () => {
    const q = {
      name: 'route1',
      type: 'skillquestion',
      skillResultSchema: [{ key: 'route', label: 'Route', type: 'path' }],
    };
    const pathRows = [{
      participant_id: 'p1',
      created_at: '2026-01-01T00:00:00Z',
      responses: {
        route1: {
          answer: {
            imageUrl: 'https://cdn.example/map.jpg',
            route: [
              { x: 0, y: 0, t: 0 },
              { x: 1, y: 0, t: 1 },
              { x: 1, y: 1, t: 2 },
            ],
          },
          shown_images: ['https://cdn.example/map.jpg'],
        },
      },
    }];
    const long = buildQuestionLongCsv(q, pathRows, null);
    expect(long).toContain('path');
    expect(long.trim().split('\n').length).toBe(5); // header + answer + 3 vertices
    const summary = buildQuestionSummaryCsv(q, pathRows);
    expect(summary).toContain('path_length');
  });
});

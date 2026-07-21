import { summarizeSkillAnswer, summarizeSkillAnswerOneLine } from './skillAnswerSummary';

describe('summarizeSkillAnswer', () => {
  test('empty', () => {
    expect(summarizeSkillAnswer(null)[0]).toMatch(/未作答/);
  });

  test('cue_detective', () => {
    const lines = summarizeSkillAnswer({
      mode: 'cue_detective',
      rankedCues: ['绿化', '照明', '车辆速度感'],
      elapsedMs: 12000,
    });
    expect(lines.some((l) => l.includes('线索顺序'))).toBe(true);
    expect(lines.some((l) => l.includes('任务'))).toBe(true);
    expect(summarizeSkillAnswerOneLine({
      mode: 'cue_detective',
      rankedCues: ['a', 'b'],
    })).toContain('线索顺序');
  });

  test('budget_lab', () => {
    const lines = summarizeSkillAnswer({
      mode: 'budget_lab',
      allocations: { 照明: 40, 树荫: 60 },
      total: 100,
      priority: '树荫',
    });
    expect(lines.some((l) => l.includes('预算'))).toBe(true);
    expect(lines.some((l) => l.includes('合计'))).toBe(true);
  });
});

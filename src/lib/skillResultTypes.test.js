import {
  isKnownSkillResultType,
  validateSkillResultValue,
  checkAnswerAgainstResultSchema,
  KNOWN_SKILL_RESULT_TYPE_IDS,
} from './skillResultTypes';

describe('isKnownSkillResultType', () => {
  it('knows catalog + string alias', () => {
    expect(isKnownSkillResultType('points')).toBe(true);
    expect(isKnownSkillResultType('rankedList')).toBe(true);
    expect(isKnownSkillResultType('string')).toBe(true);
    expect(isKnownSkillResultType('foobar')).toBe(false);
  });
});

describe('validateSkillResultValue', () => {
  it('validates points', () => {
    expect(validateSkillResultValue('points', [{ x: 0.1, y: 0.2, label: 'door' }]).ok).toBe(true);
    expect(validateSkillResultValue('points', []).ok).toBe(false);
    expect(validateSkillResultValue('points', [{ x: 'a' }]).ok).toBe(false);
  });

  it('validates path', () => {
    expect(validateSkillResultValue('path', [{ x: 0, y: 0 }, { x: 1, y: 1 }]).ok).toBe(true);
    expect(validateSkillResultValue('path', [{ x: 0, y: 0 }]).ok).toBe(false);
  });

  it('validates allocation and scaleGroup', () => {
    expect(validateSkillResultValue('allocation', { trees: 40, seats: 60 }).ok).toBe(true);
    expect(validateSkillResultValue('scaleGroup', { pleasant: 70 }).ok).toBe(true);
    expect(validateSkillResultValue('allocation', {}).ok).toBe(false);
  });

  it('validates rankedList', () => {
    expect(validateSkillResultValue('rankedList', ['A', 'B', 'C']).ok).toBe(true);
    expect(validateSkillResultValue('rankedList', []).ok).toBe(false);
  });

  it('accepts unknown types with any value', () => {
    expect(validateSkillResultValue('myCustomGraph', { edges: [] }).ok).toBe(true);
  });
});

describe('checkAnswerAgainstResultSchema', () => {
  it('reports per-field status', () => {
    const schema = [
      { key: 'marks', label: 'Marks', type: 'points' },
      { key: 'note', label: 'Note', type: 'text' },
    ];
    const r = checkAnswerAgainstResultSchema(
      { marks: [{ x: 0.5, y: 0.5 }], imageUrl: 'http://x' },
      schema,
    );
    expect(r.recorded).toBe(true);
    expect(r.fields[0].ok).toBe(true);
    expect(r.fields[1].ok).toBe(false);
    expect(r.fields[1].detail).toBe('missing');
  });
});

describe('catalog', () => {
  it('includes archetypes', () => {
    expect(KNOWN_SKILL_RESULT_TYPE_IDS).toContain('points');
    expect(KNOWN_SKILL_RESULT_TYPE_IDS).toContain('path');
    expect(KNOWN_SKILL_RESULT_TYPE_IDS).toContain('allocation');
    expect(KNOWN_SKILL_RESULT_TYPE_IDS).toContain('rankedList');
  });
});

import React from 'react';
import { render, screen } from '@testing-library/react';
import SkillQuestionFrame, { skillAnswerPresent } from './SkillQuestionWidget';
import {
  captureSkillPreviewAnswers,
  isSkillAnswerReviewMode,
  resolveSkillQuestionValue,
} from './SurveyCustomComponents';

describe('skillAnswerPresent', () => {
  it('rejects empty / context-only answers', () => {
    expect(skillAnswerPresent(null)).toBe(false);
    expect(skillAnswerPresent('')).toBe(false);
    expect(skillAnswerPresent({})).toBe(false);
    expect(skillAnswerPresent({ imageUrl: 'https://x/a.jpg' })).toBe(false);
    expect(skillAnswerPresent({ shown_images: ['a.jpg'] })).toBe(false);
  });

  it('accepts real answer payloads', () => {
    expect(skillAnswerPresent(42)).toBe(true);
    expect(skillAnswerPresent({ score: 1 })).toBe(true);
    expect(skillAnswerPresent({ marks: [{ x: 0.1, y: 0.2 }], imageUrl: 'https://x/a.jpg' })).toBe(true);
    expect(skillAnswerPresent(['a', 'b'])).toBe(true);
  });
});

describe('skill preview answer snapshot', () => {
  function makeSurvey(value, dataValue = undefined) {
    const question = {
      name: 'custom_skill',
      value,
      skillAnswerSnapshot: null,
      getType: () => 'skillquestion',
    };
    const survey = {
      data: dataValue === undefined ? {} : { custom_skill: dataValue },
      getAllQuestions: () => [question],
    };
    question.survey = survey;
    return { survey, question };
  }

  it('captures a real object answer before SurveyJS enters preview', () => {
    const original = { score: 4, choice: 'A' };
    const { survey, question } = makeSurvey(original);
    const snapshot = captureSkillPreviewAnswers(survey);

    expect(snapshot).toEqual({ custom_skill: original });
    expect(question.skillAnswerSnapshot).toEqual(original);
    expect(question.skillAnswerSnapshot).not.toBe(original);

    // Preview clones can lose the live field value; the frozen answer still wins.
    question.value = null;
    expect(resolveSkillQuestionValue(question, null, true)).toEqual(original);
  });

  it('falls back to SurveyJS data and ignores context-only payloads', () => {
    const recorded = { selected: ['x'] };
    const { survey, question } = makeSurvey({ imageUrl: 'stimulus.jpg' }, recorded);
    expect(captureSkillPreviewAnswers(survey)).toEqual({ custom_skill: recorded });

    question.value = null;
    question.skillAnswerSnapshot = { imageUrl: 'stimulus.jpg' };
    survey.__skillPreviewAnswers = {};
    survey.data = {};
    expect(resolveSkillQuestionValue(question, null, true)).toBeNull();
  });

  it('does not confuse Admin display mode with participant answer review', () => {
    expect(isSkillAnswerReviewMode({
      isReadOnly: true,
      survey: { mode: 'display', state: 'running' },
    })).toBe(false);
    expect(isSkillAnswerReviewMode({
      isReadOnly: true,
      survey: { mode: 'display', state: 'preview' },
    })).toBe(true);
  });

  it('renders the frozen answer in preview without requiring executable Skill HTML', () => {
    render(
      <SkillQuestionFrame
        skillHtml=""
        skillId="private-skill"
        value={{ score: 5 }}
        readOnly
        resultSchema={[{ key: 'score', label: 'Score', type: 'number' }]}
      />,
    );

    expect(screen.queryByText('Skill HTML not configured.')).toBeNull();
    expect(screen.getByText(/score: 5/i)).toBeTruthy();
    expect(screen.queryByTitle('skill-question')).toBeNull();
  });
});

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PaperMethodsPanel from './PaperMethodsPanel';
import { RegionProvider } from '../../contexts/RegionContext';

const pick = (participant, a, b, answer, meta = {}) => ({
  participant_id: participant,
  responses: { q: { answer, shown_images: [a, b] } },
  survey_metadata: meta,
});
const responses = [
  pick('p1', 'A.jpg', 'B.jpg', 'A.jpg', { condition: 'x' }), pick('p1', 'A.jpg', 'C.jpg', 'A.jpg', { condition: 'x' }),
  pick('p2', 'B.jpg', 'C.jpg', 'B.jpg', { condition: 'y' }), pick('p2', 'A.jpg', 'C.jpg', 'C.jpg', { condition: 'y' }),
];
const question = { name: 'q', type: 'imagepicker', title: 'Which looks safer?' };

beforeEach(() => localStorage.clear());

test('collapsed by default and hidden for unsupported types', () => {
  const { container } = render(<RegionProvider><PaperMethodsPanel question={{ name: 't', type: 'text' }} allResponses={responses} surveyConfig={{}} /></RegionProvider>);
  expect(container.textContent).toBe('');
  render(<RegionProvider><PaperMethodsPanel question={question} allResponses={responses} surveyConfig={{ pages: [{ elements: [question] }] }} /></RegionProvider>);
  expect(screen.getByText('Paper methods (optional)')).toBeTruthy();
  expect(screen.queryByText('Export scores CSV')).toBeNull();
});

test('template recommendation preselects Q-score and shows conditions', () => {
  const surveyConfig = {
    pages: [{ elements: [question] }],
    conditions: [{ id: 'x' }, { id: 'y' }],
    spAnalysisRecommendation: { questions: ['q'], method: 'qscore_pairwise', minPerImage: 1 },
  };
  render(<RegionProvider><PaperMethodsPanel question={question} allResponses={responses} surveyConfig={surveyConfig} /></RegionProvider>);
  expect(screen.getByText('Template recommendation')).toBeTruthy();
  fireEvent.click(screen.getByText('Paper methods (optional)'));
  expect(screen.getByText('Q-score (0–10)')).toBeTruthy();
  const table = screen.getByRole('table');
  expect(within(table).getByText('A.jpg')).toBeTruthy();
  expect(screen.getByText('Group comparison')).toBeTruthy();
});

test('rating questions show per-stimulus stats', () => {
  const rq = { name: 'r', type: 'imagerating', rateMin: 1, rateMax: 5 };
  const rows = [1, 2, 3].map((v, i) => ({ participant_id: `p${i}`, responses: { r: { answer: v, shown_images: ['A.jpg'] } } }));
  render(<RegionProvider><PaperMethodsPanel question={rq} allResponses={rows} surveyConfig={{ pages: [{ elements: [rq] }] }} /></RegionProvider>);
  fireEvent.click(screen.getByText('Paper methods (optional)'));
  expect(screen.getByText('Export per-stimulus CSV')).toBeTruthy();
});

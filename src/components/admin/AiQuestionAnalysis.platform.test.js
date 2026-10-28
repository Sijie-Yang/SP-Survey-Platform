import React from 'react';
import { render, screen } from '@testing-library/react';
import { RegionProvider } from '../../contexts/RegionContext';
import AiQuestionAnalysis from './AiQuestionAnalysis';
import { buildAnalysisRecords } from '../../lib/aiQuestionAnalysis';

jest.mock('../../lib/agentApi', () => ({ writeQuestionAnalysis: jest.fn() }));
jest.mock('../../lib/aiAnalysisSandbox', () => ({ runAnalysisInSandbox: jest.fn() }));

const value = (i, compare) => ({ round: i + 1, imageA: `a${i}.jpg`, imageB: `b${i}.jpg`, compare, ratingA: 4, ratingB: 2, reasonsA: ['有人行道'], reasonsB: ['路太窄'], startedAt: 1793174875928, savedAt: 1793174906097 + i, durationMs: 30000 + i * 5000 });
const rows = [{ participant_id: 'p1', responses: { grade: '二年级', pair_task: { trials: [value(0, 'a_safer'), value(1, 'b_safer'), value(2, 'similar')].map((v) => ({ value: v, shown_images: [v.imageA, v.imageB] })) } } }];
const question = { name: 'pair_task', type: 'custom', title: '比较' };

test('a custom question shows the platform analysis and its field coverage before any model is asked', () => {
  render(<RegionProvider><AiQuestionAnalysis question={question} records={buildAnalysisRecords(rows, question)} saved={null} onSave={jest.fn()} /></RegionProvider>);
  expect(screen.getByTestId('ai-analysis-coverage')).toBeTruthy();
  expect(screen.getAllByText('reasonsA').length).toBeGreaterThan(0);
  expect(screen.getByTestId('ai-analysis-generate')).toBeTruthy();
});

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResultsAnalysis, { QuestionCard, buildQuestionCardProps } from './ResultsAnalysis';
import { RegionProvider } from '../../contexts/RegionContext';
import { saveProjectFull } from '../../lib/projectManager';
import { fetchAdminResponsePage } from '../../lib/adminResults';

jest.mock('../../lib/supabase', () => ({supabase: null}));
jest.mock('../../lib/projectManager', () => ({saveProjectFull: jest.fn()}));
jest.mock('./ImagePerceptionPanel', () => () => null);
jest.mock('../../lib/adminResults', () => ({ fetchAdminResponsePage: jest.fn() }));

const q = {name: 'q', type: 'rating', title: 'Comfort'};
const config = {pages: [{name: 'page', elements: [q]}]};
const responses = [
  {id: 'one', participant_id: 'p1', responses: {q: 1}},
  {id: 'two', participant_id: 'p1', responses: {q: 5}},
];
beforeEach(() => { localStorage.clear(); jest.clearAllMocks(); });

test('platform admin reads the selected project through the admin API without delete controls', async () => {
  fetchAdminResponsePage.mockResolvedValueOnce(responses).mockResolvedValue([]);
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'other-owner-project', name: 'Other project' }} surveyConfig={config} adminMode /></RegionProvider>);
  await screen.findByText(/2 \/ 2 submissions in analysis/);
  expect(fetchAdminResponsePage).toHaveBeenCalledWith('other-owner-project', 0, null);
  fireEvent.click(screen.getByRole('tab', { name: /Data/i }));
  fireEvent.click(screen.getByRole('button', { name: /Response records/i }));
  expect(screen.getAllByRole('button', {name: 'View'})).toHaveLength(2);
  expect(screen.queryByRole('button', {name: 'Delete this response'})).toBeNull();
  expect(saveProjectFull).not.toHaveBeenCalled();
});

test('unreadable admin rows are skipped so the rest of the project still loads', async () => {
  fetchAdminResponsePage.mockResolvedValueOnce([
    ...responses,
    { id: 'bad', _unreadable: true, _unreadableReason: 'oversized_or_timeout', responses: {} },
  ]).mockResolvedValue([]);
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'other-owner-project' }} surveyConfig={config} adminMode /></RegionProvider>);
  await screen.findByText(/2 \/ 2 submissions in analysis/);
  expect(screen.getByText(/too large or unreadable/i)).toBeTruthy();
  expect(screen.queryByText(/Failed to load responses/)).toBeNull();
});

test('admin permission errors are shown instead of falling back to local responses', async () => {
  const denied = new Error('仅平台管理员可以查看此项目的答卷。');
  denied.requestId = 'req-admin-forbidden';
  denied.stage = 'admin';
  fetchAdminResponsePage.mockRejectedValue(denied);
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'restricted-project' }} surveyConfig={config} adminMode /></RegionProvider>);
  expect(await screen.findByText(/仅平台管理员可以查看此项目的答卷/)).toBeTruthy();
  expect(screen.getByText(/req-admin-forbidden/)).toBeTruthy();
  expect(screen.queryByText(/2 \/ 2 submissions in analysis/)).toBeNull();
  expect(screen.getAllByRole('heading', { name: '–' }).length).toBeGreaterThan(0);
  fetchAdminResponsePage.mockResolvedValueOnce(responses).mockResolvedValue([]);
  fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
  await screen.findByText(/2 \/ 2 submissions in analysis/);
});

test('question card uses submission denominator for repeat participants', () => {
  render(<RegionProvider><QuestionCard {...buildQuestionCardProps(q, responses)} /></RegionProvider>);
  expect(screen.getByText(/2 \/ 2 submissions answered \(100%\) · 1 participants/)).toBeTruthy();
});

test('filter preference does not save the survey and submission details are available', async () => {
  const previousFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ok: true, json: async () => ({responses})});
  try {
    render(<RegionProvider><ResultsAnalysis currentProject={{id: 'project', name: 'Project'}} surveyConfig={config} /></RegionProvider>);
    await screen.findByText(/2 \/ 2 submissions in analysis/);
    fireEvent.click(screen.getByRole('button', { name: /Filters/i }));
    fireEvent.click(screen.getByRole('switch', {name: 'Include researcher practice'}));
    expect(saveProjectFull).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('sp-analysis-prefs:project')).includePractice).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: /Data/i }));
    fireEvent.click(screen.getByRole('button', { name: /Response records/i }));
    fireEvent.click(screen.getAllByRole('button', {name: 'View'})[0]);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Not recorded (historical response)', {exact: false})).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: 'Close'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  } finally { global.fetch = previousFetch; }
});

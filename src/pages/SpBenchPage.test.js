import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { RegionProvider } from '../contexts/RegionContext';
import SpBenchPage from './SpBenchPage';
import { getBenchPublic, getHumanSubmissions, getHumanTasks } from '../lib/spBenchApi';
import { buildHumanTask, publicTask } from '../lib/benchHumanTrack';
import { syntheticResponses, syntheticSurveyConfig } from '../lib/__fixtures__/syntheticResults';

jest.mock('../lib/spBenchApi', () => ({ getBenchPublic: jest.fn(), getHumanTasks: jest.fn(), getHumanSubmissions: jest.fn() }));
jest.mock('../components/layout/PublicHeader', () => ({ __esModule: true, default: () => null, PublicFooter: () => null }));

const config = syntheticSurveyConfig({ images: 6 });
const safe = config.pages[1].elements[0];
const task = publicTask(buildHumanTask({ project: { id: 'abcd1234', name: 'S' }, question: safe, humanRows: syntheticResponses(25, { config }) }));

test('the human track is open even when the admin benchmark is not', async () => {
  getBenchPublic.mockRejectedValue(new Error('relation sp_bench_settings does not exist'));
  getHumanTasks.mockResolvedValue([task]);
  getHumanSubmissions.mockResolvedValue([]);
  render(<RegionProvider><SpBenchPage /></RegionProvider>);
  expect(await screen.findByTestId('human-leaderboard')).toBeInTheDocument();
  expect(screen.getByTestId('human-task-abcd1234-safe')).toBeInTheDocument();
  expect(screen.queryByText(/not open/)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('says "not open" when neither track has anything', async () => {
  getBenchPublic.mockResolvedValue({ success: true, enabled: false, leaderboard: [] });
  getHumanTasks.mockResolvedValue([]);
  getHumanSubmissions.mockResolvedValue([]);
  render(<RegionProvider><SpBenchPage /></RegionProvider>);
  expect(await screen.findByText(/not open|尚未开放|未开放/)).toBeInTheDocument();
});

test('both tracks show as tabs when both are open', async () => {
  getBenchPublic.mockResolvedValue({ success: true, enabled: true, settings: { title: 'SP-Bench' }, leaderboard: [] });
  getHumanTasks.mockResolvedValue([task]);
  getHumanSubmissions.mockResolvedValue([]);
  render(<RegionProvider><SpBenchPage /></RegionProvider>);
  expect(await screen.findByRole('tab', { name: /Human agreement|真人一致性/ })).toBeInTheDocument();
  expect(screen.getAllByRole('tab').length).toBe(6);
});

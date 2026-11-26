import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import SiteGrowthSection from './SiteGrowthSection';
import { getPlatformDashboard, funnelSteps, percentChange, runningTotal, formatUsd } from '../lib/platformDashboard';
import fixture from './__fixtures__/platformDashboard.json';

jest.mock('../lib/platformDashboard', () => ({
  ...jest.requireActual('../lib/platformDashboard'),
  getPlatformDashboard: jest.fn(),
}));
jest.mock('./SiteGrowthLegacy', () => () => <div>legacy panel</div>);

test('helpers', () => {
  expect(percentChange(30, 20)).toBe(50);
  expect(percentChange(5, 0)).toBeNull();
  expect(runningTotal([{ a: 1 }, { a: 2 }], 'a', 10)).toEqual([11, 13]);
  expect(funnelSteps({ users: 4, with_project: 2 })[1].share).toBe(0.5);
  expect(formatUsd(0.429)).toBe('$0.43');
  expect(formatUsd(0.004)).toBe('<$0.01');
});

test('shows growth, free-model cost and who uses it', async () => {
  getPlatformDashboard.mockResolvedValue({ data: fixture, error: null });
  const onOpenFreeModel = jest.fn();
  render(<SiteGrowthSection onOpenFreeModel={onOpenFreeModel} />);
  expect(await screen.findByText('平台增长')).toBeInTheDocument();
  expect(screen.getByText('免费模型开销')).toBeInTheDocument();
  expect(screen.getByText('免费模型开放中')).toBeInTheDocument();
  // 近 30 天 · 免费模型 = 0.42 (backfilled) + 0.009
  expect(screen.getAllByText('$0.43').length).toBeGreaterThan(0);
  expect(screen.getAllByText('a@x').length).toBe(2);
  expect(screen.getByText('Street safety')).toBeInTheDocument();
  expect(screen.getByText('收到真实回答')).toBeInTheDocument();
  fireEvent.click(screen.getByText('设置'));
  expect(onOpenFreeModel).toHaveBeenCalled();
  fireEvent.click(screen.getByText('近 12 个月'));
  expect(screen.getByText('每月开销')).toBeInTheDocument();
});

test('falls back to the old panel until the SQL is run', async () => {
  getPlatformDashboard.mockResolvedValue({ data: null, error: 'x', missing: true });
  render(<SiteGrowthSection />);
  expect(await screen.findByText(/platform_dashboard\.sql/)).toBeInTheDocument();
  expect(screen.getByText('legacy panel')).toBeInTheDocument();
});

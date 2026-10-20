import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { RegionProvider } from '../contexts/RegionContext';
import SiteGrowthSection from './SiteGrowthSection';
import { cumulativeSeries, getSiteGrowthStats } from '../lib/siteGrowth';

jest.mock('../lib/siteGrowth', () => ({
  ...jest.requireActual('../lib/siteGrowth'),
  getSiteGrowthStats: jest.fn(),
}));

const months = [
  { month: '2026-08', users: 2, projects: 1, responses: 10, visits: 0, visitors: 0 },
  { month: '2026-09', users: 3, projects: 2, responses: 40, visits: 120, visitors: 60 },
  { month: '2026-10', users: 5, projects: 1, responses: 50, visits: 300, visitors: 90 },
];

function renderSection() {
  return render(
    <RegionProvider>
      <SiteGrowthSection />
    </RegionProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('sp-survey-language', 'en');
});

test('cumulativeSeries adds each month to the running total', () => {
  expect(cumulativeSeries(months, 'users', 10).map((p) => p.value)).toEqual([12, 15, 20]);
  expect(cumulativeSeries(null, 'users')).toEqual([]);
});

test('shows platform totals and recent visits', async () => {
  getSiteGrowthStats.mockResolvedValue({
    users: 1234, users_before: 1224, projects: 40, projects_before: 36, responses: 5600, responses_before: 5500,
    visits: 420, visitors: 150, visits_30d: 380, visitors_30d: 120, visits_since: '2026-09-02', months,
  });
  renderSection();
  expect(await screen.findByText('Platform growth')).toBeInTheDocument();
  expect(screen.getByText('1,234')).toBeInTheDocument();
  expect(screen.getByText('5,600')).toBeInTheDocument();
  expect(screen.getByText('Visits (30 days)')).toBeInTheDocument();
  expect(screen.getByText('120 unique visitors (counted per day)')).toBeInTheDocument();
});

test('hides the visits tile until the counter has data', async () => {
  getSiteGrowthStats.mockResolvedValue({
    users: 3, projects: 1, responses: 0, visits: 0, visitors: 0, visits_30d: 0, visitors_30d: 0, months,
  });
  renderSection();
  expect(await screen.findByText('Researchers')).toBeInTheDocument();
  expect(screen.queryByText('Visits (30 days)')).not.toBeInTheDocument();
});

test('explains what to check when the stats are unavailable', async () => {
  getSiteGrowthStats.mockResolvedValue(null);
  renderSection();
  expect(await screen.findByText(/site_growth_stats\.sql/)).toBeInTheDocument();
});

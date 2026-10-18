import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { RegionProvider } from '../contexts/RegionContext';
import PlatformHighlights from './PlatformHighlights';
import { countResearchPapers } from '../lib/researchPaperStore';
import { UI_LANGUAGES } from '../lib/uiLanguages';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate, Link: () => null, useLocation: () => ({ pathname: '/' }) }), { virtual: true });
jest.mock('../lib/researchPaperStore', () => ({ countResearchPapers: jest.fn() }));

function renderStrip(templateCount) {
  return render(
    <RegionProvider>
      <PlatformHighlights templateCount={templateCount} />
    </RegionProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('sp-survey-language', 'en');
});

test('shows templates, papers, languages and open source; no usage numbers', async () => {
  countResearchPapers.mockResolvedValue(1520);
  renderStrip(42);
  expect(await screen.findByText('1,520')).toBeInTheDocument();
  expect(countResearchPapers).toHaveBeenCalledWith({ status: 'approved' });
  expect(screen.getByText('42')).toBeInTheDocument();
  expect(screen.getByText(String(UI_LANGUAGES.length))).toBeInTheDocument();
  expect(screen.getByText('Open source')).toBeInTheDocument();
  expect(screen.queryByText(/visits|researchers|responses/i)).not.toBeInTheDocument();
});

test('leaves out counts that are missing or still small', async () => {
  countResearchPapers.mockResolvedValue(12);
  renderStrip(3);
  await Promise.resolve();
  await Promise.resolve();
  expect(screen.queryByText('12')).not.toBeInTheDocument();
  expect(screen.queryByText('3')).not.toBeInTheDocument();
  expect(screen.getByText('interface languages')).toBeInTheDocument();
});

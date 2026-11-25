import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CandidatePapers } from './ResearchDeepSearch';

jest.mock('../../lib/researchPaperStore', () => ({}));
jest.mock('../../lib/templateManager', () => ({}));
jest.mock('../../lib/researchSearch', () => ({}));

describe('CandidatePapers', () => {
  it('shows nothing without candidates', () => {
    const { container } = render(<CandidatePapers rows={[]} busyIds={new Set()} onDecide={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('lists candidates with a DOI link and approve / reject', () => {
    const onDecide = jest.fn();
    const paper = { id: 'p1', title: 'A new perception survey', doi: '10.5555/new.1', year: 2026, venue: 'LUP', sources: ['weekly_scan', 'crossref'] };
    render(<CandidatePapers rows={[paper]} busyIds={new Set()} onDecide={onDecide} />);
    expect(screen.getByText('待审核候选 1 篇')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'A new perception survey' }).getAttribute('href')).toBe('https://doi.org/10.5555/new.1');
    fireEvent.click(screen.getByRole('button', { name: '通过' }));
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    expect(onDecide.mock.calls.map((c) => c[1])).toEqual(['approved', 'rejected']);
  });
});

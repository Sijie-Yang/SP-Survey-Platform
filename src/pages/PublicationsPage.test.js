import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { RegionProvider } from '../contexts/RegionContext';
import PublicationsPage, { sortPublications } from './PublicationsPage';

jest.mock('react-router-dom', () => ({
  Link: require('react').forwardRef(({ children, to, ...rest }, ref) => <a ref={ref} href={to} {...rest}>{children}</a>),
}), { virtual: true });
jest.mock('../components/layout/PublicHeader', () => ({ __esModule: true, default: () => null, PublicFooter: () => null }));

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'research', 'sp-survey-publications.json'), 'utf8'));

test('the publications file is well formed', () => {
  expect(Array.isArray(data.publications)).toBe(true);
  for (const p of data.publications) {
    expect(typeof p.title).toBe('string');
    expect(typeof p.authors).toBe('string');
    expect(Number.isInteger(p.year)).toBe(true);
    expect(['published', 'under review', 'preprint']).toContain(p.status);
    expect(String(p.doi || '')).not.toMatch(/^https?:/);
  }
});

test('lists papers newest first with how to cite', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => data });
  render(<RegionProvider><PublicationsPage /></RegionProvider>);
  const items = await screen.findAllByTestId('publication');
  expect(items).toHaveLength(data.publications.length);
  expect(items[0]).toHaveTextContent(sortPublications(data.publications)[0].title);
  expect(screen.getByTestId('publications-citation')).toHaveTextContent(/^Yang, S\./);
  expect(screen.getByRole('link', { name: 'SP-Report' })).toHaveAttribute('href', '/docs/sp-report');
});

/* eslint-disable import/first -- Jest mock must be declared before the router import. */
jest.mock('react-router-dom', () => {
  global.TextEncoder = require('util').TextEncoder;
  global.Request = require('node-fetch').Request;
  return jest.requireActual('react-router');
}, { virtual: true });
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, loading: false }),
}));
jest.mock('../lib/spBenchApi', () => ({
  getBenchPublicStatus: () => Promise.resolve({ enabled: false }),
}));
jest.mock('../lib/useGithubStars', () => ({
  useGithubStars: () => 3,
}));

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RegionProvider } from '../contexts/RegionContext';
import PrivacyPage, { PRIVACY_SECTIONS } from './PrivacyPage';
import { DOC_TOPICS } from './docsTopics';

function renderPage(language) {
  localStorage.setItem('sp-survey-language', language);
  return render(<MemoryRouter><RegionProvider><PrivacyPage /></RegionProvider></MemoryRouter>);
}

afterEach(() => localStorage.clear());

test('privacy page covers what a connector directory listing needs, in both languages', () => {
  const ids = PRIVACY_SECTIONS.map((s) => s.id);
  for (const id of ['collect', 'connector', 'use', 'share', 'keep', 'contact']) expect(ids).toContain(id);
  for (const section of PRIVACY_SECTIONS) {
    expect(section.title.en && section.title.zh).toBeTruthy();
    for (const paragraph of section.body) expect(paragraph.en && paragraph.zh).toBeTruthy();
  }
  renderPage('en');
  expect(screen.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeInTheDocument();
  expect(screen.getByText(/does not read your chat history/)).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Privacy' }).length).toBeGreaterThan(0);
});

test('privacy page renders in Chinese', () => {
  renderPage('zh');
  expect(screen.getByRole('heading', { level: 1, name: '隐私政策' })).toBeInTheDocument();
});

test('the connector setup guide exists for the directory documentation link', () => {
  const topic = DOC_TOPICS.find((t) => t.id === 'connect-ai');
  expect(topic).toBeTruthy();
  expect(JSON.stringify(topic)).toContain('https://sp-survey.org/mcp');
});

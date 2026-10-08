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
import { faqI18n } from '../contexts/faqI18n';
import { interfaceDictionary } from '../lib/uiLanguages';
import FaqPage from './FaqPage';
import { PublicFooter } from '../components/layout/PublicHeader';

function renderFaq(language) {
  localStorage.setItem('sp-survey-language', language);
  return render(
    <MemoryRouter>
      <RegionProvider>
        <FaqPage />
      </RegionProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.clear();
});

test('English and Chinese FAQ strings are a separate block and reach the dictionary', () => {
  expect(Object.keys(faqI18n.en).sort()).toEqual(Object.keys(faqI18n.zh).sort());
  expect(interfaceDictionary('en').faqWhereBody).toBe(faqI18n.en.faqWhereBody);
  expect(interfaceDictionary('zh').faqWhereBody).toBe(faqI18n.zh.faqWhereBody);
  expect(interfaceDictionary('ja').faqTitle).toBe(faqI18n.en.faqTitle);
});

test('the public FAQ states where data lives and that nothing expires it', () => {
  renderFaq('en');
  expect(screen.getByRole('heading', { level: 1, name: faqI18n.en.faqTitle })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: faqI18n.en.faqWhereTitle })).toBeInTheDocument();
  expect(screen.getByText(faqI18n.en.faqWhereBody)).toBeInTheDocument();
  expect(screen.getByText(faqI18n.en.faqHowLongBody)).toBeInTheDocument();
  const page = document.body.textContent;
  expect(page).not.toMatch(/GDPR|€|\$\d|Singapore|United States|own Supabase/i);
});

test('the Chinese FAQ uses the same facts', () => {
  renderFaq('zh');
  expect(screen.getByRole('heading', { level: 1, name: faqI18n.zh.faqTitle })).toBeInTheDocument();
  expect(screen.getByText(faqI18n.zh.faqWhereBody)).toBeInTheDocument();
  expect(screen.getByText(faqI18n.zh.faqHowLongBody)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/GDPR|自己的 Supabase/);
});

test('the site footer links to the FAQ', () => {
  localStorage.setItem('sp-survey-language', 'en');
  render(
    <MemoryRouter>
      <RegionProvider>
        <PublicFooter />
      </RegionProvider>
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '/faq');
});

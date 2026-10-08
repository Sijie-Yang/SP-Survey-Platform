/* eslint-disable import/first -- Jest mock must be declared before the router import. */
jest.mock('react-router-dom', () => {
  global.TextEncoder = require('util').TextEncoder;
  global.Request = require('node-fetch').Request;
  return jest.requireActual('react-router');
}, { virtual: true });

const mockAuthState = { isAuthenticated: false, loading: false };
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuthState,
}));
jest.mock('../../lib/spBenchApi', () => ({
  getBenchPublicStatus: () => Promise.resolve({ enabled: false }),
}));
jest.mock('../../lib/useGithubStars', () => ({
  useGithubStars: () => 3,
}));

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RegionProvider } from '../../contexts/RegionContext';
import PublicHeader from './PublicHeader';

function renderHeader() {
  localStorage.setItem('sp-survey-language', 'en');
  return render(
    <MemoryRouter>
      <RegionProvider>
        <PublicHeader />
      </RegionProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  mockAuthState.isAuthenticated = false;
  mockAuthState.loading = false;
  localStorage.clear();
});

test('signed-out visitors see researcher login', () => {
  renderHeader();
  const link = screen.getByRole('link', { name: 'Researcher login' });
  expect(link).toHaveAttribute('href', '/login');
});

test('signed-in visitors open the workspace instead of signing in again', () => {
  mockAuthState.isAuthenticated = true;
  renderHeader();
  const link = screen.getByRole('link', { name: 'Open workspace' });
  expect(link).toHaveAttribute('href', '/admin');
});

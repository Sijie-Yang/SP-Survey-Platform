/* eslint-disable import/first -- Jest mock must be declared before the router import. */
jest.mock('react-router-dom', () => {
  global.TextEncoder = require('util').TextEncoder;
  global.Request = require('node-fetch').Request;
  return jest.requireActual('react-router');
}, { virtual: true });

const mockAuthState = {
  isAuthenticated: false,
  loading: false,
  login: jest.fn(),
  register: jest.fn(),
};
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuthState,
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
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { RegionProvider } from '../contexts/RegionContext';
import LoginPage from './LoginPage';

function renderLogin(path) {
  localStorage.setItem('sp-survey-language', 'en');
  const router = createMemoryRouter([
    { path: '/login', element: <LoginPage /> },
    { path: '/admin', element: <div>workspace</div> },
    { path: '/skills', element: <div>skills</div> },
  ], { initialEntries: [path] });
  render(
    <RegionProvider>
      <RouterProvider router={router} />
    </RegionProvider>,
  );
}

afterEach(() => {
  mockAuthState.isAuthenticated = false;
  mockAuthState.loading = false;
  localStorage.clear();
});

test('a signed-in researcher skips the login form and returns to the workspace', async () => {
  mockAuthState.isAuthenticated = true;
  renderLogin('/login?next=/skills');
  expect(await screen.findByText('skills')).toBeInTheDocument();
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
});

test('the login form stays available until someone is signed in', () => {
  renderLogin('/login');
  expect(screen.getByRole('tab', { name: 'Sign In' })).toBeInTheDocument();
});

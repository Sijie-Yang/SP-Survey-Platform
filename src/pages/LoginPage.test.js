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
  sendPasswordReset: jest.fn(() => Promise.resolve({})),
  resendConfirmation: jest.fn(() => Promise.resolve({})),
  setNewPassword: jest.fn(() => Promise.resolve({})),
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
import { fireEvent, render, screen } from '@testing-library/react';
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
  window.location.hash = '';
  jest.clearAllMocks();
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

test('forgot password sends a reset e-mail to the typed address', async () => {
  renderLogin('/login');
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'a@b.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect(await screen.findByText(/reset link is on its way/)).toBeInTheDocument();
  expect(mockAuthState.sendPasswordReset).toHaveBeenCalledWith('a@b.org');
});

test('resend confirmation asks for the email first', async () => {
  renderLogin('/login');
  fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation email' }));
  expect(screen.getByText('Enter your email above first.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'a@b.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation email' }));
  expect(await screen.findByText(/Confirmation email sent again/)).toBeInTheDocument();
  expect(mockAuthState.resendConfirmation).toHaveBeenCalledWith('a@b.org');
});

test('a reset link signs in and shows the new password form instead of leaving', async () => {
  mockAuthState.isAuthenticated = true;
  renderLogin('/login?reset=1');
  fireEvent.change(screen.getByLabelText(/New password/), { target: { value: 'secret123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(await screen.findByText('workspace')).toBeInTheDocument();
  expect(mockAuthState.setNewPassword).toHaveBeenCalledWith('secret123');
});

test('an expired reset link says so and offers a new one', () => {
  window.location.hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid';
  renderLogin('/login?reset=1');
  expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
});

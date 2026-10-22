import React from 'react';
import { render, act } from '@testing-library/react';

let authListener;
jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: (cb) => { authListener = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      setSession: () => Promise.resolve({}),
    },
  },
  signIn: jest.fn(), signUp: jest.fn(), signOut: jest.fn(),
  requestPasswordReset: jest.fn(), resendSignupConfirmation: jest.fn(), updatePassword: jest.fn(),
}));

// eslint-disable-next-line import/first
import { AuthProvider, isResetPage } from './AuthContext';

test('only /login?reset=1 counts as the reset page', () => {
  expect(isResetPage({ pathname: '/login', search: '?reset=1' })).toBe(true);
  expect(isResetPage({ pathname: '/', search: '' })).toBe(false);
  expect(isResetPage({ pathname: '/login', search: '' })).toBe(false);
});

test('a password-recovery sign-in elsewhere is sent to the new-password form', async () => {
  const replace = jest.fn();
  const original = window.location;
  delete window.location;
  window.location = { ...original, pathname: '/', search: '', replace };
  try {
    render(<AuthProvider><div /></AuthProvider>);
    await act(async () => { authListener('SIGNED_IN', { user: { id: 'u' } }); });
    expect(replace).not.toHaveBeenCalled();
    await act(async () => { authListener('PASSWORD_RECOVERY', { user: { id: 'u' } }); });
    expect(replace).toHaveBeenCalledWith('/login?reset=1');
  } finally {
    window.location = original;
  }
});

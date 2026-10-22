import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase, signIn, signUp, signOut, requestPasswordReset, resendSignupConfirmation, updatePassword } from '../lib/supabase';
import { parsePreviewSessionMessage } from '../lib/previewSession';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      // No Supabase configured → self-hosted dev mode, skip auth
      setLoading(false);
      return;
    }

    // Restore session on mount (timeout so OAuth popups never hang blank)
    const sessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve({ data: { session: null }, timedOut: true }), 10000);
    });
    Promise.race([sessionPromise, timeoutPromise]).then((result) => {
      const session = result?.data?.session ?? null;
      setUser(session?.user ?? null);
      setLoading(false);
    }).catch(() => {
      setUser(null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    const onPreviewSession = (event) => {
      const tokens = parsePreviewSessionMessage(event, window.location.hostname);
      if (!tokens) return;
      supabase.auth.setSession(tokens).catch(() => {});
    };
    window.addEventListener('message', onPreviewSession);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('message', onPreviewSession);
    };
  }, []);

  const login = async (email, password) => {
    if (!supabase) {
      throw new Error('Supabase is not configured for this local build. Restart the development server after restoring REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY.');
    }
    const result = await signIn(email, password);
    const { data, error } = result || {};
    if (error) throw error;
    if (!data) throw new Error('The login service returned no response.');
    return data;
  };

  const register = async (email, password) => {
    if (!supabase) {
      throw new Error('Supabase is not configured for this local build. Restart the development server after restoring REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY.');
    }
    const result = await signUp(email, password);
    const { data, error } = result || {};
    if (error) throw error;
    if (!data) throw new Error('The registration service returned no response.');
    return data;
  };

  // Password reset and confirmation e-mails; each throws the service's error.
  const callAuth = async (fn, ...args) => {
    if (!supabase) throw new Error('Supabase is not configured for this local build.');
    const { data, error } = (await fn(...args)) || {};
    if (error) throw error;
    return data;
  };
  const sendPasswordReset = (email) => callAuth(requestPasswordReset, email);
  const resendConfirmation = (email) => callAuth(resendSignupConfirmation, email);
  const setNewPassword = (password) => callAuth(updatePassword, password);

  const logout = async () => {
    await signOut();
    setUser(null);
  };

  // If Supabase is not configured, treat as always authenticated (self-hosted mode)
  const isAuthenticated = !supabase || !!user;

  return (
    <AuthContext.Provider value={{ user, loading, isAuthenticated, login, register, logout, sendPasswordReset, resendConfirmation, setNewPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

/** Auth state when available; null outside an AuthProvider (embedded views, tests). */
export const useOptionalAuth = () => useContext(AuthContext);

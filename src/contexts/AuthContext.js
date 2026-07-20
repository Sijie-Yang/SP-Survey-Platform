import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase, signIn, signUp, signOut } from '../lib/supabase';

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

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email, password) => {
    const { data, error } = await signIn(email, password);
    if (error) throw error;
    return data;
  };

  const register = async (email, password) => {
    const { data, error } = await signUp(email, password);
    if (error) throw error;
    return data;
  };

  const logout = async () => {
    await signOut();
    setUser(null);
  };

  // If Supabase is not configured, treat as always authenticated (self-hosted mode)
  const isAuthenticated = !supabase || !!user;

  return (
    <AuthContext.Provider value={{ user, loading, isAuthenticated, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

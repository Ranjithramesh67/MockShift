'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, type Organization, type Session, type User } from './api';

interface AuthState {
  loading: boolean;
  user: User | null;
  organizations: Organization[];
  login: (email: string, password: string) => Promise<User>;
  signup: (email: string, password: string, name: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await authApi.me();
      setSession(s);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const s = await authApi.login({ email, password });
    setSession(s);
    return s.user;
  }, []);

  const signup = useCallback(async (email: string, password: string, name: string) => {
    const { user } = await authApi.signup({ email, password, name });
    setSession(user);
    return user.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // best-effort; local session is cleared regardless.
    }
    setSession(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      user: session?.user ?? null,
      organizations: session?.organizations ?? [],
      login,
      signup,
      logout,
      refresh,
    }),
    [loading, session, login, signup, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

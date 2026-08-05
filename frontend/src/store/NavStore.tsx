'use client';

import React, { createContext, useContext, useMemo, useState } from 'react';

export type AppView = 'workspace' | 'automations' | 'manage' | 'admin';

interface NavState {
  view: AppView;
  setView: (view: AppView) => void;
}

const NavContext = createContext<NavState | null>(null);

export function NavProvider({
  initialView = 'workspace',
  children,
}: {
  initialView?: AppView;
  children: React.ReactNode;
}) {
  const [view, setView] = useState<AppView>(initialView);
  const value = useMemo(() => ({ view, setView }), [view]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): NavState {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used inside <NavProvider>');
  return ctx;
}

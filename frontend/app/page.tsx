'use client';

import React from 'react';
import { AppProvider } from '@/store/AppStore';
import { WorkspaceProvider } from '@/store/WorkspaceStore';
import { NavProvider } from '@/store/NavStore';
import { AppShell } from '@/components/AppShell';

export default function HomePage() {
  return (
    <AppProvider>
      <WorkspaceProvider>
        <NavProvider initialView="workspace">
          <AppShell />
        </NavProvider>
      </WorkspaceProvider>
    </AppProvider>
  );
}

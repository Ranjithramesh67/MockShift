'use client';

import React from 'react';
import { AppProvider } from '@/store/AppStore';
import { WorkspaceProvider } from '@/store/WorkspaceStore';
import { NavProvider } from '@/store/NavStore';
import { AppShell } from '@/components/AppShell';

export default function AutomationsPage() {
  return (
    <AppProvider>
      <WorkspaceProvider>
        <NavProvider initialView="automations">
          <AppShell />
        </NavProvider>
      </WorkspaceProvider>
    </AppProvider>
  );
}

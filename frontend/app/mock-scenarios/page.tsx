'use client';

import React, { Suspense } from 'react';
import { AppShell } from '@/components/AppShell';

export default function MockScenariosPage() {
  // Same shape as app/docs/page.tsx: AppShell resolves the active nav view and
  // the coordinator wires a 'mock-scenarios' view (see RouteViewSync). The
  // Suspense boundary keeps the static prerender safe in Next 14.
  return (
    <Suspense fallback={null}>
      <AppShell />
    </Suspense>
  );
}

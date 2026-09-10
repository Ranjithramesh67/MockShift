'use client';

import React, { Suspense } from 'react';
import { AppShell } from '@/components/AppShell';

export default function CopilotPage() {
  // AppShell reads client-only stores; the Suspense boundary keeps the static
  // prerender of this page safe in Next 14.
  return (
    <Suspense fallback={null}>
      <AppShell />
    </Suspense>
  );
}

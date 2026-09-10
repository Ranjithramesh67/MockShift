'use client';

import React, { Suspense } from 'react';
import { AppShell } from '@/components/AppShell';

export default function ContractsPage() {
  // ContractPanel is routed through the app shell; the Suspense boundary keeps
  // the static prerender of this page safe in Next 14 (mirrors /docs).
  return (
    <Suspense fallback={null}>
      <AppShell />
    </Suspense>
  );
}

'use client';

import React, { Suspense } from 'react';
import { AppShell } from '@/components/AppShell';

export default function JsonComparisonsPage() {
  return (
    <Suspense fallback={null}>
      <AppShell />
    </Suspense>
  );
}

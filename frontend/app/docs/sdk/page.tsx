'use client';

import React, { Suspense } from 'react';
import { AppShell } from '@/components/AppShell';

export default function SdkGuidePage() {
  // DocsView reads the pathname/query via hooks; the Suspense boundary keeps the
  // static prerender of this page safe in Next 14.
  return (
    <Suspense fallback={null}>
      <AppShell />
    </Suspense>
  );
}

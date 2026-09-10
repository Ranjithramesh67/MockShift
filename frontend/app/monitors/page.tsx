'use client';

import React, { Suspense } from 'react';
import { AppShell } from '@/components/AppShell';

export default function MonitorsPage() {
  // The monitors view is selected through the shared nav store (RouteViewSync
  // maps /monitors -> 'monitors'); the Suspense boundary keeps the static
  // prerender of this page safe in Next 14.
  return (
    <Suspense fallback={null}>
      <AppShell />
    </Suspense>
  );
}

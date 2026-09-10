'use client';

import React, { Suspense } from 'react';
import { AppShell } from '@/components/AppShell';

export default function CollabPage() {
  // The collaboration panel reads targetType/targetId (and the optional
  // collectionId/projectId) from the URL via useSearchParams inside the shell;
  // the Suspense boundary keeps the static prerender of this page safe.
  return (
    <Suspense fallback={null}>
      <AppShell />
    </Suspense>
  );
}

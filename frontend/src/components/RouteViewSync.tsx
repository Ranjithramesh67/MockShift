'use client';

import React, { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useNav, type AppView } from '@/store/NavStore';

/**
 * Keep the in-memory view (workspace/manage/admin/automations) in sync with
 * the current route, so the providers can live once in the root layout while
 * still rendering the right view for /, /manage, /admin and /automations.
 */
export function RouteViewSync() {
  const pathname = usePathname();
  const { setView } = useNav();

  useEffect(() => {
    let view: AppView = 'workspace';
    if (pathname.startsWith('/manage')) view = 'manage';
    else if (pathname.startsWith('/admin')) view = 'admin';
    else if (pathname.startsWith('/automations')) view = 'automations';
    setView(view);
  }, [pathname, setView]);

  return null;
}

'use client';

import React, { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useNav, type AppView } from '@/store/NavStore';

/**
 * Keep the in-memory view (workspace/manage/admin/automations/inbox/settings)
 * in sync with the current route, so the providers can live once in the root
 * layout while still rendering the right view for /, /manage, /admin,
 * /automations, /inbox and /settings/api-tokens.
 */
export function RouteViewSync() {
  const pathname = usePathname();
  const { setView } = useNav();

  useEffect(() => {
    let view: AppView = 'workspace';
    if (pathname.startsWith('/manage')) view = 'manage';
    else if (pathname.startsWith('/admin')) view = 'admin';
    else if (pathname.startsWith('/automations')) view = 'automations';
    else if (pathname.startsWith('/history')) view = 'history';
    else if (pathname.startsWith('/docs')) view = 'docs';
    else if (pathname.startsWith('/contracts')) view = 'contracts';
    else if (pathname.startsWith('/monitors')) view = 'monitors';
    else if (pathname.startsWith('/mock-scenarios')) view = 'mock-scenarios';
    else if (pathname.startsWith('/copilot')) view = 'copilot';
    else if (pathname.startsWith('/collab')) view = 'collab';
    else if (pathname.startsWith('/inbox')) view = 'inbox';
    else if (pathname.startsWith('/settings')) view = 'settings';
    setView(view);
  }, [pathname, setView]);

  return null;
}

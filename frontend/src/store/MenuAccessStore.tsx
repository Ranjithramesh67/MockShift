'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { menuApi, type MenuKey } from '@/lib/api';
import { defaultMenus, isMenuEnabled as isEnabled } from '@/lib/menuKeys';
import { useWorkspace } from '@/store/WorkspaceStore';

interface MenuAccessState {
  menus: Record<string, boolean>;
  loading: boolean;
  isEnabled: (key: MenuKey) => boolean;
  refresh: () => Promise<void>;
}

const MenuAccessContext = createContext<MenuAccessState | null>(null);

export function MenuAccessProvider({ children }: { children: React.ReactNode }) {
  const { activeWorkspaceId, activeCollectionId, tree } = useWorkspace();
  const [menus, setMenus] = useState<Record<string, boolean>>(() => defaultMenus());
  const [loading, setLoading] = useState(false);

  // The app has no global "active project"; derive it from the selected
  // collection when one is open so project-scoped overrides apply.
  const projectId = useMemo(() => {
    if (!activeCollectionId || !tree) return null;
    return tree.collections.find((c) => c.id === activeCollectionId)?.project_id ?? null;
  }, [activeCollectionId, tree]);

  const refresh = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    try {
      const res = await menuApi.get({ workspaceId: activeWorkspaceId, projectId });
      setMenus({ ...defaultMenus(), ...res.menus });
    } catch {
      // Fail open; the backend still enforces.
      setMenus(defaultMenus());
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<MenuAccessState>(
    () => ({
      menus,
      loading,
      isEnabled: (key: MenuKey) => isEnabled(menus, key),
      refresh,
    }),
    [menus, loading, refresh]
  );

  return <MenuAccessContext.Provider value={value}>{children}</MenuAccessContext.Provider>;
}

export function useMenuAccess(): MenuAccessState {
  const ctx = useContext(MenuAccessContext);
  if (!ctx) throw new Error('useMenuAccess must be used inside <MenuAccessProvider>');
  return ctx;
}

'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { navOrderApi } from '@/lib/api';
import { RAIL_ORDER_KEYS, normalizeRailOrder, orderIndexMap } from '@/lib/menuKeys';
import { useAuth } from '@/lib/auth';

interface NavOrderState {
  /** Full rail ordering (default order when the user has not customized it). */
  order: string[];
  /** True once the user has saved a custom order. */
  custom: boolean;
  /** Resolve a rail key to its flex `order` index. */
  orderFor: (key: string) => number;
  save: (next: string[]) => Promise<void>;
  reset: () => Promise<void>;
}

const NavOrderContext = createContext<NavOrderState | null>(null);

export function NavOrderProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState<string[] | null>(null);

  const order = useMemo(() => normalizeRailOrder(saved, RAIL_ORDER_KEYS), [saved]);
  const index = useMemo(() => orderIndexMap(order), [order]);

  const refresh = useCallback(async () => {
    if (!user) {
      setSaved(null);
      return;
    }
    try {
      const res = await navOrderApi.get();
      setSaved(Array.isArray(res.order) ? res.order : null);
    } catch {
      // Fail open to the default order; the rail must never break because a
      // preference could not be loaded.
      setSaved(null);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(async (next: string[]) => {
    const normalized = normalizeRailOrder(next, RAIL_ORDER_KEYS);
    setSaved(normalized);
    try {
      await navOrderApi.save(normalized);
    } catch {
      // Keep the optimistic order; it will re-sync on the next load.
    }
  }, []);

  const reset = useCallback(async () => {
    setSaved(null);
    try {
      await navOrderApi.save([]);
    } catch {
      /* best effort */
    }
  }, []);

  const value = useMemo<NavOrderState>(
    () => ({
      order,
      custom: saved !== null,
      orderFor: (key: string) => (index[key] === undefined ? 0 : index[key]),
      save,
      reset,
    }),
    [order, index, saved, save, reset]
  );

  return <NavOrderContext.Provider value={value}>{children}</NavOrderContext.Provider>;
}

export function useNavOrder(): NavOrderState {
  const ctx = useContext(NavOrderContext);
  if (!ctx) throw new Error('useNavOrder must be used inside <NavOrderProvider>');
  return ctx;
}

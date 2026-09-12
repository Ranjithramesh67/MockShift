'use client';

import { useCallback, useEffect, useState } from 'react';
import { mockServerApi, type MockRoute, type MockServer } from '@/lib/api';

export function useProjectMockRoutes(
  projectId: string | null | undefined,
  enabled: boolean
): { server: MockServer | null; routes: MockRoute[]; loading: boolean; error: string } {
  const [server, setServer] = useState<MockServer | null>(null);
  const [routes, setRoutes] = useState<MockRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!projectId) {
      setServer(null);
      setRoutes([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { mockServer } = await mockServerApi.get(projectId);
      setServer(mockServer);
      if (!mockServer) {
        setRoutes([]);
        return;
      }
      const { routes: list } = await mockServerApi.routes(mockServer.id);
      setRoutes(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load mock routes');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  return { server, routes, loading, error };
}

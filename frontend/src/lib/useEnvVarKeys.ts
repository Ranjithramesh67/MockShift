'use client';

import { useEffect, useState } from 'react';
import { environmentApi } from '@/lib/api';
import { useWorkspace } from '@/store/WorkspaceStore';

export function useEnvVarKeys(): string[] {
  const ws = useWorkspace();
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const workspaceId = ws.activeWorkspaceId;
    if (!workspaceId) {
      setKeys([]);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const { environments } = await environmentApi.list(workspaceId);
        const active = environments.find((e) => e.is_active) ?? environments[0];
        if (!active) {
          if (!cancelled) setKeys([]);
          return;
        }
        const { variables } = await environmentApi.variables(active.id);
        if (!cancelled) setKeys(variables.map((v) => v.key).filter(Boolean));
      } catch {
        if (!cancelled) setKeys([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ws.activeWorkspaceId]);

  return keys;
}

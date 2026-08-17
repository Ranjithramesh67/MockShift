import { useEffect } from 'react';
import { useWorkspace } from '@/store/WorkspaceStore';

/**
 * Ctrl+F4 / Cmd+F4 closes the currently active request tab. Without
 * intercepting the key the browser would close the whole app tab, so we
 * preventDefault and route it into the request-tab strip instead. Dirty tabs
 * ask for confirmation, mirroring the close (×) button on each tab.
 */
export function useCloseRequestTabShortcut(): void {
  const ws = useWorkspace();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'F4') return;
      const requestId = ws.activeRequestId;
      if (!requestId) return;
      e.preventDefault();
      if (ws.isTabDirty(requestId)) {
        const copy = ws.requestCopies[requestId];
        const name = copy?.name || 'Untitled';
        const confirmed = window.confirm(`"${name}" has unsaved changes. Close anyway?`);
        if (!confirmed) return;
      }
      ws.closeRequestTab(requestId).catch(() => undefined);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [ws]);
}

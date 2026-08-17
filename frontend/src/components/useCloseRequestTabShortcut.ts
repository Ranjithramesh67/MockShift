import { useEffect } from 'react';
import { useWorkspace } from '@/store/WorkspaceStore';

/**
 * Ctrl+Q closes the currently active request tab; Ctrl+Shift+Q reopens the
 * most recently closed one (restoring its unsaved working copy at its original
 * position).
 *
 * Unlike Ctrl+F4/Ctrl+W (browser-reserved shortcuts that close the whole app
 * tab before the page ever sees the key), Ctrl+Q and Ctrl+Shift+Q are not
 * reserved by Chrome/Edge on Windows or Linux, so the browser delivers them to
 * the page and preventDefault keeps the app alive. Note Firefox binds Ctrl+Q
 * to "quit" and some Chromium builds on Linux bind Ctrl+Shift+Q to "quit" —
 * those are handled by the browser before the page and cannot be overridden.
 */
export function useCloseRequestTabShortcut(): void {
  const ws = useWorkspace();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const q = e.key.toLowerCase();
      if (q !== 'q') return;
      if (e.shiftKey) {
        e.preventDefault();
        ws.reopenLastClosedTab().catch(() => undefined);
        return;
      }
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

import { useEffect } from 'react';

/**
 * Cmd/Ctrl+K opens the global search command palette. The handler runs in the
 * capture phase so the shortcut fires even while an input or editor has focus
 * (standard command-palette behaviour) and preventDefault stops the browser's
 * own find/history bindings from taking over.
 */
export function useGlobalSearchShortcut(onOpen: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onOpen]);
}

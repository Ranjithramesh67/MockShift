import { useEffect } from 'react';

export interface TreeRenameRow {
  id: string;
  name: string;
}

export interface TreeRenameShortcutTree {
  requests: TreeRenameRow[];
  folders: TreeRenameRow[];
}

export interface TreeRenameShortcutOptions {
  selectedRow: { kind: 'request' | 'folder'; id: string } | null;
  tree: TreeRenameShortcutTree | null;
  onStartRename: (kind: 'request' | 'folder', id: string, name: string) => void;
}

/**
 * M12: pressing F2 on the currently selected sidebar row (request or folder)
 * starts its inline rename. F2 is ignored while the event target is a text
 * input (e.g. the rename input itself or the request URL field).
 */
export function useTreeRenameShortcut(options: TreeRenameShortcutOptions): void {
  const { selectedRow, tree, onStartRename } = options;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selectedRow) return;
      if (e.key !== 'F2') return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      e.preventDefault();
      const rows = selectedRow.kind === 'request' ? tree?.requests : tree?.folders;
      const row = rows?.find((r) => r.id === selectedRow.id);
      if (!row) return;
      onStartRename(selectedRow.kind, selectedRow.id, row.name);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [selectedRow, tree, onStartRename]);
}

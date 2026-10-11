import { useEffect } from 'react';
import { useWorkspace } from '@/store/WorkspaceStore';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // CodeMirror 6 content is contenteditable; older v5 / textarea-based
  // fallbacks are covered by the tag/contenteditable checks above.
  return !!target.closest('.cm-editor, .CodeMirror, [contenteditable="true"]');
}

/**
 * Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z undo and redo the active request's working
 * copy edits. To keep native browser undo working in text fields and code
 * editors, the shortcuts only fire when focus is NOT on an editable element —
 * while typing in the URL/header inputs or a CodeMirror body the browser's own
 * undo (which those editors implement) takes precedence.
 */
export function useRequestHistoryShortcuts(): void {
  const ws = useWorkspace();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      if (isEditableTarget(e.target)) return;
      const isRedo = e.shiftKey || key === 'y';
      if (isRedo) {
        if (!ws.canRedoRequest) return;
        e.preventDefault();
        ws.redoActiveRequest();
        return;
      }
      if (!ws.canUndoRequest) return;
      e.preventDefault();
      ws.undoActiveRequest();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [ws]);
}

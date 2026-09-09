'use client';

import React, { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { useApp } from '@/store/AppStore';
import { docsApi, type DocsPageSummary } from '@/lib/docsApi';

// Depth + children lookups over a flat page list (pages already scoped to the
// workspace/project by the caller).
function usePageIndex(pages: DocsPageSummary[]) {
  return useMemo(() => {
    const byParent = new Map<string | null, DocsPageSummary[]>();
    for (const p of pages) {
      const list = byParent.get(p.parentId) ?? [];
      list.push(p);
      byParent.set(p.parentId, list);
    }
    // Natural doc-tree navigation: siblings sorted alphabetically at every level.
    for (const list of Array.from(byParent.values())) list.sort((a, b) => a.title.localeCompare(b.title));
    const depth = new Map<string, number>();
    const ordered: DocsPageSummary[] = [];
    const walk = (parentId: string | null, d: number) => {
      for (const p of byParent.get(parentId) ?? []) {
        depth.set(p.id, d);
        ordered.push(p);
        walk(p.id, d + 1);
      }
    };
    walk(null, 0);
    return { byParent, depth, ordered };
  }, [pages]);
}

// Collect every descendant id of a page (used to forbid moving a page under
// itself or one of its own children — the backend enforces the same rule).
function useDescendants(pages: DocsPageSummary[], rootId: string): Set<string> {
  const { byParent } = usePageIndex(pages);
  return useMemo(() => {
    const out = new Set<string>();
    const stack = [...(byParent.get(rootId) ?? [])];
    while (stack.length) {
      const p = stack.pop()!;
      if (out.has(p.id)) continue;
      out.add(p.id);
      stack.push(...(byParent.get(p.id) ?? []));
    }
    return out;
  }, [byParent, rootId]);
}

export function MovePageModal({
  page,
  pages,
  onClose,
  onMoved,
}: {
  page: DocsPageSummary;
  pages: DocsPageSummary[];
  onClose: () => void;
  onMoved: () => void;
}) {
  const { dispatch } = useApp();
  const { depth } = usePageIndex(pages);
  const descendants = useDescendants(pages, page.id);
  const [target, setTarget] = useState<string>(() => (page.parentId && !descendants.has(page.parentId) ? page.parentId : ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Every page that is a legal destination: skip the page itself and its sub-tree.
  const targets = useMemo(() => {
    return pages.filter((p) => p.id !== page.id && !descendants.has(p.id));
  }, [pages, page.id, descendants]);

  const depthLabel = (id: string) => '— '.repeat(Math.max(0, depth.get(id) ?? 0));

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await docsApi.update(page.id, { parentId: target || null });
      dispatch({
        type: 'SHOW_TOAST',
        kind: 'success',
        message: target ? `Moved “${page.title}” under a parent page.` : `Moved “${page.title}” to the top level.`,
      });
      onMoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move page');
      setBusy(false);
    }
  };

  return (
    <Modal title="Move page" onClose={onClose} testId="docs-move-modal">
      <div className="modal-form" style={{ minWidth: 420 }}>
        {error && (
          <p className="auth-error" role="alert" data-testid="docs-move-error">
            {error}
          </p>
        )}
        <p className="hint">
          Choose where “{page.title}” should live. Its sub-pages move with it.
        </p>
        <label className="auth-field">
          <span>Parent page</span>
          <select
            className="compact-select"
            data-testid="docs-move-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Top level (no parent)</option>
            {targets.map((p) => (
              <option key={p.id} value={p.id}>
                {depthLabel(p.id)}
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            data-testid="docs-move-submit"
            disabled={busy}
            onClick={submit}
          >
            {busy ? 'Moving…' : 'Move page'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export { usePageIndex };

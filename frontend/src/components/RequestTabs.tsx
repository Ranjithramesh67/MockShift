'use client';

import React from 'react';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useRequestHistoryShortcuts } from './useRequestHistoryShortcuts';
import { BackIcon, UndoIcon, RedoIcon } from './icons';

/**
 * M7: browser-style tab strip of every open request. Each tab shows the
 * request's method badge, name, a dirty dot when the working copy has unsaved
 * changes, and a close (×) button. Clicking a tab switches to it; closing a
 * dirty tab asks for confirmation first. The strip is hidden while no requests
 * are open.
 *
 * A leading toolbar adds request-level navigation: Back returns to the request
 * that was active before the current one (reopening it if its tab was closed),
 * and Undo/Redo revert/restore the active request's unsaved working-copy edits.
 */
export function RequestTabs() {
  const ws = useWorkspace();
  useRequestHistoryShortcuts();
  if (ws.openRequestIds.length === 0) return null;

  return (
    <div className="request-tabs-bar" data-testid="request-tabs-bar">
      <div className="request-nav-controls" role="group" aria-label="Request navigation">
        <button
          type="button"
          className="request-nav-btn"
          data-testid="request-back"
          title="Back to previous request"
          aria-label="Back to previous request"
          disabled={!ws.canGoBackRequest}
          onClick={() => {
            ws.goBackRequest().catch(() => undefined);
          }}
        >
          <BackIcon size={15} />
        </button>
        <button
          type="button"
          className="request-nav-btn"
          data-testid="request-undo"
          title="Undo (Ctrl+Z)"
          aria-label="Undo last edit"
          disabled={!ws.canUndoRequest}
          onClick={() => ws.undoActiveRequest()}
        >
          <UndoIcon size={15} />
        </button>
        <button
          type="button"
          className="request-nav-btn"
          data-testid="request-redo"
          title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
          aria-label="Redo last undo"
          disabled={!ws.canRedoRequest}
          onClick={() => ws.redoActiveRequest()}
        >
          <RedoIcon size={15} />
        </button>
      </div>
      <div className="request-tabs" data-testid="request-tabs" role="tablist" aria-label="Open requests">
        {ws.openRequestIds.map((requestId) => {
          const copy = ws.requestCopies[requestId];
          const name = copy?.name || 'Untitled';
          const isActive = ws.activeRequestId === requestId;
          const dirty = ws.isTabDirty(requestId);
          return (
            <div
              key={requestId}
              className={`request-tab ${isActive ? 'active' : ''}`}
              data-testid={`request-tab-${name}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className="request-tab-select"
                title={name}
                data-testid={`request-tab-switch-${name}`}
                onClick={() => {
                  ws.activateRequestTab(requestId).catch(() => undefined);
                }}
              >
                <span className={`method-badge method-${copy?.method ?? 'GET'}`}>{copy?.method ?? 'GET'}</span>
                <span className="request-tab-name">{name}</span>
                {dirty && (
                  <span className="unsaved-dot" data-testid="unsaved-dot" title="You have unsaved changes">
                    •
                  </span>
                )}
              </button>
              <button
                type="button"
                className="request-tab-close"
                aria-label={`Close ${name}`}
                title="Close tab"
                data-testid={`request-tab-close-${name}`}
                onClick={() => {
                  if (ws.isTabDirty(requestId)) {
                    const confirmed = window.confirm(`"${name}" has unsaved changes. Close anyway?`);
                    if (!confirmed) return;
                  }
                  ws.closeRequestTab(requestId).catch(() => undefined);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

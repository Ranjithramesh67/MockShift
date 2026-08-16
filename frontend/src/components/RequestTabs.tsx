'use client';

import React from 'react';
import { useWorkspace } from '@/store/WorkspaceStore';

/**
 * M7: browser-style tab strip of every open request. Each tab shows the
 * request's method badge, name, a dirty dot when the working copy has unsaved
 * changes, and a close (×) button. Clicking a tab switches to it; closing a
 * dirty tab asks for confirmation first. The strip is hidden while no requests
 * are open.
 */
export function RequestTabs() {
  const ws = useWorkspace();
  if (ws.openRequestIds.length === 0) return null;

  return (
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
  );
}

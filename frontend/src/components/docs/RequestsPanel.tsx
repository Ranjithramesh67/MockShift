'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { docsSharedApi, type WorkspaceAccessRequest } from '@/lib/docsApi';
import { useApp } from '@/store/AppStore';
import { fmtDate } from './helpers';
import styles from './docs.module.css';

function statusClass(status: string): string {
  if (status === 'APPROVED') return styles.reqApproved;
  if (status === 'DENIED') return styles.reqDenied;
  return styles.reqPending;
}

export function RequestsPanel({
  workspaceId,
  canReview,
}: {
  workspaceId: string;
  canReview: boolean;
}) {
  const { dispatch } = useApp();
  const [pending, setPending] = useState<WorkspaceAccessRequest[]>([]);
  const [mine, setMine] = useState<WorkspaceAccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const calls: Array<Promise<{ requests: WorkspaceAccessRequest[] }>> = [
        docsSharedApi.listWorkspaceRequests({ workspaceId, mine: true }),
      ];
      if (canReview) {
        calls.push(docsSharedApi.listWorkspaceRequests({ workspaceId, status: 'PENDING' }));
      }
      const results = await Promise.all(calls);
      setMine(results[0].requests);
      setPending(results[1]?.requests ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load access requests');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, canReview]);

  useEffect(() => {
    if (!workspaceId) return;
    load();
  }, [load, workspaceId]);

  const review = async (requestId: string, approve: boolean) => {
    setBusyId(requestId);
    setError('');
    try {
      await docsSharedApi.reviewWorkspaceRequest(requestId, approve);
      dispatch({
        type: 'SHOW_TOAST',
        kind: 'success',
        message: approve ? 'Request approved — user now has workspace access.' : 'Request denied.',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to review request');
      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Review failed' });
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (requestId: string) => {
    setBusyId(requestId);
    setError('');
    try {
      await docsSharedApi.cancelWorkspaceRequest(requestId);
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Request cancelled.' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel request');
      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Cancel failed' });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p className="hint">Loading access requests…</p>;

  return (
    <div data-testid="docs-requests">
      {error && (
        <p className="auth-error" role="alert" data-testid="docs-requests-error">
          {error}
        </p>
      )}

      {canReview && (
        <>
          <h2 className="manage-section-title">Pending workspace access</h2>
          {pending.length === 0 && <p className="hint">No pending requests.</p>}
          {pending.map((r) => (
            <div key={r.id} className="request-row" data-testid={`docs-request-${r.id}`}>
              <div className="request-row-main">
                <span className="admin-avatar">{r.requester.name?.charAt(0).toUpperCase() ?? '?'}</span>
                <div>
                  <div className="admin-user-name">{r.requester.name}</div>
                  <div className="admin-user-email">{r.requester.email}</div>
                </div>
                <div className="request-row-meta">
                  <span className={`${styles.reqBadge} ${styles.reqPending}`}>{r.status}</span>
                  <span className="hint">{fmtDate(r.requestedAt)}</span>
                </div>
              </div>
              {r.reason && <div className="request-reason">“{r.reason}”</div>}
              <div className="request-row-actions">
                <button
                  type="button"
                  className="ghost-button danger"
                  disabled={busyId === r.id}
                  data-testid={`docs-deny-${r.id}`}
                  onClick={() => review(r.id, false)}
                >
                  Deny
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busyId === r.id}
                  data-testid={`docs-approve-${r.id}`}
                  onClick={() => review(r.id, true)}
                >
                  Approve
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      <h2 className="manage-section-title">My requests</h2>
      {mine.length === 0 && <p className={styles.mineEmpty}>You have no open workspace access requests.</p>}
      {mine.map((r) => (
        <div key={r.id} className="request-row" data-testid={`docs-mine-${r.id}`}>
          <div className="request-row-main">
            <span className="admin-avatar">{r.workspaceName?.charAt(0).toUpperCase() ?? 'W'}</span>
            <div>
              <div className="admin-user-name">{r.workspaceName}</div>
              <div className="admin-user-email">Requested {fmtDate(r.requestedAt)}</div>
            </div>
            <div className="request-row-meta">
              <span className={`${styles.reqBadge} ${statusClass(r.status)}`}>{r.status}</span>
              {r.reviewedAt && <span className="hint">Reviewed {fmtDate(r.reviewedAt)}</span>}
            </div>
          </div>
          {r.reason && <div className="request-reason">“{r.reason}”</div>}
          <div className="request-row-actions">
            {r.status === 'PENDING' && (
              <button
                type="button"
                className="ghost-button danger"
                disabled={busyId === r.id}
                data-testid={`docs-cancel-${r.id}`}
                onClick={() => cancel(r.id)}
              >
                Cancel request
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

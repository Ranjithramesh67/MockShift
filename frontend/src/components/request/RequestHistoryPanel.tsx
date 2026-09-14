'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { requestHistoryApi, type RequestChangedField, type RequestRevisionMeta } from '@/lib/api';
import { useRoomEvents } from '@/components/useRoomEvents';
import { roomFor } from '@/lib/realtime';
import { revisionSummary, formatChange } from '@/lib/requestHistory';
import styles from './requestHistory.module.css';

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function RevRow({
  revision,
  busy,
  onRestore,
}: {
  revision: RequestRevisionMeta;
  busy: boolean;
  onRestore: (revision: RequestRevisionMeta) => void;
}) {
  const [open, setOpen] = useState(false);
  const kindClass =
    revision.changeKind === 'rollback'
      ? styles.kindRollback
      : revision.changeKind === 'create'
        ? styles.kindCreate
        : styles.kindUpdate;
  const meta = [
    revision.createdBy.name || 'Unknown',
    formatDate(revision.createdAt),
    revisionSummary(revision),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={styles.row} data-testid="revision-row" role="listitem">
      <div className={styles.rowHead}>
        <div className={styles.meta}>
          <span className={`${styles.mono} ${styles.subtle}`}>v{revision.revisionNumber}</span>
          <span className={`${styles.kind} ${kindClass}`}>{revision.changeKind}</span>
          <span className={styles.subtle}>{meta}</span>
        </div>
        <div className={styles.meta}>
          {revision.changedFields.length > 0 && (
            <button
              type="button"
              className={styles.restore}
              data-testid="revision-details"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? 'Hide' : 'Diff'}
            </button>
          )}
          {revision.changeKind !== 'create' && (
            <button
              type="button"
              className={styles.restore}
              data-testid="revision-restore"
              disabled={busy}
              onClick={() => onRestore(revision)}
            >
              Restore
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className={styles.fields}>
          {revision.changedFields.map((f: RequestChangedField) => {
            const { label, before, after } = formatChange(f);
            return (
              <div key={f.field} className={styles.field} data-testid={`revision-field-${f.field}`}>
                <span className={styles.fieldLabel}>{label}</span>
                <span className={styles.before}>- {before}</span>
                <span className={styles.after}>+ {after}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function RequestHistoryPanel({
  requestId,
  onRestored,
}: {
  requestId: string;
  onRestored?: () => void;
}) {
  const [revisions, setRevisions] = useState<RequestRevisionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await requestHistoryApi.list(requestId);
      setRevisions(res.revisions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRoomEvents(roomFor('request', requestId), (event) => {
    if (event.type === 'entity:updated') void load();
  });

  const restore = async (revision: RequestRevisionMeta) => {
    if (busy) return;
    if (typeof window !== 'undefined' && !window.confirm(`Restore the request to v${revision.revisionNumber}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await requestHistoryApi.rollback(requestId, revision.id);
      await load();
      onRestored?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.root} data-testid="request-history-panel">
      <div className={styles.head}>
        <span className={styles.title}>Change history</span>
        {loading && <span className={styles.subtle}>Loading…</span>}
      </div>
      {error ? (
        <div className={styles.error}>
          {error}
          <button type="button" data-testid="history-retry" disabled={loading} onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : !loading && revisions.length === 0 ? (
        <div className={styles.empty}>No history yet.</div>
      ) : (
        <div className={styles.list} role="list">
          {revisions.map((r) => (
            <RevRow key={r.id} revision={r} busy={busy} onRestore={restore} />
          ))}
        </div>
      )}
    </div>
  );
}

export default RequestHistoryPanel;

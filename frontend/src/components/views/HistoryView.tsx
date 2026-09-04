'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { runHistoryApi, type RunHistoryEntry, type RunHistoryDetail } from '@/lib/api';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function snapshotHeaders(headers: Record<string, string> | undefined): Array<[string, string]> {
  return Object.entries(headers || {});
}

export function HistoryView() {
  const [runs, setRuns] = useState<RunHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<RunHistoryDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await runHistoryApi.list(200);
      setRuns(res.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (runId: string) => {
    setError('');
    try {
      const res = await runHistoryApi.detail(runId);
      setDetail(res.run);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run detail');
    }
  };

  const responseBodyText = (body: string | undefined, bodyEncoding?: string): string => {
    if (!body) return '—';
    if (bodyEncoding === 'base64') return `[binary response — ${body.length} bytes base64]`;
    return body.length > 60000 ? `${body.slice(0, 60000)}\n… (truncated)` : body;
  };

  return (
    <main className="admin-main" data-testid="history-page">
      <div className="admin-title-row">
        <div>
          <h1>Run history</h1>
          <p className="admin-subtitle">Your personal run history — only runs you executed are shown.</p>
        </div>
        <div className="admin-header-actions">
          <button type="button" className="ghost-button" data-testid="history-refresh" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <p className="auth-error" role="alert" data-testid="history-error">
          {error}
        </p>
      )}

      <div className="table-wrap table-stack">
        <table className="admin-table" data-testid="history-list">
          <thead>
            <tr>
              <th>Time</th>
              <th>Name</th>
              <th>Method</th>
              <th>URL</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>Duration</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} data-testid={`history-run-${r.name ?? 'deleted'}`}>
                <td className="hint" data-label="Time">{fmtDate(r.started_at)}</td>
                <td className="admin-user-name" data-label="Name">{r.name ?? '(deleted)'}</td>
                <td data-label="Method">
                  {r.method ? <span className={`method-badge method-${r.method.toLowerCase()}`}>{r.method}</span> : '—'}
                </td>
                <td className="hint mono-cell" title={r.url ?? ''} data-label="URL">
                  {r.url ?? '—'}
                </td>
                <td className="hint" data-label="Trigger">{r.trigger}</td>
                <td data-label="Status">
                  <span className={`vis-badge ${r.status === 'SUCCESS' ? 'vis-active' : r.status === 'FAILED' ? 'vis-inactive' : 'pending-badge'}`}>
                    {r.status}
                  </span>
                </td>
                <td className="hint" data-label="Duration">{fmtDuration(r.duration_ms)}</td>
                <td>
                  <button
                    type="button"
                    className="ghost-button small"
                    data-testid={`history-detail-${r.name ?? 'deleted'}`}
                    onClick={() => openDetail(r.id)}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
            {!loading && runs.length === 0 && (
              <tr>
                <td colSpan={8} className="hint" data-testid="history-empty">
                  No runs yet. Send a request to start building your history.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={8} className="hint">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="modal-overlay" data-testid="history-detail-modal" onClick={() => setDetail(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 data-testid="history-detail-name">{detail.name ?? '(deleted)'}</h2>
              <span className="hint">
                {fmtDate(detail.started_at)} · {fmtDuration(
                  detail.started_at && detail.finished_at
                    ? Date.parse(detail.finished_at) - Date.parse(detail.started_at)
                    : null
                )} ·{' '}
                <span className={`vis-badge ${detail.status === 'SUCCESS' ? 'vis-active' : detail.status === 'FAILED' ? 'vis-inactive' : 'pending-badge'}`}>
                  {detail.status}
                </span>
              </span>
            </div>
            <div className="modal-body">
              <div className="history-snapshots">
                <section className="history-snapshot" data-testid="history-request-snapshot">
                  <h3 className="manage-section-title">Request</h3>
                  <p className="hint">
                    <span className={`method-badge method-${(detail.request_snapshot?.method || 'GET').toLowerCase()}`}>
                      {detail.request_snapshot?.method || 'GET'}
                    </span>{' '}
                    <code className="mono-cell">{detail.request_snapshot?.url ?? '—'}</code>
                  </p>
                  <pre className="history-snapshot-body">
                    {JSON.stringify(detail.request_snapshot?.body ?? {}, null, 2)}
                  </pre>
                </section>
                <section className="history-snapshot" data-testid="history-response-snapshot">
                  <h3 className="manage-section-title">Response</h3>
                  <p className="hint">
                    Status:{' '}
                    <strong>{detail.response_snapshot?.status ?? '—'}</strong>
                    {detail.response_snapshot?.durationMs !== undefined
                      ? ` · ${fmtDuration(detail.response_snapshot.durationMs)}`
                      : ''}
                  </p>
                  <pre className="history-snapshot-body">
                    {responseBodyText(detail.response_snapshot?.body, detail.response_snapshot?.bodyEncoding)}
                  </pre>
                </section>
              </div>
              <section data-testid="history-test-results">
                <h3 className="manage-section-title">Assertions</h3>
                {detail.test_results.length === 0 ? (
                  <p className="hint">No assertions on this run.</p>
                ) : (
                  <ul className="manage-member-list">
                    {detail.test_results.map((t, i) => (
                      <li key={i} className="manage-member-row">
                        <span className={`vis-badge ${t.passed ? 'vis-active' : 'vis-inactive'}`}>
                          {t.passed ? 'PASS' : 'FAIL'}
                        </span>
                        <span className="admin-user-name">{t.test_name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost-button" data-testid="history-detail-close" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

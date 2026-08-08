'use client';

import React, { useEffect, useState } from 'react';
import { shareApi, type SharedRequestView } from '@/lib/api';

function kvTable(rows: Array<{ key: string; value: string }>) {
  if (!rows.length) return <p className="hint">None</p>;
  return (
    <table className="env-vars-table">
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.key}-${i}`}>
            <td>{row.key}</td>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function bodyPreview(share: SharedRequestView) {
  const { bodyType, bodyJson, bodyText } = share.request;
  if (bodyType === 'NONE' || (!bodyJson && !bodyText)) return <p className="hint">None</p>;
  const text =
    bodyType === 'JSON' || bodyType === 'GRAPHQL' || typeof bodyJson === 'string'
      ? String(bodyJson)
      : bodyJson
        ? JSON.stringify(bodyJson, null, 2)
        : bodyText || '';
  return (
    <pre className="share-pre">
      <code>{text}</code>
    </pre>
  );
}

function responsePreview(share: SharedRequestView) {
  const lastRun = share.lastRun;
  if (!lastRun) return <p className="hint">No runs yet.</p>;
  let body = lastRun.body;
  if (lastRun.bodyEncoding === 'base64') body = '(binary content, not shown)';
  else if (typeof body === 'string' && body.length > 20000) body = `${body.slice(0, 20000)}\n… (truncated)`;
  return (
    <>
      <div className="share-meta-row">
        <span className={`status-chip ${lastRun.status < 400 ? 'pass' : 'fail'}`}>
          {lastRun.status} {lastRun.statusText}
        </span>
        <span className="hint">{lastRun.durationMs} ms</span>
      </div>
      <pre className="share-pre">
        <code>{body}</code>
      </pre>
    </>
  );
}

export default function SharedRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string | null>(null);
  const [share, setShare] = useState<SharedRequestView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { token: t } = await params;
      if (cancelled) return;
      setToken(t);
      try {
        const res = await shareApi.get(t);
        if (!cancelled) setShare(res.share);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Share link not found');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [params]);

  return (
    <div className="share-public-page">
      <header className="share-public-header">
        <span className="share-brand">API Hub</span>
        <span className="hint">shared request</span>
      </header>

      {error && (
        <main className="share-public-main">
          <div className="share-card">
            <h2>Link unavailable</h2>
            <p className="hint">{error}. It may have been revoked by its owner.</p>
          </div>
        </main>
      )}

      {!error && !share && <main className="share-public-main"><p className="hint">Loading…</p></main>}

      {share && (
        <main className="share-public-main">
          <div className="share-card">
            <div className="share-method-row">
              <span className={`method-chip method-${share.request.method.toLowerCase()}`}>{share.request.method}</span>
              <h2>{share.request.name}</h2>
            </div>
            <div className="share-url"><code>{share.request.url}</code></div>

            <h3>Headers</h3>
            {kvTable(share.request.headers)}

            <h3>Query params</h3>
            {kvTable(share.request.queryParams)}

            <h3>Body</h3>
            {bodyPreview(share)}

            <h3>Latest response</h3>
            {responsePreview(share)}
          </div>
        </main>
      )}
    </div>
  );
}

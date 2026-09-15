'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  shareApi,
  type SharedShare,
  type SharedRequestView,
  type SharedItemView,
  type SharedFolderNode,
  type SharedRevision,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';

function kvTable(rows: Array<{ key: string; value: string }>) {
  if (!rows.length) return <p className="hint">None</p>;
  return (
    <div className="table-scroll">
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
    </div>
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

function formatFieldValue(value: unknown) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '""' : value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function historySection(revisions: SharedRevision[]) {
  if (revisions.length === 0) return <p className="hint">No change history recorded yet.</p>;
  return (
    <ul className="share-history" data-testid="share-history">
      {revisions.map((rev) => (
        <li key={rev.id} className="share-history-item">
          <div className="share-history-head">
            <span className={`share-history-kind kind-${rev.changeKind}`}>
              {rev.changeKind === 'create' ? 'Created' : rev.changeKind === 'rollback' ? 'Restored' : 'Updated'}
            </span>
            <span className="hint">
              rev #{rev.revisionNumber} · {rev.createdBy.name ?? 'Unknown'} ·{' '}
              {rev.createdAt ? new Date(rev.createdAt).toLocaleString() : ''}
            </span>
          </div>
          {rev.changedFields.length > 0 && (
            <ul className="share-history-changes">
              {rev.changedFields.map((change) => (
                <li key={change.field}>
                  <code>{change.field}</code>: <span className="share-history-old">{formatFieldValue(change.from)}</span>{' '}
                  → <span className="share-history-new">{formatFieldValue(change.to)}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function FolderNodeView({ node }: { node: SharedFolderNode }) {
  return (
    <li className="share-tree-folder" data-testid={`share-folder-${node.name}`}>
      <span className="share-tree-folder-name">{node.name}</span>
      <ul>
        {node.requests.map((r) => (
          <li key={r.id} className="share-tree-request">
            <span className={`method-chip method-${r.method.toLowerCase()}`}>{r.method}</span>
            <span className="share-tree-request-name">{r.name}</span>
            <code className="share-tree-url">{r.url}</code>
          </li>
        ))}
        {node.folders.map((f) => (
          <FolderNodeView key={f.id} node={f} />
        ))}
      </ul>
    </li>
  );
}

function itemTree(share: SharedItemView) {
  if (share.item.projects.length === 0) return <p className="hint">This item is empty.</p>;
  return (
    <div className="share-tree" data-testid="share-tree">
      {share.item.projects.map((project) => (
        <div key={project.id} className="share-tree-project">
          <h3 className="share-tree-project-name">{project.name}</h3>
          {project.collections.map((collection) => (
            <div key={collection.id} className="share-tree-collection">
              <h4 className="share-tree-collection-name">{collection.name}</h4>
              <ul>
                {collection.requests.map((r) => (
                  <li key={r.id} className="share-tree-request">
                    <span className={`method-chip method-${r.method.toLowerCase()}`}>{r.method}</span>
                    <span className="share-tree-request-name">{r.name}</span>
                    <code className="share-tree-url">{r.url}</code>
                  </li>
                ))}
                {collection.folders.map((f) => (
                  <FolderNodeView key={f.id} node={f} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function SharedRequestPage({ params }: { params: { token: string } }) {
  const { loading: authLoading, user } = useAuth();
  // Next 14 passes route params as a plain object (not a Promise), so read the
  // token synchronously instead of awaiting it.
  const token = params?.token ?? null;
  const [share, setShare] = useState<SharedShare | null>(null);
  const [revisions, setRevisions] = useState<SharedRevision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      shareApi.get(token),
      shareApi.revisions(token).catch(() => ({ revisions: [] as SharedRevision[] })),
    ])
      .then(([shareRes, revRes]) => {
        if (cancelled) return;
        setShare(shareRes.share);
        setRevisions(revRes.revisions);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Share link not found');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, user]);

  const title = share
    ? share.itemType === 'request'
      ? share.request.name
      : share.item.name
    : null;

  return (
    <div className="share-public-page">
      <header className="share-public-header">
        <span className="share-brand">API Hub</span>
        <span className="hint">shared item</span>
      </header>

      {(authLoading || loading) && (
        <main className="share-public-main">
          <p className="hint">Loading…</p>
        </main>
      )}

      {!authLoading && !user && (
        <main className="share-public-main">
          <div className="share-card" data-testid="share-login-required">
            <h2>Sign in to view this shared item</h2>
            <p className="hint">
              Shared links are login-gated. Sign in with any API Hub account to view it — no paid plan
              required.
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(`/s/${token ?? ''}`)}`}
              className="share-open-cta"
              data-testid="share-login-cta"
            >
              Sign in to continue
            </Link>
          </div>
        </main>
      )}

      {!authLoading && user && error && (
        <main className="share-public-main">
          <div className="share-card">
            <h2>Link unavailable</h2>
            <p className="hint">{error}. It may have been revoked by its owner.</p>
          </div>
        </main>
      )}

      {!authLoading && user && !error && share && (
        <main className="share-public-main">
          <div className="share-card">
            {share.itemType === 'request' ? (
              <>
                <div className="share-method-row">
                  <span className={`method-chip method-${share.request.method.toLowerCase()}`}>
                    {share.request.method}
                  </span>
                  <h2>{share.request.name}</h2>
                </div>
                <div className="share-url">
                  <code>{share.request.url}</code>
                </div>

                <h3>Headers</h3>
                {kvTable(share.request.headers)}

                <h3>Query params</h3>
                {kvTable(share.request.queryParams)}

                <h3>Body</h3>
                {bodyPreview(share)}

                <h3>Latest response</h3>
                {responsePreview(share)}

                <h3 data-testid="share-history-heading">Change history</h3>
                {historySection(revisions)}
              </>
            ) : (
              <>
                <div className="share-method-row">
                  <span className="share-item-kind">{share.item.type}</span>
                  <h2>{title}</h2>
                </div>
                {itemTree(share)}
              </>
            )}

            <Link href="/" className="share-open-cta" data-testid="share-open-app">
              Open in API Hub
            </Link>
          </div>
        </main>
      )}
    </div>
  );
}

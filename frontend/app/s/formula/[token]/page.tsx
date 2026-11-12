'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { formulaSnippetsApi, type FormulaSnippet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CodeEditor } from '@/components/CodeEditor';

export default function SharedFormulaPage({ params }: { params: Promise<{ token: string }> }) {
  const { user, loading } = useAuth();
  const [token, setToken] = useState('');
  const [snippet, setSnippet] = useState<FormulaSnippet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { token: t } = await params;
      if (cancelled) return;
      setToken(t);
      try {
        const res = await formulaSnippetsApi.publicShare(t);
        if (!cancelled) setSnippet(res.snippet);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Share link not found');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [params]);

  const onImport = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await formulaSnippetsApi.import({ token });
      setImported(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import formula');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="share-public-page" data-testid="shared-formula-view">
      <header className="share-public-header">
        <span className="share-brand">Mockshift</span>
        <span className="hint">shared formula</span>
      </header>

      {error && (
        <main className="share-public-main">
          <div className="share-card">
            <h2>Link unavailable</h2>
            <p className="hint">{error}. It may have been revoked by its owner.</p>
          </div>
        </main>
      )}

      {!error && !snippet && (
        <main className="share-public-main">
          <p className="hint">Loading…</p>
        </main>
      )}

      {snippet && (
        <main className="share-public-main">
          <div className="share-card">
            <h1>{snippet.title}</h1>
            <p className="hint">{snippet.description || 'Custom formula'}</p>
            <div className="formula-share-code">
              <CodeEditor value={snippet.code} onChange={() => undefined} language="javascript" height="220px" readOnly />
            </div>
            <div className="formula-create-actions" style={{ marginTop: 16 }}>
              {loading ? null : user ? (
                imported ? (
                  <Link className="primary-button small" href="/">
                    Open workspace
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="primary-button small"
                    data-testid="formula-share-import"
                    disabled={busy}
                    onClick={onImport}
                  >
                    Import to my account
                  </button>
                )
              ) : (
                <Link className="primary-button small" href="/login">
                  Sign in to import
                </Link>
              )}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

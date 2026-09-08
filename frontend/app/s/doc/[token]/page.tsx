'use client';

import React, { useEffect, useState } from 'react';
import { docsApi, type SharedDocView } from '@/lib/docsApi';
import { BlockView } from '@/components/docs/Mentions';
import styles from '@/components/docs/docs.module.css';

export default function SharedDocPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string | null>(null);
  const [share, setShare] = useState<SharedDocView['share'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { token: t } = await params;
      if (cancelled) return;
      setToken(t);
      try {
        const res = await docsApi.publicShare(t);
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

  const by = share?.page.updatedBy?.name ?? null;
  const updatedLabel = share
    ? (() => {
        const d = new Date(share.page.updatedAt);
        return Number.isNaN(d.getTime()) ? share.page.updatedAt : d.toLocaleString();
      })()
    : null;

  return (
    <div className="share-public-page" data-testid="shared-doc-view">
      <header className="share-public-header">
        <span className="share-brand">API Hub</span>
        <span className="hint">shared doc</span>
      </header>

      {error && (
        <main className="share-public-main">
          <div className="share-card">
            <h2>Link unavailable</h2>
            <p className="hint">{error}. It may have been revoked by its owner.</p>
          </div>
        </main>
      )}

      {!error && !share && (
        <main className="share-public-main">
          <p className="hint">Loading…</p>
        </main>
      )}

      {share && (
        <main className="share-public-main">
          <div className="share-card">
            <h1 className={styles.shareDocTitle}>{share.page.title || 'Untitled page'}</h1>
            <p className={styles.shareDocMeta}>
              {by ? `${by} updated this ` : 'Last updated '}
              <strong>{updatedLabel}</strong>
              {share.workspaceName && <span>· {share.workspaceName}</span>}
            </p>

            {share.blocks.length === 0 ? (
              <p className="hint">This page has no content yet.</p>
            ) : (
              <div className={styles.shareDocBody}>
                <BlockView blocks={share.blocks} />
              </div>
            )}

            {share.mentions.length > 0 && (
              <div className={styles.shareMentions}>
                <div className={styles.sectionLabel}>Mentions</div>
                <div className={styles.chipRow}>
                  {share.mentions.map((m, i) => (
                    <span
                      key={i}
                      className={`${styles.chip} ${m.type === 'user' ? styles.chipUser : styles.chipApi}`}
                    >
                      {m.type === 'user' ? `@${m.ref.name}` : m.ref.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}

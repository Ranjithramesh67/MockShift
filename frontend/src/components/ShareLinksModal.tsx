'use client';

import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { shareApi } from '@/lib/api';
import { CheckIcon, CopyIcon, TrashIcon } from './icons';

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const el = document.createElement('textarea');
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  return Promise.resolve();
}

export function ShareLinksModal({
  open,
  onClose,
  requestId,
  requestName,
}: {
  open: boolean;
  onClose: () => void;
  requestId: string;
  requestName: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !requestId) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    setCopied(false);
    shareApi
      .create(requestId)
      .then((res) => {
        if (!cancelled) setToken(res.share.token);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to create share link');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, requestId]);

  if (!open) return null;

  const url = token ? `${window.location.origin}/s/${token}` : null;

  const onCopy = async () => {
    if (!url) return;
    await copyText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onRevoke = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await shareApi.revoke(token);
      setToken(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke share link');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Share request" onClose={onClose} testId="share-links-modal">
      {busy && !token && <p className="hint">Creating link…</p>}
      {error && <p className="auth-error">{error}</p>}
      {!busy && !token && !error && <p className="hint">No active share link.</p>}

      {token && (
        <>
          <p className="hint">
            Anyone with this link can view <strong>{requestName}</strong> and its latest response —
            read-only, no login required.
          </p>
          <div className="share-url-row">
            <input
              className="text-input"
              type="text"
              readOnly
              value={url ?? ''}
              data-testid="share-url-input"
              aria-label="Share URL"
            />
            <button type="button" className="ghost-button" data-testid="share-copy-button" onClick={onCopy}>
              {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="ghost-button danger"
              data-testid="share-revoke-button"
              onClick={onRevoke}
              disabled={busy}
            >
              <TrashIcon size={14} />
              Revoke
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

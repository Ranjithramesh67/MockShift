'use client';

import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { shareApi, type SendItemType } from '@/lib/api';
import { CheckIcon, CopyIcon, TrashIcon } from './icons';

// De-duplicate share creation by item: React StrictMode mounts effects twice in
// development, which fired two POST /api/shares requests. Sharing one in-flight
// promise per item keeps a single request (and the server upsert keeps it safe
// regardless).
type ShareCreateResult = Awaited<ReturnType<typeof shareApi.create>>;
const inflightCreates = new Map<string, Promise<ShareCreateResult>>();

function createShareOnce(itemType: SendItemType, itemId: string) {
  const key = `${itemType}:${itemId}`;
  const existing = inflightCreates.get(key);
  if (existing) return existing;
  const promise = shareApi.create({ itemType, itemId }).finally(() => {
    inflightCreates.delete(key);
  });
  inflightCreates.set(key, promise);
  return promise;
}

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
  itemType,
  itemId,
  itemName,
}: {
  open: boolean;
  onClose: () => void;
  itemType: SendItemType;
  itemId: string;
  itemName: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !itemId) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    setCopied(false);
    createShareOnce(itemType, itemId)
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
  }, [open, itemType, itemId]);

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
    <Modal title="Share link" onClose={onClose} testId="share-links-modal">
      {busy && !token && <p className="hint">Creating link…</p>}
      {error && <p className="auth-error">{error}</p>}
      {!busy && !token && !error && <p className="hint">No active share link.</p>}

      {token && (
        <>
          <p className="hint">
            Anyone with this link can view <strong>{itemName}</strong> and its latest state — read-only.
            Viewers must be signed in to API Hub (no paid plan needed).
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

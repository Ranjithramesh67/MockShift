'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sendsApi, type Send, type SendItemType, type SendRecipient } from '@/lib/api';
import { Modal } from './Modal';
import { CheckIcon, CollectionIcon, FolderIcon, LayersIcon, RequestIcon, WorkspaceIcon } from './icons';

export interface SendableItem {
  id: string;
  type: SendItemType;
  name: string;
}

const TYPE_ICON: Record<SendItemType, React.ComponentType<{ size?: number }>> = {
  request: RequestIcon,
  folder: FolderIcon,
  collection: CollectionIcon,
  project: LayersIcon,
  workspace: WorkspaceIcon,
};

const TYPE_LABEL: Record<SendItemType, string> = {
  request: 'Request',
  folder: 'Folder',
  collection: 'Collection',
  project: 'Project',
  workspace: 'Workspace',
};

function Initials({ name }: { name: string }) {
  const parts = (name || '?').trim().split(/\s+/);
  const letters = (parts[0]?.charAt(0) || '?') + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '');
  return (
    <span className="user-avatar send-dialog-avatar" aria-hidden="true">
      {letters.toUpperCase()}
    </span>
  );
}

/**
 * Send an item (request / folder / collection / project / workspace) to
 * another user. Mount it from an item action menu with the item's id/type/name
 * and call onSent when the send is created (host toasts / navigates as needed).
 */
export function SendItemDialog({
  open,
  item,
  onClose,
  onSent,
}: {
  open: boolean;
  item: SendableItem | null;
  onClose: () => void;
  onSent?: (send: Send) => void;
}) {
  const [recipients, setRecipients] = useState<SendRecipient[] | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Send | null>(null);

  const reset = useCallback(() => {
    setRecipients(null);
    setQuery('');
    setSelectedId(null);
    setMessage('');
    setError(null);
    setBusy(false);
    setDone(null);
  }, []);

  // Reload candidates every time the dialog opens for a (new) item.
  useEffect(() => {
    if (!open || !item) return;
    setDone(null);
    setError(null);
    let stale = false;
    (async () => {
      try {
        const { recipients: list } = await sendsApi.recipients();
        if (!stale) setRecipients(list);
      } catch (err) {
        if (!stale) setError(err instanceof Error ? err.message : 'Failed to load recipients');
      }
    })();
    return () => {
      stale = true;
    };
  }, [open, item?.id]);

  const filtered = useMemo(() => {
    if (!recipients) return null;
    const q = query.trim().toLowerCase();
    if (!q) return recipients;
    return recipients.filter((r) => {
      const name = (r.name || '').toLowerCase();
      const email = (r.email || '').toLowerCase();
      const username = (r.username || '').toLowerCase();
      return name.includes(q) || email.includes(q) || username.includes(q);
    });
  }, [recipients, query]);

  const selected = recipients?.find((r) => r.id === selectedId) ?? null;

  const submit = async () => {
    if (!item || !selectedId || busy) return;
    setError(null);
    setBusy(true);
    try {
      const { send } = await sendsApi.create({
        recipientId: selectedId,
        itemType: item.type,
        itemId: item.id,
        message: message.trim() || undefined,
      });
      setDone(send);
      onSent?.(send);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    reset();
    onClose();
  };

  if (!open || !item) return null;

  const Icon = TYPE_ICON[item.type] ?? RequestIcon;

  return (
    <Modal title="Send item" onClose={close} testId="send-item-modal">
      {done ? (
        <div className="modal-section" data-testid="send-item-success">
          <p className="send-success-line">
            <CheckIcon size={15} /> Sent {TYPE_LABEL[item.type].toLowerCase()} “{item.name}” to{' '}
            <strong>{done.recipient?.name ?? 'the recipient'}</strong>.
          </p>
          <p className="hint">
            {done.recipient?.name ?? 'They'} will see it in their inbox and can accept it to copy it into their own
            account.
          </p>
          <div className="modal-actions">
            <button type="button" className="primary-button" data-testid="send-item-done" onClick={close}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="modal-section">
            <p className="send-item-line">
              <Icon size={15} />
              <span className="send-item-kind">{TYPE_LABEL[item.type]}</span>
              <strong data-testid="send-item-name">{item.name}</strong>
            </p>
            <p className="hint">The recipient receives a copy — you keep the original. On accept the item is cloned into their workspace.</p>
          </div>

          {error && (
            <p className="auth-error" role="alert" data-testid="send-item-error">
              {error}
            </p>
          )}

          <div className="modal-section">
            <h3>Who do you want to send it to?</h3>
            {recipients === null ? (
              <p className="hint">Loading people…</p>
            ) : recipients.length === 0 ? (
              <p className="hint">
                No one to send to yet — you can only send to people you share an organization or workspace with.
              </p>
            ) : (
              <>
                <label className="auth-field">
                  <span>Search people</span>
                  <input
                    type="search"
                    placeholder="Name, username or email"
                    data-testid="send-recipient-search"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSelectedId(null);
                    }}
                  />
                </label>
                <ul className="share-list send-dialog-list" data-testid="send-recipient-list">
                  {(filtered ?? []).map((r) => {
                    const active = selectedId === r.id;
                    return (
                      <li key={r.id} className={`share-row send-recipient-row${active ? ' selected' : ''}`}>
                        <button
                          type="button"
                          className="send-recipient-pick"
                          data-testid={`send-option-${r.email}`}
                          aria-pressed={active}
                          onClick={() => setSelectedId(r.id)}
                        >
                          <Initials name={r.name} />
                          <span className="send-recipient-text">
                            <span className="send-recipient-name">{r.name}</span>
                            <span className="send-recipient-meta">
                              @{r.username}
                              <span aria-hidden="true"> · </span>
                              {r.email}
                            </span>
                          </span>
                          {active && (
                            <span className="send-recipient-check">
                              <CheckIcon size={13} />
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                  {filtered && filtered.length === 0 && <li className="hint">No matching people.</li>}
                </ul>
              </>
            )}
          </div>

          <div className="modal-section">
            <h3>Add a note (optional)</h3>
            <textarea
              className="send-dialog-message"
              data-testid="send-item-message"
              rows={2}
              maxLength={500}
              placeholder="Why are you sending this?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="ghost-button" data-testid="send-item-cancel" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              data-testid="send-item-submit"
              disabled={!selected || busy}
              onClick={() => void submit()}
            >
              {busy ? 'Sending…' : 'Send item'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

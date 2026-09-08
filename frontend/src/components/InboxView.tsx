'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { sendsApi, ApiError, type Send, type SendAcceptedPath, type SendItemType, type SendStatus } from '@/lib/api';
import { UserAvatar } from './UserAvatar';
import {
  CheckIcon,
  ClockIcon,
  CollectionIcon,
  FolderIcon,
  LayersIcon,
  RequestIcon,
  SendIcon,
  WorkspaceIcon,
  XIcon,
} from './icons';

// ------------------------------------------------------------- small helpers

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

const STATUS_LABEL: Record<SendStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

const ITEM_FILTERS: Array<SendStatus | 'all'> = ['all', 'pending', 'accepted', 'rejected'];

// Human line describing where an accepted copy landed (recipient scoped).
function acceptedWhere(path: SendAcceptedPath | null): string {
  if (!path) return '';
  if (path.type === 'workspace') return path.workspaceName;
  const parts = [path.workspaceName, path.projectName, path.collectionName];
  if (path.folderName) parts.push(path.folderName);
  if (path.type === 'request' && path.name) parts.push(path.name);
  return parts.filter(Boolean).join(' / ');
}

function TypeIcon({ type }: { type: SendItemType }) {
  const Icon = TYPE_ICON[type] ?? RequestIcon;
  return <Icon size={16} />;
}

// --------------------------------------------------------------- list pieces

function EmptyState({ tab }: { tab: 'inbox' | 'sent' }) {
  return (
    <div className="inbox-empty" data-testid="inbox-empty">
      {tab === 'inbox' ? (
        <>
          <SendIcon size={26} />
          <p className="inbox-empty-title">No incoming sends</p>
          <p className="inbox-empty-sub">
            When a teammate sends you a request, folder, collection, project or workspace it will appear here. Accept
            it to copy the item into your own account.
          </p>
        </>
      ) : (
        <>
          <SendIcon size={26} />
          <p className="inbox-empty-title">Nothing sent yet</p>
          <p className="inbox-empty-sub">
            Items you send to other users show up here so you can track whether they were accepted or rejected.
          </p>
        </>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: SendStatus }) {
  return (
    <span className={`inbox-chip inbox-chip-${status}`} data-testid={`inbox-status-${status}`}>
      {status === 'pending' && <ClockIcon size={12} />}
      {status === 'accepted' && <CheckIcon size={12} />}
      {status === 'rejected' && <XIcon size={12} />}
      {STATUS_LABEL[status]}
    </span>
  );
}

function RespondActions({
  send,
  busyId,
  confirmId,
  onStart,
  onCancel,
  onConfirm,
}: {
  send: Send;
  busyId: string | null;
  confirmId: string | null;
  onStart: (sendId: string, action: 'accept' | 'reject') => void;
  onCancel: () => void;
  onConfirm: (sendId: string, action: 'accept' | 'reject') => void;
}) {
  if (confirmId === send.id) {
    return (
      <span className="inbox-respond-confirm" data-testid={`inbox-confirm-${send.id}`}>
        {busyId === send.id ? (
          <span className="inbox-busy">
            <span className="spinner" />
            Working…
          </span>
        ) : (
          <>
            <button
              type="button"
              className="ghost-button small danger-text"
              data-testid={`inbox-accept-yes-${send.id}`}
              onClick={() => onConfirm(send.id, 'accept')}
            >
              Accept — copy into my workspace
            </button>
            <button
              type="button"
              className="ghost-button small"
              data-testid={`inbox-reject-yes-${send.id}`}
              onClick={() => onConfirm(send.id, 'reject')}
            >
              Reject
            </button>
            <button type="button" className="inbox-link" data-testid={`inbox-cancel-${send.id}`} onClick={onCancel}>
              Cancel
            </button>
          </>
        )}
      </span>
    );
  }
  return (
    <span className="inbox-respond-actions">
      <button
        type="button"
        className="primary-button small"
        data-testid={`inbox-accept-${send.id}`}
        disabled={busyId === send.id}
        onClick={() => onStart(send.id, 'accept')}
      >
        Accept
      </button>
      <button
        type="button"
        className="ghost-button small"
        data-testid={`inbox-reject-${send.id}`}
        disabled={busyId === send.id}
        onClick={() => onStart(send.id, 'reject')}
      >
        Reject
      </button>
    </span>
  );
}

function InboxRow({
  send,
  busyId,
  confirmId,
  errorText,
  onStart,
  onCancel,
  onConfirm,
}: {
  send: Send;
  busyId: string | null;
  confirmId: string | null;
  errorText: string | null;
  onStart: (sendId: string, action: 'accept' | 'reject') => void;
  onCancel: () => void;
  onConfirm: (sendId: string, action: 'accept' | 'reject') => void;
}) {
  const person = send.sender;
  const itemName = send.itemName || 'Untitled item';
  return (
    <li className="inbox-row" data-testid={`inbox-row-${send.id}`}>
      <span className="inbox-person" title={person?.email || ''}>
        <UserAvatar name={person?.name ?? ''} size={34} ariaLabel={person?.name || 'Sender'} />
      </span>
      <div className="inbox-row-main">
        <div className="inbox-row-head">
          <span className="inbox-type" data-testid={`inbox-type-${send.id}`}>
            <TypeIcon type={send.itemType} />
            {TYPE_LABEL[send.itemType]}
          </span>
          <span className="inbox-time" data-testid={`inbox-time-${send.id}`}>
            {timeAgo(send.createdAt)}
          </span>
          <StatusChip status={send.status} />
        </div>
        <p className="inbox-row-item" data-testid={`inbox-item-${send.id}`}>
          <strong>{itemName}</strong>
          <span className="inbox-row-by">
            from {person?.name || 'a user'}
            {send.message ? ` · “${send.message}”` : ''}
          </span>
        </p>
        {send.status === 'accepted' && (
          <p className="inbox-row-note inbox-row-note-ok" data-testid={`inbox-acceptedwhere-${send.id}`}>
            Copied into {acceptedWhere(send.acceptedPath) || 'your workspace'}
          </p>
        )}
        {errorText && (
          <p className="inbox-row-error" role="alert" data-testid={`inbox-error-${send.id}`}>
            {errorText}
          </p>
        )}
      </div>
      {send.status === 'pending' ? (
        <RespondActions
          send={send}
          busyId={busyId}
          confirmId={confirmId}
          onStart={onStart}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      ) : null}
    </li>
  );
}

function SentRow({
  send,
  errorText,
}: {
  send: Send;
  errorText: string | null;
}) {
  const person = send.recipient;
  const itemName = send.itemName || 'Untitled item';
  const rejected = send.status === 'rejected';
  const title = rejected ? `Rejected on ${fmtDateTime(send.respondedAt)}` : `Accepted on ${fmtDateTime(send.respondedAt)}`;
  return (
    <li className="inbox-row" data-testid={`sent-row-${send.id}`}>
      <span className="inbox-person" title={person?.email || ''}>
        <UserAvatar name={person?.name ?? ''} size={34} ariaLabel={person?.name || 'Recipient'} />
      </span>
      <div className="inbox-row-main">
        <div className="inbox-row-head">
          <span className="inbox-type" data-testid={`sent-type-${send.id}`}>
            <TypeIcon type={send.itemType} />
            {TYPE_LABEL[send.itemType]}
          </span>
          <span className="inbox-time" data-testid={`sent-time-${send.id}`}>
            {timeAgo(send.createdAt)}
          </span>
          <StatusChip status={send.status} />
        </div>
        <p className="inbox-row-item" data-testid={`sent-item-${send.id}`}>
          <strong>{itemName}</strong>
          <span className="inbox-row-by">
            to {person?.name || 'a user'}
            {send.message ? ` · “${send.message}”` : ''}
          </span>
        </p>
        {send.status === 'accepted' ? (
          <p className="inbox-row-note inbox-row-note-ok" data-testid={`sent-acceptedwhere-${send.id}`} title={title}>
            {person?.name || 'They'} accepted · copied into {acceptedWhere(send.acceptedPath) || 'their workspace'}
          </p>
        ) : rejected ? (
          <p className="inbox-row-note inbox-row-note-no" data-testid={`sent-rejectedat-${send.id}`} title={title}>
            {person?.name || 'They'} rejected this item
          </p>
        ) : (
          <p className="inbox-row-note" data-testid={`sent-pendingat-${send.id}`}>
            Waiting for {person?.name || 'them'} to respond
          </p>
        )}
        {errorText && (
          <p className="inbox-row-error" role="alert">
            {errorText}
          </p>
        )}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ the view

export function InboxView() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const [tab, setTab] = useState<'inbox' | 'sent'>('inbox');
  const [inboxFilter, setInboxFilter] = useState<SendStatus | 'all'>('all');
  const [inbox, setInbox] = useState<Send[] | null>(null);
  const [outbox, setOutbox] = useState<Send[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ sendId: string; text: string } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  const loadInbox = useCallback(async () => {
    setLoadErr(null);
    try {
      const { sends } = await sendsApi.inbox(inboxFilter === 'all' ? undefined : inboxFilter);
      setInbox(sends);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUnauthorized(true);
      else setLoadErr(err instanceof Error ? err.message : 'Failed to load inbox');
    }
  }, [inboxFilter]);

  const loadOutbox = useCallback(async () => {
    setLoadErr(null);
    try {
      const { sends } = await sendsApi.outbox();
      setOutbox(sends);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUnauthorized(true);
      else setLoadErr(err instanceof Error ? err.message : 'Failed to load sent items');
    }
  }, []);

  // Refetch the visible list whenever the tab/filter changes.
  useEffect(() => {
    if (tab === 'inbox') void loadInbox();
    else void loadOutbox();
  }, [tab, loadInbox, loadOutbox]);

  useEffect(() => {
    if (unauthorized) {
      void logout();
      router.replace('/login');
    }
  }, [unauthorized, logout, router]);

  const startConfirm = (sendId: string, action: 'accept' | 'reject') => {
    setRowError(null);
    if (action === 'reject') {
      void doRespond(sendId, 'reject');
      return;
    }
    setConfirmId(sendId);
  };

  const cancelConfirm = () => setConfirmId(null);

  const doRespond = async (sendId: string, action: 'accept' | 'reject') => {
    if (busyId) return;
    setBusyId(sendId);
    setRowError(null);
    setConfirmId(null);
    try {
      const { send } = action === 'accept' ? await sendsApi.accept(sendId) : await sendsApi.reject(sendId);
      setInbox((current) => (current ? current.map((s) => (s.id === send.id ? send : s)) : current));
      setOutbox((current) => (current ? current.map((s) => (s.id === send.id ? send : s)) : current));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUnauthorized(true);
        return;
      }
      setRowError({ sendId, text: err instanceof Error ? err.message : 'Action failed' });
      // An item can only be responded to once; a 409 means it was handled in
      // another tab. Reload to reflect the truth.
      if (err instanceof Error && /already/.test(err.message)) {
        if (tab === 'inbox') void loadInbox();
      }
    } finally {
      setBusyId(null);
    }
  };

  if (authLoading) {
    return (
      <div className="loading-screen" data-testid="loading-splash">
        <span className="spinner" />
        Loading…
      </div>
    );
  }
  if (!user) return null;

  const sending = tab === 'inbox' ? inbox : outbox;
  const empty = sending !== null && sending.length === 0;

  return (
    <main className="inbox-main" data-testid="inbox-page">
      <div className="inbox-head">
        <h1 data-testid="inbox-title">Inbox</h1>
        <p className="inbox-head-sub">
          Requests, folders, collections, projects and workspaces that people send you — plus a record of what you
          have sent.
        </p>
      </div>

      <div className="inbox-tabs" role="tablist" aria-label="Inbox views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'inbox'}
          className={`inbox-tab${tab === 'inbox' ? ' active' : ''}`}
          data-testid="inbox-tab-inbox"
          onClick={() => setTab('inbox')}
        >
          <SendIcon size={14} />
          Received
          {inbox ? <span className="inbox-tab-count">{inbox.length}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sent'}
          className={`inbox-tab${tab === 'sent' ? ' active' : ''}`}
          data-testid="inbox-tab-sent"
          onClick={() => setTab('sent')}
        >
          <SendIcon size={14} />
          Sent
          {outbox ? <span className="inbox-tab-count">{outbox.length}</span> : null}
        </button>
      </div>

      {tab === 'inbox' ? (
        <div className="inbox-filter-row" role="group" aria-label="Filter received sends">
          {ITEM_FILTERS.map((filter) => (
            <button
              type="button"
              key={filter}
              className={`inbox-filter${inboxFilter === filter ? ' active' : ''}`}
              data-testid={`inbox-filter-${filter}`}
              aria-pressed={inboxFilter === filter}
              onClick={() => setInboxFilter(filter)}
            >
              {filter === 'all' ? 'All' : STATUS_LABEL[filter]}
            </button>
          ))}
        </div>
      ) : null}

      {loadErr && (
        <div className="inbox-error" role="alert" data-testid="inbox-load-error">
          <p>{loadErr}</p>
          <button
            type="button"
            className="ghost-button small"
            data-testid="inbox-retry"
            onClick={() => (tab === 'inbox' ? void loadInbox() : void loadOutbox())}
          >
            Retry
          </button>
        </div>
      )}

      {empty ? (
        <EmptyState tab={tab} />
      ) : sending ? (
        <ul className="inbox-list" data-testid={tab === 'inbox' ? 'inbox-list' : 'sent-list'}>
          {tab === 'inbox'
            ? sending.map((send) => (
                <InboxRow
                  key={send.id}
                  send={send}
                  busyId={busyId}
                  confirmId={confirmId}
                  errorText={rowError?.sendId === send.id ? rowError.text : null}
                  onStart={startConfirm}
                  onCancel={cancelConfirm}
                  onConfirm={doRespond}
                />
              ))
            : sending.map((send) => (
                <SentRow key={send.id} send={send} errorText={rowError?.sendId === send.id ? rowError.text : null} />
              ))}
        </ul>
      ) : null}
    </main>
  );
}

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { sendsApi, ApiError, accessRequestApi, type Send, type SendAcceptedPath, type SendItemType, type SendStatus } from '@/lib/api';
import { docsSharedApi } from '@/lib/docsApi';
import { mergeMyRequests } from '@/lib/accessRequests';
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

function EmptyState({ tab }: { tab: 'inbox' | 'sent' | 'requests' }) {
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
      ) : tab === 'sent' ? (
        <>
          <SendIcon size={26} />
          <p className="inbox-empty-title">Nothing sent yet</p>
          <p className="inbox-empty-sub">
            Items you send to other users show up here so you can track whether they were accepted or rejected.
          </p>
        </>
      ) : (
        <>
          <RequestIcon size={26} />
          <p className="inbox-empty-title">No access requests</p>
          <p className="inbox-empty-sub">
            Requests you make for project or workspace access show up here so you can track their status or cancel them
            while they are still pending.
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

type MyRequestRow = ReturnType<typeof mergeMyRequests>[number];

const REQUEST_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  DENIED: 'Denied',
  CANCELLED: 'Cancelled',
};

function RequestStatusChip({ status }: { status: string }) {
  const key = String(status || '').toLowerCase();
  return (
    <span className={`inbox-chip inbox-chip-${key}`} data-testid={`request-status-${key}`}>
      {REQUEST_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function RequestRow({
  row,
  busy,
  errorText,
  onCancel,
}: {
  row: MyRequestRow;
  busy: boolean;
  errorText: string | null;
  onCancel: (row: MyRequestRow) => void;
}) {
  const KindIcon = row.kind === 'project' ? LayersIcon : WorkspaceIcon;
  return (
    <li className="inbox-row" data-testid={`request-row-${row.kind}-${row.id}`}>
      <div className="inbox-row-main">
        <div className="inbox-row-head">
          <span className="inbox-type" data-testid={`request-kind-${row.id}`}>
            <KindIcon size={16} />
            {row.kind === 'project' ? 'Project' : 'Workspace'}
          </span>
          <span className="inbox-time" data-testid={`request-time-${row.id}`}>
            {timeAgo(row.requestedAt)}
          </span>
          <RequestStatusChip status={row.status} />
        </div>
        <p className="inbox-row-item" data-testid={`request-title-${row.id}`}>
          <strong>{row.title}</strong>
          {row.role ? <span className="inbox-row-by">Requested role: {row.role}</span> : null}
        </p>
        {row.reason ? (
          <p className="inbox-row-note" data-testid={`request-reason-${row.id}`}>
            {row.reason}
          </p>
        ) : null}
        {errorText ? (
          <p className="inbox-row-error" role="alert" data-testid={`request-error-${row.id}`}>
            {errorText}
          </p>
        ) : null}
      </div>
      {row.cancellable ? (
        <button
          type="button"
          className="ghost-button small inbox-request-cancel"
          data-testid={`request-cancel-${row.id}`}
          disabled={busy}
          onClick={() => onCancel(row)}
        >
          Cancel
        </button>
      ) : null}
    </li>
  );
}

// ------------------------------------------------------------------ the view

export function InboxView() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const [tab, setTab] = useState<'inbox' | 'sent' | 'requests'>(() => {
    if (typeof window !== 'undefined') {
      const requested = new URLSearchParams(window.location.search).get('tab');
      if (requested === 'requests') return 'requests';
    }
    return 'inbox';
  });
  const [inboxFilter, setInboxFilter] = useState<SendStatus | 'all'>('all');
  const [inbox, setInbox] = useState<Send[] | null>(null);
  const [outbox, setOutbox] = useState<Send[] | null>(null);
  const [myRequests, setMyRequests] = useState<MyRequestRow[]>([]);
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [requestBusyId, setRequestBusyId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<{ id: string; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ sendId: string; text: string } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [requestsLoadErr, setRequestsLoadErr] = useState<string | null>(null);
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

  const loadRequests = useCallback(async () => {
    setLoadErr(null);
    setRequestsLoadErr(null);
    setRequestError(null);
    const [p, w] = await Promise.allSettled([
      accessRequestApi.mine(),
      docsSharedApi.listWorkspaceRequests({ mine: true }),
    ]);
    const isUnauthorized = (r: PromiseSettledResult<unknown>): boolean =>
      r.status === 'rejected' && r.reason instanceof ApiError && r.reason.status === 401;
    if (isUnauthorized(p) || isUnauthorized(w)) {
      setUnauthorized(true);
      return;
    }
    const projectRows = p.status === 'fulfilled' ? p.value.accessRequests : [];
    const workspaceRows = w.status === 'fulfilled' ? w.value.requests : [];
    setMyRequests(mergeMyRequests(projectRows, workspaceRows));
    setRequestsLoaded(true);
    if (p.status === 'rejected' || w.status === 'rejected') {
      setRequestsLoadErr('Some requests could not be loaded.');
    }
  }, []);

  // Refetch the visible list whenever the tab/filter changes.
  useEffect(() => {
    if (tab === 'inbox') void loadInbox();
    else if (tab === 'sent') void loadOutbox();
    else void loadRequests();
  }, [tab, loadInbox, loadOutbox, loadRequests]);

  useEffect(() => {
    if (unauthorized) {
      void logout();
      router.replace('/login');
    }
  }, [unauthorized, logout, router]);

  const cancelRequest = async (row: MyRequestRow) => {
    if (requestBusyId) return;
    setRequestBusyId(row.id);
    setRequestError(null);
    try {
      if (row.kind === 'project') await accessRequestApi.cancel(row.projectId!, row.id);
      else await docsSharedApi.cancelWorkspaceRequest(row.id);
      await loadRequests();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUnauthorized(true);
        return;
      }
      setRequestError({ id: row.id, text: err instanceof Error ? err.message : 'Cancel failed' });
    } finally {
      setRequestBusyId(null);
    }
  };

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

  const sending = tab === 'inbox' ? inbox : tab === 'sent' ? outbox : null;
  const empty = sending !== null && sending.length === 0;
  const requestsEmpty = tab === 'requests' && requestsLoaded && myRequests.length === 0;

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
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'requests'}
          className={`inbox-tab${tab === 'requests' ? ' active' : ''}`}
          data-testid="inbox-tab-requests"
          onClick={() => setTab('requests')}
        >
          <RequestIcon size={14} />
          Requests
          {requestsLoaded ? <span className="inbox-tab-count">{myRequests.length}</span> : null}
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
            onClick={() =>
              tab === 'inbox' ? void loadInbox() : tab === 'sent' ? void loadOutbox() : void loadRequests()
            }
          >
            Retry
          </button>
        </div>
      )}

      {tab === 'requests' ? (
        <>
          {requestsLoadErr ? (
            <div className="inbox-error" role="alert" data-testid="requests-load-error">
              <p>{requestsLoadErr}</p>
              <button
                type="button"
                className="ghost-button small"
                data-testid="requests-retry"
                onClick={() => void loadRequests()}
              >
                Retry
              </button>
            </div>
          ) : null}
          {requestsEmpty && !requestsLoadErr ? (
            <EmptyState tab="requests" />
          ) : myRequests.length > 0 ? (
            <ul className="inbox-list" data-testid="requests-list">
              {myRequests.map((row) => (
                <RequestRow
                  key={`${row.kind}-${row.id}`}
                  row={row}
                  busy={requestBusyId === row.id}
                  errorText={requestError && requestError.id === row.id ? requestError.text : null}
                  onCancel={cancelRequest}
                />
              ))}
            </ul>
          ) : null}
        </>
      ) : empty ? (
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

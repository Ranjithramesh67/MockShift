'use client';

import React, { useState } from 'react';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useApp } from '@/store/AppStore';
import { accessRequestApi } from '@/lib/api';
import { CreateModal, type CreateKind } from './CreateModal';
import { SharingModal } from './SharingModal';
import { TeamsModal } from './TeamsModal';
import { AuthProviderModal } from './AuthProviderModal';
import {
  WorkspaceIcon,
  TeamIcon,
  CollectionIcon,
  RequestIcon,
  KeyIcon,
  PlusIcon,
  TrashIcon,
  ChevronIcon,
  LockIcon,
} from './icons';

export function Sidebar() {
  const ws = useWorkspace();
  const { dispatch } = useApp();
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [targetCollectionId, setTargetCollectionId] = useState<string | null>(null);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authCollectionId, setAuthCollectionId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [requestingProject, setRequestingProject] = useState<{ id: string; name: string } | null>(null);
  const [accessReason, setAccessReason] = useState('');

  const openCreate = (kind: CreateKind, collectionId?: string) => {
    setTargetCollectionId(collectionId ?? null);
    setCreateKind(kind);
  };

  const submitAccessRequest = async () => {
    if (!requestingProject) return;
    try {
      await accessRequestApi.request(requestingProject.id, accessReason || undefined);
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: `Access requested for "${requestingProject.name}".` });
      setRequestingProject(null);
      setAccessReason('');
      await ws.reloadTree();
    } catch (err) {
      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Request failed' });
    }
  };

  const onSelectRequest = (id: string) => {
    dispatch({ type: 'SELECT_REQUEST', id });
    ws.selectRequest(id).catch(() => undefined);
  };

  const onOpenAuth = async (collectionId: string) => {
    await ws.selectCollection(collectionId, ws.tree?.collections.find((c) => c.id === collectionId)?.name ?? '');
    setAuthCollectionId(collectionId);
    setAuthOpen(true);
  };

  const toggleCollection = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-section-head">
          <h3>Workspaces</h3>
          <button
            type="button"
            className="icon-button"
            aria-label="New workspace"
            title="New workspace"
            data-testid="new-workspace"
            onClick={() => openCreate('workspace')}
          >
            <PlusIcon size={14} />
          </button>
        </div>
        {ws.loading && <p className="hint">Loading…</p>}
        {ws.error && <p className="auth-error">{ws.error}</p>}
        <ul className="sidebar-list">
          {ws.workspaces.map((w) => (
            <li key={w.id} className="sidebar-row">
              <button
                type="button"
                className={`sidebar-item ${ws.activeWorkspaceId === w.id ? 'active' : ''}`}
                data-testid={`workspace-${w.name}`}
                onClick={() => ws.selectWorkspace(w.id).catch(() => undefined)}
              >
                <span className="sidebar-icon">
                  <WorkspaceIcon size={15} />
                </span>
                <span className="sidebar-item-name">{w.name}</span>
                <span className={`vis-badge vis-${w.visibility.toLowerCase()}`}>{w.visibility}</span>
              </button>
              <button
                type="button"
                className="icon-button danger"
                title="Delete workspace"
                aria-label={`Delete workspace ${w.name}`}
                data-testid={`delete-workspace-${w.name}`}
                disabled={w.name === 'My Workspace'}
                onClick={() => {
                  if (w.name === 'My Workspace') return;
                  if (
                    window.confirm(
                      `Delete workspace "${w.name}"? This removes all of its projects, collections and requests.`
                    )
                  ) {
                    ws.deleteWorkspace(w.id).catch((err) =>
                      alert(err instanceof Error ? err.message : 'Failed to delete workspace')
                    );
                  }
                }}
              >
                <TrashIcon size={13} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-head">
          <h3>Teams</h3>
          <button
            type="button"
            className="icon-button"
            aria-label="Manage teams"
            title="Manage teams"
            data-testid="manage-teams"
            onClick={() => setTeamsOpen(true)}
          >
            <PlusIcon size={14} />
          </button>
        </div>
        <ul className="sidebar-list">
          {ws.teams.map((t) => (
            <li key={t.id} className="sidebar-static-item">
              <span className="sidebar-icon">
                <TeamIcon size={15} />
              </span>
              <span className="sidebar-item-name">{t.name}</span>
              <span className="role-badge">{t.members.length}</span>
            </li>
          ))}
        </ul>
      </div>

      {ws.tree && ws.activeWorkspaceId && (
        <div className="sidebar-section">
          <div className="sidebar-section-head">
            <h3>Collections</h3>
            <button
              type="button"
              className="icon-button"
              aria-label="New collection"
              title="New collection"
              data-testid="new-collection"
              onClick={() => openCreate('collection')}
            >
              <PlusIcon size={14} />
            </button>
            <button
              type="button"
              className="ghost-button small"
              title="Share workspace"
              data-testid="share-workspace"
              onClick={() => setSharingOpen(true)}
            >
              Share
            </button>
          </div>
          {ws.tree.projects.map((p) => (
            <div key={p.id} className="tree-project">
              <div className="tree-project-name">
                <CollectionIcon size={12} />
                {p.name}
                {p.can_access ? (
                  <span className="vis-badge access-badge">MEMBER</span>
                ) : p.access_status === 'PENDING' ? (
                  <span className="vis-badge pending-badge">PENDING</span>
                ) : null}
              </div>
              {!p.can_access && p.access_status !== 'PENDING' && (
                <button
                  type="button"
                  className="ghost-button small access-request-btn"
                  data-testid={`request-access-${p.name}`}
                  onClick={() => setRequestingProject({ id: p.id, name: p.name })}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <LockIcon size={11} />
                  Request access
                </button>
              )}
              {ws.tree!.collections
                .filter((c) => c.project_id === p.id)
                .map((c) => {
                  const isCollapsed = !!collapsed[c.id];
                  const requests = ws.tree!.requests.filter((r) => r.collection_id === c.id);
                  return (
                    <div key={c.id} className="tree-collection">
                      <div className="tree-collection-row">
                        <button
                          type="button"
                          className={`tree-collection-name ${ws.activeCollectionId === c.id ? 'active' : ''}`}
                          data-testid={`collection-${c.name}`}
                          onClick={() => {
                            toggleCollection(c.id);
                            ws.selectCollection(c.id, c.name).catch(() => undefined);
                          }}
                        >
                          <span className={`chevron ${isCollapsed ? '' : 'open'}`}>
                            <ChevronIcon size={12} />
                          </span>
                          <span className="name">{c.name}</span>
                          {c.has_auth && <span className="vis-badge auth-badge">AUTH</span>}
                        </button>
                        <div className="tree-collection-actions">
                          <button
                            type="button"
                            className="icon-button"
                            title="Auth provider"
                            aria-label={`Auth settings for ${c.name}`}
                            data-testid={`auth-settings-${c.name}`}
                            onClick={() => onOpenAuth(c.id)}
                          >
                            <KeyIcon size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title="New API request"
                            aria-label={`New request in ${c.name}`}
                            data-testid={`new-request-${c.name}`}
                            onClick={() => openCreate('request', c.id)}
                          >
                            <PlusIcon size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-button danger"
                            title="Delete collection"
                            aria-label={`Delete collection ${c.name}`}
                            data-testid={`delete-collection-${c.name}`}
                            onClick={() => {
                              if (window.confirm(`Delete collection "${c.name}" and all of its requests?`)) {
                                ws.deleteCollection(c.id).catch((err) =>
                                  alert(err instanceof Error ? err.message : 'Failed to delete collection')
                                );
                              }
                            }}
                          >
                            <TrashIcon size={13} />
                          </button>
                        </div>
                      </div>
                      {!isCollapsed && requests.length > 0 && (
                        <div className="tree-collection-children">
                          <ul className="sidebar-list">
                            {requests.map((r) => (
                              <li key={r.id} className="sidebar-row">
                                <button
                                  type="button"
                                  className={`sidebar-item sidebar-item-indent ${ws.activeRequest?.id === r.id ? 'active' : ''}`}
                                  data-testid={`sidebar-request-${r.name}`}
                                  onClick={() => onSelectRequest(r.id)}
                                >
                                  <span className={`method-badge method-${r.method}`}>{r.method}</span>
                                  <span className="sidebar-item-name">{r.name}</span>
                                  {r.api_type !== 'REST' && (
                                    <span className="vis-badge api-type-badge">{r.api_type}</span>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className="icon-button danger"
                                  title="Delete request"
                                  aria-label={`Delete request ${r.name}`}
                                  data-testid={`delete-request-${r.name}`}
                                  onClick={() => {
                                    if (window.confirm(`Delete request "${r.name}"?`)) {
                                      ws.deleteRequest(r.id).catch((err) =>
                                        alert(err instanceof Error ? err.message : 'Failed to delete request')
                                      );
                                    }
                                  }}
                                >
                                  <TrashIcon size={13} />
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {!isCollapsed && requests.length === 0 && (
                        <p className="hint" style={{ padding: '4px 8px 6px 30px' }}>
                          No requests yet.
                        </p>
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
          {ws.tree.collections.length === 0 && <p className="hint">No collections yet.</p>}
        </div>
      )}

      {createKind && (
        <CreateModal
          kind={createKind}
          collectionId={targetCollectionId ?? undefined}
          onClose={() => setCreateKind(null)}
        />
      )}
      {requestingProject && (
        <div className="modal-overlay" data-testid="access-request-modal" onClick={() => setRequestingProject(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Request access</h2>
            </div>
            <div className="modal-body">
              <p className="hint">
                Request access to <strong>{requestingProject.name}</strong>. A project manager or admin
                will review your request.
              </p>
              <div className="modal-form">
                <label className="field">
                  <span className="field-label">Reason (optional)</span>
                  <textarea
                    className="text-input"
                    data-testid="access-request-reason"
                    rows={3}
                    placeholder="e.g. I need to view the mocked APIs for the payments team"
                    value={accessReason}
                    onChange={(e) => setAccessReason(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost-button" data-testid="access-request-cancel" onClick={() => setRequestingProject(null)}>
                Cancel
              </button>
              <button type="button" className="primary-button" data-testid="access-request-confirm" onClick={submitAccessRequest}>
                Request access
              </button>
            </div>
          </div>
        </div>
      )}
      <SharingModal open={sharingOpen} onClose={() => setSharingOpen(false)} />
      <TeamsModal open={teamsOpen} onClose={() => setTeamsOpen(false)} />
      <AuthProviderModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </aside>
  );
}

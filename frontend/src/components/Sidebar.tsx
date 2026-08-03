'use client';

import React, { useState } from 'react';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useApp } from '@/store/AppStore';
import { CreateModal, type CreateKind } from './CreateModal';
import { SharingModal } from './SharingModal';
import { TeamsModal } from './TeamsModal';
import { AuthProviderModal } from './AuthProviderModal';

export function Sidebar() {
  const ws = useWorkspace();
  const { dispatch } = useApp();
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [targetCollectionId, setTargetCollectionId] = useState<string | null>(null);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authCollectionId, setAuthCollectionId] = useState<string | null>(null);

  const openCreate = (kind: CreateKind, collectionId?: string) => {
    setTargetCollectionId(collectionId ?? null);
    setCreateKind(kind);
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
            +
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
                <span className="sidebar-item-name">{w.name}</span>
                <span className={`vis-badge vis-${w.visibility.toLowerCase()}`}>{w.visibility}</span>
              </button>
              <button
                type="button"
                className="icon-button"
                title="Delete workspace"
                aria-label={`Delete workspace ${w.name}`}
                data-testid={`delete-workspace-${w.name}`}
                onClick={() => {
                  if (window.confirm(`Delete workspace "${w.name}"? This removes all of its projects, collections and requests.`)) {
                    ws.deleteWorkspace(w.id).catch((err) => alert(err instanceof Error ? err.message : 'Failed to delete workspace'));
                  }
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-head">
          <h3>Teams</h3>
          <button type="button" className="icon-button" aria-label="Manage teams" title="Manage teams" data-testid="manage-teams" onClick={() => setTeamsOpen(true)}>
            +
          </button>
        </div>
        <ul className="sidebar-list">
          {ws.teams.map((t) => (
            <li key={t.id} className="sidebar-static-item">
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
              +
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
              <div className="tree-project-name">{p.name}</div>
              {ws.tree!.collections
                .filter((c) => c.project_id === p.id)
                .map((c) => (
                  <div key={c.id} className="tree-collection">
                    <button
                      type="button"
                      className={`tree-collection-name ${ws.activeCollectionId === c.id ? 'active' : ''}`}
                      data-testid={`collection-${c.name}`}
                      onClick={() => ws.selectCollection(c.id, c.name).catch(() => undefined)}
                    >
                      <span>{c.name}</span>
                      {c.has_auth && <span className="vis-badge auth-badge">AUTH</span>}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title="Auth provider"
                      data-testid={`auth-settings-${c.name}`}
                      onClick={() => onOpenAuth(c.id)}
                    >
                      key
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title="New API request"
                      data-testid={`new-request-${c.name}`}
                      onClick={() => openCreate('request', c.id)}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      title="Delete collection"
                      aria-label={`Delete collection ${c.name}`}
                      data-testid={`delete-collection-${c.name}`}
                      onClick={() => {
                        if (window.confirm(`Delete collection "${c.name}" and all of its requests?`)) {
                          ws.deleteCollection(c.id).catch((err) => alert(err instanceof Error ? err.message : 'Failed to delete collection'));
                        }
                      }}
                    >
                      ×
                    </button>
                    <ul className="sidebar-list">
                      {ws.tree!.requests
                        .filter((r) => r.collection_id === c.id)
                        .map((r) => (
                          <li key={r.id} className="sidebar-row">
                            <button
                              type="button"
                              className={`sidebar-item sidebar-item-indent ${ws.activeRequest?.id === r.id ? 'active' : ''}`}
                              data-testid={`sidebar-request-${r.name}`}
                              onClick={() => onSelectRequest(r.id)}
                            >
                              <span className={`method-badge method-${r.method}`}>{r.method}</span>
                              <span className="sidebar-item-name">{r.name}</span>
                              {r.api_type !== 'REST' && <span className="vis-badge api-type-badge">{r.api_type}</span>}
                            </button>
                            <button
                              type="button"
                              className="icon-button danger"
                              title="Delete request"
                              aria-label={`Delete request ${r.name}`}
                              data-testid={`delete-request-${r.name}`}
                              onClick={() => {
                                if (window.confirm(`Delete request "${r.name}"?`)) {
                                  ws.deleteRequest(r.id).catch((err) => alert(err instanceof Error ? err.message : 'Failed to delete request'));
                                }
                              }}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
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
      <SharingModal open={sharingOpen} onClose={() => setSharingOpen(false)} />
      <TeamsModal open={teamsOpen} onClose={() => setTeamsOpen(false)} />
      <AuthProviderModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </aside>
  );
}

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useApp } from '@/store/AppStore';
import { useNav } from '@/store/NavStore';
import { useAuth } from '@/lib/auth';
import { accessRequestApi } from '@/lib/api';
import type { ApiType } from '@/lib/types';
import { CreateModal, type CreateKind } from './CreateModal';
import { SharingModal } from './SharingModal';
import { TeamsModal } from './TeamsModal';
import { AuthProviderModal } from './AuthProviderModal';
import { CollectionRunnerModal } from './CollectionRunnerModal';
import { EnvironmentsModal } from './EnvironmentsModal';
import { MockServersModal } from './MockServersModal';
import { CollectionImportExportModal } from './CollectionImportExportModal';
import { MoveModal } from './MoveModal';
import {
  WorkspaceIcon,
  TeamIcon,
  CollectionIcon,
  FolderIcon,
  KeyIcon,
  PlusIcon,
  TrashIcon,
  ChevronIcon,
  LockIcon,
  BoltIcon,
  ShieldIcon,
  UserIcon,
  HistoryIcon,
  PlayIcon,
  ServerIcon,
  ImportIcon,
  MoveIcon,
  SaveIcon,
  RequestIcon,
} from './icons';

type RailTab = 'apis' | 'teams';

function WorkspaceChips({ onOpenCreate, onNavigate }: { onOpenCreate: (kind: CreateKind) => void; onNavigate: () => void }) {
  const ws = useWorkspace();
  return (
    <div className="workspace-chips" data-testid="workspace-chips">
      {ws.workspaces.map((w) => (
        <div key={w.id} className="workspace-chip-wrap">
          <button
            type="button"
            className={`workspace-chip ${ws.activeWorkspaceId === w.id ? 'active' : ''}`}
            data-testid={`workspace-${w.name}`}
            title={w.name}
            onClick={() => {
              ws.selectWorkspace(w.id).catch(() => undefined);
              onNavigate();
            }}
          >
            <span className="workspace-chip-icon">
              <WorkspaceIcon size={12} />
            </span>
            <span className="workspace-chip-name">{w.name}</span>
            <span className={`vis-dot vis-${w.visibility.toLowerCase()}`} title={`${w.visibility} visibility`} />
          </button>
          <button
            type="button"
            className="icon-button danger workspace-chip-delete"
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
            <TrashIcon size={12} />
          </button>
        </div>
      ))}
      {ws.workspaces.length === 0 && !ws.loading && <p className="hint">No workspaces yet.</p>}
      {ws.workspaces.length > 0 && (
        <button
          type="button"
          className="workspace-chip new"
          title="New workspace"
          aria-label="New workspace"
          data-testid="new-workspace"
          onClick={() => onOpenCreate('workspace')}
        >
          <PlusIcon size={12} />
        </button>
      )}
    </div>
  );
}

type TreeFolder = { id: string; collection_id: string; parent_id: string | null; name: string };
type TreeRequest = {
  id: string;
  name: string;
  method: string;
  url: string;
  api_type: ApiType;
  collection_id: string;
  folder_id: string | null;
};

function RequestRow({
  r,
  active,
  depth,
  onSelect,
  onDelete,
  onMove,
}: {
  r: TreeRequest;
  active: boolean;
  depth: number;
  onSelect: (id: string) => void;
  onDelete: (r: TreeRequest) => void;
  onMove: (r: TreeRequest) => void;
}) {
  return (
    <li className="sidebar-row">
      <button
        type="button"
        className={`sidebar-item sidebar-item-indent ${active ? 'active' : ''}`}
        data-testid={`sidebar-request-${r.name}`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={() => onSelect(r.id)}
      >
        <span className={`method-badge method-${r.method}`}>{r.method}</span>
        <span className="sidebar-item-name">{r.name}</span>
        {r.api_type !== 'REST' && <span className="vis-badge api-type-badge">{r.api_type}</span>}
      </button>
      <button
        type="button"
        className="icon-button"
        title="Move to folder"
        aria-label={`Move request ${r.name}`}
        data-testid={`move-request-${r.name}`}
        onClick={() => onMove(r)}
      >
        <MoveIcon size={13} />
      </button>
      <button
        type="button"
        className="icon-button danger"
        title="Delete request"
        aria-label={`Delete request ${r.name}`}
        data-testid={`delete-request-${r.name}`}
        onClick={() => onDelete(r)}
      >
        <TrashIcon size={13} />
      </button>
    </li>
  );
}

function FolderNode({
  folder,
  depth,
  collapsed,
  activeRequestId,
  onToggle,
  onSelect,
  onDeleteRequest,
  onMoveRequest,
  onOpenCreate,
  onRename,
  onDeleteFolder,
  onMoveFolder,
  requests,
  folders,
}: {
  folder: TreeFolder;
  depth: number;
  collapsed: Record<string, boolean>;
  activeRequestId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onDeleteRequest: (r: TreeRequest) => void;
  onMoveRequest: (r: TreeRequest) => void;
  onOpenCreate: (kind: CreateKind, collectionId: string, folderId: string) => void;
  onRename: (folder: TreeFolder) => void;
  onDeleteFolder: (folder: TreeFolder) => void;
  onMoveFolder: (folder: TreeFolder) => void;
  requests: TreeRequest[];
  folders: TreeFolder[];
}) {
  const isCollapsed = !!collapsed[folder.id];
  const childFolders = folders.filter((f) => f.parent_id === folder.id);
  const childRequests = requests.filter((r) => r.folder_id === folder.id);
  const hasChildren = childFolders.length > 0 || childRequests.length > 0;

  return (
    <div className="tree-folder">
      <div className="tree-folder-row">
        <button
          type="button"
          className={`tree-folder-name`}
          data-testid={`folder-${folder.name}`}
          onClick={() => onToggle(folder.id)}
        >
          <span className={`chevron ${isCollapsed ? '' : 'open'}`}>
            <ChevronIcon size={12} />
          </span>
          <span className="folder-chevron-spacer" />
          <span className="folder-icon">
            <FolderIcon size={13} />
          </span>
          <span className="name">{folder.name}</span>
        </button>
        <div className="tree-folder-actions">
          <button
            type="button"
            className="icon-button"
            title="New subfolder"
            aria-label={`New subfolder in ${folder.name}`}
            data-testid={`new-subfolder-${folder.name}`}
            onClick={() => onOpenCreate('folder', folder.collection_id, folder.id)}
          >
            <PlusIcon size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="New API request in folder"
            aria-label={`New request in ${folder.name}`}
            data-testid={`new-request-folder-${folder.name}`}
            onClick={() => onOpenCreate('request', folder.collection_id, folder.id)}
          >
            <RequestIcon size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Move folder"
            aria-label={`Move folder ${folder.name}`}
            data-testid={`move-folder-${folder.name}`}
            onClick={() => onMoveFolder(folder)}
          >
            <MoveIcon size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Rename folder"
            aria-label={`Rename folder ${folder.name}`}
            data-testid={`rename-folder-${folder.name}`}
            onClick={() => onRename(folder)}
          >
            <SaveIcon size={13} />
          </button>
          <button
            type="button"
            className="icon-button danger"
            title="Delete folder"
            aria-label={`Delete folder ${folder.name}`}
            data-testid={`delete-folder-${folder.name}`}
            onClick={() => onDeleteFolder(folder)}
          >
            <TrashIcon size={13} />
          </button>
        </div>
      </div>
      {!isCollapsed && hasChildren && (
        <div className="tree-folder-children">
          {childFolders.map((f) => (
            <FolderNode
              key={f.id}
              folder={f}
              depth={depth + 1}
              collapsed={collapsed}
              activeRequestId={activeRequestId}
              onToggle={onToggle}
              onSelect={onSelect}
              onDeleteRequest={onDeleteRequest}
              onMoveRequest={onMoveRequest}
              onOpenCreate={onOpenCreate}
              onRename={onRename}
              onDeleteFolder={onDeleteFolder}
              onMoveFolder={onMoveFolder}
              requests={requests}
              folders={folders}
            />
          ))}
          <ul className="sidebar-list">
            {childRequests.map((r) => (
              <RequestRow
                key={r.id}
                r={r}
                active={activeRequestId === r.id}
                depth={depth + 1}
                onSelect={onSelect}
                onDelete={onDeleteRequest}
                onMove={onMoveRequest}
              />
            ))}
          </ul>
        </div>
      )}
      {!isCollapsed && !hasChildren && (
        <p className="hint" style={{ padding: '4px 8px 6px 48px' }}>
          Empty folder.
        </p>
      )}
    </div>
  );
}

function CollectionsTree({ onOpenCreate, onOpenSharing, onOpenAuth, onRequestAccess, onNavigate, onRunCollection, onOpenMockServer, onOpenImportExport, onRenameFolder, onMoveRequest, onMoveFolder, onDeleteFolder }: {
  onOpenCreate: (kind: CreateKind, collectionId?: string, folderId?: string) => void;
  onOpenSharing: () => void;
  onOpenAuth: (collectionId: string) => void;
  onRequestAccess: (project: { id: string; name: string }) => void;
  onNavigate: () => void;
  onRunCollection: (collectionId: string, collectionName: string) => void;
  onOpenMockServer: (project: { id: string; name: string }) => void;
  onOpenImportExport: () => void;
  onRenameFolder: (folder: TreeFolder) => void;
  onMoveRequest: (r: TreeRequest) => void;
  onMoveFolder: (folder: TreeFolder) => void;
  onDeleteFolder: (folder: TreeFolder) => void;
}) {
  const ws = useWorkspace();
  const { dispatch } = useApp();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const onSelectRequest = (id: string) => {
    dispatch({ type: 'SELECT_REQUEST', id });
    ws.selectRequest(id).catch(() => undefined);
    onNavigate();
  };

  if (!ws.tree) return null;

  const deleteRequest = (r: TreeRequest) => {
    if (window.confirm(`Delete request "${r.name}"?`)) {
      ws.deleteRequest(r.id).catch((err) =>
        alert(err instanceof Error ? err.message : 'Failed to delete request')
      );
    }
  };

  return (
    <div className="sidebar-section tree-section">
      <div className="sidebar-section-head">
        <h3>Collections</h3>
        <button
          type="button"
          className="icon-button"
          aria-label="Import / export collections"
          title="Import / export collections"
          data-testid="open-import-export"
          onClick={onOpenImportExport}
        >
          <ImportIcon size={14} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="New collection"
          title="New collection"
          data-testid="new-collection"
          onClick={() => onOpenCreate('collection')}
        >
          <PlusIcon size={14} />
        </button>
        <button
          type="button"
          className="ghost-button small"
          title="Share workspace"
          data-testid="share-workspace"
          onClick={onOpenSharing}
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
            {p.can_access && (
              <button
                type="button"
                className="icon-button tree-project-mock"
                title={`Mock server for ${p.name}`}
                aria-label={`Mock server for ${p.name}`}
                data-testid={`mock-server-${p.name}`}
                onClick={() => onOpenMockServer({ id: p.id, name: p.name })}
              >
                <ServerIcon size={12} />
              </button>
            )}
          </div>
          {!p.can_access && p.access_status !== 'PENDING' && (
            <button
              type="button"
              className="ghost-button small access-request-btn"
              data-testid={`request-access-${p.name}`}
              onClick={() => onRequestAccess({ id: p.id, name: p.name })}
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
              const rootFolders = ws.tree!.folders.filter(
                (f) => f.collection_id === c.id && f.parent_id === null
              );
              const rootRequests = ws.tree!.requests.filter(
                (r) => r.collection_id === c.id && r.folder_id === null
              );
              return (
                <div key={c.id} className="tree-collection">
                  <div className="tree-collection-row">
                    <button
                      type="button"
                      className={`tree-collection-name ${ws.activeCollectionId === c.id ? 'active' : ''}`}
                      data-testid={`collection-${c.name}`}
                      onClick={() => {
                        toggle(c.id);
                        ws.selectCollection(c.id, c.name).catch(() => undefined);
                        onNavigate();
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
                        title="New folder"
                        aria-label={`New folder in ${c.name}`}
                        data-testid={`new-folder-${c.name}`}
                        onClick={() => onOpenCreate('folder', c.id)}
                      >
                        <FolderIcon size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        title="Run collection"
                        aria-label={`Run collection ${c.name}`}
                        data-testid={`run-collection-${c.name}`}
                        onClick={() => onRunCollection(c.id, c.name)}
                      >
                        <PlayIcon size={13} />
                      </button>
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
                        onClick={() => onOpenCreate('request', c.id)}
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
                  {!isCollapsed && (
                    <div className="tree-collection-children">
                      {rootFolders.map((f) => (
                        <FolderNode
                          key={f.id}
                          folder={f}
                          depth={0}
                          collapsed={collapsed}
                          activeRequestId={ws.activeRequest?.id ?? null}
                          onToggle={toggle}
                          onSelect={onSelectRequest}
                          onDeleteRequest={deleteRequest}
                          onMoveRequest={onMoveRequest}
                          onOpenCreate={onOpenCreate}
                          onRename={onRenameFolder}
                          onDeleteFolder={onDeleteFolder}
                          onMoveFolder={onMoveFolder}
                          requests={ws.tree!.requests}
                          folders={ws.tree!.folders}
                        />
                      ))}
                      {rootRequests.length > 0 && (
                        <ul className="sidebar-list">
                          {rootRequests.map((r) => (
                            <RequestRow
                              key={r.id}
                              r={r}
                              active={ws.activeRequest?.id === r.id}
                              depth={0}
                              onSelect={onSelectRequest}
                              onDelete={deleteRequest}
                              onMove={onMoveRequest}
                            />
                          ))}
                        </ul>
                      )}
                      {rootFolders.length === 0 && rootRequests.length === 0 && (
                        <p className="hint" style={{ padding: '4px 8px 6px 30px' }}>
                          No requests yet.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      ))}
      {ws.tree.collections.length === 0 && <p className="hint">No collections yet.</p>}
    </div>
  );
}

function TeamsPanel({ onManage }: { onManage: () => void }) {
  const ws = useWorkspace();
  return (
    <div className="sidebar-section">
      <div className="sidebar-section-head">
        <h3>Teams</h3>
        <button
          type="button"
          className="icon-button"
          aria-label="Manage teams"
          title="Manage teams"
          data-testid="manage-teams"
          onClick={onManage}
        >
          <PlusIcon size={14} />
        </button>
      </div>
      {ws.loading && <p className="hint">Loading…</p>}
      {ws.error && <p className="auth-error">{ws.error}</p>}
      <ul className="sidebar-list team-list">
        {ws.teams.map((t) => (
          <li key={t.id} className="team-card">
            <div className="team-card-row">
              <span className="team-avatar">
                <TeamIcon size={14} />
              </span>
              <span className="team-card-name">{t.name}</span>
              <span className="vis-badge team-count" title={`${t.members.length} members`}>
                {t.members.length}
              </span>
            </div>
            <div className="team-card-members">
              {t.members.slice(0, 5).map((m) => (
                <span key={m.id} className="member-chip" title={m.name || m.email}>
                  {(m.name || m.email || '?').charAt(0).toUpperCase()}
                </span>
              ))}
              {t.members.length > 5 && (
                <span className="member-chip more" title={`${t.members.length - 5} more members`}>
                  +{t.members.length - 5}
                </span>
              )}
            </div>
          </li>
        ))}
        {!ws.loading && ws.teams.length === 0 && (
          <p className="hint">No teams yet. Create one to invite collaborators.</p>
        )}
      </ul>
      <button
        type="button"
        className="ghost-button full"
        data-testid="manage-teams-link"
        onClick={onManage}
      >
        <TeamIcon size={13} />
        Manage teams
      </button>
    </div>
  );
}

export function Sidebar({ panelHidden = false }: { panelHidden?: boolean }) {
  const ws = useWorkspace();
  const { user } = useAuth();
  const { dispatch } = useApp();
  const { setView } = useNav();
  const router = useRouter();
  const [rail, setRail] = useState<RailTab>('apis');
  const [collapsed, setCollapsed] = useState(false);
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [targetCollectionId, setTargetCollectionId] = useState<string | null>(null);
  const [createFolderId, setCreateFolderId] = useState<string | null>(null);
  const [renameFolderTarget, setRenameFolderTarget] = useState<{ folderId: string; name: string; collectionId: string } | null>(null);
  const [moveRequestTarget, setMoveRequestTarget] = useState<TreeRequest | null>(null);
  const [moveFolderTarget, setMoveFolderTarget] = useState<TreeFolder | null>(null);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authCollectionId, setAuthCollectionId] = useState<string | null>(null);
  const [environmentsOpen, setEnvironmentsOpen] = useState(false);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [runnerCollectionName, setRunnerCollectionName] = useState('');
  const [mockProject, setMockProject] = useState<{ id: string; name: string } | null>(null);
  const [requestingProject, setRequestingProject] = useState<{ id: string; name: string } | null>(null);
  const [accessReason, setAccessReason] = useState('');
  const [importExportOpen, setImportExportOpen] = useState(false);

  const openCreate = (kind: CreateKind, collectionId?: string, folderId?: string) => {
    setTargetCollectionId(collectionId ?? null);
    setCreateFolderId(folderId ?? null);
    setCreateKind(kind);
  };

  const goWorkspace = () => {
    setView('workspace');
    // Always navigate to '/' — never skip based on usePathname(), which can be
    // stale while a /manage|/admin|/automations navigation is still in flight.
    // If we skipped, the in-flight navigation would complete afterwards and
    // RouteViewSync would snap the view back to the admin page.
    router.push('/');
  };

  const railHidden = panelHidden || collapsed;

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

  const onOpenAuth = async (collectionId: string) => {
    await ws.selectCollection(collectionId, ws.tree?.collections.find((c) => c.id === collectionId)?.name ?? '');
    setAuthCollectionId(collectionId);
    setAuthOpen(true);
    goWorkspace();
  };

  const onRunCollection = async (collectionId: string, collectionName: string) => {
    setRunnerCollectionName(collectionName);
    setRunnerOpen(true);
    try {
      await ws.runCollection(collectionId);
    } catch (err) {
      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Collection run failed' });
      setRunnerOpen(false);
    }
  };

  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  return (
    <aside className={`sidebar ${railHidden ? 'sidebar-rail-only' : ''}`} data-testid="sidebar">
      <nav className="rail" aria-label="Sidebar navigation">
        <button
          type="button"
          className={`rail-button ${rail === 'apis' ? 'active' : ''}`}
          data-testid="rail-apis"
          title="APIs & collections"
          aria-label="APIs & collections"
          onClick={() => {
            setRail('apis');
            setCollapsed(false);
            goWorkspace();
          }}
        >
          <CollectionIcon size={17} />
        </button>
        <button
          type="button"
          className={`rail-button ${rail === 'teams' ? 'active' : ''}`}
          data-testid="rail-teams"
          title="Teams"
          aria-label="Teams"
          onClick={() => {
            setRail('teams');
            setCollapsed(false);
          }}
        >
          <TeamIcon size={17} />
        </button>
        <div className="rail-sep" />
        <Link
          href="/automations"
          className="rail-button"
          data-testid="rail-automations"
          title="Automations"
          aria-label="Automations"
          onClick={() => setView('automations')}
        >
          <BoltIcon size={17} />
        </Link>
        <Link
          href="/history"
          className="rail-button"
          data-testid="rail-history"
          title="Run history"
          aria-label="Run history"
          onClick={() => setView('history')}
        >
          <HistoryIcon size={17} />
        </Link>
        {canManage && (
          <Link
            href="/manage"
            className="rail-button"
            data-testid="rail-manage"
            title="Manage"
            aria-label="Manage"
            onClick={() => setView('manage')}
          >
            <ShieldIcon size={17} />
          </Link>
        )}
        {user?.role === 'ADMIN' && (
          <Link
            href="/admin"
            className="rail-button"
            data-testid="rail-admin"
            title="Admin"
            aria-label="Admin"
            onClick={() => setView('admin')}
          >
            <UserIcon size={17} />
          </Link>
        )}
        <div className="rail-spacer" />
        <button
          type="button"
          className={`rail-button rail-toggle ${collapsed ? 'is-collapsed' : ''}`}
          data-testid="sidebar-toggle"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setCollapsed((v) => !v)}
        >
          <ChevronIcon size={15} />
        </button>
      </nav>

      <div className={`sidebar-panel ${railHidden ? 'sidebar-panel-hidden' : ''}`}>
        {rail === 'apis' ? (
          <>
            <div className="sidebar-section">
              <div className="sidebar-section-head">
                <h3>Workspaces</h3>
                <button
                  type="button"
                  className="ghost-button small"
                  title="Environments & variables"
                  data-testid="environments-open"
                  onClick={() => setEnvironmentsOpen(true)}
                >
                  Env
                </button>
              </div>
              {ws.loading && <p className="hint">Loading…</p>}
              {ws.error && <p className="auth-error">{ws.error}</p>}
              <WorkspaceChips onOpenCreate={openCreate} onNavigate={goWorkspace} />
            </div>

            {ws.tree && ws.activeWorkspaceId ? (
              <CollectionsTree
                onOpenCreate={openCreate}
                onOpenSharing={() => setSharingOpen(true)}
                onOpenAuth={onOpenAuth}
                onRequestAccess={(p) => setRequestingProject(p)}
                onNavigate={goWorkspace}
                onRunCollection={onRunCollection}
                onOpenMockServer={(p) => setMockProject(p)}
                onOpenImportExport={() => setImportExportOpen(true)}
                onRenameFolder={(f) => setRenameFolderTarget({ folderId: f.id, name: f.name, collectionId: f.collection_id })}
                onMoveRequest={(r) => setMoveRequestTarget(r)}
                onMoveFolder={(f) => setMoveFolderTarget(f)}
                onDeleteFolder={(f) => {
                  if (window.confirm(`Delete folder "${f.name}" and all of its subfolders? Requests inside will move to the collection root.`)) {
                    ws.deleteFolder(f.id).catch((err) =>
                      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Failed to delete folder' })
                    );
                  }
                }}
              />
            ) : (
              !ws.loading && (
                <div className="empty-state" data-testid="empty-state">
                  <CollectionIcon size={20} />
                  <p>Select a workspace to browse its collections.</p>
                  <button
                    type="button"
                    className="primary-button small"
                    data-testid="empty-new-workspace"
                    onClick={() => openCreate('workspace')}
                  >
                    <PlusIcon size={13} />
                    New workspace
                  </button>
                </div>
              )
            )}
          </>
        ) : (
          <TeamsPanel onManage={() => setTeamsOpen(true)} />
        )}
      </div>

      {createKind && (
        <CreateModal
          kind={createKind}
          collectionId={targetCollectionId ?? undefined}
          parentFolderId={createFolderId ?? undefined}
          renameTarget={renameFolderTarget}
          onClose={() => {
            setCreateKind(null);
            setRenameFolderTarget(null);
          }}
        />
      )}
      {moveRequestTarget && (
        <MoveModal
          title="Move request"
          collectionId={moveRequestTarget.collection_id}
          onSelect={(target) => {
            const folderId = 'folderId' in target ? target.folderId : null;
            ws.moveRequest(moveRequestTarget.id, folderId).then(
              () => {
                setMoveRequestTarget(null);
                dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Request moved.' });
              },
              (err) => dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Failed to move request' })
            );
          }}
          onClose={() => setMoveRequestTarget(null)}
        />
      )}
      {moveFolderTarget && (
        <MoveModal
          title="Move folder"
          collectionId={moveFolderTarget.collection_id}
          excludeFolderId={moveFolderTarget.id}
          onSelect={(target) => {
            const parentId = 'folderId' in target ? target.folderId : null;
            ws.moveFolder(moveFolderTarget.id, parentId).then(
              () => {
                setMoveFolderTarget(null);
                dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Folder moved.' });
              },
              (err) => dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Failed to move folder' })
            );
          }}
          onClose={() => setMoveFolderTarget(null)}
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
      <EnvironmentsModal open={environmentsOpen} onClose={() => setEnvironmentsOpen(false)} />
      <AuthProviderModal open={authOpen} onClose={() => setAuthOpen(false)} />
      {mockProject && (
        <MockServersModal
          open
          projectId={mockProject.id}
          projectName={mockProject.name}
          onClose={() => setMockProject(null)}
        />
      )}
      <CollectionRunnerModal
        open={runnerOpen}
        running={ws.collectionRunRunning}
        collectionName={runnerCollectionName}
        result={ws.collectionRun}
        onClose={() => {
          setRunnerOpen(false);
          ws.clearCollectionRun();
        }}
      />
      <CollectionImportExportModal open={importExportOpen} onClose={() => setImportExportOpen(false)} />
    </aside>
  );
}

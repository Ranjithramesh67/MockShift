'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useApp } from '@/store/AppStore';
import { useNav } from '@/store/NavStore';
import { useAuth } from '@/lib/auth';
import { useTreeRenameShortcut } from './useTreeRenameShortcut';
import { accessRequestApi } from '@/lib/api';
import { CreateModal, type CreateKind } from './CreateModal';
import { SharingModal } from './SharingModal';
import { TeamsModal } from './TeamsModal';
import { AuthProviderModal } from './AuthProviderModal';
import { CollectionRunnerModal } from './CollectionRunnerModal';
import { EnvironmentsModal } from './EnvironmentsModal';
import { MockServersModal } from './MockServersModal';
import { CollectionImportExportModal } from './CollectionImportExportModal';
import {
  WorkspaceIcon,
  TeamIcon,
  CollectionIcon,
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
  FolderIcon,
  PencilIcon,
  DotsIcon,
  RequestIcon,
  CopyIcon,
} from './icons';

type RailTab = 'apis' | 'teams';

const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 560;
const SIDEBAR_DEFAULT_WIDTH = 296;
const SIDEBAR_WIDTH_KEY = 'apihub.sidebarWidth';

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

function CollectionsTree({ onOpenCreate, onOpenSharing, onOpenAuth, onRequestAccess, onNavigate, onRunCollection, onOpenMockServer, onOpenImportExport }: {
  onOpenCreate: (kind: CreateKind, collectionId?: string, folderId?: string) => void;
  onOpenSharing: () => void;
  onOpenAuth: (collectionId: string) => void;
  onRequestAccess: (project: { id: string; name: string }) => void;
  onNavigate: () => void;
  onRunCollection: (collectionId: string, collectionName: string) => void;
  onOpenMockServer: (project: { id: string; name: string }) => void;
  onOpenImportExport: () => void;
}) {
  const ws = useWorkspace();
  const { dispatch } = useApp();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<{ kind: 'request' | 'folder'; id: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<{ kind: 'request' | 'folder'; id: string } | null>(null);

  // M11: Ctrl/Cmd+C duplicates the currently selected request or folder.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selectedRow) return;
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 'c' && e.key !== 'C')) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      e.preventDefault();
      const row =
        ws.tree?.requests.find((r) => r.id === selectedRow.id) ??
        ws.tree?.folders.find((f) => f.id === selectedRow.id);
      const name = row?.name;
      const action =
        selectedRow.kind === 'request'
          ? ws.duplicateRequest(selectedRow.id)
          : ws.duplicateFolder(selectedRow.id);
      action
        .then(() => {
          if (name) dispatch({ type: 'SHOW_TOAST', kind: 'success', message: `Duplicated "${name}"` });
        })
        .catch((err) => {
          dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Duplicate failed' });
        });
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [selectedRow, ws, dispatch]);

  const toggle = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const onSelectRequest = (id: string) => {
    dispatch({ type: 'SELECT_REQUEST', id });
    ws.selectRequest(id).catch(() => undefined);
    onNavigate();
  };

  const startRename = (kind: 'request' | 'folder', id: string, name: string) => {
    setMenuFor(null);
    setRenaming({ kind, id });
    setRenameValue(name);
  };

  // M12: F2 on the selected row starts its inline rename.
  useTreeRenameShortcut({ selectedRow, tree: ws.tree, onStartRename: startRename });

  const commitRename = async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    setRenaming(null);
    if (!name) return;
    try {
      if (renaming.kind === 'request') {
        await ws.renameRequest(renaming.id, name);
      } else {
        await ws.renameFolder(renaming.id, name);
      }
    } catch (err) {
      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Rename failed' });
    }
  };

  const deleteRequest = (id: string, name: string) => {
    if (window.confirm(`Delete request "${name}"?`)) {
      ws.deleteRequest(id).catch((err) =>
        alert(err instanceof Error ? err.message : 'Failed to delete request')
      );
    }
  };

  const deleteFolder = (id: string, name: string) => {
    if (
      window.confirm(
        `Delete folder "${name}" and its contents? Requests inside will be moved back to the collection root.`
      )
    ) {
      ws.deleteFolder(id).catch((err) =>
        alert(err instanceof Error ? err.message : 'Failed to delete folder')
      );
    }
  };

  if (!ws.tree) return null;

  const tree = ws.tree;

  // M10: native HTML5 drag-and-drop — request rows and folder rows are drag
  // sources; folder rows and collection roots are drop targets.
  const handleDragStart = (e: React.DragEvent, kind: 'request' | 'folder', id: string) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ kind, id }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, target: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(target);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDropTarget(null);
  };

  const handleDrop = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    try {
      const payload = JSON.parse(e.dataTransfer.getData('text/plain')) as { kind?: string; id?: string };
      if (!payload || typeof payload.id !== 'string') return;

      if (payload.kind === 'request') {
        const moved = tree.requests.find((r) => r.id === payload.id);
        ws.moveRequest(payload.id, folderId)
          .then(() => {
            dispatch({
              type: 'SHOW_TOAST',
              kind: 'success',
              message: moved ? `Moved "${moved.name}"` : 'Request moved',
            });
          })
          .catch((err) => {
            dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Move failed' });
          });
        return;
      }

      if (payload.kind === 'folder') {
        const dragged = tree.folders.find((f) => f.id === payload.id);
        if (!dragged) return;
        const descendantIds = new Set<string>();
        const collect = (parentId: string) => {
          for (const f of tree.folders) {
            if (f.parent_id === parentId && !descendantIds.has(f.id)) {
              descendantIds.add(f.id);
              collect(f.id);
            }
          }
        };
        collect(payload.id);
        const wouldCycle =
          folderId === payload.id ||
          (folderId !== null && descendantIds.has(folderId)) ||
          (folderId === null && dragged.parent_id == null);
        if (wouldCycle) {
          dispatch({
            type: 'SHOW_TOAST',
            kind: 'error',
            message: 'Cannot move a folder into itself or its subfolder',
          });
          return;
        }
        ws.moveFolder(payload.id, folderId)
          .then(() => {
            dispatch({
              type: 'SHOW_TOAST',
              kind: 'success',
              message: `Moved "${dragged.name}"`,
            });
          })
          .catch((err) => {
            dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Move failed' });
          });
        return;
      }
    } catch {
      // ignore malformed drag payload
    }
  };

  const renderRequest = (r: (typeof tree.requests)[number], collectionId: string) => {
    const isActive = ws.activeRequest?.id === r.id;
    const isRenaming = renaming?.kind === 'request' && renaming.id === r.id;
    const isSelected = selectedRow?.kind === 'request' && selectedRow.id === r.id;
    return (
      <li
        key={r.id}
        className={`sidebar-row ${isSelected ? 'selected' : ''}`}
        data-testid={`sidebar-row-${r.name}`}
        draggable={!isRenaming}
        onDragStart={(e) => handleDragStart(e, 'request', r.id)}
      >
        {isRenaming ? (
          <input
            type="text"
            className="tree-rename-input"
            autoFocus
            defaultValue={r.name}
            data-testid={`rename-input-${r.name}`}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(null);
            }}
            onBlur={commitRename}
          />
        ) : (
          <button
            type="button"
            className={`sidebar-item sidebar-item-indent ${isActive ? 'active' : ''}`}
            data-testid={`sidebar-request-${r.name}`}
            onClick={() => {
              setSelectedRow({ kind: 'request', id: r.id });
              onSelectRequest(r.id);
            }}
          >
            <span className={`method-badge method-${r.method}`}>{r.method}</span>
            <span className="sidebar-item-name">{r.name}</span>
            {r.api_type !== 'REST' && (
              <span className="vis-badge api-type-badge">{r.api_type}</span>
            )}
          </button>
        )}
        <div className="sidebar-row-actions">
          <button
            type="button"
            className="icon-button"
            title="Request options"
            aria-label={`Options for ${r.name}`}
            data-testid={`request-options-${r.name}`}
            onClick={() => setMenuFor(menuFor === r.id ? null : r.id)}
          >
            <DotsIcon size={13} />
          </button>
        </div>
        {menuFor === r.id && (
          <>
            <div className="tree-menu-backdrop" onClick={() => setMenuFor(null)} />
            <div className="tree-menu" data-testid={`request-menu-${r.name}`}>
              <button
                type="button"
                data-testid={`request-edit-${r.name}`}
                onClick={() => {
                  setMenuFor(null);
                  onSelectRequest(r.id);
                }}
              >
                <RequestIcon size={13} />
                Edit
              </button>
              <button
                type="button"
                data-testid={`request-rename-${r.name}`}
                onClick={() => startRename('request', r.id, r.name)}
              >
                <PencilIcon size={13} />
                Rename
              </button>
              <button
                type="button"
                data-testid={`request-duplicate-${r.name}`}
                onClick={() => {
                  setMenuFor(null);
                  ws.duplicateRequest(r.id)
                    .then(() =>
                      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: `Duplicated "${r.name}"` })
                    )
                    .catch((err) =>
                      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Duplicate failed' })
                    );
                }}
              >
                <CopyIcon size={13} />
                Duplicate
              </button>
              <button
                type="button"
                className="danger"
                data-testid={`request-delete-${r.name}`}
                onClick={() => {
                  setMenuFor(null);
                  deleteRequest(r.id, r.name);
                }}
              >
                <TrashIcon size={13} />
                Delete
              </button>
            </div>
          </>
        )}
      </li>
    );
  };

  const renderFolder = (folder: (typeof tree.folders)[number], collectionId: string) => {
    const isCollapsed = !!collapsed[folder.id];
    const isRenaming = renaming?.kind === 'folder' && renaming.id === folder.id;
    const subFolders = tree.folders.filter(
      (f) => f.collection_id === collectionId && f.parent_id === folder.id
    );
    const requests = tree.requests.filter(
      (r) => r.collection_id === collectionId && r.folder_id === folder.id
    );
    const hasChildren = subFolders.length > 0 || requests.length > 0;
    const isSelected = selectedRow?.kind === 'folder' && selectedRow.id === folder.id;
    const isDropTarget = dropTarget === `folder:${folder.id}`;
    return (
      <div key={folder.id} className="tree-folder">
        <div
          className={`tree-folder-row ${isSelected ? 'selected' : ''} ${isDropTarget ? 'tree-drop-target' : ''}`}
          draggable={!isRenaming}
          onDragStart={(e) => handleDragStart(e, 'folder', folder.id)}
          onDragOver={(e) => handleDragOver(e, `folder:${folder.id}`)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, folder.id)}
        >
          {isRenaming ? (
            <input
              type="text"
              className="tree-rename-input"
              autoFocus
              defaultValue={folder.name}
              data-testid={`rename-folder-input-${folder.name}`}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(null);
              }}
              onBlur={commitRename}
            />
          ) : (
            <button
              type="button"
              className="tree-folder-name"
              data-testid={`folder-${folder.name}`}
              onClick={() => {
                setSelectedRow({ kind: 'folder', id: folder.id });
                toggle(folder.id);
              }}
            >
              <span className={`chevron ${isCollapsed ? '' : 'open'}`}>
                <ChevronIcon size={11} />
              </span>
              <span className="tree-folder-icon">
                <FolderIcon size={13} />
              </span>
              <span className="name">{folder.name}</span>
              {!isCollapsed && hasChildren && <span className="folder-count">{requests.length}</span>}
            </button>
          )}
          <div className="tree-folder-actions">
            <button
              type="button"
              className="icon-button"
              title="New API request"
              aria-label={`New request in ${folder.name}`}
              data-testid={`new-request-folder-${folder.name}`}
              onClick={() => onOpenCreate('request', collectionId, folder.id)}
            >
              <PlusIcon size={12} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="New sub-folder"
              aria-label={`New sub-folder in ${folder.name}`}
              data-testid={`new-subfolder-${folder.name}`}
              onClick={() => onOpenCreate('folder', collectionId, folder.id)}
            >
              <FolderIcon size={12} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Rename folder"
              aria-label={`Rename folder ${folder.name}`}
              data-testid={`rename-folder-${folder.name}`}
              onClick={() => startRename('folder', folder.id, folder.name)}
            >
              <PencilIcon size={12} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Duplicate folder"
              aria-label={`Duplicate folder ${folder.name}`}
              data-testid={`duplicate-folder-${folder.name}`}
              onClick={() => {
                ws.duplicateFolder(folder.id)
                  .then(() =>
                    dispatch({ type: 'SHOW_TOAST', kind: 'success', message: `Duplicated "${folder.name}"` })
                  )
                  .catch((err) =>
                    dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Duplicate failed' })
                  );
              }}
            >
              <CopyIcon size={12} />
            </button>
            <button
              type="button"
              className="icon-button danger"
              title="Delete folder"
              aria-label={`Delete folder ${folder.name}`}
              data-testid={`delete-folder-${folder.name}`}
              onClick={() => deleteFolder(folder.id, folder.name)}
            >
              <TrashIcon size={12} />
            </button>
          </div>
        </div>
        {!isCollapsed && (
          <div
            className={`tree-folder-children ${isDropTarget ? 'tree-drop-target' : ''}`}
            onDragOver={(e) => handleDragOver(e, `folder:${folder.id}`)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, folder.id)}
          >
            {subFolders.map((f) => renderFolder(f, collectionId))}
            {requests.length > 0 && (
              <ul className="sidebar-list">
                {requests.map((r) => renderRequest(r, collectionId))}
              </ul>
            )}
            {!hasChildren && (
              <p className="hint" style={{ padding: '4px 8px 6px 30px' }}>
                Empty folder.
              </p>
            )}
          </div>
        )}
      </div>
    );
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
      {tree.projects.map((p) => (
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
          {tree.collections
            .filter((c) => c.project_id === p.id)
            .map((c) => {
              const isCollapsed = !!collapsed[c.id];
              const rootFolders = tree.folders.filter(
                (f) => f.collection_id === c.id && !f.parent_id
              );
              const rootRequests = tree.requests.filter(
                (r) => r.collection_id === c.id && !r.folder_id
              );
              return (
                <div key={c.id} className="tree-collection">
                  <div
                    className={`tree-collection-row ${dropTarget === `collection:${c.id}` ? 'tree-drop-target' : ''}`}
                    onDragOver={(e) => handleDragOver(e, `collection:${c.id}`)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, null)}
                  >
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
                  {!isCollapsed && (rootFolders.length > 0 || rootRequests.length > 0) && (
                    <div
                      className={`tree-collection-children ${dropTarget === `children:${c.id}` ? 'tree-drop-target' : ''}`}
                      onDragOver={(e) => handleDragOver(e, `children:${c.id}`)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, null)}
                    >
                      {rootFolders.map((f) => renderFolder(f, c.id))}
                      {rootRequests.length > 0 && (
                        <ul className="sidebar-list">
                          {rootRequests.map((r) => renderRequest(r, c.id))}
                        </ul>
                      )}
                    </div>
                  )}
                  {!isCollapsed && rootFolders.length === 0 && rootRequests.length === 0 && (
                    <p className="hint" style={{ padding: '4px 8px 6px 30px' }}>
                      No requests yet.
                    </p>
                  )}
                </div>
              );
            })}
        </div>
      ))}
      {tree.collections.length === 0 && <p className="hint">No collections yet.</p>}
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
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
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
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
    const saved = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return Number.isFinite(parsed)
      ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, parsed))
      : SIDEBAR_DEFAULT_WIDTH;
  });
  const widthRef = useRef(width);
  widthRef.current = width;

  const onResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    const move = (ev: PointerEvent) => {
      setWidth(
        Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + (ev.clientX - startX)))
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('is-col-dragging');
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current));
    };
    document.body.classList.add('is-col-dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  const openCreate = (kind: CreateKind, collectionId?: string, folderId?: string) => {
    setTargetCollectionId(collectionId ?? null);
    setTargetFolderId(folderId ?? null);
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
    <aside
      className={`sidebar ${railHidden ? 'sidebar-rail-only' : ''}`}
      data-testid="sidebar"
      style={railHidden ? undefined : { width }}
    >
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
          folderId={targetFolderId ?? undefined}
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
      {!railHidden && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          title="Drag to resize"
          onPointerDown={onResizeStart}
        />
      )}
    </aside>
  );
}

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useAuth } from '@/lib/auth';
import type { UserRole } from '@/lib/api';
import { docsApi } from '@/lib/docsApi';
import { RequestsPanel } from './RequestsPanel';
import { NewPageModal } from './Pickers';
import { workspaceApi } from '@/lib/api';
import { fmtDate, workspaceRoleRank } from './helpers';
import styles from './docs.module.css';
import { FileIcon, PlusIcon } from '@/components/icons';

// Workspace-access-request review gate mirrors the backend: platform
// MANAGER/ADMIN bypass, otherwise the workspace role must be >= ADMIN.
function roleCanReview(role: UserRole | null | undefined, globalRole?: UserRole | null): boolean {
  if (workspaceRoleRank(globalRole ?? null) >= 3) return true;
  return workspaceRoleRank(role ?? null) >= 4;
}

export function DocsHome({ onOpenPage }: { onOpenPage: (pageId: string) => void }) {
  const ws = useWorkspace();
  const { user } = useAuth();
  const [workspaceId, setWorkspaceId] = useState<string>(() => ws.activeWorkspaceId ?? ws.workspaces[0]?.id ?? '');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [tab, setTab] = useState<'pages' | 'requests'>('pages');
  const [pages, setPages] = useState<Awaited<ReturnType<typeof docsApi.list>>['pages']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const seq = useRef(0);

  const workspaces = ws.workspaces;

  // Follow the WorkspaceStore's active workspace until the user picks one.
  useEffect(() => {
    if (ws.activeWorkspaceId && !workspaceId) setWorkspaceId(ws.activeWorkspaceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.activeWorkspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    workspaceApi
      .content(workspaceId)
      .then((tree) => {
        if (!alive) return;
        setProjects(tree.projects.filter((p) => p.can_access).map((p) => ({ id: p.id, name: p.name })));
      })
      .catch(() => {
        if (alive) setProjects([]);
      });
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  // Debounce the free-text search box.
  useEffect(() => {
    const t = window.setTimeout(() => setAppliedQ(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const loadPages = useCallback(async () => {
    if (!workspaceId || tab !== 'pages') {
      setLoading(false);
      return;
    }
    const run = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const res = await docsApi.list({ workspaceId, projectId: projectId || undefined, q: appliedQ || undefined });
      if (run === seq.current) setPages(res.pages);
    } catch (err) {
      if (run === seq.current) setError(err instanceof Error ? err.message : 'Failed to load pages');
    } finally {
      if (run === seq.current) setLoading(false);
    }
  }, [workspaceId, projectId, appliedQ, tab]);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  const onWorkspaceChange = (id: string) => {
    setWorkspaceId(id);
    setProjectId('');
    setQ('');
    setAppliedQ('');
  };

  const onCreated = (page: { id: string; workspaceId: string }) => {
    setCreating(false);
    setWorkspaceId(page.workspaceId);
    setTab('pages');
    onOpenPage(page.id);
  };

  const canReview = roleCanReview(
    workspaces.find((w) => w.id === workspaceId)?.role,
    user?.role
  );

  return (
    <div className={styles.docsRoot} data-testid="docs-home">
      <div className={styles.docsHeader}>
        <div>
          <h1>Docs</h1>
          <p className="admin-subtitle">Workspace documentation, examples and walkthroughs.</p>
        </div>
        <div className="admin-header-actions">
          <button
            type="button"
            className="primary-button"
            data-testid="docs-new-page"
            disabled={workspaces.length === 0}
            onClick={() => setCreating(true)}
          >
            <PlusIcon size={14} />
            New page
          </button>
        </div>
      </div>

      {workspaces.length === 0 && !ws.loading && (
        <div className="panel-empty" data-testid="docs-empty">
          <p>No workspaces available. Create or join a workspace to start writing docs.</p>
        </div>
      )}

      <div className={styles.scopeRow}>
        <select
          className="compact-select"
          data-testid="docs-workspace-select"
          value={workspaceId}
          onChange={(e) => onWorkspaceChange(e.target.value)}
        >
          {workspaces.length === 0 && <option value="">Loading workspaces…</option>}
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select
          className="compact-select"
          data-testid="docs-project-select"
          value={projectId}
          disabled={projects.length === 0}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className={styles.searchWrap}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search pages…"
            value={q}
            data-testid="docs-search"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="manage-tabs" data-testid="docs-tabs">
        <button type="button" className={`manage-tab ${tab === 'pages' ? 'active' : ''}`} data-testid="docs-tab-pages" onClick={() => setTab('pages')}>
          Pages
        </button>
        <button type="button" className={`manage-tab ${tab === 'requests' ? 'active' : ''}`} data-testid="docs-tab-requests" onClick={() => setTab('requests')}>
          Access requests
        </button>
      </div>

      {tab === 'requests' ? (
        workspaceId ? (
          <RequestsPanel workspaceId={workspaceId} canReview={canReview} />
        ) : (
          <p className="hint">Select a workspace to view access requests.</p>
        )
      ) : (
        <div className="table-wrap table-stack">
          {error && (
            <p className="auth-error" role="alert" data-testid="docs-list-error">
              {error}
            </p>
          )}
          <table className="admin-table" data-testid="docs-list">
            <thead>
              <tr>
                <th>Title</th>
                <th>Location</th>
                <th>Updated</th>
                <th>Blocks</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.id} className={styles.clickableRow} data-testid={`docs-page-row-${p.id}`} onClick={() => onOpenPage(p.id)}>
                  <td data-label="Title">
                    <span className={styles.pageTitleCell}>
                      <FileIcon size={14} />
                      {p.title}
                    </span>
                  </td>
                  <td className={styles.mutedCell} data-label="Location">
                    {p.projectName ? `${p.workspaceName} · ${p.projectName}` : p.workspaceName}
                  </td>
                  <td className={styles.mutedCell} data-label="Updated">
                    {(p.updatedBy ?? p.createdBy)?.name ?? '—'} · {fmtDate(p.updatedAt ?? p.createdAt)}
                  </td>
                  <td className={styles.mutedCell} data-label="Blocks">
                    <span className={`${styles.pill} ${styles.pillBlock}`}>{p.blockCount}</span>
                  </td>
                </tr>
              ))}
              {loading && (
                <tr>
                  <td colSpan={4} className="hint" data-testid="docs-loading">
                    Loading pages…
                  </td>
                </tr>
              )}
              {!loading && !error && pages.length === 0 && (
                <tr>
                  <td colSpan={4} className="hint" data-testid="docs-pages-empty">
                    No pages yet{workspaceId ? '' : ' for this workspace'}. Click “New page” to write the first one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <NewPageModal
          workspaces={workspaces}
          defaultWorkspaceId={workspaceId}
          onClose={() => setCreating(false)}
          onCreated={onCreated}
        />
      )}
    </div>
  );
}

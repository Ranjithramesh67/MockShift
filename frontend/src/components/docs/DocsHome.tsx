'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useAuth } from '@/lib/auth';
import { useApp } from '@/store/AppStore';
import type { UserRole } from '@/lib/api';
import { docsApi, type DocsUsage, type DocsPageSummary } from '@/lib/docsApi';
import { RequestsPanel } from './RequestsPanel';
import { NewPageModal } from './Pickers';
import { MovePageModal } from './MovePageModal';
import { workspaceApi } from '@/lib/api';
import { fmtDate, workspaceRoleRank } from './helpers';
import styles from './docs.module.css';
import { ChevronIcon, FileIcon, GlobeIcon, LockIcon, MoveIcon, PlusIcon } from '@/components/icons';

// Workspace-access-request review gate mirrors the backend: platform
// MANAGER/ADMIN bypass, otherwise the workspace role must be >= ADMIN.
function roleCanReview(role: UserRole | null | undefined, globalRole?: UserRole | null): boolean {
  if (workspaceRoleRank(globalRole ?? null) >= 3) return true;
  return workspaceRoleRank(role ?? null) >= 4;
}

// Page edit mirror of the backend canEditPage: page author OR workspace
// role >= EDITOR OR platform MANAGER/ADMIN.
function canManagePage(
  role: UserRole | null | undefined,
  globalRole: UserRole | null | undefined,
  page: DocsPageSummary,
  userId?: string
): boolean {
  if (workspaceRoleRank(globalRole ?? null) >= 3) return true;
  if (workspaceRoleRank(role ?? null) >= 2) return true;
  return Boolean(userId && page.createdBy?.id === userId);
}

interface TreeRow {
  page: DocsPageSummary;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

export function DocsHome({ onOpenPage }: { onOpenPage: (pageId: string) => void }) {
  const ws = useWorkspace();
  const { user } = useAuth();
  const { dispatch } = useApp();
  const [workspaceId, setWorkspaceId] = useState<string>(() => ws.activeWorkspaceId ?? ws.workspaces[0]?.id ?? '');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [tab, setTab] = useState<'private' | 'public' | 'shared' | 'requests'>('private');
  const [pages, setPages] = useState<DocsPageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [subParent, setSubParent] = useState<DocsPageSummary | null>(null);
  const [movePage, setMovePage] = useState<DocsPageSummary | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [usage, setUsage] = useState<DocsUsage | null>(null);
  const [sharedPages, setSharedPages] = useState<DocsPageSummary[]>([]);
  const [sharedLoading, setSharedLoading] = useState(false);
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

  // Per-workspace plan usage (drives the doc-count pill and New page gate).
  useEffect(() => {
    if (!workspaceId) {
      setUsage(null);
      return;
    }
    let alive = true;
    docsApi
      .usage(workspaceId)
      .then((u) => {
        if (alive) setUsage(u);
      })
      .catch(() => {
        if (alive) setUsage(null);
      });
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  const loadPages = useCallback(async () => {
    if (!workspaceId || (tab !== 'private' && tab !== 'public')) {
      setLoading(false);
      return;
    }
    const run = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const res = await docsApi.list({
        workspaceId,
        projectId: projectId || undefined,
        q: appliedQ || undefined,
        visibility: tab === 'public' ? 'PUBLIC' : 'PRIVATE',
      });
      if (run === seq.current) setPages(res.pages);
    } catch (err) {
      if (run === seq.current) setError(err instanceof Error ? err.message : 'Failed to load pages');
    } finally {
      if (run === seq.current) setLoading(false);
    }
  }, [workspaceId, projectId, appliedQ, tab]);

  // Inbound shares feed for the "Shared with me" home section (cross-workspace
  // pages the caller can read through an audience grant or PUBLIC visibility).
  const loadShared = useCallback(async () => {
    setSharedLoading(true);
    try {
      const res = await docsApi.shared();
      setSharedPages(res.pages);
    } catch {
      setSharedPages([]);
    } finally {
      setSharedLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShared();
  }, [loadShared]);

  // Refresh the inbound-shares feed whenever the Shared tab is opened.
  useEffect(() => {
    if (tab === 'shared') void loadShared();
  }, [tab, loadShared]);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  // Search results are a flat recent-first list (grouping a result set into a
  // tree would hide matches whose ancestors did not match).
  const searching = appliedQ.length > 0;

  // Collapse everything when the scope, the query or the tab changes.
  useEffect(() => {
    setCollapsedIds(new Set());
  }, [workspaceId, projectId, searching, tab]);

  const byParent = useMemo(() => {
    const map = new Map<string | null, DocsPageSummary[]>();
    for (const p of pages) {
      const list = map.get(p.parentId) ?? [];
      list.push(p);
      map.set(p.parentId, list);
    }
    for (const list of Array.from(map.values())) list.sort((a, b) => a.title.localeCompare(b.title));
    return map;
  }, [pages]);

  // Depth-first rows in tree order. A "root" is a page with no parent in the
  // current scope (parentId null, or its parent was filtered out) — those are
  // always shown; collapsed branches skip their descendants.
  const rows = useMemo<TreeRow[]>(() => {
    if (searching) {
      return pages.map((page) => ({ page, depth: 0, hasChildren: false, expanded: false }));
    }
    const pagesById = new Map(pages.map((p) => [p.id, p]));
    const roots = pages
      .filter((p) => !p.parentId || !pagesById.has(p.parentId))
      .sort((a, b) => a.title.localeCompare(b.title));
    const out: TreeRow[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const child of byParent.get(parentId) ?? []) {
        const grand = byParent.get(child.id) ?? [];
        const expanded = !collapsedIds.has(child.id);
        out.push({ page: child, depth, hasChildren: grand.length > 0, expanded });
        if (grand.length > 0 && expanded) walk(child.id, depth + 1);
      }
    };
    for (const root of roots) {
      const children = byParent.get(root.id) ?? [];
      const expanded = !collapsedIds.has(root.id);
      out.push({ page: root, depth: 0, hasChildren: children.length > 0, expanded });
      if (children.length > 0 && expanded) walk(root.id, 1);
    }
    return out;
  }, [pages, byParent, collapsedIds, searching]);

  // "Shared with me" grouped by how each page became readable. Pages of the
  // currently selected workspace are excluded (they already show in the tree).
  const sharedGroups = useMemo(() => {
    const map = new Map<string, { label: string; order: number; pages: DocsPageSummary[] }>();
    const push = (key: string, label: string, order: number, page: DocsPageSummary) => {
      const g = map.get(key) ?? { label, order, pages: [] };
      g.pages.push(page);
      map.set(key, g);
    };
    for (const page of sharedPages) {
      if (page.workspaceId === workspaceId) continue;
      const vias = page.via && page.via.length > 0 ? page.via : [{ kind: 'user' as const }];
      const seen = new Set<string>();
      for (const v of vias) {
        let key: string;
        let label: string;
        let order: number;
        if (v.kind === 'user') {
          key = 'user';
          label = 'Shared directly with you';
          order = 0;
        } else if (v.kind === 'team') {
          key = `team:${v.id ?? ''}`;
          label = `${v.name || 'A team'} · team`;
          order = 1;
        } else if (v.kind === 'org') {
          key = `org:${v.id ?? ''}`;
          label = `${v.name || 'An organization'} · organization`;
          order = 2;
        } else {
          key = `public:${v.id ?? ''}`;
          label = `${v.name || 'Your organization'} · public docs`;
          order = 3;
        }
        if (!seen.has(key)) {
          seen.add(key);
          push(key, label, order, page);
        }
      }
    }
    return Array.from(map.values())
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
      .map((g) => ({
        ...g,
        pages: [...g.pages].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
      }));
  }, [sharedPages, workspaceId]);

  const onWorkspaceChange = (id: string) => {
    setWorkspaceId(id);
    setProjectId('');
    setQ('');
    setAppliedQ('');
  };

  const toastError = (err: unknown, fallback: string) => {
    dispatch({
      type: 'SHOW_TOAST',
      kind: 'error',
      message: err instanceof Error ? err.message : fallback,
    });
  };

  const onCreated = (page: { id: string; workspaceId: string }) => {
    setCreating(false);
    setSubParent(null);
    setWorkspaceId(page.workspaceId);
    setTab('private');
    void loadPages();
    void loadShared();
    onOpenPage(page.id);
  };

  const toggleVisibility = async (page: DocsPageSummary) => {
    const next = page.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC';
    try {
      await docsApi.update(page.id, { visibility: next });
      dispatch({
        type: 'SHOW_TOAST',
        kind: 'success',
        message: next === 'PUBLIC' ? `“${page.title}” is now visible to your organization.` : `“${page.title}” is private again.`,
      });
      void loadPages();
      void loadShared();
    } catch (err) {
      toastError(err, 'Failed to change page visibility');
    }
  };

  const toggleCollapsed = (pageId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  };

  const onMoved = () => {
    setMovePage(null);
    void loadPages();
  };

  const canReview = roleCanReview(
    workspaces.find((w) => w.id === workspaceId)?.role,
    user?.role
  );

  const enforced = !!usage?.enforced;
  const docLimit = usage && enforced ? usage.limits.doc_pages : null;
  const docUsed = usage?.usage.doc_pages ?? 0;
  const atDocLimit = enforced && docLimit !== null && docUsed >= docLimit;

  return (
    <div className={styles.docsRoot} data-testid="docs-home">
      <div className={styles.docsHeader}>
        <div>
          <div className={styles.titleRow}>
            <h1>Docs</h1>
            {enforced && (
              <span className={styles.limitPill} data-testid="docs-limit-pill">
                {docLimit !== null ? `${docUsed} / ${docLimit} docs` : `${docUsed} docs used`}
              </span>
            )}
          </div>
          <p className="admin-subtitle">Workspace documentation, examples and walkthroughs.</p>
        </div>
        <div className="admin-header-actions">
          <button
            type="button"
            className="primary-button"
            data-testid="docs-new-page"
            title={atDocLimit ? 'Plan limit reached — upgrade for more docs' : undefined}
            disabled={workspaces.length === 0 || atDocLimit}
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
        <button type="button" className={`manage-tab ${tab === 'private' ? 'active' : ''}`} data-testid="docs-tab-private" onClick={() => setTab('private')}>
          Private
        </button>
        <button type="button" className={`manage-tab ${tab === 'public' ? 'active' : ''}`} data-testid="docs-tab-public" onClick={() => setTab('public')}>
          Public
        </button>
        <button type="button" className={`manage-tab ${tab === 'shared' ? 'active' : ''}`} data-testid="docs-tab-shared" onClick={() => setTab('shared')}>
          Shared with me{sharedGroups.length > 0 ? ` (${sharedGroups.reduce((n, g) => n + g.pages.length, 0)})` : ''}
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
      ) : tab === 'shared' ? (
        <section className={styles.sharedWrap} data-testid="docs-shared-section">
          <div className={styles.sharedHead}>
            <h2>Shared with me</h2>
            <span className={styles.sharedCount}>
              {sharedGroups.reduce((n, g) => n + g.pages.length, 0)}
            </span>
          </div>
          <p className={styles.treeHint}>
            Pages people shared with your teams or organization, and docs shared with you directly.
          </p>
          {sharedLoading && sharedPages.length === 0 && (
            <p className="hint" data-testid="docs-shared-loading">
              Loading shared docs…
            </p>
          )}
          {!sharedLoading && sharedGroups.length === 0 && (
            <p className="hint" data-testid="docs-shared-empty">
              Nothing has been shared with you yet.
            </p>
          )}
          {sharedGroups.map((group) => (
            <div key={group.label} className={styles.sharedGroup} data-testid="docs-shared-group">
              <h3 className={styles.sharedGroupTitle}>{group.label}</h3>
              <ul className={styles.sharedList}>
                {group.pages.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={styles.sharedItem}
                      data-testid={`docs-shared-page-${p.id}`}
                      onClick={() => onOpenPage(p.id)}
                    >
                      <FileIcon size={14} />
                      <span className={styles.sharedItemMain}>
                        <span className={styles.sharedItemTitle}>{p.title || 'Untitled page'}</span>
                        <span className={styles.sharedItemMeta}>
                          {p.workspaceName} · updated {fmtDate(p.updatedAt)}
                        </span>
                      </span>
                      <span className={styles.sharedItemOpen}>
                        Open <ChevronIcon size={12} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
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
                <th>Visibility</th>
                <th>Updated</th>
                <th>Blocks</th>
                <th className={styles.actionsHead}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { page, depth } = row;
                const manage = canManagePage(
                  workspaces.find((w) => w.id === workspaceId)?.role,
                  user?.role,
                  page,
                  user?.id
                );
                const isPublic = page.visibility === 'PUBLIC';
                return (
                  <tr
                    key={page.id}
                    className={styles.clickableRow}
                    data-testid={`docs-page-row-${page.id}`}
                    onClick={() => onOpenPage(page.id)}
                  >
                    <td data-label="Title">
                      <span className={styles.pageTitleCell} style={{ paddingLeft: depth * 22 }}>
                        {row.hasChildren ? (
                          <button
                            type="button"
                            className={`${styles.chevBtn} ${row.expanded ? styles.chevOpen : ''}`}
                            data-testid={`docs-tree-expand-${page.id}`}
                            aria-label={row.expanded ? 'Collapse sub-pages' : 'Expand sub-pages'}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleCollapsed(page.id);
                            }}
                          >
                            <ChevronIcon size={14} />
                          </button>
                        ) : (
                          <span className={styles.chevSpacer} aria-hidden />
                        )}
                        <FileIcon size={14} />
                        <span className={styles.pageName}>{page.title}</span>
                      </span>
                    </td>
                    <td data-label="Visibility">
                      <button
                        type="button"
                        className={`${styles.visPill} ${isPublic ? styles.visPublic : styles.visPrivate}`}
                        data-testid={`docs-vis-${page.id}`}
                        title={manage ? `Click to make it ${isPublic ? 'private' : 'public'}` : `${isPublic ? 'Public' : 'Private'} page`}
                        disabled={!manage}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleVisibility(page);
                        }}
                      >
                        {isPublic ? <GlobeIcon size={11} /> : <LockIcon size={11} />}
                        {isPublic ? 'Public' : 'Private'}
                      </button>
                    </td>
                    <td className={styles.mutedCell} data-label="Updated">
                      {(page.updatedBy ?? page.createdBy)?.name ?? '—'} · {fmtDate(page.updatedAt ?? page.createdAt)}
                    </td>
                    <td className={styles.mutedCell} data-label="Blocks">
                      <span className={`${styles.pill} ${styles.pillBlock}`}>{page.blockCount}</span>
                    </td>
                    <td data-label="" onClick={(e) => e.stopPropagation()}>
                      {manage && (
                        <span className={styles.rowActions}>
                          <button
                            type="button"
                            className={styles.rowActionBtn}
                            data-testid={`docs-page-sub-${page.id}`}
                            title={atDocLimit ? 'Plan limit reached — upgrade for more docs' : 'Add a sub-page'}
                            disabled={atDocLimit}
                            onClick={() => setSubParent(page)}
                          >
                            <PlusIcon size={13} />
                          </button>
                          <button
                            type="button"
                            className={styles.rowActionBtn}
                            data-testid={`docs-page-move-${page.id}`}
                            title="Move page"
                            onClick={() => setMovePage(page)}
                          >
                            <MoveIcon size={13} />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {loading && (
                <tr>
                  <td colSpan={5} className="hint" data-testid="docs-loading">
                    Loading pages…
                  </td>
                </tr>
              )}
              {!loading && !error && pages.length === 0 && (
                <tr>
                  <td colSpan={5} className="hint" data-testid="docs-pages-empty">
                    {tab === 'public'
                      ? 'No public pages yet. Make a page public from the Private tab or with the visibility control.'
                      : `No private pages yet${workspaceId ? '' : ' for this workspace'}. Click “New page” to write the first one.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {!searching && pages.length > 0 && (
            <p className={styles.treeHint} data-testid="docs-tree-hint">
              Nested pages form a document tree — use the arrows to collapse a branch, the “+” to add a sub-page, or the
              move icon to re-parent a page.
            </p>
          )}
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

      {subParent && (
        <NewPageModal
          workspaces={workspaces}
          defaultWorkspaceId={workspaceId}
          parentPage={subParent}
          onClose={() => setSubParent(null)}
          onCreated={onCreated}
        />
      )}

      {movePage && (
        <MovePageModal
          page={movePage}
          pages={pages}
          onClose={() => setMovePage(null)}
          onMoved={onMoved}
        />
      )}
    </div>
  );
}

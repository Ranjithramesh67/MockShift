'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { workspaceApi, type Workspace } from '@/lib/api';
import { docsApi, type DocsPageSummary } from '@/lib/docsApi';
import { listWorkspaceApis, listWorkspaceMembers, type MemberOption } from './helpers';
import styles from './docs.module.css';

// ------------------------------------------------------------- New page modal
export function NewPageModal({
  workspaces,
  defaultWorkspaceId,
  onClose,
  onCreated,
}: {
  workspaces: Workspace[];
  defaultWorkspaceId: string;
  onClose: () => void;
  onCreated: (page: DocsPageSummary) => void;
}) {
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId);
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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

  const create = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Title is required');
      return;
    }
    if (!workspaceId) {
      setError('Choose a workspace');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { page } = await docsApi.create({
        workspaceId,
        projectId: projectId || null,
        title: trimmed,
      });
      onCreated(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create page');
      setBusy(false);
    }
  };

  return (
    <Modal title="New page" onClose={onClose} testId="docs-new-page-modal">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="modal-form"
      >
        {error && (
          <p className="auth-error" role="alert" data-testid="docs-new-page-error">
            {error}
          </p>
        )}
        <label className="auth-field">
          <span>Title</span>
          <input
            type="text"
            autoFocus
            data-testid="docs-new-page-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Getting started with the Petstore API"
            required
          />
        </label>
        <label className="auth-field">
          <span>Workspace</span>
          <select
            className="compact-select"
            data-testid="docs-new-page-workspace"
            value={workspaceId}
            onChange={(e) => {
              setWorkspaceId(e.target.value);
              setProjectId('');
            }}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="auth-field">
          <span>Project (optional)</span>
          <select
            className="compact-select"
            data-testid="docs-new-page-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">No project — workspace page</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" data-testid="docs-new-page-submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create page'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------- User mention picker
export function UserPickerModal({
  workspaceId,
  onClose,
  onPick,
}: {
  workspaceId: string;
  onClose: () => void;
  onPick: (userId: string) => void;
}) {
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listWorkspaceMembers(workspaceId)
      .then((m) => {
        if (alive) setMembers(m);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load members');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.name.toLowerCase().includes(q) || (m.email ?? '').toLowerCase().includes(q));
  }, [members, filter]);

  return (
    <Modal title="Tag a user" onClose={onClose} testId="docs-user-picker">
      <div className="modal-form" style={{ minWidth: 380 }}>
        <input
          type="text"
          className="text-input"
          placeholder="Filter members…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
        />
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {loading && <p className="hint">Loading workspace members…</p>}
        {!loading && visible.length === 0 && <p className="hint">No members to tag in this workspace.</p>}
        <div className={styles.pickerScroll}>
          <ul className="manage-member-list" data-testid="docs-user-picker-list">
            {visible.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={styles.optionRow}
                  data-testid={`docs-user-option-${m.email ?? m.id}`}
                  onClick={() => onPick(m.id)}
                >
                  <span className="admin-avatar">{m.name.charAt(0).toUpperCase()}</span>
                  <span className={styles.optionMain}>
                    <span className={styles.optionName}>{m.name}</span>
                    {m.email && <span className={styles.optionEmail}>{m.email}</span>}
                  </span>
                  {m.role && <span className="role-badge">{m.role}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- API mention picker
export function ApiPickerModal({
  workspaceId,
  onClose,
  onPick,
}: {
  workspaceId: string;
  onClose: () => void;
  onPick: (requestId: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const apis = useApiDirectory(workspaceId, setLoading, setError);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return apis;
    return apis.filter((a) => a.name.toLowerCase().includes(q) || a.projectName.toLowerCase().includes(q));
  }, [apis, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof apis>();
    for (const a of visible) {
      const list = map.get(a.projectName) ?? [];
      list.push(a);
      map.set(a.projectName, list);
    }
    return Array.from(map.entries());
  }, [visible]);

  return (
    <Modal title="Tag an API" onClose={onClose} testId="docs-api-picker">
      <div className="modal-form" style={{ minWidth: 460 }}>
        <input
          type="text"
          className="text-input"
          placeholder="Filter APIs…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
        />
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {loading && <p className="hint">Loading requests…</p>}
        {!loading && apis.length === 0 && <p className="hint">No requests in this workspace to tag yet.</p>}
        <div data-testid="docs-api-picker-list" className={styles.pickerScroll}>
          {grouped.map(([projectName, items]) => (
            <div key={projectName} className={styles.pickerGroup}>
              <div className={styles.sectionLabel}>{projectName}</div>
              <ul className="manage-member-list">
                {items.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className={styles.optionRow}
                      data-testid={`docs-api-option-${a.name}`}
                      onClick={() => onPick(a.id)}
                    >
                      <span className={`method-badge method-${a.method.toUpperCase()}`}>{a.method.toUpperCase()}</span>
                      <span className={styles.optionName}>{a.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// Small hook: request directory for the workspace (used by the API picker).
function useApiDirectory(
  workspaceId: string,
  setLoading: (v: boolean) => void,
  setError: (v: string) => void
) {
  const [apis, setApis] = useState<Awaited<ReturnType<typeof listWorkspaceApis>>>([]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    listWorkspaceApis(workspaceId)
      .then((list) => {
        if (alive) setApis(list);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load APIs');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);
  return apis;
}

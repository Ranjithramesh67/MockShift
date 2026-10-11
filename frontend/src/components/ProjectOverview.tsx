'use client';

import React, { useEffect, useState } from 'react';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useApp } from '@/store/AppStore';
import { useAuth } from '@/lib/auth';
import {
  projectApi,
  type MemberRole,
  type OverviewPerson,
  type ProjectOrgUser,
} from '@/lib/api';
import { TabBar } from './TabBar';
import { Modal } from './Modal';
import {
  CollectionIcon,
  FolderIcon,
  RequestIcon,
  BoltIcon,
  ServerIcon,
  HistoryIcon,
  UsersIcon,
  XIcon,
} from './icons';

type TabId = 'overview' | 'members' | 'activity';

const TABS: Array<{ id: TabId; label: string; icon?: React.ComponentType<{ size?: number }> }> = [
  { id: 'overview', label: 'Overview', icon: CollectionIcon },
  { id: 'members', label: 'Members', icon: UsersIcon },
  { id: 'activity', label: 'Activity', icon: HistoryIcon },
];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function RoleBadge({ role }: { role: string }) {
  return <span className={`role-badge role-${role}`}>{role}</span>;
}

export function ProjectOverview() {
  const ws = useWorkspace();
  const { dispatch } = useApp();
  const { user } = useAuth();
  const [tab, setTab] = useState<TabId>('overview');
  const [orgUsers, setOrgUsers] = useState<ProjectOrgUser[]>([]);
  const [newUserId, setNewUserId] = useState('');
  const [newUserRole, setNewUserRole] = useState<MemberRole>('EDITOR');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renameError, setRenameError] = useState('');
  const [renaming, setRenaming] = useState(false);

  const overview = ws.overview;

  useEffect(() => {
    if (!overview) {
      setTab('overview');
      setOrgUsers([]);
      setNewUserId('');
      setNewUserRole('EDITOR');
      return;
    }
    if (tab !== 'members' || !overview.canManage) return;
    projectApi
      .orgUsers(overview.project.id)
      .then((r) => setOrgUsers(r.users))
      .catch(() => setOrgUsers([]));
  }, [tab, overview]);

  if (!overview) {
    return (
      <div className="project-overview" data-testid="project-overview">
        <div className="project-overview-head">
          <div className="project-overview-title-row">
            <h2 className="project-overview-title">Project</h2>
            <button
              type="button"
              className="icon-button po-close"
              title="Close project overview"
              aria-label="Close project overview"
              data-testid="close-project-overview"
              onClick={() => ws.closeProjectOverview()}
            >
              <XIcon size={14} />
            </button>
          </div>
        </div>
        <div className="project-overview-body">
          {ws.overviewError ? (
            <p className="auth-error po-error" role="alert" data-testid="project-overview-error">
              {ws.overviewError}
            </p>
          ) : (
            <div className="panel-empty">
              <span className="spinner" />
              Loading project overview…
            </div>
          )}
        </div>
      </div>
    );
  }

  const refreshOverview = () =>
    ws.selectProjectOverview({ id: overview.project.id, name: overview.project.name });

  const fail = (err: unknown, fallback: string) =>
    dispatch({
      type: 'SHOW_TOAST',
      kind: 'error',
      message: err instanceof Error ? err.message : fallback,
    });

  const addMember = async () => {
    if (!newUserId) return;
    try {
      await projectApi.addMember(overview.project.id, newUserId, newUserRole);
      setNewUserId('');
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Member added.' });
      await refreshOverview();
    } catch (err) {
      fail(err, 'Failed to add member');
    }
  };

  const changeMemberRole = async (person: OverviewPerson, role: MemberRole) => {
    try {
      await projectApi.setMemberRole(overview.project.id, person.id, role);
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Role updated.' });
      await refreshOverview();
    } catch (err) {
      fail(err, 'Failed to update role');
    }
  };

  const removeMember = async (person: OverviewPerson) => {
    if (!window.confirm(`Remove ${person.name || person.email} from this project?`)) return;
    try {
      await projectApi.removeMember(overview.project.id, person.id);
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Member removed.' });
      await refreshOverview();
    } catch (err) {
      fail(err, 'Failed to remove member');
    }
  };

  const openRename = () => {
    setRenameName(overview.project.name);
    setRenameError('');
    setRenameOpen(true);
  };

  const submitRename = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = renameName.trim();
    if (!next) {
      setRenameError('Name is required');
      return;
    }
    setRenaming(true);
    setRenameError('');
    try {
      await ws.renameProject(overview.project.id, next);
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Project renamed.' });
      setRenameOpen(false);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Failed to rename project');
    } finally {
      setRenaming(false);
    }
  };

  const deleteProject = async () => {
    const ok = window.confirm(
      `Delete project "${overview.project.name}"? Its collections, requests and runs will be removed.`
    );
    if (!ok) return;
    try {
      await ws.deleteProject(overview.project.id);
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Project deleted.' });
    } catch (err) {
      fail(err, 'Failed to delete project');
    }
  };

  const roleLabel =
    overview.myAccess.isManager ||
    overview.myAccess.level === 'MANAGER' ||
    overview.myAccess.level === 'ADMIN'
      ? 'MANAGER'
      : overview.myAccess.level;

  const people: OverviewPerson[] = [...overview.managers, ...overview.members];
  // The workspace owner/admin of the auto-created "Default Project" is not a
  // project manager/member, so surface the signed-in user explicitly instead
  // of showing an empty list.
  if (user && !people.some((p) => p.id === user.id)) {
    people.unshift({
      id: user.id,
      name: user.name ?? '',
      email: user.email,
      role: overview.canManage ? 'MANAGER' : overview.myAccess.level === 'EDITOR' ? 'EDITOR' : 'VIEWER',
      granted_at: null,
      grantor_name: null,
    });
  }
  const assignedIds = new Set(people.map((p) => p.id));
  const isSelf = (p: OverviewPerson) => Boolean(user && p.id === user.id);

  const statTiles = [
    { label: 'Collections', value: overview.counts.collections, icon: CollectionIcon },
    { label: 'Folders', value: overview.counts.folders, icon: FolderIcon },
    { label: 'Requests', value: overview.counts.requests, icon: RequestIcon },
    { label: 'Automations', value: overview.counts.automations, icon: BoltIcon },
    { label: 'Workflows', value: overview.counts.workflows, icon: ServerIcon },
    {
      label: 'Mock server',
      value: overview.counts.has_mock_server ? 'ON' : 'OFF',
      icon: ServerIcon,
    },
  ];

  const roleCell = (p: OverviewPerson, isManager: boolean) => {
    if (isManager) return <RoleBadge role="MANAGER" />;
    if (overview.canManage) {
      return (
        <select
          className="compact-select po-role-select"
          data-testid={`role-${p.email}`}
          aria-label={`Role for ${p.email}`}
          value={p.role}
          onChange={(e) => changeMemberRole(p, e.target.value as MemberRole)}
        >
          <option value="EDITOR">EDITOR</option>
          <option value="VIEWER">VIEWER</option>
        </select>
      );
    }
    return <RoleBadge role={p.role} />;
  };

  const personCell = (p: OverviewPerson) => (
    <div className="po-person">
      <span className="po-avatar">{(p.name || p.email || '?').charAt(0).toUpperCase()}</span>
      <div className="po-person-text">
        <span className="po-person-name">
          {p.name || '—'}
          {isSelf(p) && <span className="po-you-badge">you</span>}
        </span>
        <span className="po-person-email">{p.email}</span>
      </div>
    </div>
  );

  return (
    <div className="project-overview" data-testid="project-overview">
      <div className="project-overview-head">
        <div className="project-overview-title-row">
          <h2 className="project-overview-title">{overview.project.name}</h2>
          <span className="vis-badge po-loc-badge">
            {overview.project.workspace_name}
            {overview.project.organization_name
              ? ` · ${overview.project.organization_name}`
              : ''}
          </span>
          <span className={`role-badge role-${roleLabel}`}>
            {roleLabel}
          </span>
          {overview.canManage && (
            <div className="po-project-actions">
              <button
                type="button"
                className="ghost-button small"
                data-testid="rename-project"
                onClick={openRename}
              >
                Rename
              </button>
              <button
                type="button"
                className="ghost-button small danger"
                data-testid="delete-project"
                onClick={deleteProject}
              >
                Delete
              </button>
            </div>
          )}
          <button
            type="button"
            className="icon-button po-close"
            title="Close project overview"
            aria-label="Close project overview"
            data-testid="close-project-overview"
            onClick={() => ws.closeProjectOverview()}
          >
            <XIcon size={14} />
          </button>
        </div>
        <p className="project-overview-sub">
          Project command center for <strong>{overview.project.workspace_name}</strong>.
        </p>
        {ws.overviewError && (
          <p className="auth-error po-error" role="alert" data-testid="project-overview-error">
            {ws.overviewError}
          </p>
        )}
      </div>

      <TabBar tabs={TABS} active={tab} onChange={setTab} testIdPrefix="project" />

      <div className="project-overview-body">
        {tab === 'overview' && (
          <>
            <div className="po-tiles">
              {statTiles.map((tile) => {
                const Icon = tile.icon;
                return (
                  <div key={tile.label} className="po-tile">
                    <span className="po-tile-icon">
                      <Icon size={14} />
                    </span>
                    <span className="po-tile-value">{tile.value}</span>
                    <span className="po-tile-label">{tile.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="po-card">
              <h3 className="manage-section-title">Workspace</h3>
              <div className="po-kv">
                <span className="po-kv-label">Workspace</span>
                <span className="po-kv-value">{overview.project.workspace_name}</span>
              </div>
              <div className="po-kv">
                <span className="po-kv-label">Organization</span>
                <span className="po-kv-value">{overview.project.organization_name || '—'}</span>
              </div>
              <div className="po-kv">
                <span className="po-kv-label">Visibility</span>
                <span className="po-kv-value">{overview.project.workspace_visibility}</span>
              </div>
            </div>
          </>
        )}

        {tab === 'members' && (
          <>
            {overview.canManage && (
              <div className="po-add-member">
                <select
                  className="compact-select"
                  data-testid="add-member-user"
                  aria-label="User to add"
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                >
                  <option value="" disabled>
                    Choose a user…
                  </option>
                  {orgUsers
                    .filter((u) => !assignedIds.has(u.id) && (!user || u.id !== user.id))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                </select>
                <select
                  className="compact-select"
                  data-testid="add-member-role"
                  aria-label="Role to grant"
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as MemberRole)}
                >
                  <option value="EDITOR">EDITOR</option>
                  <option value="VIEWER">VIEWER</option>
                </select>
                <button
                  type="button"
                  className="primary-button small"
                  data-testid="add-member-btn"
                  disabled={!newUserId}
                  onClick={addMember}
                >
                  Add member
                </button>
              </div>
            )}
            <div className="table-wrap">
              <table className="po-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Granted by / at</th>
                    {overview.canManage && <th className="po-actions-col" />}
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => {
                    const isManager = p.role === 'MANAGER';
                    const isMemberRow = !isManager;
                    return (
                      <tr key={p.id}>
                        <td>{personCell(p)}</td>
                        <td>{roleCell(p, isManager)}</td>
                        <td className="hint">
                          {p.grantor_name ? `by ${p.grantor_name} · ` : ''}
                          {fmtDate(p.granted_at)}
                        </td>
                        {overview.canManage && (
                          <td className="po-actions-col">
                            {isMemberRow && !isSelf(p) && (
                              <button
                                type="button"
                                className="ghost-button small danger"
                                data-testid={`remove-member-${p.email}`}
                                onClick={() => removeMember(p)}
                              >
                                Remove
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {people.length === 0 && (
                    <tr>
                      <td colSpan={overview.canManage ? 4 : 3} className="hint">
                        No members yet. Add a collaborator to this project.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'activity' && (
          <div className="table-wrap">
            <table className="po-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Trigger</th>
                  <th>Name</th>
                  <th>User</th>
                  <th>Started at</th>
                </tr>
              </thead>
              <tbody>
                {overview.recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <span
                        className={`vis-badge ${run.status === 'SUCCESS' ? 'vis-active' : 'vis-inactive'}`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="hint">{run.trigger}</td>
                    <td>{run.request_name || run.workflow_name || '—'}</td>
                    <td className="hint">{run.user_name || '—'}</td>
                    <td className="hint">{fmtDate(run.started_at)}</td>
                  </tr>
                ))}
                {overview.recentRuns.length === 0 && (
                  <tr>
                    <td colSpan={5} className="hint">
                      No recent runs for this project.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {renameOpen && (
        <Modal title="Rename project" onClose={() => setRenameOpen(false)} testId="rename-project-modal">
          <form onSubmit={submitRename} className="modal-form">
            {renameError && (
              <p className="auth-error" role="alert" data-testid="rename-project-error">
                {renameError}
              </p>
            )}
            <label className="auth-field">
              <span>Name</span>
              <input
                type="text"
                autoFocus
                data-testid="rename-project-name"
                value={renameName}
                onChange={(e) => {
                  setRenameName(e.target.value);
                  setRenameError('');
                }}
                required
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => setRenameOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={renaming} data-testid="rename-project-submit">
                {renaming ? 'Saving…' : 'Rename'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

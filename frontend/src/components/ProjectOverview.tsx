'use client';

import React, { useEffect, useState } from 'react';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useApp } from '@/store/AppStore';
import {
  projectApi,
  type MemberRole,
  type OverviewPerson,
  type ProjectOrgUser,
} from '@/lib/api';
import { TabBar } from './TabBar';
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
  const [tab, setTab] = useState<TabId>('overview');
  const [orgUsers, setOrgUsers] = useState<ProjectOrgUser[]>([]);
  const [newUserId, setNewUserId] = useState('');
  const [newUserRole, setNewUserRole] = useState<MemberRole>('EDITOR');

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

  const roleLabel =
    overview.myAccess.isManager ||
    overview.myAccess.level === 'MANAGER' ||
    overview.myAccess.level === 'ADMIN'
      ? 'MANAGER'
      : overview.myAccess.level;

  const people: OverviewPerson[] = [...overview.managers, ...overview.members];
  const assignedIds = new Set(people.map((p) => p.id));

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
        <span className="po-person-name">{p.name || '—'}</span>
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
                    .filter((u) => !assignedIds.has(u.id))
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
                            {isMemberRow && (
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
    </div>
  );
}

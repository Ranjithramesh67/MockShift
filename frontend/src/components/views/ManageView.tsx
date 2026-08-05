'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  manageApi,
  type ManageOverview,
  type ManageProject,
  type ManageTeam,
  type AccessRequestRow,
  type AuditLogEntry,
  type RunHistoryEntry,
  type AdminUser,
  type ProjectDetail,
} from '@/lib/api';

type TabId = 'overview' | 'requests' | 'users' | 'projects' | 'teams' | 'audit' | 'history';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'requests', label: 'Access requests' },
  { id: 'users', label: 'Users' },
  { id: 'projects', label: 'Projects' },
  { id: 'teams', label: 'Teams' },
  { id: 'audit', label: 'Audit log' },
  { id: 'history', label: 'History' },
];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function ManageView() {
  const { user } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('overview');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [overview, setOverview] = useState<ManageOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [projects, setProjects] = useState<ManageProject[]>([]);
  const [teams, setTeams] = useState<ManageTeam[]>([]);
  const [requests, setRequests] = useState<AccessRequestRow[]>([]);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [runs, setRuns] = useState<RunHistoryEntry[]>([]);
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const canAdmin = user?.role === 'ADMIN';

  const loadOverview = () => manageApi.overview().then((r) => setOverview(r)).catch(() => undefined);
  const loadUsers = () => manageApi.users().then((r) => setUsers(r.users)).catch(() => undefined);
  const loadProjects = () => manageApi.projects().then((r) => setProjects(r.projects)).catch(() => undefined);
  const loadTeams = () => manageApi.teams().then((r) => setTeams(r.teams)).catch(() => undefined);
  const loadRequests = () => manageApi.accessRequests().then((r) => setRequests(r.accessRequests)).catch(() => undefined);
  const loadLogs = () => manageApi.auditLogs(100).then((r) => setLogs(r.logs)).catch(() => undefined);
  const loadHistory = () => manageApi.history(100).then((r) => setRuns(r.runs)).catch(() => undefined);

  useEffect(() => {
    if (!user) return;
    loadOverview();
    loadUsers();
    loadProjects();
    loadTeams();
    loadRequests();
    loadLogs();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user) return null;
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    return (
      <div className="auth-screen">
        <div className="auth-card" data-testid="manage-forbidden">
          <h1 className="auth-title">Manager access required</h1>
          <p>Only managers and administrators can view this section.</p>
          <button type="button" className="ghost-button" data-testid="manage-forbidden-back" onClick={() => router.push('/')}>
            Back to workspace
          </button>
        </div>
      </div>
    );
  }

  const review = async (r: AccessRequestRow, approve: boolean) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await manageApi.reviewRequest(r.id, approve);
      setNotice(approve ? 'Request approved.' : 'Request denied.');
      loadRequests();
      loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed');
    } finally {
      setBusy(false);
    }
  };

  const openProject = async (projectId: string) => {
    setError('');
    setNotice('');
    try {
      const detail = await manageApi.project(projectId);
      setProjectDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
    }
  };

  const assignManager = async (projectId: string, userId: string) => {
    if (!canAdmin) return;
    setError('');
    setBusy(true);
    try {
      await manageApi.assignManager(projectId, userId);
      setNotice('Manager assigned.');
      await openProject(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign manager');
    } finally {
      setBusy(false);
    }
  };

  const removeManager = async (projectId: string, userId: string) => {
    if (!canAdmin) return;
    setError('');
    setBusy(true);
    try {
      await manageApi.removeManager(projectId, userId);
      setNotice('Manager removed.');
      await openProject(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove manager');
    } finally {
      setBusy(false);
    }
  };

  const pendingRequests = requests.filter((r) => r.status === 'PENDING');
  const resolvedRequests = requests.filter((r) => r.status !== 'PENDING');

  return (
    <main className="admin-main" data-testid="manage-page">
      <div className="admin-title-row">
        <div>
          <h1>Management</h1>
          <p className="admin-subtitle">
            {overview ? (overview.scope === 'all' ? 'Platform-wide view' : 'View scoped to your managed projects') : 'Governance dashboard'}
          </p>
        </div>
        <div className="admin-header-actions">
          {canAdmin && (
            <button type="button" className="ghost-button" data-testid="manage-to-admin" onClick={() => router.push('/admin')}>
              Admin console
            </button>
          )}
          {pendingRequests.length > 0 && (
            <button type="button" className="primary-button" data-testid="goto-requests" onClick={() => setTab('requests')}>
              {pendingRequests.length} pending approval{pendingRequests.length > 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="auth-error" role="alert" data-testid="manage-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="test-result" data-testid="manage-notice">
          {notice}
        </p>
      )}

      <div className="manage-tabs" data-testid="manage-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`manage-tab ${tab === t.id ? 'active' : ''}`}
            data-testid={`manage-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'requests' && pendingRequests.length > 0 && <span className="bell-badge">{pendingRequests.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="overview-grid" data-testid="overview-grid">
          {overview
            ? Object.entries(overview.counts).map(([key, value]) => (
                <div key={key} className="stat-card" data-testid={`stat-${key}`}>
                  <span className="stat-value">{value}</span>
                  <span className="stat-label">{key.replace(/_/g, ' ')}</span>
                </div>
              ))
            : Object.keys({
                users: 0, projects: 0, teams: 0, workspaces: 0, runs: 0, pending_requests: 0, audit_entries: 0, automations: 0,
              }).map((key) => (
                <div key={key} className="stat-card">
                  <span className="stat-value">…</span>
                  <span className="stat-label">{key.replace(/_/g, ' ')}</span>
                </div>
              ))}
        </div>
      )}

      {tab === 'requests' && (
        <div data-testid="access-requests-section">
          <h2 className="manage-section-title">Pending</h2>
          {pendingRequests.length === 0 && <p className="hint">No pending access requests.</p>}
          {pendingRequests.map((r) => (
            <div key={r.id} className="request-row" data-testid={`request-row-${r.email}`}>
              <div className="request-row-main">
                <span className="admin-avatar">{r.name?.charAt(0).toUpperCase() ?? '?'}</span>
                <div>
                  <div className="admin-user-name">{r.name}</div>
                  <div className="admin-user-email">{r.email}</div>
                </div>
                <div className="request-row-meta">
                  <span className="vis-badge api-type-badge">{r.project_name}</span>
                  <span className="role-badge">{r.role}</span>
                  <span className="hint">{fmtDate(r.requested_at)}</span>
                </div>
              </div>
              {r.reason && <div className="request-reason">“{r.reason}”</div>}
              <div className="request-row-actions">
                <button type="button" className="ghost-button danger" data-testid={`deny-${r.email}`} disabled={busy} onClick={() => review(r, false)}>
                  Deny
                </button>
                <button type="button" className="primary-button" data-testid={`approve-${r.email}`} disabled={busy} onClick={() => review(r, true)}>
                  Approve
                </button>
              </div>
            </div>
          ))}

          <h2 className="manage-section-title">Reviewed</h2>
          {resolvedRequests.length === 0 && <p className="hint">Nothing reviewed yet.</p>}
          {resolvedRequests.map((r) => (
            <div key={r.id} className="request-row">
              <div className="request-row-main">
                <span className="admin-avatar">{r.name?.charAt(0).toUpperCase() ?? '?'}</span>
                <div>
                  <div className="admin-user-name">{r.name}</div>
                  <div className="admin-user-email">{r.email}</div>
                </div>
                <div className="request-row-meta">
                  <span className="vis-badge api-type-badge">{r.project_name}</span>
                  <span className={`vis-badge ${r.status === 'APPROVED' ? 'vis-active' : 'vis-inactive'}`}>{r.status}</span>
                  <span className="hint">{fmtDate(r.reviewed_at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'users' && (
        <div data-testid="manage-users-section">
          {!canAdmin && (
            <p className="hint" style={{ marginBottom: 12 }}>
              As a manager you can view users in your organisation. Role changes are managed by administrators.
            </p>
          )}
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} data-testid={`manage-user-${u.email}`}>
                  <td>
                    <div className="admin-user-cell">
                      <span className="admin-avatar">{u.name.charAt(0).toUpperCase()}</span>
                      <div>
                        <div className="admin-user-name">{u.name}</div>
                        <div className="admin-user-email">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="role-badge">{u.role}</span>
                  </td>
                  <td>
                    <span className={`vis-badge ${u.is_active ? 'vis-active' : 'vis-inactive'}`}>
                      {u.is_active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="hint">{fmtDate(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'projects' && (
        <div data-testid="manage-projects-section">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Workspace</th>
                <th>Collections</th>
                <th>Requests</th>
                <th>Role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} data-testid={`manage-project-${p.name}`}>
                  <td className="admin-user-name">{p.name}</td>
                  <td className="hint">{p.workspace_name}</td>
                  <td>{p.collections}</td>
                  <td>{p.requests}</td>
                  <td>
                    {p.is_manager ? <span className="vis-badge access-badge">MANAGER</span> : <span className="hint">—</span>}
                  </td>
                  <td>
                    <button type="button" className="ghost-button small" data-testid={`open-project-${p.name}`} onClick={() => openProject(p.id)}>
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {projectDetail && (
            <div className="modal-overlay" data-testid="project-detail-modal" onClick={() => setProjectDetail(null)}>
              <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>{projectDetail.project.name}</h2>
                  <span className="hint">{projectDetail.project.workspace_name}</span>
                </div>
                <div className="modal-body">
                  <h3 className="manage-section-title">Managers</h3>
                  <ul className="manage-member-list">
                    {projectDetail.managers.map((m) => (
                      <li key={m.id} className="manage-member-row">
                        <span className="admin-avatar">{m.name.charAt(0).toUpperCase()}</span>
                        <span className="admin-user-name">{m.name}</span>
                        <span className="hint">{m.email}</span>
                        {canAdmin && (
                          <button
                            type="button"
                            className="ghost-button small danger"
                            data-testid={`remove-manager-${m.email}`}
                            onClick={() => removeManager(projectDetail.project.id, m.id)}
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    ))}
                    {projectDetail.managers.length === 0 && <p className="hint">No managers assigned.</p>}
                  </ul>

                  {canAdmin && (
                    <>
                      <h3 className="manage-section-title">Assign manager</h3>
                      <select
                        className="compact-select"
                        data-testid="assign-manager-select"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) assignManager(projectDetail.project.id, e.target.value);
                          e.target.value = '';
                        }}
                      >
                        <option value="" disabled>
                          Choose a user…
                        </option>
                        {users
                          .filter((u) => u.is_active && !projectDetail.managers.some((m) => m.id === u.id))
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({u.email})
                            </option>
                          ))}
                      </select>
                    </>
                  )}

                  <h3 className="manage-section-title">Members</h3>
                  <ul className="manage-member-list">
                    {projectDetail.members.map((m) => (
                      <li key={m.id} className="manage-member-row">
                        <span className="admin-avatar">{m.name.charAt(0).toUpperCase()}</span>
                        <span className="admin-user-name">{m.name}</span>
                        <span className="hint">{m.email}</span>
                        <span className="role-badge">{m.role}</span>
                      </li>
                    ))}
                    {projectDetail.members.length === 0 && <p className="hint">No members yet.</p>}
                  </ul>

                  <h3 className="manage-section-title">Access requests</h3>
                  <ul className="manage-member-list">
                    {projectDetail.requests.map((r) => (
                      <li key={r.id} className="manage-member-row">
                        <span className="admin-avatar">{r.name.charAt(0).toUpperCase()}</span>
                        <span className="admin-user-name">{r.name}</span>
                        <span className="hint">{fmtDate(r.requested_at)}</span>
                        <span className={`vis-badge ${r.status === 'APPROVED' ? 'vis-active' : r.status === 'DENIED' ? 'vis-inactive' : 'pending-badge'}`}>
                          {r.status}
                        </span>
                      </li>
                    ))}
                    {projectDetail.requests.length === 0 && <p className="hint">No requests for this project.</p>}
                  </ul>
                </div>
                <div className="modal-actions">
                  <button type="button" className="ghost-button" data-testid="close-project-detail" onClick={() => setProjectDetail(null)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'teams' && (
        <table className="admin-table" data-testid="manage-teams-section">
          <thead>
            <tr>
              <th>Name</th>
              <th>Members</th>
              <th>Org</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id}>
                <td className="admin-user-name">{t.name}</td>
                <td>{t.members}</td>
                <td className="hint">{t.organization_id ?? '—'}</td>
              </tr>
            ))}
            {teams.length === 0 && (
              <tr>
                <td colSpan={3} className="hint">
                  No teams.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {tab === 'audit' && (
        <table className="admin-table" data-testid="manage-audit-section">
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="hint">{fmtDate(l.created_at)}</td>
                <td>{l.actor_email ?? 'system'}</td>
                <td>
                  <span className="vis-badge access-badge">{l.action}</span>
                </td>
                <td className="hint">
                  {l.entity_type}
                  {l.entity_id ? ` · ${l.entity_id.slice(0, 8)}` : ''}
                </td>
                <td className="hint">{l.detail ? JSON.stringify(l.detail) : '—'}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="hint">
                  No audit entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {tab === 'history' && (
        <table className="admin-table" data-testid="manage-history-section">
          <thead>
            <tr>
              <th>Time</th>
              <th>Name</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>User</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="hint">{fmtDate(r.started_at)}</td>
                <td>{r.name ?? '—'}</td>
                <td className="hint">{r.trigger}</td>
                <td>
                  <span className={`vis-badge ${r.status === 'SUCCESS' ? 'vis-active' : 'vis-inactive'}`}>{r.status}</span>
                </td>
                <td className="hint">{r.user_email ?? 'system'}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={5} className="hint">
                  No runs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </main>
  );
}

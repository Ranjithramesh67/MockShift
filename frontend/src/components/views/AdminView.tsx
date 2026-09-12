'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  adminApi,
  type AdminUser,
  type UserRole,
  type AdminAccessOverview,
  type AdminAccessProject,
  type AdminAccessWorkspace,
  type AdminMenuSettingRow,
  type AdminMenusResponse,
  type MenuKey,
} from '@/lib/api';

type Tab = 'users' | 'access' | 'menus';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'users', label: 'Users' },
  { id: 'access', label: 'Access' },
  { id: 'menus', label: 'Menus' },
];

const ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER'];

export function AdminView() {
  const { user } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', username: '', email: '', role: 'EDITOR' as UserRole, password: '' });

  const loadUsers = () => {
    if (!user) return;
    adminApi
      .users()
      .then((res) => setUsers(res.users))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load users'));
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user) return null;
  if (user.role !== 'ADMIN') {
    return (
      <div className="auth-screen">
        <div className="auth-card" data-testid="admin-forbidden">
          <h1 className="auth-title">Admin access required</h1>
          <p>Only administrators can view this section.</p>
          <button type="button" className="ghost-button" data-testid="admin-forbidden-back" onClick={() => router.push('/')}>
            Back to workspace
          </button>
        </div>
      </div>
    );
  }

  const patch = async (u: AdminUser, change: { role?: UserRole; isActive?: boolean }) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await adminApi.patchUser(u.id, change);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...change } : x)));
      setNotice('User updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const createUser = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await adminApi.createUser(createForm);
      setNotice(`User "${createForm.username || createForm.email}" created.`);
      setCreateOpen(false);
      setCreateForm({ name: '', username: '', email: '', role: 'EDITOR', password: '' });
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await fn();
      setNotice(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : label);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-main" data-testid="admin-page">
      <div className="admin-title-row">
        <div>
          <h1>Administration</h1>
          <p className="admin-subtitle">Manage platform roles, user access and account status.</p>
        </div>
        {tab === 'users' && (
          <button type="button" className="primary-button" data-testid="create-user-open" onClick={() => setCreateOpen(true)}>
            Create user
          </button>
        )}
      </div>
      {error && (
        <p className="auth-error" role="alert" data-testid="admin-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="test-result" data-testid="admin-notice">
          {notice}
        </p>
      )}

      <div className="manage-tabs" data-testid="admin-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`manage-tab ${tab === t.id ? 'active' : ''}`}
            data-testid={`admin-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <UsersTab users={users} currentUserId={user.id} busy={busy} onPatch={patch} />
      )}

      {tab === 'access' && (
        <AccessTab allUsers={users} busy={busy} onRun={run} />
      )}

      {tab === 'menus' && <MenusTab busy={busy} onRun={run} />}

      {createOpen && (
        <div className="modal-overlay" data-testid="create-user-modal" onClick={() => setCreateOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create user</h2>
            </div>
            <div className="modal-body">
              <div className="modal-form">
                <label className="field">
                  <span className="field-label">Name</span>
                  <input
                    className="text-input"
                    data-testid="create-user-name"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Username</span>
                  <input
                    className="text-input"
                    data-testid="create-user-username"
                    value={createForm.username}
                    onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Email</span>
                  <input
                    className="text-input"
                    type="email"
                    data-testid="create-user-email"
                    value={createForm.email}
                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Role</span>
                  <select
                    className="compact-select"
                    data-testid="create-user-role"
                    value={createForm.role}
                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as UserRole })}
                  >
                    <option value="MANAGER">MANAGER</option>
                    <option value="EDITOR">EDITOR</option>
                    <option value="VIEWER">VIEWER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Password (min 8 chars)</span>
                  <input
                    className="text-input"
                    type="password"
                    data-testid="create-user-password"
                    value={createForm.password}
                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  />
                </label>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost-button" data-testid="create-user-cancel" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                data-testid="create-user-confirm"
                disabled={busy || !createForm.email || !createForm.name || !createForm.username || createForm.password.length < 8}
                onClick={createUser}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function UsersTab({ users, currentUserId, busy, onPatch }: {
  users: AdminUser[];
  currentUserId: string;
  busy: boolean;
  onPatch: (u: AdminUser, change: { role?: UserRole; isActive?: boolean }) => Promise<void>;
}) {
  return (
    <div className="table-wrap table-stack">
      <table className="admin-table" data-testid="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>Projects</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} data-testid={`admin-user-${u.email}`}>
              <td data-label="Name">
                <div className="admin-user-cell">
                  <span className="admin-avatar">{u.name.charAt(0).toUpperCase()}</span>
                  <div>
                    <div className="admin-user-name">{u.name}</div>
                    <div className="admin-user-email">@{u.username}</div>
                  </div>
                </div>
              </td>
              <td data-label="Role">
                <select
                  className="compact-select"
                  value={u.role}
                  disabled={u.id === currentUserId || busy}
                  data-testid={`admin-role-${u.email}`}
                  onChange={(e) => onPatch(u, { role: e.target.value as UserRole })}
                >
                  <option value="ADMIN">ADMIN</option>
                  <option value="MANAGER">MANAGER</option>
                  <option value="EDITOR">EDITOR</option>
                  <option value="VIEWER">VIEWER</option>
                </select>
              </td>
              <td data-label="Status">
                <span className={`vis-badge ${u.is_active ? 'vis-active' : 'vis-inactive'}`}>
                  {u.is_active ? 'active' : 'inactive'}
                </span>
              </td>
              <td data-label="Projects">
                {u.projects && u.projects.length > 0 ? (
                  <div className="admin-project-chips" data-testid={`admin-projects-${u.email}`}>
                    {u.projects.map((p) => (
                      <span key={p.id} className={`admin-project-chip ${p.kind === 'manager' ? 'is-manager' : ''}`} title={`${p.kind === 'manager' ? 'Manager' : 'Member'} of ${p.name}`}>
                        {p.name}
                        <span className="admin-project-role">{p.kind === 'manager' ? 'MANAGER' : p.role}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="hint">—</span>
                )}
              </td>
              <td>
                <button
                  type="button"
                  className="ghost-button small"
                  disabled={u.id === currentUserId || busy}
                  data-testid={`admin-toggle-${u.email}`}
                  onClick={() => onPatch(u, { isActive: !u.is_active })}
                >
                  {u.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccessTab({ allUsers, busy, onRun }: {
  allUsers: AdminUser[];
  busy: boolean;
  onRun: (label: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [overview, setOverview] = useState<AdminAccessOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeUsers, setActiveUsers] = useState<AdminUser[]>([]);

  const showError = (msg: string) => {
    onRun('', () => Promise.reject(new Error(msg))).catch(() => undefined);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [acc, us] = await Promise.all([adminApi.access(), adminApi.users()]);
      setOverview(acc);
      setActiveUsers(us.users.filter((u) => u.is_active));
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to load access');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addProjectMember = async (p: AdminAccessProject, userId: string, role: UserRole = 'VIEWER') => {
    if (!userId) return;
    await onRun(`Granted "${findUser(userId)?.name ?? userId}" access to "${p.name}".`, () =>
      adminApi.grantProjectMember(p.id, { userId, role }).then(() => load())
    );
  };

  const removeProjectMember = async (p: AdminAccessProject, userId: string) => {
    await onRun(`Revoked project access for "${findUser(userId)?.name ?? userId}".`, () =>
      adminApi.revokeProjectMember(p.id, userId).then(() => load())
    );
  };

  const addManager = async (p: AdminAccessProject, userId: string) => {
    if (!userId) return;
    await onRun(`Assigned "${findUser(userId)?.name ?? userId}" as manager of "${p.name}".`, () =>
      adminApi.assignManager(p.id, userId).then(() => load())
    );
  };

  const removeManager = async (p: AdminAccessProject, userId: string) => {
    await onRun(`Removed manager "${findUser(userId)?.name ?? userId}" from "${p.name}".`, () =>
      adminApi.removeManager(p.id, userId).then(() => load())
    );
  };

  const addWorkspaceMember = async (w: AdminAccessWorkspace, userId: string, role: UserRole = 'VIEWER') => {
    if (!userId) return;
    await onRun(`Granted "${findUser(userId)?.name ?? userId}" access to workspace "${w.name}".`, () =>
      adminApi.grantWorkspaceMember(w.id, { userId, role }).then(() => load())
    );
  };

  const removeWorkspaceMember = async (w: AdminAccessWorkspace, userId: string) => {
    await onRun(`Revoked workspace access for "${findUser(userId)?.name ?? userId}".`, () =>
      adminApi.revokeWorkspaceMember(w.id, userId).then(() => load())
    );
  };

  const findUser = (id: string) => activeUsers.find((u) => u.id === id);

  if (loading) return <p className="hint">Loading access overview…</p>;
  if (!overview) return <p className="hint">No access data.</p>;

  return (
    <div data-testid="admin-access-section">
      <div className="admin-title-row" style={{ marginTop: 8 }}>
        <p className="hint">
          Grant or revoke project and workspace membership directly. Managers also control
          access requests for their projects.
        </p>
        <button type="button" className="ghost-button small" data-testid="refresh-access" onClick={load}>
          Refresh
        </button>
      </div>

      <h2 className="manage-section-title">Projects</h2>
      {overview.projects.length === 0 && <p className="hint">No projects.</p>}
      {overview.projects.map((p) => (
        <div key={p.id} className="admin-access-card" data-testid={`access-project-${p.name}`}>
          <div className="admin-access-card-head">
            <span className="admin-user-name">{p.name}</span>
            <span className="hint">{p.workspace_name}</span>
          </div>

          <MemberSection
            title="Managers"
            members={p.managers.map((m) => ({ id: m.id, name: m.name, email: m.email, role: 'MANAGER' as UserRole }))}
            busy={busy}
            candidateUsers={activeUsers.filter((u) => !p.managers.some((m) => m.id === u.id))}
            addLabel="Assign manager"
            addRoleOnly={false}
            onAdd={(userId) => addManager(p, userId)}
            onRemove={(userId) => removeManager(p, userId)}
          />

          <MemberSection
            title="Members"
            members={p.members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role ?? 'VIEWER' }))}
            busy={busy}
            candidateUsers={activeUsers.filter((u) => !p.members.some((m) => m.id === u.id))}
            addLabel="Grant access"
            addRoleOnly
            onAdd={(userId, role) => addProjectMember(p, userId, role)}
            onRemove={(userId) => removeProjectMember(p, userId)}
          />
        </div>
      ))}

      <h2 className="manage-section-title">Workspaces</h2>
      {overview.workspaces.length === 0 && <p className="hint">No workspaces.</p>}
      {overview.workspaces.map((w) => (
        <div key={w.id} className="admin-access-card" data-testid={`access-workspace-${w.name}`}>
          <div className="admin-access-card-head">
            <span className="admin-user-name">{w.name}</span>
            <span className="hint">{w.organization_name}</span>
          </div>

          <MemberSection
            title="Members"
            members={w.members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role ?? 'VIEWER' }))}
            busy={busy}
            candidateUsers={activeUsers.filter((u) => !w.members.some((m) => m.id === u.id))}
            addLabel="Grant access"
            addRoleOnly
            onAdd={(userId, role) => addWorkspaceMember(w, userId, role)}
            onRemove={(userId) => removeWorkspaceMember(w, userId)}
          />
        </div>
      ))}
    </div>
  );
}

function MemberSection({ title, members, busy, candidateUsers, addLabel, addRoleOnly, onAdd, onRemove }: {
  title: string;
  members: Array<{ id: string; name: string; email: string; role: UserRole }>;
  busy: boolean;
  candidateUsers: Array<{ id: string; name: string; email: string }>;
  addLabel: string;
  addRoleOnly: boolean;
  onAdd: (userId: string, role?: UserRole) => void;
  onRemove: (userId: string) => void;
}) {
  const [selUser, setSelUser] = useState('');
  const [selRole, setSelRole] = useState<UserRole>('EDITOR');

  return (
    <div className="admin-access-members">
      <h3 className="manage-section-title">{title}</h3>
      <ul className="manage-member-list">
        {members.map((m) => (
          <li key={m.id} className="manage-member-row">
            <span className="admin-avatar">{m.name.charAt(0).toUpperCase()}</span>
            <span className="admin-user-name">{m.name}</span>
            <span className="hint">{m.email}</span>
            <span className="role-badge">{m.role}</span>
            <button
              type="button"
              className="ghost-button small danger"
              disabled={busy}
              data-testid={`remove-${title.toLowerCase()}-${m.email}`}
              onClick={() => onRemove(m.id)}
            >
              Remove
            </button>
          </li>
        ))}
        {members.length === 0 && <p className="hint">None.</p>}
      </ul>
      <div className="admin-access-add">
        <select
          className="compact-select"
          data-testid={`add-${title.toLowerCase()}-user`}
          value={selUser}
          disabled={busy}
          onChange={(e) => setSelUser(e.target.value)}
        >
          <option value="" disabled>
            Choose a user…
          </option>
          {candidateUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
        {addRoleOnly && (
          <select
            className="compact-select"
            data-testid={`add-${title.toLowerCase()}-role`}
            value={selRole}
            disabled={busy}
            onChange={(e) => setSelRole(e.target.value as UserRole)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="primary-button small"
          disabled={busy || !selUser}
          data-testid={`add-${title.toLowerCase()}-confirm`}
          onClick={() => {
            if (!selUser) return;
            onAdd(selUser, addRoleOnly ? selRole : undefined);
            setSelUser('');
          }}
        >
          {addLabel}
        </button>
      </div>
    </div>
  );
}

function MenusTab({ busy, onRun }: {
  busy: boolean;
  onRun: (label: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [data, setData] = useState<AdminMenusResponse | null>(null);
  const [scope, setScope] = useState<'org' | 'project'>('org');
  const [menuKey, setMenuKey] = useState<MenuKey>('docs');
  const [targetId, setTargetId] = useState('');
  const [enabled, setEnabled] = useState(false);

  const load = async () => {
    try {
      setData(await adminApi.menus());
    } catch (err) {
      await onRun(err instanceof Error ? err.message : 'Failed to load menus', () => Promise.reject(new Error('load')));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return <p className="hint">Loading menu settings…</p>;

  const targets = scope === 'org' ? data.organizations : data.projects;
  const scopeLabel = (s: AdminMenuSettingRow) =>
    s.scope === 'org' ? s.organization_name : `${s.workspace_name ?? ''} / ${s.project_name ?? ''}`;

  return (
    <div data-testid="admin-menus-section">
      <p className="hint">
        Disable a feature for an entire organization or a single project. A missing override means the
        feature is enabled. Project overrides beat organization overrides.
      </p>

      <div className="admin-access-add" style={{ marginTop: 12 }}>
        <select
          className="compact-select"
          data-testid="menu-key"
          value={menuKey}
          disabled={busy}
          onChange={(e) => setMenuKey(e.target.value as MenuKey)}
        >
          {data.keys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          className="compact-select"
          data-testid="menu-scope"
          value={scope}
          disabled={busy}
          onChange={(e) => {
            setScope(e.target.value as 'org' | 'project');
            setTargetId('');
          }}
        >
          <option value="org">Organization</option>
          <option value="project">Project</option>
        </select>
        <select
          className="compact-select"
          data-testid="menu-target"
          value={targetId}
          disabled={busy}
          onChange={(e) => setTargetId(e.target.value)}
        >
          <option value="" disabled>
            Choose a target…
          </option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {scope === 'org' ? t.name : `${(t as { workspace_name?: string }).workspace_name} / ${t.name}`}
            </option>
          ))}
        </select>
        <label className="field" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            data-testid="menu-enabled"
            checked={enabled}
            disabled={busy}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Enabled</span>
        </label>
        <button
          type="button"
          className="primary-button small"
          data-testid="menu-save"
          disabled={busy || !targetId}
          onClick={() =>
            onRun(`Menu "${menuKey}" override saved.`, async () => {
              await adminApi.setMenu({
                menuKey,
                scope,
                organizationId: scope === 'org' ? targetId : undefined,
                projectId: scope === 'project' ? targetId : undefined,
                enabled,
              });
              await load();
            })}
        >
          Save override
        </button>
      </div>

      <div className="table-wrap table-stack" style={{ marginTop: 16 }}>
        <table className="admin-table" data-testid="admin-menus-table">
          <thead>
            <tr>
              <th>Menu</th>
              <th>Scope</th>
              <th>Target</th>
              <th>State</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.settings.length === 0 && (
              <tr>
                <td colSpan={5} className="hint">
                  No overrides — every feature is enabled.
                </td>
              </tr>
            )}
            {data.settings.map((s) => (
              <tr key={s.id} data-testid={`menu-setting-${s.id}`}>
                <td data-label="Menu">{s.menu_key}</td>
                <td data-label="Scope">{s.scope}</td>
                <td data-label="Target">{scopeLabel(s)}</td>
                <td data-label="State">
                  <span className={`vis-badge ${s.enabled ? 'vis-active' : 'vis-inactive'}`}>
                    {s.enabled ? 'enabled' : 'disabled'}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="ghost-button small danger"
                    disabled={busy}
                    data-testid={`menu-remove-${s.id}`}
                    onClick={() =>
                      onRun('Override removed.', async () => {
                        await adminApi.deleteMenu(s.id);
                        await load();
                      })}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

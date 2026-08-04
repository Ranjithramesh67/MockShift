'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { adminApi, type AdminUser, type UserRole } from '@/lib/api';

export default function AdminPage() {
  const { loading, user } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', email: '', role: 'EDITOR' as UserRole, password: '' });

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  const load = () => {
    if (!user) return;
    adminApi
      .users()
      .then((res) => setUsers(res.users))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load users'));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (loading) return <div className="loading-screen">Loading…</div>;
  if (!user) return null;
  if (user.role !== 'ADMIN') {
    return (
      <div className="auth-screen">
        <div className="auth-card" data-testid="admin-forbidden">
          <h1 className="auth-title">Admin access required</h1>
          <p>Only administrators can view this page.</p>
          <Link href="/" className="ghost-button">
            Back to workspace
          </Link>
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
      setNotice(`User "${createForm.email}" created.`);
      setCreateOpen(false);
      setCreateForm({ name: '', email: '', role: 'EDITOR', password: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-page" data-testid="admin-page">
      <header className="admin-header">
        <div className="brand">
          <span className="brand-mark">AH</span>
          <span className="brand-name">API Hub</span>
          <span className="brand-env">Admin</span>
        </div>
        <div className="admin-header-actions">
          <Link href="/manage" className="ghost-button" data-testid="manage-link">
            Manage
          </Link>
          <Link href="/" className="ghost-button" data-testid="back-to-app">
            Back to workspace
          </Link>
        </div>
      </header>
      <main className="admin-main">
        <div className="admin-title-row">
          <div>
            <h1>Users</h1>
            <p className="admin-subtitle">Manage platform roles and account status.</p>
          </div>
          <button type="button" className="primary-button" data-testid="create-user-open" onClick={() => setCreateOpen(true)}>
            Create user
          </button>
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
        <table className="admin-table" data-testid="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} data-testid={`admin-user-${u.email}`}>
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
                  <select
                    className="compact-select"
                    value={u.role}
                    disabled={u.id === user.id || busy}
                    data-testid={`admin-role-${u.email}`}
                    onChange={(e) => patch(u, { role: e.target.value as UserRole })}
                  >
                    <option value="ADMIN">ADMIN</option>
                    <option value="MANAGER">MANAGER</option>
                    <option value="EDITOR">EDITOR</option>
                    <option value="VIEWER">VIEWER</option>
                  </select>
                </td>
                <td>
                  <span className={`vis-badge ${u.is_active ? 'vis-active' : 'vis-inactive'}`}>
                    {u.is_active ? 'active' : 'inactive'}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="ghost-button small"
                    disabled={u.id === user.id || busy}
                    data-testid={`admin-toggle-${u.email}`}
                    onClick={() => patch(u, { isActive: !u.is_active })}
                  >
                    {u.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

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
                  disabled={busy || !createForm.email || !createForm.name || createForm.password.length < 8}
                  onClick={createUser}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

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

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    adminApi
      .users()
      .then((res) => setUsers(res.users))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load users'));
  }, [user]);

  if (loading) return <div className="auth-screen">Loading…</div>;
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

  return (
    <div className="admin-page" data-testid="admin-page">
      <header className="admin-header">
        <div className="brand">
          <span className="brand-mark">AH</span>
          <span className="brand-name">API Hub</span>
          <span className="brand-env">Admin</span>
        </div>
        <Link href="/" className="ghost-button" data-testid="back-to-app">
          Back to workspace
        </Link>
      </header>
      <main className="admin-main">
        <h1>Users</h1>
        {error && (
          <p className="auth-error" role="alert" data-testid="admin-error">
            {error}
          </p>
        )}
        {notice && <p className="test-result" data-testid="admin-notice">{notice}</p>}
        <table className="admin-table" data-testid="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} data-testid={`admin-user-${u.email}`}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <select
                    className="compact-select"
                    value={u.role}
                    disabled={u.id === user.id || busy}
                    data-testid={`admin-role-${u.email}`}
                    onChange={(e) => patch(u, { role: e.target.value as UserRole })}
                  >
                    <option value="ADMIN">ADMIN</option>
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
      </main>
    </div>
  );
}

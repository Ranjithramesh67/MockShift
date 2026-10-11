'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  iamApi,
  type IamMember,
  type IamOrg,
  type IamPermissionGroup,
  type IamRole,
} from '@/lib/api';

type Tab = 'members' | 'roles';

const FORBIDDEN_MESSAGE =
  'You do not have permission to manage roles or members in this organization.';

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 403) return FORBIDDEN_MESSAGE;
  return err instanceof Error && err.message ? err.message : fallback;
}

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

export function IamView() {
  const [orgs, setOrgs] = useState<IamOrg[]>([]);
  const [orgId, setOrgId] = useState('');
  const [groups, setGroups] = useState<IamPermissionGroup[]>([]);
  const [roles, setRoles] = useState<IamRole[]>([]);
  const [members, setMembers] = useState<IamMember[]>([]);
  const [perms, setPerms] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgError, setOrgError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [actionError, setActionError] = useState('');
  const [objLoading, setObjLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('members');
  const [roleModal, setRoleModal] = useState<{ mode: 'create' | 'edit'; role: IamRole | null } | null>(null);
  const [memberModal, setMemberModal] = useState<IamMember | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    iamApi
      .orgs()
      .then((res) => {
        if (cancelled) return;
        setOrgs(res.organizations);
        const preferred = res.organizations.find((o) => o.isAdmin) ?? res.organizations[0] ?? null;
        setOrgId(preferred ? preferred.id : '');
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setOrgError(errorMessage(err, 'Failed to load organizations'));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    iamApi
      .permissions()
      .then((res) => setGroups(res.groups))
      .catch(() => setGroups([]));
  }, []);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setObjLoading(true);
    setLoadError('');
    setActionError('');
    setForbidden(false);
    setPerms(null);

    iamApi
      .myPermissions(orgId)
      .then((res) => {
        if (!cancelled) setPerms(res.permissions);
      })
      .catch(() => {
        if (!cancelled) setPerms(null);
      });

    Promise.all([iamApi.roles(orgId), iamApi.members(orgId)])
      .then(([roleRes, memberRes]) => {
        if (cancelled) return;
        setRoles(roleRes.roles);
        setMembers(memberRes.members);
      })
      .catch((err) => {
        if (cancelled) return;
        setRoles([]);
        setMembers([]);
        setLoadError(errorMessage(err, 'Failed to load organization access'));
        setForbidden(isForbidden(err));
      })
      .finally(() => {
        if (!cancelled) setObjLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, refreshKey]);

  const permissionLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) {
      for (const perm of group.permissions) map.set(perm.key, perm.label);
    }
    return map;
  }, [groups]);

  const selectedOrg = orgs.find((o) => o.id === orgId) ?? null;
  const canManageRoles = perms ? perms.includes('org.manage_roles') : Boolean(selectedOrg?.isAdmin);
  const canManageMembers = perms ? perms.includes('org.manage_members') : Boolean(selectedOrg?.isAdmin);

  const deleteRole = async (role: IamRole) => {
    if (!window.confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    setActionError('');
    try {
      await iamApi.deleteRole(orgId, role.id);
      reload();
    } catch (err) {
      setActionError(errorMessage(err, 'Failed to delete role'));
      if (isForbidden(err)) setForbidden(true);
    }
  };

  if (loading) {
    return (
      <main className="admin-main" data-testid="iam-view">
        <p className="hint" data-testid="iam-loading">
          Loading access…
        </p>
      </main>
    );
  }

  if (orgs.length === 0) {
    return (
      <main className="admin-main" data-testid="iam-view">
        <div className="iam-empty" data-testid="iam-empty">
          <h1>Access</h1>
          <p className="hint">You are not a member of any organization yet.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="admin-main" data-testid="iam-view">
      <div className="admin-title-row">
        <div>
          <h1>Access</h1>
          <p className="admin-subtitle">Manage organization members and fine-grained roles.</p>
        </div>
        <label className="iam-org-picker">
          <span className="field-label">Organization</span>
          <select
            className="compact-select"
            data-testid="iam-org-select"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {orgError && (
        <p className="auth-error" role="alert" data-testid="iam-error">
          {orgError}
        </p>
      )}

      <div className="manage-tabs" data-testid="iam-tabs">
        <button
          type="button"
          className={`manage-tab ${tab === 'members' ? 'active' : ''}`}
          data-testid="iam-tab-members"
          onClick={() => setTab('members')}
        >
          Members
        </button>
        <button
          type="button"
          className={`manage-tab ${tab === 'roles' ? 'active' : ''}`}
          data-testid="iam-tab-roles"
          onClick={() => setTab('roles')}
        >
          Roles
        </button>
      </div>

      {loadError && (
        <p className="auth-error" role="alert" data-testid="iam-load-error">
          {loadError}
        </p>
      )}
      {actionError && (
        <p className="auth-error" role="alert" data-testid="iam-action-error">
          {actionError}
        </p>
      )}

      {forbidden ? (
        <div className="iam-empty" data-testid="iam-forbidden">
          <h2>Access restricted</h2>
          <p className="hint">{FORBIDDEN_MESSAGE}</p>
        </div>
      ) : objLoading ? (
        <p className="hint">Loading…</p>
      ) : tab === 'members' ? (
        <MembersTab
          members={members}
          canManage={canManageMembers}
          onManage={setMemberModal}
        />
      ) : (
        <RolesTab
          roles={roles}
          permissionLabels={permissionLabels}
          canManage={canManageRoles}
          onCreate={() => setRoleModal({ mode: 'create', role: null })}
          onEdit={(role) => setRoleModal({ mode: 'edit', role })}
          onDelete={deleteRole}
        />
      )}

      {memberModal && (
        <MemberRolesModal
          member={memberModal}
          roles={roles}
          orgId={orgId}
          onClose={() => setMemberModal(null)}
          onSaved={() => {
            setMemberModal(null);
            reload();
          }}
        />
      )}

      {roleModal && (
        <RoleModal
          mode={roleModal.mode}
          role={roleModal.role}
          groups={groups}
          orgId={orgId}
          onClose={() => setRoleModal(null)}
          onSaved={() => {
            setRoleModal(null);
            reload();
          }}
        />
      )}
    </main>
  );
}

function MembersTab({
  members,
  canManage,
  onManage,
}: {
  members: IamMember[];
  canManage: boolean;
  onManage: (member: IamMember) => void;
}) {
  if (members.length === 0) return <p className="hint">No members in this organization.</p>;
  return (
    <div className="table-wrap table-stack">
      <table className="admin-table" data-testid="iam-members-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Legacy role</th>
            <th>Roles</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId} data-testid="iam-member-row" data-user-id={m.userId}>
              <td data-label="Member">
                <div className="admin-user-cell">
                  <span className="admin-avatar">
                    {(m.name || m.username || m.email || '?').charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <div className="admin-user-name">
                      {m.name}
                      {m.isOwner && <span className="vis-badge iam-owner-badge">Owner</span>}
                    </div>
                    <div className="admin-user-email">{m.email || `@${m.username}`}</div>
                  </div>
                </div>
              </td>
              <td data-label="Legacy role">
                <span className={`role-badge role-${m.legacyRole}`}>{m.legacyRole}</span>
              </td>
              <td data-label="Roles">
                <div className="iam-role-chips">
                  {m.roles.length === 0 && <span className="hint">—</span>}
                  {m.roles.map((r) => (
                    <span key={r.id} className="role-badge">
                      {r.name}
                    </span>
                  ))}
                </div>
              </td>
              <td>
                {canManage && (
                  <button
                    type="button"
                    className="ghost-button small"
                    data-testid={`iam-manage-roles-${m.userId}`}
                    onClick={() => onManage(m)}
                  >
                    Manage roles
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RolesTab({
  roles,
  permissionLabels,
  canManage,
  onCreate,
  onEdit,
  onDelete,
}: {
  roles: IamRole[];
  permissionLabels: Map<string, string>;
  canManage: boolean;
  onCreate: () => void;
  onEdit: (role: IamRole) => void;
  onDelete: (role: IamRole) => void;
}) {
  const summary = (role: IamRole) => {
    if (role.permissions.length === 0) return 'No permissions';
    return role.permissions.map((key) => permissionLabels.get(key) ?? key).join(', ');
  };

  return (
    <div>
      <div className="admin-title-row">
        <p className="hint">
          System roles are built in. Create custom roles to grant a precise set of permissions.
        </p>
        {canManage && (
          <button
            type="button"
            className="primary-button small"
            data-testid="iam-create-role"
            onClick={onCreate}
          >
            Create role
          </button>
        )}
      </div>

      {roles.length === 0 ? (
        <p className="hint">No roles defined yet.</p>
      ) : (
        <div className="table-wrap table-stack">
          <table className="admin-table" data-testid="iam-roles-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Permissions</th>
                <th>Members</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id} data-testid="iam-role-row" data-role-id={role.id}>
                  <td data-label="Role">
                    <div className="iam-role-name">
                      <span className="admin-user-name">{role.name}</span>
                      {role.isSystem && <span className="vis-badge iam-system-badge">System</span>}
                    </div>
                    {role.description && <div className="hint">{role.description}</div>}
                  </td>
                  <td data-label="Permissions">
                    <span className="iam-perm-summary" title={summary(role)}>
                      {summary(role)}
                    </span>
                  </td>
                  <td data-label="Members">{role.memberCount}</td>
                  <td>
                    {role.isSystem || !canManage ? (
                      <span className="hint">—</span>
                    ) : (
                      <div className="iam-row-actions">
                        <button
                          type="button"
                          className="ghost-button small"
                          data-testid={`iam-edit-role-${role.id}`}
                          onClick={() => onEdit(role)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="ghost-button small danger"
                          data-testid={`iam-delete-role-${role.id}`}
                          onClick={() => onDelete(role)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MemberRolesModal({
  member,
  roles,
  orgId,
  onClose,
  onSaved,
}: {
  member: IamMember;
  roles: IamRole[];
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(member.roles.map((r) => r.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await iamApi.setMemberRoles(orgId, member.userId, selected);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Failed to update roles'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" data-testid="iam-member-roles-modal" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Roles for {member.name}</h2>
        </div>
        <div className="modal-body">
          <div className="modal-form iam-perm-list">
            {roles.length === 0 && <p className="hint">No roles available.</p>}
            {roles.map((role) => (
              <label key={role.id} className="iam-check-row">
                <input
                  type="checkbox"
                  data-testid={`iam-member-role-${role.id}`}
                  checked={selected.includes(role.id)}
                  disabled={saving}
                  onChange={() => toggle(role.id)}
                />
                <span>{role.name}</span>
                {role.isSystem && <span className="vis-badge iam-system-badge">System</span>}
              </label>
            ))}
          </div>
          {error && (
            <p className="auth-error" role="alert" data-testid="iam-member-roles-error">
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="ghost-button"
            data-testid="iam-member-roles-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            data-testid="iam-member-roles-save"
            disabled={saving}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function RoleModal({
  mode,
  role,
  groups,
  orgId,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  role: IamRole | null;
  groups: IamPermissionGroup[];
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<string[]>(role?.permissions ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleOne = (key: string) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));

  const toggleGroup = (keys: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return Array.from(next);
    });

  const canSave = name.trim().length > 0 && selected.length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      permissions: selected,
    };
    try {
      if (mode === 'create') await iamApi.createRole(orgId, payload);
      else if (role) await iamApi.updateRole(orgId, role.id, payload);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Failed to save role'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" data-testid="iam-role-modal" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{mode === 'create' ? 'Create role' : `Edit ${role?.name ?? 'role'}`}</h2>
        </div>
        <div className="modal-body">
          <div className="modal-form">
            <label className="field">
              <span className="field-label">Name</span>
              <input
                className="text-input"
                data-testid="iam-role-name"
                value={name}
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Description</span>
              <input
                className="text-input"
                data-testid="iam-role-description"
                value={description}
                disabled={saving}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </div>

          <h3 className="manage-subsection-title">Permissions</h3>
          {groups.length === 0 && <p className="hint">No permissions available.</p>}
          {groups.map((group) => {
            const keys = group.permissions.map((p) => p.key);
            const allOn = keys.length > 0 && keys.every((k) => selected.includes(k));
            const someOn = keys.some((k) => selected.includes(k));
            return (
              <section key={group.key} className="iam-perm-group" data-testid={`iam-perm-group-${group.key}`}>
                <div className="iam-perm-group-head">
                  <span className="iam-perm-group-label">{group.label}</span>
                  <label className="iam-check-row">
                    <input
                      type="checkbox"
                      data-testid={`iam-group-selectall-${group.key}`}
                      checked={allOn}
                      disabled={saving}
                      ref={(el) => {
                        if (el) el.indeterminate = someOn && !allOn;
                      }}
                      onChange={(e) => toggleGroup(keys, e.target.checked)}
                    />
                    <span>All</span>
                  </label>
                </div>
                <div className="iam-perm-grid">
                  {group.permissions.map((perm) => (
                    <label key={perm.key} className="iam-check-row">
                      <input
                        type="checkbox"
                        data-testid={`iam-permission-${perm.key}`}
                        checked={selected.includes(perm.key)}
                        disabled={saving}
                        onChange={() => toggleOne(perm.key)}
                      />
                      <span>{perm.label}</span>
                    </label>
                  ))}
                </div>
              </section>
            );
          })}

          {selected.length === 0 && (
            <p className="hint" data-testid="iam-role-perm-hint">
              Select at least one permission.
            </p>
          )}
          {error && (
            <p className="auth-error" role="alert" data-testid="iam-role-error">
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost-button" data-testid="iam-role-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            data-testid="iam-role-save"
            disabled={!canSave}
            onClick={save}
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

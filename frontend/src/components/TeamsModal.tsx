'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { teamApi, type ProjectOrgUser, type UserRole } from '@/lib/api';
import { useWorkspace } from '@/store/WorkspaceStore';
import { Modal } from './Modal';

function TeamInviteRow({
  teamId,
  memberIds,
  busy,
  setBusy,
  setError,
  onInvited,
}: {
  teamId: string;
  memberIds: string[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string) => void;
  onInvited: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('EDITOR');
  const [users, setUsers] = useState<ProjectOrgUser[]>([]);
  const memberKey = memberIds.join(',');
  const typing = query.trim().length > 0;

  useEffect(() => {
    let cancelled = false;
    teamApi
      .orgUsers(teamId)
      .then((r) => {
        if (!cancelled) setUsers(r.users);
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [teamId, memberKey]);

  const available = useMemo(() => users.filter((u) => !memberIds.includes(u.id)), [users, memberIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return available.filter(
      (u) =>
        u.id === selectedId ||
        u.name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q)
    );
  }, [available, query, selectedId]);

  const onInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const q = query.trim().toLowerCase();
    const target =
      available.find((u) => u.id === selectedId) ||
      available.find((u) => u.username.toLowerCase() === q || u.name.toLowerCase() === q) ||
      (filtered.length === 1 ? filtered[0] : null);
    if (!target) {
      setError('Select a user from the list');
      return;
    }
    setBusy(true);
    try {
      await teamApi.addMember(teamId, target.id, inviteRole);
      await onInvited();
      setQuery('');
      setSelectedId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onInvite} className="modal-form" data-testid={`invite-form-${teamId}`}>
      <div className="invite-picker">
        <div className="invite-row">
          <input
            type="search"
            placeholder="Search people by name or username"
            data-testid="invite-email"
            aria-label="Search people to add"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedId('');
            }}
            autoComplete="off"
          />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as UserRole)} data-testid="invite-role">
            <option value="EDITOR">EDITOR</option>
            <option value="VIEWER">VIEWER</option>
          </select>
          <button
            type="submit"
            className="primary-button"
            disabled={busy || (!selectedId && filtered.length !== 1)}
            data-testid={`invite-${teamId}`}
          >
            Add
          </button>
        </div>
        {typing && (
          <ul className="invite-user-list" data-testid={`invite-user-list-${teamId}`} role="listbox" aria-label="People to add">
            {filtered.length === 0 && <li className="invite-user-empty">No matching people</li>}
            {filtered.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedId === u.id}
                  className={`invite-user-option${selectedId === u.id ? ' selected' : ''}`}
                  data-testid={`invite-user-${u.username}`}
                  onClick={() => {
                    setSelectedId(u.id);
                    setQuery(u.username);
                  }}
                >
                  <span className="invite-user-name">{u.name}</span>
                  <span className="invite-user-email">@{u.username}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}

export function TeamsModal({
  open,
  onClose,
  teamId = null,
}: {
  open: boolean;
  onClose: () => void;
  teamId?: string | null;
}) {
  const ws = useWorkspace();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setActiveId(null);
      setError('');
      setName('');
      return;
    }
    setActiveId(teamId);
    ws.refresh().catch(() => {});
  }, [open, teamId, ws.refresh]);

  if (!open) return null;

  const onCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Team name is required');
      return;
    }
    setBusy(true);
    try {
      const { team } = await teamApi.create({ name: name.trim() });
      await ws.refresh();
      setName('');
      setActiveId(team.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create team');
    } finally {
      setBusy(false);
    }
  };

  const activeTeam = activeId ? ws.teams.find((t) => t.id === activeId) : undefined;

  return (
    <Modal title={activeTeam ? activeTeam.name : 'Teams'} onClose={onClose} testId="teams-modal">
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      {!activeTeam && (
        <>
          <section className="modal-section">
            <h3>Create team</h3>
            <form onSubmit={onCreateTeam} className="modal-form">
              <label className="auth-field">
                <span>Team name</span>
                <input type="text" data-testid="team-name" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <div className="modal-actions">
                <button type="submit" className="primary-button" disabled={busy} data-testid="create-team">
                  Create team
                </button>
              </div>
            </form>
          </section>
          <section className="modal-section">
            <h3>Your teams</h3>
            {ws.teams.length === 0 && <p className="hint">No teams yet.</p>}
            <ul className="share-list">
              {ws.teams.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="team-pick-row"
                    data-testid={`pick-team-${t.name}`}
                    onClick={() => setActiveId(t.id)}
                  >
                    <span className="sidebar-item-name">{t.name}</span>
                    <span className="vis-badge team-count">{t.members.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {activeTeam && (
        <section className="modal-section" data-testid={`team-detail-${activeTeam.id}`}>
          <div className="modal-section-head">
            <button type="button" className="ghost-button small" data-testid="teams-back" onClick={() => setActiveId(null)}>
              All teams
            </button>
            {activeTeam.myRole === 'ADMIN' && (
              <button
                type="button"
                className="ghost-button small danger-text"
                data-testid={`delete-team-${activeTeam.name}`}
                onClick={() => {
                  if (window.confirm(`Delete team "${activeTeam.name}"? Members lose access to workspaces shared with this team.`)) {
                    ws.deleteTeam(activeTeam.id)
                      .then(() => setActiveId(null))
                      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to delete team'));
                  }
                }}
              >
                Delete team
              </button>
            )}
          </div>
          <ul className="share-list">
            {activeTeam.members.map((m) => (
              <li key={m.id} className="share-row">
                <span className="sidebar-item-name">
                  {m.name} (@{m.username})
                </span>
                <span className={`role-badge role-${m.role}`}>{m.role}</span>
              </li>
            ))}
          </ul>
          {activeTeam.myRole === 'ADMIN' && (
            <TeamInviteRow
              teamId={activeTeam.id}
              memberIds={activeTeam.members.map((m) => m.id)}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onInvited={() => ws.refresh()}
            />
          )}
        </section>
      )}
    </Modal>
  );
}

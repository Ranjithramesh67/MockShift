'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { workspaceApi, type UserRole } from '@/lib/api';
import { useWorkspace } from '@/store/WorkspaceStore';
import { Modal } from './Modal';

interface Share {
  share_id: string;
  team_id: string;
  name: string;
  role: UserRole;
}

interface Person {
  user_id: string;
  name: string;
  email: string;
  username: string | null;
  role: UserRole;
}

const ROLE_OPTIONS: UserRole[] = ['VIEWER', 'EDITOR'];

export function SharingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const [shares, setShares] = useState<Share[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [personInput, setPersonInput] = useState('');
  const [personRole, setPersonRole] = useState<UserRole>('EDITOR');
  const [teamRoles, setTeamRoles] = useState<Record<string, UserRole>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ws.activeWorkspaceId) return;
    const [teamsRes, membersRes] = await Promise.all([
      workspaceApi.teams(ws.activeWorkspaceId),
      workspaceApi.members(ws.activeWorkspaceId).catch(() => ({ members: [] as Person[] })),
    ]);
    setShares(teamsRes.teams);
    setPeople(membersRes.members);
    setTeamRoles((prev) => {
      const next = { ...prev };
      for (const t of teamsRes.teams) if (!next[t.team_id]) next[t.team_id] = 'EDITOR';
      return next;
    });
  }, [ws.activeWorkspaceId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  const unsharedTeams = ws.teams.filter((t) => !shares.some((s) => s.team_id === t.id));

  const run = async (fn: () => Promise<unknown>, failMsg: string) => {
    setError('');
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : failMsg);
    } finally {
      setBusy(false);
    }
  };

  const onAddPerson = () => {
    const identifier = personInput.trim();
    if (!identifier) return;
    run(
      () => workspaceApi.addMember(ws.activeWorkspaceId!, { email: identifier, role: personRole }),
      'Could not add that person'
    ).then(() => setPersonInput(''));
  };

  const onRemovePerson = (userId: string) =>
    run(() => workspaceApi.removeMember(ws.activeWorkspaceId!, userId), 'Could not remove that person');

  const onShare = (teamId: string) =>
    run(
      () => ws.shareWorkspace(ws.activeWorkspaceId!, teamId, teamRoles[teamId] ?? 'EDITOR'),
      'Share failed'
    );

  const onUnshare = (teamId: string) =>
    run(() => ws.unshareWorkspace(ws.activeWorkspaceId!, teamId), 'Unshare failed');

  return (
    <Modal title="Workspace access" onClose={onClose} testId="sharing-modal">
      <p className="hint" style={{ marginTop: 0 }}>
        Control who can open this workspace. Access applies to the whole workspace.
      </p>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      <section className="modal-section">
        <h3>People</h3>
        <p className="hint">Grant access to one specific person (this workspace only).</p>
        {people.length === 0 ? (
          <p className="hint">No individual access yet.</p>
        ) : (
          <ul className="share-list">
            {people.map((p) => (
              <li key={p.user_id} className="share-row">
                <span className="sidebar-item-name">
                  {p.name} <span className="hint">{p.email}</span>
                </span>
                <span className={`role-badge role-${p.role}`}>{p.role}</span>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={busy}
                  data-testid={`unshare-person-${p.user_id}`}
                  onClick={() => onRemovePerson(p.user_id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="share-add-row">
          <input
            type="text"
            className="text-input"
            placeholder="Email or username"
            value={personInput}
            data-testid="share-person-input"
            onChange={(e) => setPersonInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onAddPerson();
            }}
          />
          <select
            className="text-input"
            value={personRole}
            data-testid="share-person-role"
            onChange={(e) => setPersonRole(e.target.value as UserRole)}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary-button"
            disabled={busy || !personInput.trim()}
            data-testid="share-person-add"
            onClick={onAddPerson}
          >
            Add person
          </button>
        </div>
      </section>

      <section className="modal-section">
        <h3>Teams</h3>
        <p className="hint">
          Sharing with a team gives every current and future member of that team access.
        </p>
        {shares.length === 0 ? (
          <p className="hint">Not shared with any team yet.</p>
        ) : (
          <ul className="share-list">
            {shares.map((s) => (
              <li key={s.share_id} className="share-row">
                <span className="sidebar-item-name">{s.name}</span>
                <span className={`role-badge role-${s.role}`}>{s.role}</span>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={busy}
                  data-testid={`unshare-${s.team_id}`}
                  onClick={() => onUnshare(s.team_id)}
                >
                  Unshare
                </button>
              </li>
            ))}
          </ul>
        )}
        {unsharedTeams.length === 0 ? (
          <p className="hint">All teams already have access.</p>
        ) : (
          <ul className="share-list">
            {unsharedTeams.map((t) => (
              <li key={t.id} className="share-row">
                <span className="sidebar-item-name">{t.name}</span>
                <select
                  className="text-input"
                  value={teamRoles[t.id] ?? 'EDITOR'}
                  data-testid={`share-role-${t.id}`}
                  onChange={(e) => setTeamRoles((prev) => ({ ...prev, [t.id]: e.target.value as UserRole }))}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy}
                  data-testid={`share-${t.id}`}
                  onClick={() => onShare(t.id)}
                >
                  Give access
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  );
}

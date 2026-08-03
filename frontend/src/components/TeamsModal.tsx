'use client';

import React, { useState } from 'react';
import { teamApi, type UserRole } from '@/lib/api';
import { useWorkspace } from '@/store/WorkspaceStore';
import { Modal } from './Modal';

export function TeamsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const [name, setName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('EDITOR');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
      await teamApi.create({ name: name.trim() });
      await ws.refresh();
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create team');
    } finally {
      setBusy(false);
    }
  };

  const onInvite = async (teamId: string, e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!inviteEmail.trim()) return;
    setBusy(true);
    try {
      await ws.inviteToTeam(teamId, inviteEmail.trim(), inviteRole);
      setInviteEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Teams & members" onClose={onClose} testId="teams-modal">
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
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

      {ws.teams.map((team) => (
        <section key={team.id} className="modal-section">
          <h3>{team.name}</h3>
          <ul className="share-list">
            {team.members.map((m) => (
              <li key={m.id} className="share-row">
                <span className="sidebar-item-name">
                  {m.name} ({m.email})
                </span>
                <span className={`role-badge role-${m.role}`}>{m.role}</span>
              </li>
            ))}
          </ul>
          <form onSubmit={(e) => onInvite(team.id, e)} className="modal-form">
            <div className="invite-row">
              <input
                type="email"
                placeholder="member@example.com"
                data-testid="invite-email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as UserRole)} data-testid="invite-role">
                <option value="EDITOR">EDITOR</option>
                <option value="VIEWER">VIEWER</option>
              </select>
              <button type="submit" className="primary-button" disabled={busy} data-testid={`invite-${team.id}`}>
                Invite
              </button>
            </div>
          </form>
        </section>
      ))}
    </Modal>
  );
}

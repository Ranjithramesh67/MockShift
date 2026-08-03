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

export function SharingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const [shares, setShares] = useState<Share[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ws.activeWorkspaceId) return;
    const { teams } = await workspaceApi.teams(ws.activeWorkspaceId);
    setShares(teams);
  }, [ws.activeWorkspaceId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  const unsharedTeams = ws.teams.filter((t) => !shares.some((s) => s.team_id === t.id));

  const onShare = async (teamId: string, role: UserRole) => {
    setError('');
    setBusy(true);
    try {
      await ws.shareWorkspace(ws.activeWorkspaceId!, teamId, role);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Share failed');
    } finally {
      setBusy(false);
    }
  };

  const onUnshare = async (shareId: string) => {
    setBusy(true);
    try {
      await ws.unshareWorkspace(ws.activeWorkspaceId!, shareId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unshare failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Share workspace with teams" onClose={onClose} testId="sharing-modal">
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <section className="modal-section">
        <h3>Shared with</h3>
        {shares.length === 0 && <p className="hint">Not shared with any team yet.</p>}
        <ul className="share-list">
          {shares.map((s) => (
            <li key={s.share_id} className="share-row">
              <span className="sidebar-item-name">{s.name}</span>
              <span className={`role-badge role-${s.role}`}>{s.role}</span>
              <button type="button" className="ghost-button" disabled={busy} data-testid={`unshare-${s.team_id}`} onClick={() => onUnshare(s.share_id)}>
                Unshare
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="modal-section">
        <h3>Add team</h3>
        {unsharedTeams.length === 0 && <p className="hint">All teams already have access.</p>}
        <ul className="share-list">
          {unsharedTeams.map((t) => (
            <li key={t.id} className="share-row">
              <span className="sidebar-item-name">{t.name}</span>
              <button type="button" className="primary-button" disabled={busy} data-testid={`share-${t.id}`} onClick={() => onShare(t.id, 'EDITOR')}>
                Share
              </button>
            </li>
          ))}
        </ul>
      </section>
    </Modal>
  );
}

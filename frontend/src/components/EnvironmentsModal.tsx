'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { environmentApi, type Environment, type EnvironmentVariable } from '@/lib/api';
import { useWorkspace } from '@/store/WorkspaceStore';
import { Modal } from './Modal';

interface DraftVariable {
  id?: string;
  key: string;
  value: string;
  isSecret: boolean;
}

export function EnvironmentsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [variables, setVariables] = useState<EnvironmentVariable[]>([]);
  const [newEnvName, setNewEnvName] = useState('');
  const [drafts, setDrafts] = useState<DraftVariable[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const canEdit = ws.activeWorkspaceRole === 'ADMIN' || ws.activeWorkspaceRole === 'EDITOR';

  const loadEnvironments = useCallback(async () => {
    if (!ws.activeWorkspaceId) {
      setEnvironments([]);
      setSelectedId(null);
      return;
    }
    const { environments } = await environmentApi.list(ws.activeWorkspaceId);
    setEnvironments(environments);
    setSelectedId((current) => {
      if (current && environments.some((e) => e.id === current)) return current;
      return environments.find((e) => e.is_active)?.id ?? environments[0]?.id ?? null;
    });
  }, [ws.activeWorkspaceId]);

  const loadVariables = useCallback(async (environmentId: string | null) => {
    if (!environmentId) {
      setVariables([]);
      setDrafts([]);
      return;
    }
    const { variables } = await environmentApi.variables(environmentId);
    setVariables(variables);
    setDrafts(
      variables.map((v) => ({ id: v.id, key: v.key, value: v.value ?? '', isSecret: v.is_secret }))
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    setError('');
    loadEnvironments().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load environments'));
  }, [open, loadEnvironments]);

  useEffect(() => {
    if (open) loadVariables(selectedId).catch(() => undefined);
  }, [open, selectedId, loadVariables]);

  if (!open) return null;

  const selected = environments.find((e) => e.id === selectedId) ?? null;

  const onCreate = async () => {
    if (!ws.activeWorkspaceId) return;
    const name = newEnvName.trim();
    if (!name) return;
    setError('');
    setBusy(true);
    try {
      const { environment } = await environmentApi.create(ws.activeWorkspaceId, name, environments.length === 0);
      await loadEnvironments();
      setSelectedId(environment.id);
      setNewEnvName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create environment');
    } finally {
      setBusy(false);
    }
  };

  const onSetActive = async (environmentId: string) => {
    setBusy(true);
    try {
      await environmentApi.update(environmentId, { isActive: true });
      await loadEnvironments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate environment');
    } finally {
      setBusy(false);
    }
  };

  const onRename = async (environmentId: string) => {
    const name = renameValue.trim();
    if (!name) return;
    setBusy(true);
    try {
      await environmentApi.update(environmentId, { name });
      setRenamingId(null);
      await loadEnvironments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename environment');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (environmentId: string) => {
    const env = environments.find((e) => e.id === environmentId);
    if (!env || !window.confirm(`Delete environment "${env.name}" and all of its variables?`)) return;
    setBusy(true);
    try {
      await environmentApi.remove(environmentId);
      await loadEnvironments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete environment');
    } finally {
      setBusy(false);
    }
  };

  const patchDraft = (index: number, patch: Partial<DraftVariable>) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const addDraft = () => {
    setDrafts((prev) => [...prev, { key: '', value: '', isSecret: false }]);
  };

  const removeDraft = (index: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  };

  const saveVariables = async () => {
    if (!selectedId) return;
    setError('');
    setBusy(true);
    try {
      // Upsert every non-empty draft row (the API upserts by key).
      for (const d of drafts) {
        if (!d.key.trim()) continue;
        await environmentApi.saveVariable(selectedId, {
          key: d.key.trim(),
          value: d.value,
          isSecret: d.isSecret,
        });
      }
      // Remove variables that were deleted in the UI.
      const removed = variables.filter((v) => !drafts.some((d) => d.id === v.id && d.key.trim() !== ''));
      for (const v of removed) {
        await environmentApi.deleteVariable(selectedId, v.id);
      }
      await loadVariables(selectedId);
      await loadEnvironments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save variables');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Environments" onClose={onClose} testId="environments-modal">
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <p className="hint">
        Environment variables are resolved per request as <code>{'{{key}}'}</code> with priority
        REQUEST &gt; ENVIRONMENT &gt; WORKSPACE &gt; GLOBAL. The active environment applies to every
        request in this workspace.
      </p>

      <section className="modal-section">
        <h3>Environments</h3>
        {!ws.activeWorkspaceId && <p className="hint">Select a workspace to manage its environments.</p>}
        {environments.length === 0 && ws.activeWorkspaceId && (
          <p className="hint">No environments yet. Create one below.</p>
        )}
        <ul className="env-list">
          {environments.map((env) => (
            <li key={env.id} className={`env-row ${env.id === selectedId ? 'active' : ''}`}>
              <button
                type="button"
                className="env-select"
                data-testid={`env-${env.name}`}
                onClick={() => setSelectedId(env.id)}
              >
                <span className={`env-active-dot ${env.is_active ? 'on' : ''}`} title={env.is_active ? 'Active' : 'Inactive'} />
                <span className="sidebar-item-name">{env.name}</span>
                {env.variable_count ? (
                  <span className="vis-badge env-count" title={`${env.variable_count} variables`}>
                    {env.variable_count}
                  </span>
                ) : null}
              </button>
              {canEdit && (
                <div className="env-actions">
                  {!env.is_active && (
                    <button
                      type="button"
                      className="ghost-button small"
                      data-testid={`activate-${env.name}`}
                      disabled={busy}
                      onClick={() => onSetActive(env.id)}
                    >
                      Activate
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    title="Rename"
                    aria-label={`Rename ${env.name}`}
                    data-testid={`rename-${env.name}`}
                    disabled={busy}
                    onClick={() => {
                      setRenamingId(env.id);
                      setRenameValue(env.name);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    title="Delete"
                    aria-label={`Delete ${env.name}`}
                    data-testid={`delete-env-${env.name}`}
                    disabled={busy}
                    onClick={() => onDelete(env.id)}
                  >
                    ✕
                  </button>
                </div>
              )}
              {renamingId === env.id && (
                <div className="env-rename">
                  <input
                    className="text-input"
                    data-testid={`rename-input-${env.name}`}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onRename(env.id);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                  />
                  <button type="button" className="primary-button small" data-testid={`rename-save-${env.name}`} onClick={() => onRename(env.id)}>
                    Save
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="env-create">
            <input
              className="text-input"
              data-testid="new-env-name"
              placeholder="Environment name"
              value={newEnvName}
              onChange={(e) => setNewEnvName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCreate();
              }}
            />
            <button type="button" className="primary-button small" data-testid="new-env-create" disabled={busy || !newEnvName.trim()} onClick={onCreate}>
              Create
            </button>
          </div>
        )}
      </section>

      {selected && (
        <section className="modal-section">
          <div className="modal-section-head">
            <h3>Variables — {selected.name}</h3>
            {canEdit && (
              <button type="button" className="ghost-button small" data-testid="add-variable" onClick={addDraft}>
                + Variable
              </button>
            )}
          </div>
          {drafts.length === 0 && <p className="hint">No variables in this environment.</p>}
          <table className="env-vars-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th>Secret</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {drafts.map((d, i) => (
                <tr key={i}>
                  <td>
                    <input
                      className="text-input"
                      data-testid="var-key"
                      value={d.key}
                      placeholder="e.g. BASE_URL"
                      disabled={!canEdit}
                      onChange={(e) => patchDraft(i, { key: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="text-input"
                      data-testid="var-value"
                      type={d.isSecret ? 'password' : 'text'}
                      value={d.value}
                      placeholder={d.isSecret ? '••••••••' : 'e.g. https://api.example.com'}
                      disabled={!canEdit}
                      onChange={(e) => patchDraft(i, { value: e.target.value })}
                    />
                  </td>
                  <td>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        data-testid="var-secret"
                        checked={d.isSecret}
                        disabled={!canEdit}
                        onChange={(e) => patchDraft(i, { isSecret: e.target.checked })}
                      />
                      <span>Secret</span>
                    </label>
                  </td>
                  {canEdit && (
                    <td>
                      <button type="button" className="icon-button danger" title="Remove variable" aria-label="Remove variable" data-testid="var-remove" onClick={() => removeDraft(i)}>
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && (
            <div className="modal-actions">
              <button type="button" className="primary-button" data-testid="save-variables" disabled={busy} onClick={saveVariables}>
                Save variables
              </button>
            </div>
          )}
        </section>
      )}
    </Modal>
  );
}

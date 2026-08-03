'use client';

import React, { useState } from 'react';
import type { ApiType } from '@/lib/types';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useAuth } from '@/lib/auth';
import { Modal } from './Modal';

const API_TYPE_OPTIONS: Array<{ id: ApiType; label: string; hint: string }> = [
  { id: 'REST', label: 'REST', hint: 'Standard JSON/HTTP API' },
  { id: 'SOAP', label: 'SOAP', hint: 'XML envelope service' },
  { id: 'GRAPHQL', label: 'GraphQL', hint: 'Query language API' },
  { id: 'AUTH', label: 'Auth / Token', hint: 'Token endpoint used by a folder auth provider' },
];

export type CreateKind = 'workspace' | 'collection' | 'request';

export function CreateModal({
  kind,
  defaultApiType = 'REST',
  collectionId,
  onClose,
}: {
  kind: CreateKind;
  defaultApiType?: ApiType;
  collectionId?: string;
  onClose: () => void;
}) {
  const ws = useWorkspace();
  const { organizations } = useAuth();
  const [name, setName] = useState('');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [apiType, setApiType] = useState<ApiType>(defaultApiType);
  const [visibility, setVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const title =
    kind === 'workspace' ? 'New workspace' : kind === 'collection' ? 'New collection' : 'New API request';

  const canCreateWorkspace = organizations.some((o) => o.role === 'ADMIN');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setBusy(true);
    try {
      if (kind === 'workspace') {
        await ws.createWorkspace(name.trim(), visibility);
      } else if (kind === 'collection') {
        await ws.createCollection(name.trim());
      } else {
        if (!url.trim()) {
          setError('URL is required');
          return;
        }
        if (collectionId) {
          const collection = ws.tree?.collections.find((c) => c.id === collectionId);
          await ws.selectCollection(collectionId, collection?.name ?? '');
        }
        await ws.createRequest({ name: name.trim(), method, url: url.trim(), apiType });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setBusy(false);
    }
  };

  const testId =
    kind === 'workspace' ? 'new-workspace-modal' : kind === 'collection' ? 'new-collection-modal' : 'new-api-modal';

  return (
    <Modal title={title} onClose={onClose} testId={testId}>
      <form onSubmit={onSubmit} className="modal-form">
        {kind === 'workspace' && !canCreateWorkspace && (
          <p className="auth-error" role="alert">
            Only organization admins can create workspaces.
          </p>
        )}
        {error && (
          <p className="auth-error" role="alert" data-testid="create-error">
            {error}
          </p>
        )}
        <label className="auth-field">
          <span>{kind === 'request' ? 'Name' : 'Name'}</span>
          <input
            type="text"
            autoFocus
            data-testid="create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>

        {kind === 'request' && (
          <>
            <div className="auth-field">
              <span>Type</span>
              <div className="api-type-options" data-testid="create-api-type">
                {API_TYPE_OPTIONS.map((opt) => (
                  <button
                    type="button"
                    key={opt.id}
                    className={`api-type-option ${apiType === opt.id ? 'selected' : ''}`}
                    data-testid={`api-type-${opt.id}`}
                    onClick={() => setApiType(opt.id)}
                  >
                    <strong>{opt.label}</strong>
                    <span>{opt.hint}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="auth-field">
              <span>Method</span>
              <select data-testid="create-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <label className="auth-field">
              <span>URL</span>
              <input
                type="text"
                data-testid="create-url"
                value={url}
                placeholder="https://api.example.com/path"
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
          </>
        )}

        {kind === 'workspace' && (
          <>
            <label className="auth-field">
              <span>Organization</span>
              <select
                data-testid="create-organization"
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
              >
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="auth-field">
              <span>Visibility</span>
              <select data-testid="create-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as 'PRIVATE' | 'PUBLIC')}>
                <option value="PRIVATE">Private</option>
                <option value="PUBLIC">Public (org members can read)</option>
              </select>
            </div>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={busy || (kind === 'workspace' && !canCreateWorkspace)}
            data-testid="create-submit"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

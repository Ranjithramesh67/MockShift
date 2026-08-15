'use client';

import React, { useState } from 'react';
import type { ApiType } from '@/lib/types';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useAuth } from '@/lib/auth';
import { Modal } from './Modal';
import { RestIcon, SoapIcon, GraphqlIcon, KeyIcon } from './icons';

const API_TYPE_OPTIONS: Array<{ id: ApiType; label: string; hint: string; icon: typeof RestIcon }> = [
  { id: 'REST', label: 'REST', hint: 'Standard JSON/HTTP API', icon: RestIcon },
  { id: 'SOAP', label: 'SOAP', hint: 'XML envelope service', icon: SoapIcon },
  { id: 'GRAPHQL', label: 'GraphQL', hint: 'Query language API', icon: GraphqlIcon },
  { id: 'AUTH', label: 'Auth / Token', hint: 'Token endpoint used by a folder auth provider', icon: KeyIcon },
];

export type CreateKind = 'workspace' | 'collection' | 'request' | 'folder';

export function CreateModal({
  kind,
  defaultApiType = 'REST',
  collectionId,
  parentFolderId,
  renameTarget,
  onClose,
}: {
  kind: CreateKind;
  defaultApiType?: ApiType;
  collectionId?: string;
  parentFolderId?: string;
  renameTarget?: { folderId: string; name: string } | null;
  onClose: () => void;
}) {
  const ws = useWorkspace();
  const { organizations } = useAuth();
  const [name, setName] = useState(renameTarget?.name ?? '');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [apiType, setApiType] = useState<ApiType>(defaultApiType);
  const [visibility, setVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const title = renameTarget
    ? 'Rename folder'
    : kind === 'workspace'
    ? 'New workspace'
    : kind === 'collection'
    ? 'New collection'
    : kind === 'folder'
    ? 'New folder'
    : 'New API request';

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
      if (renameTarget) {
        await ws.renameFolder(renameTarget.folderId, name.trim());
      } else if (kind === 'workspace') {
        await ws.createWorkspace(name.trim(), visibility);
      } else if (kind === 'collection') {
        await ws.createCollection(name.trim());
      } else if (kind === 'folder') {
        if (!collectionId) {
          setError('A collection is required to create a folder');
          return;
        }
        await ws.createFolder({
          collectionId,
          parentId: parentFolderId ?? null,
          name: name.trim(),
        });
      } else {
        if (!url.trim()) {
          setError('URL is required');
          return;
        }
        if (collectionId) {
          const collection = ws.tree?.collections.find((c) => c.id === collectionId);
          await ws.selectCollection(collectionId, collection?.name ?? '');
        }
        await ws.createRequest({ name: name.trim(), method, url: url.trim(), apiType, folderId: parentFolderId ?? null });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setBusy(false);
    }
  };

  const testId =
    kind === 'workspace'
      ? 'new-workspace-modal'
      : kind === 'collection'
      ? 'new-collection-modal'
      : kind === 'folder'
      ? 'new-folder-modal'
      : 'new-api-modal';

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
          <span>Name</span>
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
                    <strong>
                      <opt.icon size={15} />
                      {opt.label}
                    </strong>
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

        {kind === 'workspace' && !renameTarget && (
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
            {busy ? 'Saving…' : renameTarget ? 'Rename' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

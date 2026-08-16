'use client';

import React, { useState } from 'react';
import type { ApiRequest, ApiType } from '@/lib/types';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useAuth } from '@/lib/auth';
import { contentApi } from '@/lib/api';
import { isCurlCommand, parseCurl } from '@/lib/curl';
import { Modal } from './Modal';
import { RestIcon, SoapIcon, GraphqlIcon, KeyIcon } from './icons';

const API_TYPE_OPTIONS: Array<{ id: ApiType; label: string; hint: string; icon: typeof RestIcon }> = [
  { id: 'REST', label: 'REST', hint: 'Standard JSON/HTTP API', icon: RestIcon },
  { id: 'SOAP', label: 'SOAP', hint: 'XML envelope service', icon: SoapIcon },
  { id: 'GRAPHQL', label: 'GraphQL', hint: 'Query language API', icon: GraphqlIcon },
  { id: 'AUTH', label: 'Auth / Token', hint: 'Token endpoint used by a folder auth provider', icon: KeyIcon },
];

export type CreateKind = 'workspace' | 'collection' | 'request' | 'folder';

function deriveRequestName(parsed: { method: string; url: string }): string {
  const clean = parsed.url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
  const base = clean || parsed.url || 'request';
  const host = base.split('/')[0];
  return `${parsed.method} ${host}`;
}

export function CreateModal({
  kind,
  defaultApiType = 'REST',
  collectionId,
  folderId,
  onClose,
}: {
  kind: CreateKind;
  defaultApiType?: ApiType;
  collectionId?: string;
  folderId?: string;
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
    kind === 'workspace'
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
    const curlParsed = isCurlCommand(url) ? parseCurl(url) : null;
    const finalName = name.trim() || (curlParsed?.url ? deriveRequestName(curlParsed) : '');
    if (!finalName && kind !== 'request') {
      setError('Name is required');
      return;
    }
    if (kind === 'request' && !curlParsed && !url.trim()) {
      setError('URL is required');
      return;
    }
    setBusy(true);
    try {
      if (kind === 'workspace') {
        await ws.createWorkspace(name.trim(), visibility);
      } else if (kind === 'collection') {
        await ws.createCollection(name.trim());
      } else if (kind === 'folder') {
        const targetCollectionId = collectionId ?? ws.activeCollectionId;
        if (!targetCollectionId) {
          setError('Select a collection first');
          return;
        }
        const collection = ws.tree?.collections.find((c) => c.id === targetCollectionId);
        await ws.selectCollection(targetCollectionId, collection?.name ?? '');
        await ws.createFolder({
          name: name.trim(),
          collectionId: targetCollectionId,
          parentId: folderId ?? null,
        });
      } else {
        if (collectionId) {
          const collection = ws.tree?.collections.find((c) => c.id === collectionId);
          await ws.selectCollection(collectionId, collection?.name ?? '');
        }
        if (curlParsed) {
          const { request } = await contentApi.createRequest({
            collectionId: collectionId ?? ws.activeCollectionId!,
            name: finalName,
            method: curlParsed.method,
            url: curlParsed.url,
            apiType,
            folderId: folderId ?? null,
          });
          await contentApi.updateRequest(request.id, {
            headers: curlParsed.headers,
            queryParams: curlParsed.queryParams,
            bodyType: curlParsed.bodyType,
            bodyJson: curlParsed.bodyJson ?? curlParsed.bodyText ?? null,
            bodyText: curlParsed.bodyText ?? null,
            contentType: curlParsed.contentType,
          });
          await ws.reloadTree();
          await ws.selectRequest(request.id);
        } else {
          await ws.createRequest({ name: finalName, method, url: url.trim(), apiType, folderId: folderId ?? null });
        }
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setBusy(false);
    }
  };

  const onUrlChange = (value: string) => {
    setUrl(value);
    setError('');
    if (isCurlCommand(value)) {
      const parsed = parseCurl(value);
      if (parsed.url) {
        setMethod(parsed.method);
      }
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
          <span>{kind === 'request' ? 'Name' : 'Name'}</span>
          <input
            type="text"
            autoFocus
            data-testid="create-name"
            value={name}
            placeholder={kind === 'request' ? 'Auto-derived from URL or cURL (optional)' : undefined}
            onChange={(e) => setName(e.target.value)}
            required={kind !== 'request'}
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
                placeholder={'https://api.example.com/path  ·  or paste a curl command'}
                onChange={(e) => onUrlChange(e.target.value)}
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

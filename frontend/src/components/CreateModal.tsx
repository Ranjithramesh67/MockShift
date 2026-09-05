'use client';

import React, { useState } from 'react';
import type { ApiType, KeyValueEntry } from '@/lib/types';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useAuth } from '@/lib/auth';
import { contentApi } from '@/lib/api';
import { isCurlCommand, parseCurl } from '@/lib/curl';
import { Modal } from './Modal';
import { TabBar, type TabItem } from './TabBar';
import { KeyValueRows } from './KeyValueRows';
import { RestIcon, SoapIcon, GraphqlIcon, KeyIcon, RowsIcon, ListIcon, CodeIcon } from './icons';

const API_TYPE_OPTIONS: Array<{ id: ApiType; label: string; hint: string; icon: typeof RestIcon }> = [
  { id: 'REST', label: 'REST', hint: 'Standard JSON/HTTP API', icon: RestIcon },
  { id: 'SOAP', label: 'SOAP', hint: 'XML envelope service', icon: SoapIcon },
  { id: 'GRAPHQL', label: 'GraphQL', hint: 'Query language API', icon: GraphqlIcon },
  { id: 'AUTH', label: 'Auth / Token', hint: 'Token endpoint used by a folder auth provider', icon: KeyIcon },
];

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// Methods that conventionally carry a request body. GET/DELETE/HEAD/OPTIONS
// hide the Body tab and edit query params instead.
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

type FormTab = 'params' | 'headers' | 'body';
type CreateMode = 'form' | 'curl';
type BodySel = 'JSON' | 'XML' | 'RAW_TEXT';

export type CreateKind = 'workspace' | 'collection' | 'request' | 'folder';

function deriveRequestName(method: string, url: string): string {
  const clean = url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
  const base = clean || url || 'request';
  const host = base.split('/')[0];
  return `${method} ${host}`;
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

  // Request-only: which source mode and which method-related tab is active.
  const [mode, setMode] = useState<CreateMode>('form');
  const [formTab, setFormTab] = useState<FormTab>('params');
  const [curlText, setCurlText] = useState('');
  const [params, setParams] = useState<KeyValueEntry[]>([]);
  const [headers, setHeaders] = useState<KeyValueEntry[]>([]);
  const [bodySel, setBodySel] = useState<BodySel>('JSON');
  const [bodyText, setBodyText] = useState('');

  const title =
    kind === 'workspace'
      ? 'New workspace'
      : kind === 'collection'
        ? 'New collection'
        : kind === 'folder'
          ? 'New folder'
          : 'New API request';

  const canCreateWorkspace = organizations.some((o) => o.role === 'ADMIN');

  const isRequest = kind === 'request';
  const supportsBody = isRequest && BODY_METHODS.has(method);
  const formTabs: Array<TabItem<FormTab>> = [
    { id: 'params', label: 'Params', icon: RowsIcon },
    { id: 'headers', label: 'Headers', icon: ListIcon },
    ...(supportsBody ? [{ id: 'body' as const, label: 'Body', icon: CodeIcon }] : []),
  ];
  const activeTab: FormTab =
    formTab === 'body' && !supportsBody ? 'params' : formTab;

  const curlPreview = isCurlCommand(curlText) ? parseCurl(curlText) : null;

  const setApiTypeSafe = (t: ApiType) => {
    setApiType(t);
    // SOAP / GraphQL / Auth requests are body-driven: switch a body-less
    // method to POST so the Body tab is available.
    if (t !== 'REST' && !BODY_METHODS.has(method)) {
      setMethod('POST');
    }
  };

  const pickFormTab = (tab: FormTab) => {
    if (tab === 'body' && !supportsBody) return;
    setFormTab(tab);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const collection = collectionId ?? ws.activeCollectionId;
    if (isRequest && !collection) {
      setError('Select a collection in the sidebar first.');
      return;
    }

    if (isRequest && mode === 'curl') {
      if (!curlText.trim()) {
        setError('Paste a curl command.');
        return;
      }
      const parsed = parseCurl(curlText);
      if (!parsed.url) {
        setError('Could not find a URL in that curl command.');
        return;
      }
      const finalName = name.trim() || deriveRequestName(parsed.method, parsed.url);
      setBusy(true);
      try {
        const { request } = await contentApi.createRequest({
          collectionId: collection!,
          name: finalName,
          method: parsed.method,
          url: parsed.url,
          apiType,
          folderId: folderId ?? null,
        });
        await contentApi.updateRequest(request.id, {
          headers: parsed.headers,
          queryParams: parsed.queryParams,
          bodyType: parsed.bodyType,
          bodyJson: parsed.bodyJson ?? parsed.bodyText ?? null,
          bodyText: parsed.bodyText ?? null,
          contentType: parsed.contentType,
        });
        await ws.reloadTree();
        await ws.selectRequest(request.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create');
        setBusy(false);
        return;
      }
      setBusy(false);
      onClose();
      return;
    }

    if (isRequest && !url.trim()) {
      setError('URL is required');
      return;
    }

    const finalName =
      name.trim() || (isRequest ? deriveRequestName(method, url.trim()) : '');
    if (!finalName && !isRequest) {
      setError('Name is required');
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
          setBusy(false);
          return;
        }
        const collectionInfo = ws.tree?.collections.find((c) => c.id === targetCollectionId);
        await ws.selectCollection(targetCollectionId, collectionInfo?.name ?? '');
        await ws.createFolder({
          name: name.trim(),
          collectionId: targetCollectionId,
          parentId: folderId ?? null,
        });
      } else {
        const collectionInfo = collection
          ? ws.tree?.collections.find((c) => c.id === collection)
          : undefined;
        if (collection) {
          await ws.selectCollection(collection, collectionInfo?.name ?? '');
        }
        const { request } = await contentApi.createRequest({
          collectionId: collection!,
          name: finalName,
          method,
          url: url.trim(),
          apiType,
          folderId: folderId ?? null,
        });
        const patch: Record<string, unknown> = {
          headers,
          queryParams: params,
        };
        if (supportsBody && bodyText.trim()) {
          const graphql = apiType === 'GRAPHQL';
          const contentType =
            bodySel === 'XML' ? 'application/xml' : graphql ? 'application/json' : bodySel === 'JSON' ? 'application/json' : 'text/plain';
          const bodyType = graphql ? 'GRAPHQL' : bodySel === 'JSON' ? 'JSON' : 'RAW_TEXT';
          patch.bodyType = bodyType;
          patch.bodyJson = bodyText.trim();
          patch.contentType = contentType;
        }
        await contentApi.updateRequest(request.id, patch);
        await ws.reloadTree();
        await ws.selectRequest(request.id);
      }
      setBusy(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
      setBusy(false);
    }
  };

  const onUrlChange = (value: string) => {
    setUrl(value);
    setError('');
  };

  const onSelectFormTabFromBar = (tab: string) => pickFormTab(tab as FormTab);

  const testId =
    kind === 'workspace'
      ? 'new-workspace-modal'
      : kind === 'collection'
        ? 'new-collection-modal'
        : kind === 'folder'
          ? 'new-folder-modal'
          : 'new-api-modal';

  const bodyOptions: Array<{ id: BodySel; label: string }> =
    apiType === 'GRAPHQL'
      ? [
          { id: 'JSON', label: 'GraphQL query (JSON)' },
          { id: 'RAW_TEXT', label: 'Raw text' },
        ]
      : [
          { id: 'JSON', label: 'JSON' },
          { id: 'XML', label: 'XML' },
          { id: 'RAW_TEXT', label: 'Raw text' },
        ];

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

        {!isRequest && (
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
        )}

        {isRequest && (
          <>
            <label className="auth-field">
              <span>Name</span>
              <input
                type="text"
                autoFocus
                data-testid="create-name"
                value={name}
                placeholder={
                  mode === 'curl'
                    ? 'Optional — auto-derived from the curl command'
                    : 'Optional — auto-derived from method + host'
                }
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <div className="auth-field">
              <span>Type</span>
              <div className="api-type-options" data-testid="create-api-type">
                {API_TYPE_OPTIONS.map((opt) => (
                  <button
                    type="button"
                    key={opt.id}
                    className={`api-type-option ${apiType === opt.id ? 'selected' : ''}`}
                    data-testid={`api-type-${opt.id}`}
                    onClick={() => setApiTypeSafe(opt.id)}
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

            <div className="modal-tabs create-mode-tabs" data-testid="create-mode">
              <button
                type="button"
                className={`modal-tab ${mode === 'form' ? 'active' : ''}`}
                data-testid="create-mode-form"
                aria-pressed={mode === 'form'}
                onClick={() => {
                  setMode('form');
                  setError('');
                }}
              >
                Form
              </button>
              <button
                type="button"
                className={`modal-tab ${mode === 'curl' ? 'active' : ''}`}
                data-testid="create-mode-curl"
                aria-pressed={mode === 'curl'}
                onClick={() => {
                  setMode('curl');
                  setError('');
                }}
              >
                cURL
              </button>
            </div>

            {mode === 'form' ? (
              <>
                <div className="create-method-url">
                  <label className="auth-field method-field">
                    <span>Method</span>
                    <select data-testid="create-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                      {HTTP_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="auth-field url-field">
                    <span>URL</span>
                    <input
                      type="text"
                      data-testid="create-url"
                      value={url}
                      placeholder={'https://api.example.com/path'}
                      onChange={(e) => onUrlChange(e.target.value)}
                    />
                  </label>
                </div>

                <div className="create-request-tabs" data-testid="create-request-tabs">
                  <TabBar tabs={formTabs} active={activeTab} onChange={onSelectFormTabFromBar} testIdPrefix="create" />
                  {activeTab === 'params' && (
                    <KeyValueRows
                      entries={params}
                      onChange={setParams}
                      keyPlaceholder="e.g. page"
                      valuePlaceholder="e.g. 1"
                      testIdPrefix="create-params"
                    />
                  )}
                  {activeTab === 'headers' && (
                    <KeyValueRows
                      entries={headers}
                      onChange={setHeaders}
                      keyPlaceholder="e.g. Authorization"
                      valuePlaceholder="e.g. Bearer token"
                      testIdPrefix="create-headers"
                    />
                  )}
                  {activeTab === 'body' && (
                    <div className="body-editor" data-testid="create-body-editor">
                      <div className="body-toolbar">
                        <select
                          className="compact-select"
                          aria-label="Body type"
                          data-testid="create-body-type"
                          value={bodySel}
                          onChange={(e) => setBodySel(e.target.value as BodySel)}
                        >
                          {bodyOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <textarea
                        className="create-body-input"
                        data-testid="create-body-input"
                        rows={6}
                        spellCheck={false}
                        placeholder={
                          bodySel === 'JSON' || apiType === 'GRAPHQL'
                            ? '{\n  "key": "value"\n}'
                            : bodySel === 'XML'
                              ? '<Request>\n  <field>value</field>\n</Request>'
                              : 'raw request body'
                        }
                        aria-label="Request body"
                        value={bodyText}
                        onChange={(e) => setBodyText(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="create-curl-hint">
                  Paste a full curl command — method, URL, query params, headers and body are parsed and
                  pre-filled into the saved request.
                </p>
                <textarea
                  className="curl-input"
                  rows={8}
                  spellCheck={false}
                  placeholder={'curl -X POST \'https://api.example.com/orders\' \\\n  -H \'Content-Type: application/json\' \\\n  --data-raw \'{"sku": "A1"}\''}
                  aria-label="cURL command"
                  data-testid="create-curl-input"
                  value={curlText}
                  onChange={(e) => {
                    setCurlText(e.target.value);
                    setError('');
                  }}
                />
                {curlPreview?.url && (
                  <p className="create-curl-preview" data-testid="create-curl-preview">
                    {curlPreview.method} {curlPreview.url}
                  </p>
                )}
              </>
            )}
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

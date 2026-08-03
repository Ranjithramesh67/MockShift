'use client';

import React from 'react';
import type { ApiRequest, ApiType, BodyType, HttpMethod, RequestContentType } from '@/lib/types';
import { useApp } from '@/store/AppStore';
import { useWorkspace } from '@/store/WorkspaceStore';
import { KeyValueRows } from './KeyValueRows';
import { CodeEditor } from './CodeEditor';
import { TabBar } from './TabBar';
import { generateCurl } from '@/lib/curl';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const API_TYPES: ApiType[] = ['REST', 'SOAP', 'GRAPHQL', 'AUTH'];

type BodyKind = 'NONE' | 'JSON' | 'XML' | 'FORM_URLENCODED' | 'MULTIPART' | 'GRAPHQL' | 'RAW_TEXT';

const BODY_KIND_OPTIONS: Array<{ id: BodyKind; label: string }> = [
  { id: 'NONE', label: 'None' },
  { id: 'JSON', label: 'JSON' },
  { id: 'XML', label: 'XML' },
  { id: 'FORM_URLENCODED', label: 'Form' },
  { id: 'MULTIPART', label: 'Multipart' },
  { id: 'GRAPHQL', label: 'GraphQL' },
  { id: 'RAW_TEXT', label: 'Raw' },
];

function bodyKindOf(request: ApiRequest): BodyKind {
  if (request.bodyType === 'NONE') return 'NONE';
  if (request.bodyType === 'JSON') return 'JSON';
  if (request.bodyType === 'MULTIPART') return 'MULTIPART';
  if (request.bodyType === 'FORM_URLENCODED') return 'FORM_URLENCODED';
  if (request.bodyType === 'GRAPHQL') return 'GRAPHQL';
  if (request.contentType.includes('xml')) return 'XML';
  return 'RAW_TEXT';
}

function bodyTypeForKind(kind: BodyKind): { bodyType: BodyType; contentType: RequestContentType } {
  switch (kind) {
    case 'JSON':
      return { bodyType: 'JSON', contentType: 'application/json' };
    case 'XML':
      return { bodyType: 'RAW_TEXT', contentType: 'application/xml' };
    case 'FORM_URLENCODED':
      return { bodyType: 'FORM_URLENCODED', contentType: 'application/x-www-form-urlencoded' };
    case 'MULTIPART':
      return { bodyType: 'MULTIPART', contentType: 'multipart/form-data' };
    case 'GRAPHQL':
      return { bodyType: 'GRAPHQL', contentType: 'application/json' };
    case 'RAW_TEXT':
      return { bodyType: 'RAW_TEXT', contentType: 'text/plain' };
    default:
      return { bodyType: 'NONE', contentType: 'text/plain' };
  }
}

export function RequestConfigurator({ onOpenCurl }: { onOpenCurl: () => void }) {
  const { state, dispatch } = useApp();
  const ws = useWorkspace();
  const activeTab = state.activeRequestTab;
  const request = ws.activeRequest;
  if (!request) return <div className="panel-empty">Select a request from the sidebar to edit it.</div>;

  const update = (patch: Partial<ApiRequest>) => ws.updateActiveRequest(patch);

  const updateKeyValue = (field: 'headers' | 'queryParams', entries: ApiRequest['headers']) => {
    update({ [field]: entries } as Partial<ApiRequest>);
  };

  const bodyKind = bodyKindOf(request);

  const onBodyKindChange = (kind: BodyKind) => {
    const next = bodyTypeForKind(kind);
    update({
      bodyType: next.bodyType,
      contentType: next.contentType,
      bodyJson: kind === 'NONE' ? null : request.bodyJson ?? '',
    });
  };

  const onSend = async () => {
    try {
      await ws.runActiveRequest();
      dispatch({ type: 'SHOW_TOAST', kind: 'info', message: 'Request executed.' });
    } catch (err) {
      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Run failed' });
    }
  };

  const onSave = async () => {
    try {
      await ws.saveActiveRequest();
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Request saved.' });
    } catch (err) {
      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Save failed' });
    }
  };

  const onExportCurl = () => {
    navigator.clipboard?.writeText(generateCurl(request)).catch(() => undefined);
    dispatch({ type: 'SHOW_TOAST', kind: 'info', message: 'cURL command copied to clipboard.' });
  };

  return (
    <div className="request-configurator" data-testid="request-configurator">
      <div className="request-bar">
        <select
          className="method-select"
          value={request.method}
          aria-label="Method"
          data-testid="method-select"
          onChange={(e) => update({ method: e.target.value as HttpMethod })}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          className="url-input"
          type="text"
          value={request.url}
          placeholder="https://api.example.com/path"
          spellCheck={false}
          aria-label="Request URL"
          data-testid="url-input"
          onChange={(e) => update({ url: e.target.value })}
        />
        <select
          className="compact-select"
          aria-label="API type"
          data-testid="api-type-select"
          value={request.apiType}
          onChange={(e) => update({ apiType: e.target.value as ApiType })}
        >
          {API_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="button" className="primary-button" data-testid="send-button" onClick={onSend}>
          Send
        </button>
        <button type="button" className="ghost-button" data-testid="save-request-button" onClick={onSave}>
          Save
        </button>
        <button type="button" className="ghost-button" data-testid="export-curl-button" onClick={onExportCurl}>
          Export cURL
        </button>
        <button type="button" className="ghost-button" data-testid="import-curl-button" onClick={onOpenCurl}>
          Import cURL
        </button>
      </div>

      <TabBar
        tabs={[
          { id: 'params', label: 'Params' },
          { id: 'headers', label: 'Headers' },
          { id: 'body', label: 'Body' },
          { id: 'formula', label: 'Formula' },
        ]}
        active={activeTab}
        onChange={(tab) => dispatch({ type: 'SET_REQUEST_TAB', tab })}
        testIdPrefix="request"
      />

      <div className="request-tab-body" data-testid="request-tab-panel">
        {activeTab === 'params' && (
          <KeyValueRows
            entries={request.queryParams}
            onChange={(queryParams) => updateKeyValue('queryParams', queryParams)}
            keyPlaceholder="e.g. include"
            valuePlaceholder="e.g. line_items"
            testIdPrefix="params"
          />
        )}
        {activeTab === 'headers' && (
          <KeyValueRows
            entries={request.headers}
            onChange={(headers) => updateKeyValue('headers', headers)}
            keyPlaceholder="e.g. Authorization"
            valuePlaceholder="e.g. Bearer {{token}}"
            testIdPrefix="headers"
          />
        )}
        {activeTab === 'body' && (
          <div className="body-editor" data-testid="body-editor">
            <div className="body-toolbar">
              <select
                className="compact-select"
                aria-label="Body type"
                data-testid="body-type-select"
                value={bodyKind}
                onChange={(e) => onBodyKindChange(e.target.value as BodyKind)}
              >
                {BODY_KIND_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {bodyKind === 'NONE' ? (
              <div className="panel-empty">This request has no body.</div>
            ) : (
              <CodeEditor
                value={request.bodyJson ?? ''}
                onChange={(value) => update({ bodyJson: value })}
                language={bodyKind === 'JSON' || bodyKind === 'GRAPHQL' ? 'json' : bodyKind === 'XML' ? 'xml' : 'text'}
                height="100%"
                ariaLabel="Request body editor"
              />
            )}
          </div>
        )}
        {activeTab === 'formula' && (
          <div className="formula-editor">
            <p className="hint">
              Pre-request formula executed in the sandbox. Helpers: $utils, $vars, req.body, req.headers.
            </p>
            <CodeEditor
              value={request.formula}
              onChange={(value) => update({ formula: value })}
              language="javascript"
              height="100%"
              ariaLabel="Formula editor"
            />
          </div>
        )}
      </div>
    </div>
  );
}

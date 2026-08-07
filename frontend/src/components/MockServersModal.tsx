'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { mockServerApi, type MockRoute, type MockServer } from '@/lib/api';
import { parseMockHeaders, mockBaseUrl } from '@/lib/mockServer';
import { Modal } from './Modal';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

interface DraftRoute {
  id?: string;
  method: string;
  path: string;
  status: string;
  headers: string;
  body: string;
  delayMs: string;
}

function toDraft(r: MockRoute): DraftRoute {
  return {
    id: r.id,
    method: r.method,
    path: r.path,
    status: String(r.status),
    headers: r.headers && Object.keys(r.headers).length > 0 ? JSON.stringify(r.headers, null, 2) : '',
    body: r.body,
    delayMs: String(r.delay_ms ?? 0),
  };
}

function parseHeaders(raw: string): Record<string, string> {
  return parseMockHeaders(raw);
}

export function MockServersModal({
  open,
  projectId,
  projectName,
  onClose,
}: {
  open: boolean;
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const [server, setServer] = useState<MockServer | null>(null);
  const [routes, setRoutes] = useState<MockRoute[]>([]);
  const [drafts, setDrafts] = useState<DraftRoute[]>([]);
  const [newServerName, setNewServerName] = useState('Mock Server');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadServer = useCallback(async () => {
    if (!projectId) {
      setServer(null);
      return;
    }
    const { mockServer } = await mockServerApi.get(projectId);
    setServer(mockServer);
    if (mockServer) {
      const { routes } = await mockServerApi.routes(mockServer.id);
      setRoutes(routes);
      setDrafts(routes.map(toDraft));
    } else {
      setRoutes([]);
      setDrafts([]);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    setError('');
    loadServer().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load mock server'));
  }, [open, projectId, loadServer]);

  if (!open) return null;

  const mockBaseUrlValue = mockBaseUrl(projectId);

  const onCreate = async () => {
    setError('');
    setBusy(true);
    try {
      const name = newServerName.trim() || 'Mock Server';
      const { mockServer } = await mockServerApi.create(projectId, { name });
      setServer(mockServer);
      setRoutes([]);
      setDrafts([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create mock server');
    } finally {
      setBusy(false);
    }
  };

  const onToggleEnabled = async (enabled: boolean) => {
    if (!server) return;
    setBusy(true);
    try {
      const { mockServer } = await mockServerApi.update(server.id, { enabled });
      setServer(mockServer);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update mock server');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!server) return;
    if (!window.confirm(`Delete mock server "${server.name}" and all of its routes?`)) return;
    setBusy(true);
    try {
      await mockServerApi.remove(server.id);
      setServer(null);
      setRoutes([]);
      setDrafts([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete mock server');
    } finally {
      setBusy(false);
    }
  };

  const patchDraft = (index: number, patch: Partial<DraftRoute>) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const addDraft = () => {
    setDrafts((prev) => [...prev, { method: 'GET', path: '/', status: '200', headers: '', body: '', delayMs: '0' }]);
  };

  const removeDraft = (index: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  };

  const saveRoutes = async () => {
    if (!server) return;
    setError('');
    setBusy(true);
    try {
      const removedIds = routes.map((r) => r.id).filter((id) => !drafts.some((d) => d.id === id));
      for (const id of removedIds) {
        await mockServerApi.deleteRoute(id);
      }
      for (const d of drafts) {
        const input = {
          method: d.method.toUpperCase(),
          path: d.path,
          status: Number(d.status) || 200,
          headers: parseHeaders(d.headers),
          body: d.body,
          delayMs: Number(d.delayMs) || 0,
        };
        if (d.id) {
          await mockServerApi.updateRoute(d.id, input);
        } else {
          await mockServerApi.createRoute(server.id, input);
        }
      }
      await loadServer();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save routes');
    } finally {
      setBusy(false);
    }
  };

  const renderRoutes = (
    <section className="modal-section">
      <div className="modal-section-head">
        <h3>Routes</h3>
        <button type="button" className="ghost-button small" data-testid="mock-add-route" onClick={addDraft}>
          + Route
        </button>
      </div>
      {drafts.length === 0 && <p className="hint">No routes yet. Add one below to start serving mock responses.</p>}
      {drafts.map((d, i) => (
        <div key={d.id ?? `new-${i}`} className="mock-route-row" data-testid={`mock-route-${i}`}>
          <div className="mock-route-fields">
            <select
              className="text-input mock-method"
              data-testid={`mock-route-method-${i}`}
              value={d.method}
              onChange={(e) => patchDraft(i, { method: e.target.value })}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              className="text-input"
              data-testid={`mock-route-path-${i}`}
              placeholder="/users/:id"
              value={d.path}
              onChange={(e) => patchDraft(i, { path: e.target.value })}
            />
            <input
              className="text-input mock-status"
              data-testid={`mock-route-status-${i}`}
              placeholder="200"
              value={d.status}
              onChange={(e) => patchDraft(i, { status: e.target.value })}
            />
            <input
              className="text-input mock-delay"
              data-testid={`mock-route-delay-${i}`}
              placeholder="delay ms"
              value={d.delayMs}
              onChange={(e) => patchDraft(i, { delayMs: e.target.value })}
            />
            <button
              type="button"
              className="icon-button danger"
              title="Remove route"
              aria-label="Remove route"
              data-testid={`mock-route-remove-${i}`}
              onClick={() => removeDraft(i)}
            >
              ✕
            </button>
          </div>
          <input
            className="text-input"
            data-testid={`mock-route-headers-${i}`}
            placeholder='Headers JSON, e.g. {"x-mock":"true"}'
            value={d.headers}
            onChange={(e) => patchDraft(i, { headers: e.target.value })}
          />
          <textarea
            className="text-input mock-body"
            data-testid={`mock-route-body-${i}`}
            placeholder={'Response body (JSON, or {"userId":"{{id}}"} to echo path params)'}
            rows={3}
            value={d.body}
            onChange={(e) => patchDraft(i, { body: e.target.value })}
          />
        </div>
      ))}
      <div className="modal-actions">
        <button type="button" className="primary-button" data-testid="mock-save-routes" disabled={busy} onClick={saveRoutes}>
          Save routes
        </button>
      </div>
    </section>
  );

  return (
    <Modal title={`Mock server — ${projectName}`} onClose={onClose} testId="mock-server-modal">
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {!server ? (
        <section className="modal-section">
          <p className="hint">
            Create a per-project mock API server. Its routes are served at{' '}
            <code>{mockBaseUrlValue}/…</code> so you can point requests at it instead of a real upstream.
          </p>
          <div className="env-create">
            <input
              className="text-input"
              data-testid="mock-server-name"
              placeholder="Mock server name"
              value={newServerName}
              onChange={(e) => setNewServerName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCreate();
              }}
            />
            <button type="button" className="primary-button small" data-testid="mock-server-create" disabled={busy} onClick={onCreate}>
              Create mock server
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="modal-section">
            <div className="mock-server-head">
              <div className="mock-server-info">
                <span className="vis-badge status-chip">
                  <span className={`status-dot ${server.enabled ? 'status-ok' : 'status-err'}`} />
                  {server.enabled ? 'Enabled' : 'Disabled'}
                </span>
                <code className="mock-base-url" data-testid="mock-base-url">
                  {mockBaseUrlValue}
                </code>
              </div>
              <div className="mock-server-actions">
                <button
                  type="button"
                  className="ghost-button small"
                  data-testid="mock-toggle-enabled"
                  disabled={busy}
                  onClick={() => onToggleEnabled(!server.enabled)}
                >
                  {server.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className="ghost-button small danger"
                  data-testid="mock-delete-server"
                  disabled={busy}
                  onClick={onDelete}
                >
                  Delete
                </button>
              </div>
            </div>
            <p className="hint">
              Requests to <code>{mockBaseUrlValue}/users/42</code> return the body of the route whose path
              matches (<code>:name</code> segments are captured and echoed via <code>{'{{name}}'}</code>).
              Routes are matched in order; use <code>*</code> as the method to match any method.
            </p>
          </section>
          {renderRoutes}
        </>
      )}
    </Modal>
  );
}

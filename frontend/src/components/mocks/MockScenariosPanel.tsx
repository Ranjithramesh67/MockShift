'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { mockServerApi, type MockRoute, type MockServer } from '@/lib/api';
import { mockBaseUrl } from '@/lib/mockServer';
import {
  MOCK_CONDITION_OPERATORS,
  MOCK_CONDITION_SOURCES,
  emptyCondition,
  mockScenariosApi,
  operatorNeedsValue,
  type MockCallLog,
  type MockCondition,
  type MockConditionOperator,
  type MockConditionSource,
  type MockRouteResponse,
  type MockScenario,
  type MockSequenceMode,
} from '@/lib/mockScenariosApi';
import styles from './mocks.module.css';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY'];

// ============================================================================
// Standalone mock-scenarios panel (E3).
//
// Coordinator seam: mount it for a project, e.g. from the app shell / a route:
//   import { MockScenariosPanel } from '@/components/mocks/MockScenariosPanel';
//   <MockScenariosPanel projectId={projectId} />
//
// The panel resolves the project's mock server itself, then manages named
// scenarios, conditional/sequence responses and the call log (with replay). It
// never imports the existing MockServersModal / sidebar code.
// ============================================================================

export interface MockScenariosPanelProps {
  projectId: string;
  // Optional override; a project has at most one mock server so this is only a
  // hint (the panel still resolves the server through the project).
  mockServerId?: string | null;
  className?: string;
}

interface ResponseDraft {
  scenarioId: string;
  name: string;
  priority: string;
  status: string;
  delayMs: string;
  body: string;
  headers: string;
  sequenceIndex: string;
  sequenceMode: MockSequenceMode;
  conditions: MockCondition[];
}

function emptyDraft(): ResponseDraft {
  return {
    scenarioId: '',
    name: '',
    priority: '0',
    status: '200',
    delayMs: '0',
    body: '{\n  "ok": true\n}',
    headers: '',
    sequenceIndex: '',
    sequenceMode: 'cycle',
    conditions: [],
  };
}

interface RouteDraft {
  method: string;
  path: string;
  status: string;
  delayMs: string;
  body: string;
  headers: string;
}

function emptyRouteDraft(): RouteDraft {
  return { method: 'GET', path: '/', status: '200', delayMs: '0', body: '', headers: '' };
}

function toRouteDraft(route: MockRoute): RouteDraft {
  return {
    method: route.method,
    path: route.path,
    status: String(route.status),
    delayMs: String(route.delay_ms ?? 0),
    body: route.body ?? '',
    headers: route.headers && Object.keys(route.headers).length > 0 ? JSON.stringify(route.headers, null, 2) : '',
  };
}

function parseHeaders(raw: string): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Headers must be a JSON object like {"x-mock":"true"}');
  }
  return parsed as Record<string, string>;
}

function toConditionPayload(condition: MockCondition): MockCondition {
  const payload: MockCondition = {
    source: condition.source,
    name: condition.name.trim(),
    operator: condition.operator,
  };
  if (condition.caseSensitive) payload.caseSensitive = true;
  if (operatorNeedsValue(condition.operator)) {
    payload.value =
      condition.operator === 'in'
        ? String(condition.value ?? '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        : condition.value;
  }
  return payload;
}

function sourceBadgeClass(source: string): string {
  if (source === 'scenario') return `${styles.badge} ${styles.badgeScenario}`;
  if (source === 'static') return `${styles.badge} ${styles.badgeStatic}`;
  return `${styles.badge} ${styles.badgeUnmatched}`;
}

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}.${ms}`;
}

function CallLogDetail({ log }: { log: MockCallLog }) {
  const query = log.query && Object.keys(log.query).length > 0 ? prettyJson(log.query) : '';
  const reqHeaders =
    log.request_headers && Object.keys(log.request_headers).length > 0
      ? prettyJson(log.request_headers)
      : '';
  const resHeaders =
    log.response_headers && Object.keys(log.response_headers).length > 0
      ? prettyJson(log.response_headers)
      : '';
  const scenarioLabel = log.scenario_name ? ` · scenario ${log.scenario_name}` : '';
  return (
    <div className={styles.logDetail} data-testid="mock-call-log-detail">
      <div className={styles.logMeta}>
        <span>Triggered {formatTimestamp(log.created_at)}</span>
        <span>{log.duration_ms} ms</span>
        <span>status {log.status ?? '-'}</span>
        <span>
          source {log.source}
          {scenarioLabel}
        </span>
        <span>route {log.matched_route_path || '-'}</span>
        {log.replayed_from ? <span>replay of {log.replayed_from}</span> : null}
      </div>
      <div className={styles.logDetailSection}>
        <span className={styles.logDetailLabel}>Request query</span>
        <pre className={styles.pre}>{query || '-'}</pre>
      </div>
      <div className={styles.logDetailSection}>
        <span className={styles.logDetailLabel}>Request headers</span>
        <pre className={styles.pre}>{reqHeaders || '-'}</pre>
      </div>
      <div className={styles.logDetailSection}>
        <span className={styles.logDetailLabel}>Request body</span>
        <pre className={styles.pre}>{log.request_body || '-'}</pre>
      </div>
      <div className={styles.logDetailSection}>
        <span className={styles.logDetailLabel}>Response headers</span>
        <pre className={styles.pre}>{resHeaders || '-'}</pre>
      </div>
      <div className={styles.logDetailSection}>
        <span className={styles.logDetailLabel}>Response body</span>
        <pre className={styles.pre}>{log.response_body || '-'}</pre>
      </div>
    </div>
  );
}

export function MockScenariosPanel({ projectId, className }: MockScenariosPanelProps) {
  const [server, setServer] = useState<MockServer | null>(null);
  const [scenarios, setScenarios] = useState<MockScenario[]>([]);
  const [routes, setRoutes] = useState<MockRoute[]>([]);
  const [logs, setLogs] = useState<MockCallLog[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [responses, setResponses] = useState<MockRouteResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newScenarioName, setNewScenarioName] = useState('');
  const [newServerName, setNewServerName] = useState('Mock Server');
  const [showForm, setShowForm] = useState(false);
  const [showRouteForm, setShowRouteForm] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [routeDraft, setRouteDraft] = useState<RouteDraft>(emptyRouteDraft);
  const [draft, setDraft] = useState<ResponseDraft>(emptyDraft);
  const [replay, setReplay] = useState<{ status: number; body: string } | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const selectedRouteIdRef = useRef('');

  useEffect(() => {
    selectedRouteIdRef.current = selectedRouteId;
  }, [selectedRouteId]);

  const refreshResponses = useCallback(async (routeId: string) => {
    if (!routeId) {
      setResponses([]);
      return;
    }
    try {
      const result = await mockScenariosApi.listResponses(routeId);
      setResponses(result.responses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load responses');
    }
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const { mockServer } = await mockServerApi.get(projectId);
      setServer(mockServer);
      if (!mockServer) {
        setScenarios([]);
        setRoutes([]);
        setLogs([]);
        setResponses([]);
        setSelectedRouteId('');
        return;
      }
      const [scenarioResult, routeResult, logResult] = await Promise.all([
        mockScenariosApi.listScenarios(mockServer.id),
        mockServerApi.routes(mockServer.id),
        mockScenariosApi.listCallLogs(mockServer.id, { limit: 100 }),
      ]);
      setScenarios(scenarioResult.scenarios);
      setRoutes(routeResult.routes);
      setLogs(logResult.logs);
      const currentRouteId = selectedRouteIdRef.current;
      const nextRouteId = routeResult.routes.some((r) => r.id === currentRouteId)
        ? currentRouteId
        : routeResult.routes[0]?.id || '';
      setSelectedRouteId(nextRouteId);
      await refreshResponses(nextRouteId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load mock scenarios');
    } finally {
      setLoading(false);
    }
  }, [projectId, refreshResponses]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRouteSelect = useCallback(
    (routeId: string) => {
      setSelectedRouteId(routeId);
      refreshResponses(routeId);
    },
    [refreshResponses]
  );

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const createScenario = () =>
    withBusy(async () => {
      if (!server || !newScenarioName.trim()) return;
      await mockScenariosApi.createScenario({ mockServerId: server.id, name: newScenarioName.trim() });
      setNewScenarioName('');
      setNotice('Scenario created');
      await load();
    });

  const createServer = () =>
    withBusy(async () => {
      if (!projectId) return;
      await mockServerApi.create(projectId, { name: newServerName.trim() || 'Mock Server' });
      setNotice('Mock server created');
      await load();
    });

  const deleteScenario = (id: string) =>
    withBusy(async () => {
      if (!window.confirm('Delete this scenario and all of its response overrides?')) return;
      await mockScenariosApi.deleteScenario(id);
      setNotice('Scenario deleted');
      await load();
    });

  const cancelRouteForm = () => {
    setShowRouteForm(false);
    setEditingRouteId(null);
    setRouteDraft(emptyRouteDraft());
  };

  const startAddRoute = () => {
    if (showRouteForm && !editingRouteId) {
      cancelRouteForm();
      return;
    }
    setEditingRouteId(null);
    setRouteDraft(emptyRouteDraft());
    setShowRouteForm(true);
  };

  const startEditRoute = (route: MockRoute) => {
    setEditingRouteId(route.id);
    setRouteDraft(toRouteDraft(route));
    setShowRouteForm(true);
  };

  const submitRoute = () =>
    withBusy(async () => {
      if (!server) return;
      let headers: Record<string, string>;
      try {
        headers = parseHeaders(routeDraft.headers);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid headers');
        return;
      }
      const path = routeDraft.path.trim();
      if (!path) return;
      const input = {
        method: routeDraft.method.toUpperCase(),
        path,
        status: Number(routeDraft.status) || 200,
        headers,
        body: routeDraft.body,
        delayMs: Number(routeDraft.delayMs) || 0,
      };
      if (editingRouteId) {
        await mockServerApi.updateRoute(editingRouteId, input);
        setNotice('Route updated');
        cancelRouteForm();
        await load();
      } else {
        const { route } = await mockServerApi.createRoute(server.id, input);
        setNotice('Route added');
        cancelRouteForm();
        await load();
        setSelectedRouteId(route.id);
        await refreshResponses(route.id);
      }
    });

  const deleteRoute = (route: MockRoute) =>
    withBusy(async () => {
      if (!window.confirm(`Delete route ${route.method} ${route.path}?`)) return;
      await mockServerApi.deleteRoute(route.id);
      setNotice('Route deleted');
      await load();
    });

  const updateCondition = (index: number, patch: Partial<MockCondition>) => {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition, i) =>
        i === index ? { ...condition, ...patch } : condition
      ),
    }));
  };

  const addCondition = () =>
    setDraft((current) => ({ ...current, conditions: [...current.conditions, emptyCondition()] }));

  const removeCondition = (index: number) =>
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.filter((_, i) => i !== index),
    }));

  const submitResponse = () =>
    withBusy(async () => {
      if (!selectedRouteId) return;
      let headers: Record<string, string>;
      try {
        headers = parseHeaders(draft.headers);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid headers');
        return;
      }
      const conditions = draft.conditions
        .filter((condition) => condition.name.trim())
        .map(toConditionPayload);
      await mockScenariosApi.createResponse(selectedRouteId, {
        scenarioId: draft.scenarioId || null,
        name: draft.name.trim(),
        priority: Number(draft.priority) || 0,
        status: Number(draft.status) || 200,
        delayMs: Number(draft.delayMs) || 0,
        body: draft.body,
        headers,
        conditions,
        sequenceIndex: draft.sequenceIndex === '' ? null : Number(draft.sequenceIndex),
        sequenceMode: draft.sequenceMode,
      });
      setDraft(emptyDraft());
      setShowForm(false);
      setNotice('Response added');
      await refreshResponses(selectedRouteId);
    });

  const deleteResponse = (id: string) =>
    withBusy(async () => {
      await mockScenariosApi.deleteResponse(id);
      setNotice('Response deleted');
      await refreshResponses(selectedRouteId);
    });

  const resetSequence = () =>
    withBusy(async () => {
      if (!selectedRouteId) return;
      await mockScenariosApi.resetSequence(selectedRouteId);
      setNotice('Sequence reset');
    });

  const clearLogs = () =>
    withBusy(async () => {
      if (!server) return;
      if (!window.confirm('Clear all captured calls for this mock server?')) return;
      await mockScenariosApi.clearCallLogs(server.id);
      setLogs([]);
      setExpandedLogId(null);
      setNotice('Call log cleared');
    });

  const replayCall = (id: string) =>
    withBusy(async () => {
      const result = await mockScenariosApi.replay(id);
      setReplay({ status: result.replay.status, body: result.replay.body });
      if (server) {
        const logResult = await mockScenariosApi.listCallLogs(server.id, { limit: 100 });
        setLogs(logResult.logs);
      }
      setNotice('Replayed request');
    });

  const scenarioName = (id: string | null) =>
    id ? scenarios.find((scenario) => scenario.id === id)?.name || id : 'Default';

  return (
    <div className={[styles.panel, className].filter(Boolean).join(' ')} data-testid="mock-scenarios-panel">
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Mock scenarios</h1>
          <p className={styles.subtitle}>
            {server ? (
              <>
                {server.name} · <code>{mockBaseUrl(projectId)}</code> · activate with{' '}
                <code>X-Mock-Scenario: &lt;name&gt;</code> or <code>?__scenario=&lt;name&gt;</code>
              </>
            ) : (
              'Conditional responses, named scenario overrides, stateful sequences and call logs.'
            )}
          </p>
        </div>
        <div className={styles.actions}>
          <button className={styles.btn} type="button" onClick={load} disabled={loading || busy}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.success}>{notice}</div> : null}

      {!server && !loading ? (
        <div className={styles.section}>
          <p className={styles.empty}>This project has no mock server yet. Create one first.</p>
          <div className={styles.inlineForm}>
            <div className={`${styles.field} ${styles.fieldGrow}`}>
              <label className={styles.label} htmlFor="new-mock-server-name">
                Mock server name
              </label>
              <input
                id="new-mock-server-name"
                className={styles.input}
                value={newServerName}
                placeholder="Mock Server"
                data-testid="mock-scenarios-server-name"
                onChange={(event) => setNewServerName(event.target.value)}
              />
            </div>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              type="button"
              onClick={createServer}
              disabled={busy || !projectId}
              data-testid="mock-scenarios-create-server"
            >
              Create mock server
            </button>
          </div>
        </div>
      ) : null}

      {server ? (
        <>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Scenarios</h2>
              <span className={styles.sectionHint}>
                Named override sets. Activate one per request with{' '}
                <code>X-Mock-Scenario: &lt;name&gt;</code> or <code>?__scenario=&lt;name&gt;</code>;
                its responses outrank the Default set.
              </span>
            </div>
            {scenarios.length === 0 ? (
              <p className={styles.empty}>No scenarios yet.</p>
            ) : (
              <div className={styles.list}>
                {scenarios.map((scenario) => (
                  <div key={scenario.id} className={styles.listItem}>
                    <div className={styles.itemMain}>
                      <span className={styles.itemName}>{scenario.name}</span>
                      {scenario.description ? (
                        <span className={styles.subtitle}>{scenario.description}</span>
                      ) : null}
                    </div>
                    <div className={styles.itemActions}>
                      <button
                        className={`${styles.btn} ${styles.btnDanger}`}
                        type="button"
                        onClick={() => deleteScenario(scenario.id)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.inlineForm}>
              <div className={`${styles.field} ${styles.fieldGrow}`}>
                <label className={styles.label} htmlFor="new-scenario-name">
                  New scenario
                </label>
                <input
                  id="new-scenario-name"
                  className={styles.input}
                  value={newScenarioName}
                  placeholder="e.g. maintenance"
                  onChange={(event) => setNewScenarioName(event.target.value)}
                />
              </div>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                type="button"
                onClick={createScenario}
                disabled={busy || !newScenarioName.trim()}
              >
                Add scenario
              </button>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Routes</h2>
              <div className={styles.actions}>
                <span className={styles.sectionHint}>
                  {routes.length} route{routes.length === 1 ? '' : 's'}
                </span>
                <button
                  className={styles.btn}
                  type="button"
                  onClick={startAddRoute}
                  disabled={busy}
                  data-testid="mock-scenarios-add-route"
                >
                  {showRouteForm && !editingRouteId ? 'Cancel' : 'Add route'}
                </button>
              </div>
            </div>

            {routes.length === 0 ? (
              <p className={styles.empty}>No routes yet. Add one to start serving mock responses.</p>
            ) : (
              <div className={styles.list}>
                {routes.map((route) => (
                  <div key={route.id} className={styles.listItem}>
                    <div className={styles.itemMain}>
                      <span className={styles.itemName}>
                        <span className={styles.logMethod}>{route.method}</span> {route.path}
                      </span>
                      <span className={styles.itemMeta}>
                        <span className={styles.badgeStatus}>status {route.status}</span>
                        {route.delay_ms ? (
                          <span className={styles.badge}>delay {route.delay_ms}ms</span>
                        ) : null}
                      </span>
                    </div>
                    <div className={styles.itemActions}>
                      <button
                        className={styles.btn}
                        type="button"
                        onClick={() => startEditRoute(route)}
                        disabled={busy}
                      >
                        Edit
                      </button>
                      <button
                        className={`${styles.btn} ${styles.btnDanger}`}
                        type="button"
                        onClick={() => deleteRoute(route)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showRouteForm ? (
              <div className={styles.routeForm}>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.label}>Method</label>
                    <select
                      className={styles.select}
                      value={routeDraft.method}
                      data-testid="mock-scenarios-route-method"
                      onChange={(event) =>
                        setRouteDraft({ ...routeDraft, method: event.target.value })
                      }
                    >
                      {METHODS.map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={`${styles.field} ${styles.fieldGrow}`}>
                    <label className={styles.label}>Path</label>
                    <input
                      className={styles.input}
                      placeholder="/users/:id"
                      value={routeDraft.path}
                      data-testid="mock-scenarios-route-path"
                      onChange={(event) =>
                        setRouteDraft({ ...routeDraft, path: event.target.value })
                      }
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Status</label>
                    <input
                      className={styles.input}
                      value={routeDraft.status}
                      inputMode="numeric"
                      data-testid="mock-scenarios-route-status"
                      onChange={(event) =>
                        setRouteDraft({ ...routeDraft, status: event.target.value })
                      }
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Delay (ms)</label>
                    <input
                      className={styles.input}
                      value={routeDraft.delayMs}
                      inputMode="numeric"
                      data-testid="mock-scenarios-route-delay"
                      onChange={(event) =>
                        setRouteDraft({ ...routeDraft, delayMs: event.target.value })
                      }
                    />
                  </div>
                </div>
                <div className={styles.row}>
                  <div className={`${styles.field} ${styles.fieldGrow}`}>
                    <label className={styles.label}>Response body</label>
                    <textarea
                      className={styles.textarea}
                      value={routeDraft.body}
                      placeholder='{"userId":"{{id}}"}'
                      data-testid="mock-scenarios-route-body"
                      onChange={(event) =>
                        setRouteDraft({ ...routeDraft, body: event.target.value })
                      }
                    />
                  </div>
                  <div className={`${styles.field} ${styles.fieldGrow}`}>
                    <label className={styles.label}>Headers (JSON)</label>
                    <textarea
                      className={styles.textarea}
                      value={routeDraft.headers}
                      placeholder='{"x-mock":"true"}'
                      data-testid="mock-scenarios-route-headers"
                      onChange={(event) =>
                        setRouteDraft({ ...routeDraft, headers: event.target.value })
                      }
                    />
                  </div>
                </div>
                <div className={styles.inlineForm}>
                  <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    type="button"
                    onClick={submitRoute}
                    disabled={busy || !routeDraft.path.trim()}
                    data-testid="mock-scenarios-save-route"
                  >
                    {editingRouteId ? 'Save route' : 'Add route'}
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Route responses</h2>
              <div className={styles.actions}>
                <select
                  className={styles.select}
                  value={selectedRouteId}
                  onChange={(event) => handleRouteSelect(event.target.value)}
                >
                  {routes.length === 0 ? <option value="">No routes</option> : null}
                  {routes.map((route) => (
                    <option key={route.id} value={route.id}>
                      {route.method} {route.path}
                    </option>
                  ))}
                </select>
                <button
                  className={styles.btn}
                  type="button"
                  onClick={() => setShowForm((value) => !value)}
                  disabled={!selectedRouteId}
                >
                  {showForm ? 'Cancel' : 'Add response'}
                </button>
                <button
                  className={styles.btn}
                  type="button"
                  onClick={resetSequence}
                  disabled={!selectedRouteId || busy}
                >
                  Reset sequence
                </button>
              </div>
            </div>

            {showForm ? (
              <div className={styles.responseForm}>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.label}>Scenario</label>
                    <select
                      className={styles.select}
                      value={draft.scenarioId}
                      onChange={(event) =>
                        setDraft({ ...draft, scenarioId: event.target.value })
                      }
                    >
                      <option value="">Default (no scenario)</option>
                      {scenarios.map((scenario) => (
                        <option key={scenario.id} value={scenario.id}>
                          {scenario.name}
                        </option>
                      ))}
                    </select>
                    <span className={styles.fieldHint}>
                      Default is served for every call. A named scenario response is served only
                      while that scenario is active.
                    </span>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Priority</label>
                    <input
                      className={styles.input}
                      value={draft.priority}
                      inputMode="numeric"
                      onChange={(event) => setDraft({ ...draft, priority: event.target.value })}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Status</label>
                    <input
                      className={styles.input}
                      value={draft.status}
                      inputMode="numeric"
                      onChange={(event) => setDraft({ ...draft, status: event.target.value })}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Delay (ms)</label>
                    <input
                      className={styles.input}
                      value={draft.delayMs}
                      inputMode="numeric"
                      onChange={(event) => setDraft({ ...draft, delayMs: event.target.value })}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Sequence index</label>
                    <input
                      className={styles.input}
                      value={draft.sequenceIndex}
                      placeholder="blank = conditional"
                      inputMode="numeric"
                      onChange={(event) =>
                        setDraft({ ...draft, sequenceIndex: event.target.value })
                      }
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Sequence mode</label>
                    <select
                      className={styles.select}
                      value={draft.sequenceMode}
                      onChange={(event) =>
                        setDraft({ ...draft, sequenceMode: event.target.value as MockSequenceMode })
                      }
                    >
                      <option value="cycle">cycle</option>
                      <option value="advance">advance</option>
                    </select>
                  </div>
                </div>

                <div className={styles.subForm}>
                  <div className={styles.sectionHead}>
                    <span className={styles.sectionTitle}>Conditions (all must match)</span>
                    <button className={styles.btn} type="button" onClick={addCondition}>
                      Add condition
                    </button>
                  </div>
                  {draft.conditions.length === 0 ? (
                    <p className={styles.empty}>
                      No conditions: this response is always eligible for the selected scope.
                    </p>
                  ) : (
                    <div className={styles.conditions}>
                      {draft.conditions.map((condition, index) => (
                        <div key={index} className={styles.conditionRow}>
                          <select
                            className={styles.select}
                            value={condition.source}
                            onChange={(event) =>
                              updateCondition(index, {
                                source: event.target.value as MockConditionSource,
                              })
                            }
                          >
                            {MOCK_CONDITION_SOURCES.map((source) => (
                              <option key={source} value={source}>
                                {source}
                              </option>
                            ))}
                          </select>
                          <input
                            className={styles.input}
                            placeholder="name (e.g. x-api-key or user.role)"
                            value={condition.name}
                            onChange={(event) =>
                              updateCondition(index, { name: event.target.value })
                            }
                          />
                          <select
                            className={styles.select}
                            value={condition.operator}
                            onChange={(event) =>
                              updateCondition(index, {
                                operator: event.target.value as MockConditionOperator,
                              })
                            }
                          >
                            {MOCK_CONDITION_OPERATORS.map((operator) => (
                              <option key={operator} value={operator}>
                                {operator}
                              </option>
                            ))}
                          </select>
                          {operatorNeedsValue(condition.operator) ? (
                            <input
                              className={styles.input}
                              placeholder={condition.operator === 'in' ? 'a,b,c' : 'value'}
                              value={String(condition.value ?? '')}
                              onChange={(event) =>
                                updateCondition(index, { value: event.target.value })
                              }
                            />
                          ) : null}
                          <button
                            className={`${styles.btn} ${styles.btnDanger}`}
                            type="button"
                            onClick={() => removeCondition(index)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className={styles.row}>
                  <div className={`${styles.field} ${styles.fieldGrow}`}>
                    <label className={styles.label}>Response body</label>
                    <textarea
                      className={styles.textarea}
                      value={draft.body}
                      onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                    />
                  </div>
                  <div className={`${styles.field} ${styles.fieldGrow}`}>
                    <label className={styles.label}>Headers (JSON)</label>
                    <textarea
                      className={styles.textarea}
                      value={draft.headers}
                      placeholder='{"x-mock":"true"}'
                      onChange={(event) => setDraft({ ...draft, headers: event.target.value })}
                    />
                  </div>
                </div>
                <div className={styles.inlineForm}>
                  <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    type="button"
                    onClick={submitResponse}
                    disabled={busy}
                  >
                    Save response
                  </button>
                </div>
              </div>
            ) : null}

            <div className={styles.responseList}>
              {responses.length === 0 ? (
                <p className={styles.empty}>No conditional or sequence responses for this route.</p>
              ) : (
                <div className={styles.list}>
                  {responses.map((response) => (
                    <div key={response.id} className={styles.listItem}>
                      <div className={styles.itemMain}>
                        <span className={styles.itemName}>
                          {response.name || (response.sequence_index === null ? 'Conditional response' : `Sequence #${response.sequence_index}`)}
                        </span>
                        <span className={styles.itemMeta}>
                          <span className={styles.badgeStatus}>status {response.status}</span>
                          <span className={styles.badge}>{scenarioName(response.scenario_id)}</span>
                          <span className={styles.badge}>priority {response.priority}</span>
                          {response.sequence_index !== null ? (
                            <span className={styles.badge}>
                              sequence {response.sequence_index} · {response.sequence_mode}
                            </span>
                          ) : null}
                          {response.conditions.length > 0 ? (
                            <span className={styles.badge}>
                              {response.conditions.length} condition
                              {response.conditions.length === 1 ? '' : 's'}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <div className={styles.itemActions}>
                        <button
                          className={`${styles.btn} ${styles.btnDanger}`}
                          type="button"
                          onClick={() => deleteResponse(response.id)}
                          disabled={busy}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Call log</h2>
              <div className={styles.actions}>
                <span className={styles.sectionHint}>{logs.length} captured</span>
                <button
                  className={styles.btn}
                  type="button"
                  onClick={() => load()}
                  disabled={loading || busy}
                >
                  Refresh
                </button>
                <button
                  className={`${styles.btn} ${styles.btnDanger}`}
                  type="button"
                  onClick={clearLogs}
                  disabled={busy || logs.length === 0}
                >
                  Clear log
                </button>
              </div>
            </div>
            {logs.length === 0 ? (
              <p className={styles.empty}>No calls captured yet. Hit the mock URL to record one.</p>
            ) : (
              <div className={styles.logTable}>
                {logs.map((log) => (
                  <div key={log.id} className={styles.logEntry}>
                    <div className={styles.logRow}>
                      <span className={styles.logTime}>
                        {new Date(log.created_at).toLocaleTimeString()}
                      </span>
                      <span className={styles.logMethod}>{log.method}</span>
                      <span className={styles.logPath} title={log.path}>
                        {log.path}
                      </span>
                      <span className={styles.badgeStatus}>{log.status ?? '-'}</span>
                      <span className={sourceBadgeClass(log.source)}>
                        {log.source === 'scenario' && log.scenario_name
                          ? `scenario:${log.scenario_name}`
                          : log.source}
                      </span>
                      <span className={`${styles.itemMeta} ${styles.logScenario}`}>
                        {log.matched_route_path || '-'}
                      </span>
                      <span className={styles.logAction}>
                        <button
                          className={styles.btn}
                          type="button"
                          onClick={() =>
                            setExpandedLogId((current) => (current === log.id ? null : log.id))
                          }
                        >
                          {expandedLogId === log.id ? 'Hide' : 'Details'}
                        </button>
                        <button
                          className={styles.btn}
                          type="button"
                          onClick={() => replayCall(log.id)}
                          disabled={busy}
                        >
                          Replay
                        </button>
                      </span>
                    </div>
                    {expandedLogId === log.id ? <CallLogDetail log={log} /> : null}
                  </div>
                ))}
              </div>
            )}
            {replay ? (
              <pre className={styles.pre}>{`HTTP ${replay.status}\n${replay.body}`}</pre>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mockServerApi, type MockRoute, type MockServer } from '@/lib/api';
import {
  emptyCondition,
  mockScenariosApi,
  operatorNeedsValue,
  type MockCallLog,
  type MockCondition,
  type MockRouteResponse,
  type MockScenario,
  type MockScenarioLink,
  type MockSequenceMode,
} from '@/lib/mockScenariosApi';

export interface ResponseDraft {
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

export function emptyDraft(): ResponseDraft {
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

export interface RouteDraft {
  method: string;
  path: string;
  status: string;
  delayMs: string;
  body: string;
  headers: string;
}

export function emptyRouteDraft(): RouteDraft {
  return { method: 'GET', path: '/', status: '200', delayMs: '0', body: '', headers: '' };
}

export function toRouteDraft(route: MockRoute): RouteDraft {
  return {
    method: route.method,
    path: route.path,
    status: String(route.status),
    delayMs: String(route.delay_ms ?? 0),
    body: route.body ?? '',
    headers: route.headers && Object.keys(route.headers).length > 0 ? JSON.stringify(route.headers, null, 2) : '',
  };
}

export function parseHeaders(raw: string): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Headers must be a JSON object like {"x-mock":"true"}');
  }
  return parsed as Record<string, string>;
}

export function toConditionPayload(condition: MockCondition): MockCondition {
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

export function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}.${ms}`;
}

export interface ScenarioRouteGroup {
  routeId: string;
  method: string;
  path: string;
  responses: MockScenarioLink[];
}

// Group the flat scenario-link rows by route, preserving route order.
export function groupLinksByRoute(links: MockScenarioLink[]): ScenarioRouteGroup[] {
  const groups = new Map<string, ScenarioRouteGroup>();
  for (const link of links) {
    let group = groups.get(link.route_id);
    if (!group) {
      group = { routeId: link.route_id, method: link.method, path: link.path, responses: [] };
      groups.set(link.route_id, group);
    }
    group.responses.push(link);
  }
  return Array.from(groups.values());
}

export function useMockServerAdmin(projectId: string) {
  const [server, setServer] = useState<MockServer | null>(null);
  const [scenarios, setScenarios] = useState<MockScenario[]>([]);
  const [routes, setRoutes] = useState<MockRoute[]>([]);
  const [logs, setLogs] = useState<MockCallLog[]>([]);
  const [scenarioLinks, setScenarioLinks] = useState<MockScenarioLink[]>([]);
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
  const [expandedScenarioId, setExpandedScenarioId] = useState<string | null>(null);
  const [showDefaultOverrides, setShowDefaultOverrides] = useState(false);
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

  const refreshLinks = useCallback(async (serverId: string) => {
    if (!serverId) {
      setScenarioLinks([]);
      return;
    }
    try {
      const result = await mockScenariosApi.listScenarioLinks(serverId);
      setScenarioLinks(result.links);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scenario links');
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
        setScenarioLinks([]);
        setResponses([]);
        setSelectedRouteId('');
        return;
      }
      const [scenarioResult, routeResult, logResult, linkResult] = await Promise.all([
        mockScenariosApi.listScenarios(mockServer.id),
        mockServerApi.routes(mockServer.id),
        mockScenariosApi.listCallLogs(mockServer.id, { limit: 100 }),
        mockScenariosApi.listScenarioLinks(mockServer.id),
      ]);
      setScenarios(scenarioResult.scenarios);
      setRoutes(routeResult.routes);
      setLogs(logResult.logs);
      setScenarioLinks(linkResult.links);
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

  const linksByScenario = useMemo(() => {
    const map = new Map<string, MockScenarioLink[]>();
    const defaults: MockScenarioLink[] = [];
    for (const link of scenarioLinks) {
      if (link.scenario_id) {
        const list = map.get(link.scenario_id);
        if (list) list.push(link);
        else map.set(link.scenario_id, [link]);
      } else {
        defaults.push(link);
      }
    }
    return { map, defaults };
  }, [scenarioLinks]);

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
      if (server) await refreshLinks(server.id);
    });

  const deleteResponse = (id: string) =>
    withBusy(async () => {
      await mockScenariosApi.deleteResponse(id);
      setNotice('Response deleted');
      await refreshResponses(selectedRouteId);
      if (server) await refreshLinks(server.id);
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

  return {
    server,
    scenarios,
    routes,
    logs,
    scenarioLinks,
    linksByScenario,
    selectedRouteId,
    responses,
    loading,
    busy,
    error,
    notice,
    newScenarioName,
    setNewScenarioName,
    newServerName,
    setNewServerName,
    showForm,
    setShowForm,
    showRouteForm,
    editingRouteId,
    routeDraft,
    setRouteDraft,
    draft,
    setDraft,
    replay,
    expandedLogId,
    setExpandedLogId,
    expandedScenarioId,
    setExpandedScenarioId,
    showDefaultOverrides,
    setShowDefaultOverrides,
    load,
    handleRouteSelect,
    createScenario,
    createServer,
    deleteScenario,
    startAddRoute,
    startEditRoute,
    cancelRouteForm,
    submitRoute,
    deleteRoute,
    updateCondition,
    addCondition,
    removeCondition,
    submitResponse,
    deleteResponse,
    resetSequence,
    clearLogs,
    replayCall,
    scenarioName,
    groupLinksByRoute,
  };
}

export type MockServerAdmin = ReturnType<typeof useMockServerAdmin>;

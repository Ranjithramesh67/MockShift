'use client';

import { apiFetch } from './api';

// ============================================================================
// E3 — Mock server scenarios & call logs API client.
//
// Mirrors backend/src/api/routes/mockScenarios.js. Response fields stay
// snake_case to match the mock_routes / mock_servers rows the panel already
// consumes, so route + response rows can be rendered together.
// ============================================================================

export interface MockScenario {
  id: string;
  project_id: string;
  mock_server_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export type MockConditionSource = 'header' | 'query' | 'body';

export type MockConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'regex'
  | 'exists'
  | 'notExists'
  | 'in';

export interface MockCondition {
  source: MockConditionSource;
  name: string;
  operator: MockConditionOperator;
  value?: unknown;
  caseSensitive?: boolean;
}

export type MockSequenceMode = 'cycle' | 'advance';

export interface MockRouteResponse {
  id: string;
  route_id: string;
  scenario_id: string | null;
  name: string;
  priority: number;
  conditions: MockCondition[];
  status: number;
  headers: Record<string, string>;
  body: string;
  delay_ms: number;
  sequence_index: number | null;
  sequence_mode: MockSequenceMode;
  created_at: string;
}

export interface MockSequenceState {
  scenario_id: string;
  cursor: number;
  updated_at: string;
}

// A response override joined with its route (+ scenario), used to show which
// scenario overrides which routes on the mock server.
export interface MockScenarioLink {
  response_id: string;
  route_id: string;
  scenario_id: string | null;
  name: string;
  priority: number;
  status: number;
  conditions: MockCondition[];
  sequence_index: number | null;
  sequence_mode: MockSequenceMode;
  method: string;
  path: string;
}

export type MockCallSource = 'scenario' | 'static' | 'unmatched';

export interface MockCallLog {
  id: string;
  project_id: string;
  mock_server_id: string;
  method: string;
  path: string;
  query: Record<string, unknown>;
  request_headers: Record<string, unknown>;
  request_body: string;
  matched_route_id: string | null;
  matched_route_path: string | null;
  matched_response_id: string | null;
  matched_scenario_id: string | null;
  scenario_name: string | null;
  status: number | null;
  duration_ms: number;
  response_headers: Record<string, unknown>;
  response_body: string;
  source: MockCallSource;
  replayed_from: string | null;
  created_at: string;
}

export interface MockResponseInput {
  scenarioId?: string | null;
  name?: string;
  priority?: number;
  conditions?: MockCondition[];
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  delayMs?: number;
  sequenceIndex?: number | null;
  sequenceMode?: MockSequenceMode;
}

export interface MockRouteResponsesResult {
  responses: MockRouteResponse[];
  sequenceState: MockSequenceState[];
  scenarios: Array<{ id: string; name: string }>;
}

export interface MockReplayResult {
  replay: { status: number; headers: Record<string, string>; body: string };
  log: MockCallLog | null;
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).length > 0) q.set(key, String(value));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const mockScenariosApi = {
  listScenarios: (mockServerId: string) =>
    apiFetch<{ scenarios: MockScenario[] }>(`/api/mock-scenarios${toQuery({ mockServerId })}`),

  createScenario: (input: { mockServerId: string; name: string; description?: string }) =>
    apiFetch<{ scenario: MockScenario }>('/api/mock-scenarios', { method: 'POST', body: input }),

  updateScenario: (scenarioId: string, patch: { name?: string; description?: string }) =>
    apiFetch<{ scenario: MockScenario }>(`/api/mock-scenarios/${scenarioId}`, {
      method: 'PATCH',
      body: patch,
    }),

  listScenarioLinks: (mockServerId: string) =>
    apiFetch<{ links: MockScenarioLink[] }>(
      `/api/mock-scenarios/links${toQuery({ mockServerId })}`
    ),

  deleteScenario: (scenarioId: string) =>
    apiFetch<{ ok: boolean }>(`/api/mock-scenarios/${scenarioId}`, { method: 'DELETE' }),

  listResponses: (routeId: string) =>
    apiFetch<MockRouteResponsesResult>(`/api/mock-routes/${routeId}/responses`),

  createResponse: (routeId: string, input: MockResponseInput) =>
    apiFetch<{ response: MockRouteResponse }>(`/api/mock-routes/${routeId}/responses`, {
      method: 'POST',
      body: input,
    }),

  updateResponse: (responseId: string, patch: MockResponseInput) =>
    apiFetch<{ response: MockRouteResponse }>(`/api/mock-responses/${responseId}`, {
      method: 'PATCH',
      body: patch,
    }),

  deleteResponse: (responseId: string) =>
    apiFetch<{ ok: boolean }>(`/api/mock-responses/${responseId}`, { method: 'DELETE' }),

  resetSequence: (routeId: string, scenarioId?: string | null) =>
    apiFetch<{ ok: boolean; cursor: number }>(`/api/mock-routes/${routeId}/sequence/reset`, {
      method: 'POST',
      body: scenarioId ? { scenarioId } : {},
    }),

  listCallLogs: (
    mockServerId: string,
    options: { limit?: number; offset?: number } = {}
  ) =>
    apiFetch<{ logs: MockCallLog[]; total: number }>(
      `/api/mock-call-logs${toQuery({
        mockServerId,
        limit: options.limit,
        offset: options.offset,
      })}`
    ),

  clearCallLogs: (mockServerId: string) =>
    apiFetch<{ ok: boolean; cleared: number }>(`/api/mock-call-logs${toQuery({ mockServerId })}`, {
      method: 'DELETE',
    }),

  replay: (callLogId: string) =>
    apiFetch<MockReplayResult>(`/api/mock-call-logs/${callLogId}/replay`, { method: 'POST' }),
};

export const MOCK_CONDITION_SOURCES: MockConditionSource[] = ['header', 'query', 'body'];

export const MOCK_CONDITION_OPERATORS: MockConditionOperator[] = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'regex',
  'exists',
  'notExists',
  'in',
];

// Operators that do not take a comparison value.
export function operatorNeedsValue(operator: MockConditionOperator): boolean {
  return operator !== 'exists' && operator !== 'notExists';
}

export function emptyCondition(): MockCondition {
  return { source: 'query', name: '', operator: 'equals', value: '' };
}

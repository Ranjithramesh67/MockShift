'use client';

import { apiFetch } from './api';

// ------------------------------------------------------------- Monitor types
// A monitor is a saved synthetic check. It targets one stored request or one
// workflow in a project and runs on a 5-field cron schedule. The backend
// records each check in monitor_results and tracks UP/DOWN streaks + alerts.
export type MonitorTargetType = 'REQUEST' | 'WORKFLOW';
export type MonitorStatus = 'UNKNOWN' | 'UP' | 'DOWN';
export type MonitorResultStatus = 'PASS' | 'FAIL';

export interface Monitor {
  id: string;
  projectId: string;
  name: string;
  targetType: MonitorTargetType;
  requestId: string | null;
  workflowId: string | null;
  scheduleCron: string;
  failureThreshold: number;
  notifyWebhookUrl: string | null;
  enabled: boolean;
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  alerted: boolean;
  lastCheckedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorResult {
  id: string;
  status: MonitorResultStatus;
  httpStatus: number | null;
  durationMs: number | null;
  error: string | null;
  checkedAt: string;
}

export interface MonitorAggregate {
  totalChecks: number;
  passed: number;
  failed: number;
  uptimePct: number | null;
  p95DurationMs: number | null;
  currentStreak: { status: MonitorStatus; count: number };
}

export interface MonitorWithAggregate {
  monitor: Monitor;
  aggregate: MonitorAggregate;
}

export interface MonitorResultsResponse extends MonitorWithAggregate {
  results: MonitorResult[];
}

export interface MonitorCheckResponse extends MonitorWithAggregate {
  check: {
    passed: boolean;
    httpStatus: number | null;
    durationMs: number | null;
    error: string | null;
  };
  alerts: Array<{ event: string; deliveries: string[] }>;
}

export interface CreateMonitorInput {
  projectId: string;
  name: string;
  targetType: MonitorTargetType;
  requestId?: string;
  workflowId?: string;
  scheduleCron: string;
  failureThreshold?: number;
  notifyWebhookUrl?: string;
  enabled?: boolean;
}

export interface UpdateMonitorInput {
  name?: string;
  targetType?: MonitorTargetType;
  requestId?: string | null;
  workflowId?: string | null;
  scheduleCron?: string;
  failureThreshold?: number;
  notifyWebhookUrl?: string | null;
  enabled?: boolean;
}

export const monitorsApi = {
  list: (projectId?: string) =>
    apiFetch<{ monitors: Monitor[] }>(
      `/api/monitors${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`
    ),
  get: (monitorId: string) => apiFetch<MonitorWithAggregate>(`/api/monitors/${monitorId}`),
  create: (input: CreateMonitorInput) =>
    apiFetch<{ monitor: Monitor }>('/api/monitors', { method: 'POST', body: input }),
  update: (monitorId: string, patch: UpdateMonitorInput) =>
    apiFetch<MonitorWithAggregate>(`/api/monitors/${monitorId}`, { method: 'PATCH', body: patch }),
  remove: (monitorId: string) =>
    apiFetch<void>(`/api/monitors/${monitorId}`, { method: 'DELETE' }),
  results: (monitorId: string, limit = 50) =>
    apiFetch<MonitorResultsResponse>(`/api/monitors/${monitorId}/results?limit=${limit}`),
  check: (monitorId: string) =>
    apiFetch<MonitorCheckResponse>(`/api/monitors/${monitorId}/check`, { method: 'POST' }),
};

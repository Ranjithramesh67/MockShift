'use client';

import type { Assertion } from './types';

export type ApiType = 'REST' | 'SOAP' | 'GRAPHQL' | 'AUTH';
export type WorkspaceVisibility = 'PRIVATE' | 'PUBLIC';
export type UserRole = 'ADMIN' | 'MANAGER' | 'EDITOR' | 'VIEWER';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  created_at?: string;
}

export interface Organization {
  id: string;
  name: string;
  role: UserRole;
}

export interface Session {
  user: User;
  organizations: Organization[];
}

export interface Workspace {
  id: string;
  name: string;
  visibility: WorkspaceVisibility;
  organization_id: string;
  organization_name: string;
  role: UserRole;
}

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface Team {
  id: string;
  name: string;
  organization_id: string;
  organization_name: string;
  members: TeamMember[];
  myRole: UserRole;
}

export interface ContentTree {
  workspaceId: string;
  projects: Array<{
    id: string;
    name: string;
    can_access: boolean;
    access_status: 'PENDING' | 'APPROVED' | 'DENIED' | null;
  }>;
  collections: Array<{ id: string; name: string; project_id: string; has_auth: string | null }>;
  requests: Array<{
    id: string;
    name: string;
    method: string;
    url: string;
    api_type: ApiType;
    collection_id: string;
  }>;
}

export interface RequestDetail {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  queryParams: Array<{ key: string; value: string; enabled: boolean }>;
  bodyType: string;
  bodyJson: string | null;
  bodyText: string | null;
  apiType: ApiType;
  formula: string;
  collectionId: string;
  workspaceId: string;
  workspaceRole: UserRole;
  authProvider: AuthProvider | null;
  assertions?: Assertion[];
}

export type AuthType = 'NONE' | 'BASIC' | 'BEARER_TOKEN' | 'OAUTH2';

export interface AuthProvider {
  authType: AuthType;
  tokenRequestId: string | null;
  tokenPath: string;
  headerKey: string;
  headerPrefix: string;
}

export interface AssertionResult {
  id: string;
  passed: boolean;
  message: string;
}

export interface RunResult {
  runStatus: 'SUCCESS' | 'FAILED';
  httpStatus: number;
  error: string | null;
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    bodyEncoding?: 'text' | 'base64';
    durationMs: number;
  } | null;
  resolvedAuth: { headerKey: string; headerValue: string } | null;
  requestSnapshot: { url: string; method: string; headers: Record<string, string>; body: string | null };
  variables: Record<string, string>;
  testResults?: AssertionResult[];
  assertionsPassed?: boolean;
}

export interface CollectionRunItem {
  requestId: string;
  name: string;
  runStatus: string;
  httpStatus: number;
  error: string | null;
  durationMs: number | null;
  assertions: AssertionResult[];
  assertionsPassed: boolean;
}

export interface CollectionRunResult {
  results: CollectionRunItem[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    assertionsTotal: number;
    assertionsPassed: number;
  };
}

export interface AdminUser extends User {
  workspace_count?: number;
  request_count?: number;
  projects?: Array<{ id: string; name: string; kind: 'manager' | 'member'; role: string }>;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const authApi = {
  signup: (input: { email: string; password: string; name?: string }) =>
    apiFetch<{ user: Session }>('/api/auth/signup', { method: 'POST', body: input }),
  login: (input: { email: string; password: string }) =>
    apiFetch<{ user: Session }>('/api/auth/login', { method: 'POST', body: input }),
  logout: () => apiFetch('/api/auth/logout', { method: 'POST' }),
  me: () => apiFetch<Session>('/api/auth/me'),
};

export const workspaceApi = {
  list: () => apiFetch<{ workspaces: Workspace[] }>('/api/workspaces'),
  create: (input: { name: string; visibility?: WorkspaceVisibility; organizationId?: string }) =>
    apiFetch<{ workspace: Workspace }>('/api/workspaces', { method: 'POST', body: input }),
  remove: (workspaceId: string) => apiFetch(`/api/workspaces/${workspaceId}`, { method: 'DELETE' }),
  content: (workspaceId: string) => apiFetch<ContentTree>(`/api/workspaces/${workspaceId}/content`),
  share: (workspaceId: string, teamId: string, role: UserRole) =>
    apiFetch(`/api/workspaces/${workspaceId}/teams`, { method: 'POST', body: { teamId, role } }),
  unshare: (workspaceId: string, teamId: string) =>
    apiFetch(`/api/workspaces/${workspaceId}/teams/${teamId}`, { method: 'DELETE' }),
  teams: (workspaceId: string) => apiFetch<{ teams: Array<{ share_id: string; team_id: string; name: string; role: UserRole }> }>(`/api/workspaces/${workspaceId}/teams`),
};

export const teamApi = {
  list: () => apiFetch<{ teams: Team[] }>('/api/teams'),
  create: (input: { name: string; organizationId?: string }) => apiFetch<{ team: Team }>('/api/teams', { method: 'POST', body: input }),
  delete: (teamId: string) => apiFetch(`/api/teams/${teamId}`, { method: 'DELETE' }),
  invite: (teamId: string, email: string, role: UserRole) =>
    apiFetch<{ members: TeamMember[] }>(`/api/teams/${teamId}/members`, { method: 'POST', body: { email, role } }),
  setRole: (teamId: string, userId: string, role: UserRole) =>
    apiFetch<{ members: TeamMember[] }>(`/api/teams/${teamId}/members/${userId}`, { method: 'PATCH', body: { role } }),
  remove: (teamId: string, userId: string) =>
    apiFetch<{ members: TeamMember[] }>(`/api/teams/${teamId}/members/${userId}`, { method: 'DELETE' }),
};

export const contentApi = {
  createCollection: (projectId: string, name: string) =>
    apiFetch<{ collection: { id: string; name: string; project_id: string } }>('/api/collections', { method: 'POST', body: { projectId, name } }),
  deleteCollection: (collectionId: string) =>
    apiFetch(`/api/collections/${collectionId}`, { method: 'DELETE' }),
  createRequest: (input: { collectionId: string; name: string; method: string; url: string; apiType: ApiType }) =>
    apiFetch<{ request: { id: string; name: string; method: string; url: string; api_type: ApiType; collection_id: string } }>('/api/requests', { method: 'POST', body: input }),
  deleteRequest: (requestId: string) =>
    apiFetch(`/api/requests/${requestId}`, { method: 'DELETE' }),
  getRequest: (requestId: string) => apiFetch<{ request: RequestDetail }>(`/api/requests/${requestId}`),
  updateRequest: (requestId: string, patch: Record<string, unknown>) =>
    apiFetch<{ request: { id: string } }>(`/api/requests/${requestId}`, { method: 'PUT', body: patch }),
  runRequest: (requestId: string) => apiFetch<RunResult>(`/api/requests/${requestId}/run`, { method: 'POST' }),
  runCollection: (collectionId: string) =>
    apiFetch<CollectionRunResult>(`/api/collections/${collectionId}/run`, { method: 'POST' }),
  getAuthProvider: (collectionId: string) =>
    apiFetch<{ authProvider: AuthProvider | null }>(`/api/collections/${collectionId}/auth-provider`),
  setAuthProvider: (collectionId: string, provider: AuthProvider) =>
    apiFetch<{ authProvider: AuthProvider }>(`/api/collections/${collectionId}/auth-provider`, { method: 'PUT', body: provider }),
  testAuthProvider: (collectionId: string) =>
    apiFetch<{ tokenStatus: number; resolvedHeader: { headerKey: string; headerValue: string } | null; tokenResponse: string }>(
      `/api/collections/${collectionId}/auth-provider/test`,
      { method: 'POST' }
    ),
};

// --------------------------------------------------------- Collection export
export interface ExportedCollectionRequest {
  sourceId?: string;
  name: string;
  method: string;
  url: string;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  queryParams: Array<{ key: string; value: string; enabled: boolean }>;
  bodyType: string;
  bodyJson: unknown;
  bodyText: string | null;
  apiType: ApiType;
  formula: string;
  assertions: Assertion[];
}

export interface ExportedCollection {
  format: string;
  version: number;
  name: string;
  requests: ExportedCollectionRequest[];
  authProvider: AuthProvider | null;
}

export interface CollectionImportResult {
  collection: { id: string; name: string; project_id: string };
  requests: Array<{ id: string; name: string; method: string; url: string; api_type: ApiType }>;
}

export const collectionExportApi = {
  export: (collectionId: string) =>
    apiFetch<{ collection: ExportedCollection }>(`/api/collections/${collectionId}/export`),
  import: (input: { projectId: string; name: string; collection: ExportedCollection }) =>
    apiFetch<CollectionImportResult>('/api/collections/import', { method: 'POST', body: input }),
};

export const adminApi = {
  users: () => apiFetch<{ users: AdminUser[] }>('/api/admin/users'),
  patchUser: (userId: string, patch: { role?: UserRole; isActive?: boolean }) =>
    apiFetch(`/api/admin/users/${userId}`, { method: 'PATCH', body: patch }),
  createUser: (input: { email: string; name: string; role: UserRole; password: string }) =>
    apiFetch<{ user: User }>('/api/admin/users', { method: 'POST', body: input }),
};

// ---------------------------------------------------------------- Manage API
export interface ManageOverview {
  scope: 'all' | 'managed';
  counts: {
    users: string;
    projects: string;
    teams: string;
    workspaces: string;
    runs: string;
    pending_requests: string;
    audit_entries: string;
    automations: string;
  };
}

export interface ManageProject {
  id: string;
  name: string;
  workspace_id: string;
  workspace_name: string;
  collections: number;
  requests: number;
  is_manager: boolean;
}

export interface ManageTeam {
  id: string;
  name: string;
  organization_id: string | null;
  members: number;
}

export interface AccessRequestRow {
  id: string;
  project_id: string;
  user_id: string;
  role: UserRole;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  email?: string;
  name?: string;
  project_name?: string;
}

export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  detail: unknown;
  ip: string | null;
  created_at: string;
}

export interface RunHistoryEntry {
  id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  request_id: string | null;
  workflow_id: string | null;
  user_email: string | null;
  user_name: string | null;
  name: string | null;
  method: string | null;
  url: string | null;
}

export interface RunTestResult {
  test_name: string;
  passed: boolean;
  assertions: unknown;
  error: string | null;
}

export interface RunHistoryDetail {
  id: string;
  name: string | null;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  request_id: string | null;
  workflow_id: string | null;
  request_snapshot: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown } | null;
  response_snapshot: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: string;
    bodyEncoding?: string;
    durationMs?: number;
  } | null;
  test_results: RunTestResult[];
}

// Personal run history — scoped server-side to the current user only.
export const runHistoryApi = {
  list: (limit = 100) => apiFetch<{ runs: RunHistoryEntry[] }>(`/api/history?limit=${limit}`),
  detail: (runId: string) => apiFetch<{ run: RunHistoryDetail }>(`/api/history/${runId}`),
};

export interface ProjectDetail {
  project: { id: string; name: string; workspace_id: string; workspace_name: string; organization_id: string };
  managers: Array<{ id: string; email: string; name: string }>;
  members: Array<{ id: string; email: string; name: string; role: UserRole }>;
  requests: Array<{ id: string; status: string; reason: string | null; requested_at: string; role: UserRole; user_id: string; email: string; name: string }>;
}

export const manageApi = {
  overview: () => apiFetch<ManageOverview>('/api/manage/overview'),
  users: () => apiFetch<{ users: AdminUser[] }>('/api/manage/users'),
  projects: () => apiFetch<{ projects: ManageProject[] }>('/api/manage/projects'),
  project: (projectId: string) => apiFetch<ProjectDetail>(`/api/manage/projects/${projectId}`),
  teams: () => apiFetch<{ teams: ManageTeam[] }>('/api/manage/teams'),
  accessRequests: () => apiFetch<{ accessRequests: AccessRequestRow[] }>('/api/manage/access-requests'),
  reviewRequest: (requestId: string, approve: boolean) =>
    apiFetch(`/api/manage/access-requests/${requestId}/review`, { method: 'POST', body: { approve } }),
  auditLogs: (limit = 100) => apiFetch<{ logs: AuditLogEntry[] }>(`/api/manage/audit-logs?limit=${limit}`),
  history: (limit = 100) => apiFetch<{ runs: RunHistoryEntry[] }>(`/api/manage/history?limit=${limit}`),
  assignManager: (projectId: string, userId: string) =>
    apiFetch(`/api/manage/projects/${projectId}/managers`, { method: 'POST', body: { userId } }),
  removeManager: (projectId: string, userId: string) =>
    apiFetch(`/api/manage/projects/${projectId}/managers/${userId}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------- Access requests
export const accessRequestApi = {
  request: (projectId: string, reason?: string, role?: UserRole) =>
    apiFetch<{ accessRequest: AccessRequestRow }>(`/api/projects/${projectId}/access-requests`, {
      method: 'POST',
      body: { reason, role },
    }),
  mine: () => apiFetch<{ accessRequests: AccessRequestRow[] }>('/api/access-requests/mine'),
  members: (projectId: string) =>
    apiFetch<{ managers: Array<{ id: string; email: string; name: string }>; members: Array<{ id: string; email: string; name: string; role: UserRole }> }>(
      `/api/projects/${projectId}/members`
    ),
};

// ---------------------------------------------------------------- Workflows
export interface StoredWorkflow {
  id: string;
  project_id: string;
  name: string;
  definition: { steps: unknown[] };
  created_at?: string;
  updated_at?: string;
}

export const workflowApi = {
  list: (projectId: string) => apiFetch<{ workflows: StoredWorkflow[] }>(`/api/workflows?projectId=${projectId}`),
  create: (input: { projectId: string; name: string; definition: { steps: unknown[] } }) =>
    apiFetch<{ workflow: StoredWorkflow }>('/api/workflows', { method: 'POST', body: input }),
  update: (workflowId: string, patch: { name?: string; definition?: { steps: unknown[] } }) =>
    apiFetch<{ workflow: StoredWorkflow }>(`/api/workflows/${workflowId}`, { method: 'PUT', body: patch }),
  remove: (workflowId: string) => apiFetch(`/api/workflows/${workflowId}`, { method: 'DELETE' }),
  run: (workflowId: string) => apiFetch<{ runId: string; status: string }>(`/api/workflows/${workflowId}/run`, { method: 'POST' }),
  runs: (workflowId: string, limit = 50) => apiFetch<{ runs: RunHistoryEntry[] }>(`/api/workflows/${workflowId}/runs?limit=${limit}`),
};

// --------------------------------------------------------------- Automations
export type AutomationTriggerType = 'SCHEDULE' | 'WEBHOOK' | 'ON_REQUEST' | 'ON_RUN_FAILURE';

export interface Automation {
  id: string;
  name: string;
  projectId: string;
  workflowId: string;
  triggerType: AutomationTriggerType;
  scheduleCron: string | null;
  webhookToken: string | null;
  eventRequestId: string | null;
  sourceWorkflowId: string | null;
  notifyWebhookUrl: string | null;
  inputVars: Record<string, string>;
  notifyOnFailure: boolean;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  workflowName: string;
  projectName: string;
  webhookUrl: string | null;
}

export type AutomationInput = {
  name: string;
  projectId: string;
  workflowId: string;
  triggerType: AutomationTriggerType;
  scheduleCron?: string;
  eventRequestId?: string;
  sourceWorkflowId?: string;
  notifyWebhookUrl?: string;
  inputVars?: Record<string, string>;
  notifyOnFailure?: boolean;
  enabled?: boolean;
};

export type AutomationPatch = Partial<
  Pick<Automation, 'name' | 'scheduleCron' | 'notifyOnFailure' | 'enabled' | 'eventRequestId' | 'sourceWorkflowId' | 'notifyWebhookUrl'>
>;

export const automationApi = {
  list: () => apiFetch<{ automations: Automation[] }>('/api/automations'),
  create: (input: AutomationInput) =>
    apiFetch<{ automation: Automation }>('/api/automations', { method: 'POST', body: input }),
  update: (automationId: string, patch: AutomationPatch) =>
    apiFetch<{ automation: Automation }>(`/api/automations/${automationId}`, { method: 'PATCH', body: patch }),
  remove: (automationId: string) => apiFetch(`/api/automations/${automationId}`, { method: 'DELETE' }),
  runs: (automationId: string, limit = 50) => apiFetch<{ runs: RunHistoryEntry[] }>(`/api/automations/${automationId}/runs?limit=${limit}`),
  trigger: (automationId: string) => apiFetch<{ runId: string; status: string }>(`/api/automations/${automationId}/trigger`, { method: 'POST' }),
};

// ------------------------------------------------------------- Notifications
export interface Notification {
  id: string;
  title: string;
  body: string | null;
  kind: 'info' | 'success' | 'error';
  read: boolean;
  payload: Record<string, unknown> | null;
  link: string | null;
  created_at: string;
}

export const notificationApi = {
  list: () => apiFetch<{ notifications: Notification[] }>('/api/notifications'),
  markRead: (notificationId: string) => apiFetch(`/api/notifications/${notificationId}/read`, { method: 'POST' }),
  readAll: () => apiFetch('/api/notifications/read-all', { method: 'POST' }),
};

// ------------------------------------------------------------- Environments
export interface Environment {
  id: string;
  name: string;
  is_active: boolean;
  variable_count?: number;
}

export interface EnvironmentVariable {
  id: string;
  key: string;
  is_secret: boolean;
  value?: string;
}

export interface MockServer {
  id: string;
  project_id: string;
  name: string;
  enabled: boolean;
  created_at: string;
}

export interface MockRoute {
  id: string;
  mock_server_id: string;
  method: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  delay_ms: number;
  sort_order: number;
}

export interface MockRouteInput {
  method?: string;
  path?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  delayMs?: number;
}

export const mockServerApi = {
  get: (projectId: string) =>
    apiFetch<{ mockServer: MockServer | null }>(`/api/projects/${projectId}/mock-server`),
  create: (projectId: string, input: { name?: string; enabled?: boolean }) =>
    apiFetch<{ mockServer: MockServer }>(`/api/projects/${projectId}/mock-server`, {
      method: 'POST',
      body: input,
    }),
  update: (serverId: string, patch: { name?: string; enabled?: boolean }) =>
    apiFetch<{ mockServer: MockServer }>(`/api/mock-servers/${serverId}`, {
      method: 'PATCH',
      body: patch,
    }),
  remove: (serverId: string) => apiFetch(`/api/mock-servers/${serverId}`, { method: 'DELETE' }),
  routes: (serverId: string) =>
    apiFetch<{ routes: MockRoute[] }>(`/api/mock-servers/${serverId}/routes`),
  createRoute: (serverId: string, input: MockRouteInput) =>
    apiFetch<{ route: MockRoute }>(`/api/mock-servers/${serverId}/routes`, {
      method: 'POST',
      body: input,
    }),
  updateRoute: (routeId: string, input: MockRouteInput) =>
    apiFetch<{ route: MockRoute }>(`/api/mock-routes/${routeId}`, {
      method: 'PATCH',
      body: input,
    }),
  deleteRoute: (routeId: string) => apiFetch(`/api/mock-routes/${routeId}`, { method: 'DELETE' }),
};

export const environmentApi = {
  list: (workspaceId: string) =>
    apiFetch<{ environments: Environment[] }>(`/api/workspaces/${workspaceId}/environments`),
  create: (workspaceId: string, name: string, makeActive = false) =>
    apiFetch<{ environment: Environment }>(`/api/workspaces/${workspaceId}/environments`, {
      method: 'POST',
      body: { name, makeActive },
    }),
  update: (environmentId: string, patch: { name?: string; isActive?: boolean }) =>
    apiFetch<{ environment: Environment }>(`/api/environments/${environmentId}`, {
      method: 'PATCH',
      body: patch,
    }),
  remove: (environmentId: string) => apiFetch(`/api/environments/${environmentId}`, { method: 'DELETE' }),
  variables: (environmentId: string) =>
    apiFetch<{ variables: EnvironmentVariable[] }>(`/api/environments/${environmentId}/variables`),
  saveVariable: (environmentId: string, input: { key: string; value: string; isSecret: boolean }) =>
    apiFetch<{ variable: EnvironmentVariable }>(`/api/environments/${environmentId}/variables`, {
      method: 'POST',
      body: input,
    }),
  deleteVariable: (environmentId: string, variableId: string) =>
    apiFetch(`/api/environments/${environmentId}/variables/${variableId}`, { method: 'DELETE' }),
};

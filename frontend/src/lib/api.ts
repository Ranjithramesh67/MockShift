'use client';

export type ApiType = 'REST' | 'SOAP' | 'GRAPHQL' | 'AUTH';
export type WorkspaceVisibility = 'PRIVATE' | 'PUBLIC';
export type UserRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

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
  projects: Array<{ id: string; name: string }>;
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
  collectionId: string;
  workspaceId: string;
  workspaceRole: UserRole;
  authProvider: AuthProvider | null;
}

export type AuthType = 'NONE' | 'BASIC' | 'BEARER_TOKEN' | 'OAUTH2';

export interface AuthProvider {
  authType: AuthType;
  tokenRequestId: string | null;
  tokenPath: string;
  headerKey: string;
  headerPrefix: string;
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
    durationMs: number;
  } | null;
  resolvedAuth: { headerKey: string; headerValue: string } | null;
  requestSnapshot: { url: string; method: string; headers: Record<string, string>; body: string | null };
  variables: Record<string, string>;
}

export interface AdminUser extends User {
  workspace_count?: number;
  request_count?: number;
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
    apiFetch<Session>('/api/auth/login', { method: 'POST', body: input }),
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

export const adminApi = {
  users: () => apiFetch<{ users: AdminUser[] }>('/api/admin/users'),
  patchUser: (userId: string, patch: { role?: UserRole; isActive?: boolean }) =>
    apiFetch(`/api/admin/users/${userId}`, { method: 'PATCH', body: patch }),
};

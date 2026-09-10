'use client';

import { apiFetch } from './api';

export type ApiTokenScope = 'read' | 'write' | 'runs' | 'sdk';
export type ApiTokenStatus = 'active' | 'revoked';

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  status: ApiTokenStatus;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  projectId: string | null;
  workspaceId: string | null;
}

export interface ApiTokenCreateInput {
  name: string;
  scopes?: ApiTokenScope[];
  expiresAt?: string | null;
  projectId?: string;
  workspaceId?: string;
}

// A personal API token used for machine auth. The plaintext `token` value is
// returned exactly once, at creation — later reads only carry the prefix.
export interface ApiTokenCreated {
  token: string;
  apiToken: ApiToken;
}

export const tokensApi = {
  list: () => apiFetch<{ tokens: ApiToken[] }>('/api/tokens'),
  create: (input: ApiTokenCreateInput) =>
    apiFetch<ApiTokenCreated>('/api/tokens', { method: 'POST', body: input }),
  revoke: (tokenId: string) => apiFetch<{ ok: true }>(`/api/tokens/${tokenId}`, { method: 'DELETE' }),
};

export const API_TOKEN_SCOPES: ApiTokenScope[] = ['read', 'write', 'runs', 'sdk'];

export const API_TOKEN_SCOPE_LABEL: Record<ApiTokenScope, string> = {
  read: 'Read',
  write: 'Write',
  runs: 'Run requests',
  sdk: 'SDK / route sync',
};

export const API_TOKEN_SCOPE_HINT: Record<ApiTokenScope, string> = {
  read: 'List and inspect resources',
  write: 'Create and update resources',
  runs: 'Execute stored requests server-side',
  sdk: 'Sync routes from apihub-sdk into a project or workspace',
};

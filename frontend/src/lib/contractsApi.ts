'use client';

import { apiFetch } from './api';

// E1 — OpenAPI import + contract validation client.
// The backend keeps the imported document server-side; specs are listed per
// project, operations are derived from the document, and a request can carry
// `contract` checks that validate a live response body at run/verify time.

export interface ContractOperation {
  method: string;
  path: string;
  operationId: string | null;
  summary: string | null;
  tags: string[];
  responseCodes: string[];
  requestSchema: Record<string, unknown> | null;
}

export interface ContractSpec {
  id: string;
  projectId: string;
  collectionId: string | null;
  name: string;
  version: string | null;
  specHash: string;
  operationCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContractSpecDetail {
  spec: ContractSpec & { document: Record<string, unknown> };
  operations: ContractOperation[];
}

export interface ContractDiffChange {
  kind: string;
  severity: 'breaking' | 'non-breaking';
  method?: string;
  path?: string;
  status?: string;
  location?: string;
  field?: string;
  from?: string;
  to?: string;
  detail: string;
}

export interface ContractDiff {
  hasBreaking: boolean;
  breaking: ContractDiffChange[];
  nonBreaking: ContractDiffChange[];
  changes: ContractDiffChange[];
}

export interface ContractValidationResult {
  valid: boolean;
  skipped: boolean;
  errors: string[];
  statusKey: string | null;
  message?: string;
}

export interface ContractAssertionResult {
  id: string;
  passed: boolean;
  message: string;
  errors?: string[];
  statusKey?: string | null;
}

export interface ContractCheck {
  id: string;
  requestId: string;
  specId: string;
  specName: string;
  specVersion: string | null;
  method: string;
  path: string;
  statusCode: string;
  createdAt: string;
}

export interface ContractResponseInput {
  status?: number;
  headers?: Record<string, string>;
  body: string;
  bodyEncoding?: 'text' | 'base64';
}

export interface ContractImportInput {
  projectId: string;
  spec: unknown;
  collectionId?: string;
  name?: string;
  generateRequests?: boolean;
}

export interface ContractImportResult {
  spec: ContractSpec;
  collection: { id: string; name: string; project_id: string } | null;
  folders: Array<{ id: string; name: string; collection_id: string; parent_id: string | null }>;
  requests: Array<{ id: string; name: string; method: string; url: string; api_type: string; collection_id: string; folder_id: string | null }>;
}

export const contractsApi = {
  list: (projectId: string) =>
    apiFetch<{ specs: ContractSpec[] }>(`/api/contracts?projectId=${encodeURIComponent(projectId)}`),

  importSpec: (input: ContractImportInput) =>
    apiFetch<ContractImportResult>('/api/contracts/import', { method: 'POST', body: input }),

  get: (specId: string) => apiFetch<ContractSpecDetail>(`/api/contracts/${specId}`),

  operations: (specId: string) =>
    apiFetch<{ spec: ContractSpec; operations: ContractOperation[] }>(`/api/contracts/${specId}/operations`),

  diff: (input: { baseSpecId?: string; headSpecId?: string; base?: unknown; head?: unknown }) =>
    apiFetch<{ diff: ContractDiff; base: ContractSpec | null; head: ContractSpec | null }>('/api/contracts/diff', {
      method: 'POST',
      body: input,
    }),

  validate: (input: {
    specId: string;
    method: string;
    path: string;
    statusCode?: string;
    response: ContractResponseInput;
  }) => apiFetch<{ result: ContractValidationResult }>('/api/contracts/validate', { method: 'POST', body: input }),

  listChecks: (requestId: string) =>
    apiFetch<{ checks: ContractCheck[] }>(`/api/contracts/checks?requestId=${encodeURIComponent(requestId)}`),

  attachCheck: (input: { requestId: string; specId: string; method: string; path: string; statusCode?: string }) =>
    apiFetch<{ check: ContractCheck }>('/api/contracts/checks', { method: 'POST', body: input }),

  removeCheck: (checkId: string) =>
    apiFetch<{ ok: true }>(`/api/contracts/checks/${checkId}`, { method: 'DELETE' }),

  validateRequest: (requestId: string, response: ContractResponseInput) =>
    apiFetch<{ passed: boolean; results: ContractAssertionResult[] }>('/api/contracts/validate-request', {
      method: 'POST',
      body: { requestId, response },
    }),
};

'use client';

import { ApiError, apiFetch } from './api';
import type { Assertion } from './types';
import type { DocsBlockContent, DocsBlockType } from './docsApi';

// ------------------------------------------------------------------ Copilot
// Client for the server-side AI copilot (/api/copilot). The backend is BYO-key:
// it reads only USER_LLM_* env vars and returns 503 when unconfigured, so this
// module never handles or stores a key. `isCopilotNotConfigured` lets callers
// render a friendly "configure an LLM" state instead of a generic error.

export interface CopilotStatus {
  configured: boolean;
  model: string | null;
  provider: string | null;
}

export interface CopilotUsage {
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}

export interface CopilotAssertionResponse {
  assertions: Assertion[];
  usage: CopilotUsage;
  model: string | null;
  provider: string | null;
}

export interface CopilotExplainResponse {
  explanation: string;
  usage: CopilotUsage;
  model: string | null;
  provider: string | null;
}

export interface CopilotDocBlock {
  id: string | null;
  type: DocsBlockType;
  content: DocsBlockContent;
}

export interface CopilotDocsResponse {
  blocks: CopilotDocBlock[];
  usage: CopilotUsage;
  model: string | null;
  provider: string | null;
}

// A run-history response snapshot as stored by the platform (already redacted
// server-side before it reaches the model).
export interface CopilotResponseSnapshot {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  bodyEncoding?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export const copilotApi = {
  status: () => apiFetch<CopilotStatus>('/api/copilot/status'),

  generateAssertions: (input: { requestId: string; response?: CopilotResponseSnapshot }) =>
    apiFetch<CopilotAssertionResponse>('/api/copilot/generate-assertions', {
      method: 'POST',
      body: input,
    }),

  explainRun: (input: { runId: string }) =>
    apiFetch<CopilotExplainResponse>('/api/copilot/explain-run', { method: 'POST', body: input }),

  generateDocs: (input: { requestId: string }) =>
    apiFetch<CopilotDocsResponse>('/api/copilot/generate-docs', { method: 'POST', body: input }),
};

// True when the API rejected a copilot call because no USER_LLM_* provider is
// configured (backend status 503 / code LLM_NOT_CONFIGURED).
export function isCopilotNotConfigured(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503;
}

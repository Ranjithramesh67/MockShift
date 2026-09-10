'use client';

import { apiFetch, ApiError } from './api';

// ---------------------------------------------------------------- Docs types
// Confluence-style documentation pages. A page lives in a workspace (project
// optional) and is made of an ordered list of typed "blocks" (text, code,
// payload/response/schema examples, lists). Pages can also carry mentions —
// either of a user (@Name chip) or of an API request (chip that deep-links
// into the workspace when the reader has access).
export type DocsBlockType = 'heading' | 'text' | 'code' | 'payload' | 'response' | 'schema' | 'list' | 'image' | 'table';

// Table guardrails mirror the backend (TABLE_MAX_* in routes/docs.js): the
// editor clamps to the same bounds so a round-trip never trips a 400.
export const TABLE_MAX_ROWS = 50;
export const TABLE_MAX_COLS = 12;
export const TABLE_MAX_CELL = 2000;

export interface DocsPerson {
  id: string;
  name: string;
}

export type DocsVisibility = 'PRIVATE' | 'PUBLIC';

export interface DocsPageSummary {
  id: string;
  title: string;
  workspaceId: string;
  workspaceName: string;
  projectId: string | null;
  projectName: string | null;
  visibility: DocsVisibility;
  parentId: string | null;
  teamId?: string | null;
  teamName?: string | null;
  position?: number;
  createdBy: DocsPerson | null;
  updatedBy: DocsPerson | null;
  createdAt: string;
  updatedAt: string;
  blockCount: number;
}

export interface DocsPageInfo extends DocsPageSummary {
  canEdit: boolean;
}

export interface DocsUserRef {
  id: string;
  name: string;
  email?: string | null;
}

export interface DocsApiRef {
  id: string;
  name: string;
  method: string;
  collectionId: string;
  workspaceId: string;
  projectId: string;
  access: { read: boolean };
}

export interface DocsMention {
  id: string;
  type: 'user' | 'api';
  refId: string;
  ref: DocsUserRef | DocsApiRef;
}

// Block content is stored server-side as a plain JSON object keyed per block
// type (see the FROZEN contract). We keep it as a Record so editing stays
// uniform; the renderer reads fields through the accessor helpers below.
export type DocsBlockContent = Record<string, unknown>;

export interface DocsBlock {
  id: string | null;
  type: DocsBlockType;
  content: DocsBlockContent;
}

export interface DocsServerBlock extends DocsBlock {
  id: string;
  position: number;
}

export interface DocsPageDetail {
  page: DocsPageInfo;
  blocks: DocsServerBlock[];
  mentions: DocsMention[];
}

// -------------------------------------------------- sharing / usage contract
// GET /api/docs/usage — per-workspace plan usage + limits for docs resources.
// A null limit means unlimited; the pill/disable logic only kicks in when the
// plan is enforced.
export interface DocsUsage {
  planKey: string | null;
  planName: string | null;
  enforced: boolean;
  usage: { doc_pages: number; api_requests: number; mock_servers: number };
  limits: { doc_pages: number | null; api_requests: number | null; mock_servers: number | null };
}

export type DocExportFormat = 'markdown' | 'html' | 'word' | 'json';

export interface DocsShareInfo {
  token: string;
  url: string; // relative public path, e.g. /s/doc/<token>
  createdAt?: string;
}

// One doc_shares audience grant as returned by GET /docs/:pageId/shares.
export interface DocsShareTarget {
  id: string;
  name: string;
  email?: string | null;
}
export type DocsShareGrant =
  | { id: string; kind: 'public'; token: string; url: string; createdAt: string }
  | { id: string; kind: 'user'; createdAt: string; target: DocsShareTarget }
  | { id: string; kind: 'team'; createdAt: string; target: DocsShareTarget }
  | { id: string; kind: 'org'; createdAt: string; target: DocsShareTarget };

export interface DocsShareTargetOption {
  id: string;
  name: string;
}
export interface DocsShareContext {
  organizationId: string | null;
  teams: DocsShareTargetOption[];
}

// How a page in GET /docs/shared became readable to the caller (DR2): a direct
// user grant, a team/org audience share, or PUBLIC visibility in an org the
// caller belongs to. `name` is present for team/org/public reasons.
export interface DocsSharedVia {
  kind: 'user' | 'team' | 'org' | 'public';
  id?: string | null;
  name?: string | null;
}

export interface DocsPageSummary {
  id: string;
  title: string;
  workspaceId: string;
  workspaceName: string;
  projectId: string | null;
  projectName: string | null;
  visibility: DocsVisibility;
  parentId: string | null;
  teamId?: string | null;
  teamName?: string | null;
  position?: number;
  createdBy: DocsPerson | null;
  updatedBy: DocsPerson | null;
  createdAt: string;
  updatedAt: string;
  blockCount: number;
  via?: DocsSharedVia[];
}

// GET /api/docs/public/:token — the no-login public snapshot of a shared page.
export interface SharedDocBlock {
  id: string;
  position: number;
  type: DocsBlockType;
  content: DocsBlockContent;
}

export interface SharedDocMention {
  type: 'user' | 'api';
  ref: { name: string };
}

export interface SharedDocView {
  share: {
    token: string;
    createdAt: string;
    page: {
      title: string;
      updatedAt: string;
      updatedBy: { name: string } | null;
    };
    workspaceName: string;
    blocks: SharedDocBlock[];
    mentions: SharedDocMention[];
  };
}

export function isUserMention(m: DocsMention): m is DocsMention & { ref: DocsUserRef } {
  return m.type === 'user';
}

export function isApiMention(m: DocsMention): m is DocsMention & { ref: DocsApiRef } {
  return m.type === 'api';
}

// ------------------------------------------------------------------ accessors
export function blockText(c: DocsBlockContent, key = 'text', fallback = ''): string {
  const v = c[key];
  if (typeof v === 'string') return v;
  if (v != null) return String(v);
  return fallback;
}

// Image display presets shared by the editor, viewer and exports. The percent
// is a max width relative to the content column — the backend export keeps the
// same mapping (IMG_SIZE_PCT in backend/src/api/routes/docs.js).
export const IMAGE_SIZES = ['small', 'medium', 'large', 'full'] as const;
export type DocsImageSize = (typeof IMAGE_SIZES)[number];
export const IMAGE_SIZE_PCT: Record<DocsImageSize, number> = {
  small: 34,
  medium: 55,
  large: 80,
  full: 100,
};

export function imageSizeOf(c: DocsBlockContent): DocsImageSize {
  const s = String(c.size ?? '');
  return (IMAGE_SIZES as readonly string[]).includes(s) ? (s as DocsImageSize) : 'full';
}

export function blockNum(c: DocsBlockContent, key = 'status', fallback = 0): number {
  const v = c[key];
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function blockStrings(c: DocsBlockContent, key = 'items'): string[] {
  const v = c[key];
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : String(x)));
  return [];
}

// Table rows as a rectangular grid: arrays of string cells, padded to the widest
// row so the editor and viewer always see the same shape.
export function tableRows(c: DocsBlockContent): string[][] {
  const raw = Array.isArray(c.rows) ? (c.rows as unknown[]).filter(Array.isArray) : [];
  const cols = raw.reduce((m, r) => Math.max(m, (r as unknown[]).length), 0);
  return (raw as unknown[][]).map((r) => Array.from({ length: cols }, (_, i) => (typeof r[i] === 'string' ? (r[i] as string) : '')));
}

export function blockMethod(c: DocsBlockContent): string {
  const m = blockText(c, 'method', 'GET');
  return (m || 'GET').toUpperCase();
}

// Blocks per type + their add-menu labels.
export const BLOCK_LABELS: Array<{ type: DocsBlockType; label: string }> = [
  { type: 'heading', label: 'Heading' },
  { type: 'text', label: 'Text' },
  { type: 'code', label: 'Code' },
  { type: 'payload', label: 'Payload' },
  { type: 'response', label: 'Response' },
  { type: 'schema', label: 'Schema' },
  { type: 'list', label: 'List' },
  { type: 'image', label: 'Image' },
  { type: 'table', label: 'Table' },
];

export function defaultContent(type: DocsBlockType): DocsBlockContent {
  switch (type) {
    case 'heading':
      return { text: '' };
    case 'text':
      return { text: '' };
    case 'code':
      return { language: 'text', code: '' };
    case 'payload':
      return { method: 'GET', contentType: 'application/json', body: '' };
    case 'response':
      return { status: 200, body: '' };
    case 'schema':
      return { language: 'json', definition: '' };
    case 'list':
      return { style: 'bullet', items: [''] };
    case 'image':
      return { src: '', alt: '', caption: '', size: 'full' };
    case 'table':
      return { rows: [['', ''], ['', '']], caption: '' };
  }
}

export function newBlock(type: DocsBlockType): DocsBlock {
  return { id: null, type, content: defaultContent(type) };
}

// Normalise a draft block into the exact payload the PUT /blocks endpoint
// expects (id null for new blocks, otherwise keep the server id).
export function blockToPayload(b: DocsBlock): { id: string | null; type: DocsBlockType; content: DocsBlockContent } {
  const content: DocsBlockContent = { ...b.content };
  if (b.type === 'response') {
    const n = Number(content.status);
    content.status = Number.isFinite(n) ? n : 0;
  }
  if (b.type === 'list') {
    const items = blockStrings(content, 'items').map((s) => s.trimEnd());
    content.items = items[items.length - 1] === '' ? items.slice(0, -1) : items;
  }
  return { id: b.id ?? null, type: b.type, content };
}

export function stripPositions(blocks: DocsServerBlock[]): DocsBlock[] {
  return blocks.map((b) => ({ id: b.id, type: b.type, content: b.content }));
}

// ------------------------------------------------------------------------- API
export interface ProjectAccessRow {
  id: string;
  project_id: string;
  user_id: string;
  role: string;
  reason: string | null;
  status: string;
  requested_at: string;
}

export interface WorkspaceAccessRequest {
  id: string;
  workspaceId: string;
  workspaceName: string;
  requesterId: string;
  requester: { id: string; name: string; email: string };
  reason: string | null;
  status: string;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).length > 0) q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const docsApi = {
  list: (params: { workspaceId: string; projectId?: string; q?: string; visibility?: DocsVisibility }) =>
    apiFetch<{ pages: DocsPageSummary[] }>(`/api/docs${toQuery(params)}`),

  // Pages this caller can read without holding the owning workspace: targeted
  // share audiences (the share's whole sub-tree) + PUBLIC pages of orgs the
  // caller belongs to. Each page carries `via` (which grant exposed it) so the
  // home "Shared with me" surface can group by team/org/direct.
  shared: () => apiFetch<{ pages: DocsPageSummary[] }>('/api/docs/shared'),

  // Share management (DR1 audiences + DR2 UI): the page's current grants and
  // the org/team target options, creating one audience grant, revoking one.
  listShares: (pageId: string) =>
    apiFetch<{ shares: DocsShareGrant[]; context: DocsShareContext }>(`/api/docs/${pageId}/shares`),

  createShare: (
    pageId: string,
    input:
      | { kind: 'user'; targetUser: { email: string } | { username: string } | { id: string } }
      | { kind: 'team'; teamId: string }
      | { kind: 'org' }
  ) => apiFetch<{ share: DocsShareGrant | null }>(`/api/docs/${pageId}/shares`, {
    method: 'POST',
    body: input,
  }),

  revokeShare: (pageId: string, shareId: string) =>
    apiFetch<void>(`/api/docs/${pageId}/shares/${shareId}`, { method: 'DELETE' }),

  create: (input: {
    workspaceId: string;
    projectId?: string | null;
    parentId?: string | null;
    teamId?: string | null;
    title: string;
    visibility?: DocsVisibility;
  }) => apiFetch<{ page: DocsPageSummary }>('/api/docs', { method: 'POST', body: input }),

  get: (pageId: string) => apiFetch<DocsPageDetail>(`/api/docs/${pageId}`),

  // Optional-title/visibility/parentId/teamId/position patch — parentId null
  // moves the page to the root level, teamId null clears the team ("space")
  // binding, position (>= 0) reorders among siblings. A missing key leaves that
  // field untouched.
  update: (
    pageId: string,
    patch: {
      title?: string;
      visibility?: DocsVisibility;
      parentId?: string | null;
      teamId?: string | null;
      position?: number;
    }
  ) => apiFetch<{ page: DocsPageSummary }>(`/api/docs/${pageId}`, { method: 'PUT', body: patch }),

  updateTitle: (pageId: string, title: string) => apiFetch<{ page: DocsPageSummary }>(`/api/docs/${pageId}`, { method: 'PUT', body: { title } }),

  remove: (pageId: string) => apiFetch<void>(`/api/docs/${pageId}`, { method: 'DELETE' }),

  saveBlocks: (pageId: string, blocks: DocsBlock[]) =>
    apiFetch<{ blocks: DocsServerBlock[] }>(`/api/docs/${pageId}/blocks`, {
      method: 'PUT',
      body: { blocks: blocks.map(blockToPayload) },
    }),

  addMention: (pageId: string, input: { type: 'user' | 'api'; refId: string }) =>
    apiFetch<{ mention: DocsMention }>(`/api/docs/${pageId}/mentions`, { method: 'POST', body: input }),

  removeMention: (pageId: string, mentionId: string) =>
    apiFetch<void>(`/api/docs/${pageId}/mentions/${mentionId}`, { method: 'DELETE' }),

  usage: (workspaceId: string) =>
    apiFetch<DocsUsage>(`/api/docs/usage${toQuery({ workspaceId })}`),

  share: (pageId: string) =>
    apiFetch<{ share: DocsShareInfo }>(`/api/docs/${pageId}/share`, { method: 'POST' }),

  unshare: (pageId: string) =>
    apiFetch<void>(`/api/docs/${pageId}/share`, { method: 'DELETE' }),

  // No-login public snapshot backing the /s/doc/<token> page.
  publicShare: (token: string) => apiFetch<SharedDocView>(`/api/docs/public/${encodeURIComponent(token)}`),
};

// Document export downloads: the endpoint streams an authenticated file; we
// pull the body as text so callers can build a Blob download or print the HTML.
export async function fetchDocExport(pageId: string, format: DocExportFormat): Promise<string> {
  const res = await fetch(`/api/docs/${encodeURIComponent(pageId)}/export?format=${format}`, {
    credentials: 'include',
    headers: { Accept: 'text/html, text/markdown, application/json, text/plain; q=0.9, */*; q=0.1' },
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
  return res.text();
}

// Existing (non-docs) endpoints reused by the docs UI.
export const docsSharedApi = {
  // A caller's own project access-request rows (pre-fill "pending" state).
  projectAccessRequests: (projectId: string) =>
    apiFetch<{ accessRequests: ProjectAccessRow[] }>(`/api/projects/${projectId}/access-requests`),
  // All workspace docs-access-requests for the selected workspace / caller.
  listWorkspaceRequests: (params: { workspaceId: string; status?: string; mine?: boolean }) =>
    apiFetch<{ requests: WorkspaceAccessRequest[] }>(
      `/api/docs/workspace-access-requests${toQuery({ workspaceId: params.workspaceId, status: params.status, mine: params.mine ? 1 : undefined })}`
    ),
  requestWorkspaceAccess: (input: { workspaceId: string; reason?: string }) =>
    apiFetch<{ request: WorkspaceAccessRequest }>('/api/docs/workspace-access-requests', { method: 'POST', body: input }),
  reviewWorkspaceRequest: (requestId: string, approve: boolean) =>
    apiFetch<{ ok: boolean; status: string }>(`/api/docs/workspace-access-requests/${requestId}/review`, {
      method: 'POST',
      body: { approve },
    }),
  cancelWorkspaceRequest: (requestId: string) =>
    apiFetch<{ ok: boolean }>(`/api/docs/workspace-access-requests/${requestId}/cancel`, { method: 'POST' }),
};

export function isApiError(err: unknown): err is ApiError {
  return err instanceof Error && typeof (err as ApiError).status === 'number';
}

'use client';

import { apiFetch } from './api';

// ------------------------------------------------------------------ types
// Collaboration round (P5/E5): comment threads on a request or collection, a
// lightweight review flow on a collection, and version snapshots with a diff.

export type CollabTargetType = 'request' | 'collection';

export interface CollabPerson {
  id: string;
  name: string | null;
}

export interface CollabComment {
  id: string;
  targetType: CollabTargetType;
  targetId: string;
  parentId: string | null;
  body: string;
  author: CollabPerson;
  resolved: boolean;
  resolvedBy: CollabPerson | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  replies: CollabComment[];
}

// A review row is only ever pending/approved/changes_requested; the collection
// status adds `none` when no review has been requested yet.
export type ReviewDecision = 'approved' | 'changes_requested';
export type ReviewStatus = 'none' | 'pending' | ReviewDecision;

export interface CollabReview {
  id: string;
  collectionId: string;
  status: ReviewStatus;
  requestComment: string | null;
  decisionComment: string | null;
  requestedBy: CollabPerson;
  reviewer: CollabPerson | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
}

export interface CollectionVersionMeta {
  id: string;
  collectionId: string;
  versionNumber: number;
  label: string | null;
  requestCount: number;
  createdBy: CollabPerson;
  createdAt: string;
}

export interface SnapshotRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  folderId: string | null;
  [key: string]: unknown;
}

export interface CollectionSnapshot {
  collection: { id: string; name: string; projectId: string };
  requests: SnapshotRequest[];
}

export interface CollectionVersion extends CollectionVersionMeta {
  snapshot: CollectionSnapshot | null;
}

export interface DiffRequestSummary {
  id: string;
  name: string | null;
  method: string | null;
  url: string | null;
  folderId: string | null;
}

export interface DiffField {
  field: string;
  from: unknown;
  to: unknown;
}

export interface DiffChangedRequest {
  id: string;
  name: string | null;
  from: DiffRequestSummary;
  to: DiffRequestSummary;
  fields: DiffField[];
}

export interface CollabDiff {
  added: DiffRequestSummary[];
  removed: DiffRequestSummary[];
  changed: DiffChangedRequest[];
  counts: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    fromTotal: number;
    toTotal: number;
  };
}

export interface VersionDiffResult {
  from: CollectionVersionMeta;
  to: CollectionVersionMeta;
  diff: CollabDiff;
}

function toQuery(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).length > 0) q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ------------------------------------------------------------------ API
export const collabApi = {
  // ---- comments
  listComments: (targetType: CollabTargetType, targetId: string) =>
    apiFetch<{ comments: CollabComment[]; count: number }>(
      `/api/comments${toQuery({ targetType, targetId })}`
    ),

  createComment: (input: {
    targetType: CollabTargetType;
    targetId: string;
    body: string;
    parentId?: string | null;
  }) =>
    apiFetch<{ comment: CollabComment }>('/api/comments', {
      method: 'POST',
      body: {
        targetType: input.targetType,
        targetId: input.targetId,
        body: input.body,
        parentId: input.parentId ?? null,
      },
    }),

  resolveComment: (commentId: string) =>
    apiFetch<{ comment: CollabComment }>(`/api/comments/${commentId}/resolve`, { method: 'POST' }),

  unresolveComment: (commentId: string) =>
    apiFetch<{ comment: CollabComment }>(`/api/comments/${commentId}/unresolve`, { method: 'POST' }),

  deleteComment: (commentId: string) =>
    apiFetch<{ ok: boolean }>(`/api/comments/${commentId}`, { method: 'DELETE' }),

  // ---- reviews (collection only)
  listReviews: (collectionId: string) =>
    apiFetch<{ reviews: CollabReview[]; status: ReviewStatus; current: CollabReview | null }>(
      `/api/reviews${toQuery({ collectionId })}`
    ),

  reviewStatus: (collectionId: string) =>
    apiFetch<{ status: ReviewStatus; review: CollabReview | null }>(
      `/api/reviews/collections/${collectionId}/status`
    ),

  requestReview: (input: { collectionId: string; reviewerId?: string | null; comment?: string }) =>
    apiFetch<{ review: CollabReview; status: ReviewStatus }>('/api/reviews', {
      method: 'POST',
      body: {
        collectionId: input.collectionId,
        reviewerId: input.reviewerId ?? null,
        comment: input.comment,
      },
    }),

  decideReview: (reviewId: string, decision: ReviewDecision, comment?: string) =>
    apiFetch<{ review: CollabReview; status: ReviewStatus }>(`/api/reviews/${reviewId}/decision`, {
      method: 'POST',
      body: { decision, comment },
    }),

  // ---- versions (collection only)
  listVersions: (collectionId: string) =>
    apiFetch<{ versions: CollectionVersionMeta[] }>(`/api/versions${toQuery({ collectionId })}`),

  createVersion: (collectionId: string, label?: string) =>
    apiFetch<{ version: CollectionVersionMeta }>('/api/versions', {
      method: 'POST',
      body: { collectionId, label },
    }),

  getVersion: (versionId: string) =>
    apiFetch<{ version: CollectionVersion }>(`/api/versions/${versionId}`),

  diffVersions: (collectionId: string, from: string, to: string) =>
    apiFetch<VersionDiffResult>(
      `/api/versions/diff${toQuery({ collectionId, from, to })}`
    ),
};

export function isApiErrorLike(err: unknown): err is Error {
  return err instanceof Error;
}

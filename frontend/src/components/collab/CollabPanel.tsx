'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { accessRequestApi } from '@/lib/api';
import {
  collabApi,
  type CollabComment,
  type CollabReview,
  type CollabTargetType,
  type CollectionVersionMeta,
  type ReviewDecision,
  type ReviewStatus,
  type VersionDiffResult,
} from '@/lib/collabApi';
import styles from './collab.module.css';

// ============================================================================
// CollabPanel — a self-contained collaboration surface for a request or a
// collection:
//   - comment threads (create, reply, resolve/unresolve, delete)
//   - a collection review flow (request a review, approve / request changes)
//   - collection version snapshots + diff
//
// It is intentionally store-agnostic: the only props are the target identity
// plus an optional projectId (used to populate the reviewer picker). The host
// view decides where to mount it.
// ============================================================================

export interface CollabPanelProps {
  targetType: CollabTargetType;
  targetId: string;
  /** Reviews/versions only apply to collections; defaults to targetId. */
  collectionId?: string | null;
  /** Enables the reviewer picker (project managers + members). */
  projectId?: string | null;
  title?: string;
}

function errMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Request failed';
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function statusPillClass(status: ReviewStatus): string {
  if (status === 'pending') return `${styles.pill} ${styles.pillPending}`;
  if (status === 'approved') return `${styles.pill} ${styles.pillApproved}`;
  if (status === 'changes_requested') return `${styles.pill} ${styles.pillChanges}`;
  return `${styles.pill} ${styles.pillNone}`;
}

function statusLabel(status: ReviewStatus): string {
  return status === 'changes_requested' ? 'Changes requested' : status;
}

function methodPrefix(request: { method: string | null; name: string | null; id?: string }): string {
  return `${request.method ?? ''} ${request.name ?? request.id ?? ''}`.trim();
}

// ---------------------------------------------------------------- comments

function CommentRow({
  comment,
  depth,
  onReply,
  onToggleResolve,
  onDelete,
  busy,
}: {
  comment: CollabComment;
  depth: number;
  onReply: (comment: CollabComment) => void;
  onToggleResolve: (comment: CollabComment) => void;
  onDelete: (comment: CollabComment) => void;
  busy: boolean;
}) {
  return (
    <div>
      <div className={`${styles.comment} ${comment.resolved ? styles.commentResolved : ''}`}>
        <div className={styles.commentMeta}>
          <span className={styles.author}>{comment.author.name || 'Unknown'}</span>
          <span className={styles.subtle}>{formatDate(comment.createdAt)}</span>
          {comment.resolved && <span className={styles.subtle}>resolved</span>}
        </div>
        <div className={styles.commentBody}>{comment.body}</div>
        <div className={styles.rowActions}>
          {depth === 0 && (
            <button type="button" className={styles.linkBtn} onClick={() => onReply(comment)} disabled={busy}>
              Reply
            </button>
          )}
          {depth === 0 && (
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => onToggleResolve(comment)}
              disabled={busy}
            >
              {comment.resolved ? 'Unresolve' : 'Resolve'}
            </button>
          )}
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => onDelete(comment)}
            disabled={busy}
          >
            Delete
          </button>
        </div>
      </div>
      {comment.replies.length > 0 && (
        <div className={styles.replies}>
          {comment.replies.map((reply) => (
            <CommentRow
              key={reply.id}
              comment={reply}
              depth={depth + 1}
              onReply={onReply}
              onToggleResolve={onToggleResolve}
              onDelete={onDelete}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentsSection({ targetType, targetId }: { targetType: CollabTargetType; targetId: string }) {
  const [comments, setComments] = useState<CollabComment[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await collabApi.listComments(targetType, targetId);
      setComments(res.comments);
      setCount(res.count);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, [targetType, targetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitRoot = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await collabApi.createComment({ targetType, targetId, body });
      setDraft('');
      await load();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitReply = async () => {
    const body = replyDraft.trim();
    if (!body || !replyTo || busy) return;
    setBusy(true);
    setError(null);
    try {
      await collabApi.createComment({ targetType, targetId, body, parentId: replyTo });
      setReplyDraft('');
      setReplyTo(null);
      await load();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleResolve = async (comment: CollabComment) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (comment.resolved) await collabApi.unresolveComment(comment.id);
      else await collabApi.resolveComment(comment.id);
      await load();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (comment: CollabComment) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await collabApi.deleteComment(comment.id);
      await load();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>Comments{count ? ` (${count})` : ''}</span>
        {loading && <span className={styles.subtle}>Loading…</span>}
      </div>
      {error && <div className={styles.error}>{error}</div>}

      {comments.length === 0 && !loading ? (
        <div className={styles.empty}>No comments yet. Start the conversation.</div>
      ) : (
        <div className={styles.commentList}>
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              depth={0}
              onReply={(c) => {
                setReplyTo(c.id);
                setReplyDraft('');
              }}
              onToggleResolve={toggleResolve}
              onDelete={remove}
              busy={busy}
            />
          ))}
        </div>
      )}

      <div className={styles.form}>
        <textarea
          className={styles.textarea}
          placeholder="Write a comment…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className={styles.rowActions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={submitRoot} disabled={busy || !draft.trim()}>
            Comment
          </button>
        </div>
      </div>

      {replyTo && (
        <div className={styles.form}>
          <span className={styles.sectionTitle}>Reply</span>
          <textarea
            className={styles.textarea}
            placeholder="Write a reply…"
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
          />
          <div className={styles.rowActions}>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={submitReply} disabled={busy || !replyDraft.trim()}>
              Reply
            </button>
            <button type="button" className={styles.btn} onClick={() => setReplyTo(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- reviews

function ReviewSection({ collectionId, projectId }: { collectionId: string; projectId?: string | null }) {
  const [status, setStatus] = useState<ReviewStatus>('none');
  const [current, setCurrent] = useState<CollabReview | null>(null);
  const [reviews, setReviews] = useState<CollabReview[]>([]);
  const [reviewers, setReviewers] = useState<Array<{ id: string; name: string }>>([]);
  const [reviewerId, setReviewerId] = useState('');
  const [requestComment, setRequestComment] = useState('');
  const [decisionComment, setDecisionComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await collabApi.listReviews(collectionId);
      setStatus(res.status);
      setCurrent(res.current);
      setReviews(res.reviews);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!projectId) {
      setReviewers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await accessRequestApi.members(projectId);
        if (cancelled) return;
        const options = [...res.managers, ...res.members].map((u) => ({ id: u.id, name: u.name }));
        setReviewers(options);
      } catch {
        if (!cancelled) setReviewers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const requestReview = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await collabApi.requestReview({
        collectionId,
        reviewerId: reviewerId || null,
        comment: requestComment.trim() || undefined,
      });
      setRequestComment('');
      setReviewerId('');
      await load();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: ReviewDecision) => {
    if (busy || !current) return;
    setBusy(true);
    setError(null);
    try {
      await collabApi.decideReview(current.id, decision, decisionComment.trim() || undefined);
      setDecisionComment('');
      await load();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>Review</span>
        <span className={statusPillClass(status)}>{statusLabel(status)}</span>
      </div>
      {error && <div className={styles.error}>{error}</div>}

      {current ? (
        <div className={styles.comment}>
          <div className={styles.commentMeta}>
            <span className={styles.subtle}>Requested by</span>
            <span className={styles.author}>{current.requestedBy.name || 'Unknown'}</span>
            <span className={styles.subtle}>{formatDate(current.createdAt)}</span>
            {current.reviewer && (
              <span className={styles.subtle}>· reviewer: {current.reviewer.name || 'Unknown'}</span>
            )}
          </div>
          {current.requestComment && <div className={styles.commentBody}>{current.requestComment}</div>}
          {current.decisionComment && (
            <div className={styles.commentBody}>
              <span className={styles.subtle}>Decision note: </span>
              {current.decisionComment}
            </div>
          )}
          {current.status === 'pending' && (
            <div className={styles.form}>
              <textarea
                className={styles.textarea}
                placeholder="Decision note (optional)…"
                value={decisionComment}
                onChange={(e) => setDecisionComment(e.target.value)}
              />
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => decide('approved')}
                  disabled={busy}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  onClick={() => decide('changes_requested')}
                  disabled={busy}
                >
                  Request changes
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        !loading && <div className={styles.empty}>No review requested yet.</div>
      )}

      {(!current || current.status !== 'pending') && (
        <div className={styles.form}>
          <div className={styles.inlineForm}>
            {reviewers.length > 0 && (
              <select
                className={styles.input}
                value={reviewerId}
                onChange={(e) => setReviewerId(e.target.value)}
                aria-label="Reviewer"
              >
                <option value="">Any editor</option>
                {reviewers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
            <input
              className={styles.input}
              placeholder="Review note (optional)…"
              value={requestComment}
              onChange={(e) => setRequestComment(e.target.value)}
            />
            <button type="button" className={styles.btn} onClick={requestReview} disabled={busy}>
              Request review
            </button>
          </div>
        </div>
      )}

      {reviews.length > 1 && (
        <div className={styles.versionList}>
          {reviews.slice(1).map((review) => (
            <div key={review.id} className={styles.versionRow}>
              <span className={statusPillClass(review.status)}>{statusLabel(review.status)}</span>
              <span className={styles.subtle}>
                {review.requestedBy.name || 'Unknown'} · {formatDate(review.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// --------------------------------------------------------------- versions

function VersionsSection({ collectionId }: { collectionId: string }) {
  const [versions, setVersions] = useState<CollectionVersionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [diff, setDiff] = useState<VersionDiffResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await collabApi.listVersions(collectionId);
      setVersions(res.versions);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveVersion = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await collabApi.createVersion(collectionId, label.trim() || undefined);
      setLabel('');
      setDiff(null);
      await load();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const compare = async () => {
    if (!fromId || !toId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await collabApi.diffVersions(collectionId, fromId, toId);
      setDiff(res);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>Versions</span>
        {loading && <span className={styles.subtle}>Loading…</span>}
      </div>
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.inlineForm}>
        <input
          className={styles.input}
          placeholder="Version label (optional)…"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={saveVersion} disabled={busy}>
          Save version
        </button>
      </div>

      {versions.length === 0 && !loading ? (
        <div className={styles.empty}>No saved versions.</div>
      ) : (
        <div className={styles.versionList}>
          {versions.map((version) => (
            <div key={version.id} className={styles.versionRow}>
              <span>
                <span className={styles.mono}>v{version.versionNumber}</span>
                {version.label ? ` · ${version.label}` : ''}
              </span>
              <span className={styles.subtle}>
                {version.requestCount} request{version.requestCount === 1 ? '' : 's'} ·{' '}
                {version.createdBy.name || 'Unknown'} · {formatDate(version.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {versions.length >= 2 && (
        <div className={styles.inlineForm}>
          <select className={styles.input} value={fromId} onChange={(e) => setFromId(e.target.value)} aria-label="From version">
            <option value="">From…</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNumber}
                {v.label ? ` · ${v.label}` : ''}
              </option>
            ))}
          </select>
          <select className={styles.input} value={toId} onChange={(e) => setToId(e.target.value)} aria-label="To version">
            <option value="">To…</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNumber}
                {v.label ? ` · ${v.label}` : ''}
              </option>
            ))}
          </select>
          <button type="button" className={styles.btn} onClick={compare} disabled={busy || !fromId || !toId}>
            Compare
          </button>
        </div>
      )}

      {diff && <DiffView result={diff} />}
    </section>
  );
}

function DiffView({ result }: { result: VersionDiffResult }) {
  const { diff } = result;
  return (
    <div className={styles.diffGrid}>
      <div className={styles.subtle}>
        Comparing v{result.from.versionNumber} → v{result.to.versionNumber}: {diff.counts.added} added,{' '}
        {diff.counts.removed} removed, {diff.counts.changed} changed, {diff.counts.unchanged} unchanged.
      </div>

      {diff.added.length > 0 && (
        <div className={styles.diffGroup}>
          <span className={`${styles.diffGroupTitle} ${styles.diffAdded}`}>Added ({diff.added.length})</span>
          {diff.added.map((r) => (
            <div key={r.id} className={styles.diffItem}>
              + {methodPrefix(r)}
            </div>
          ))}
        </div>
      )}

      {diff.removed.length > 0 && (
        <div className={styles.diffGroup}>
          <span className={`${styles.diffGroupTitle} ${styles.diffRemoved}`}>Removed ({diff.removed.length})</span>
          {diff.removed.map((r) => (
            <div key={r.id} className={styles.diffItem}>
              − {methodPrefix(r)}
            </div>
          ))}
        </div>
      )}

      {diff.changed.length > 0 && (
        <div className={styles.diffGroup}>
          <span className={`${styles.diffGroupTitle} ${styles.diffChanged}`}>Changed ({diff.changed.length})</span>
          {diff.changed.map((c) => (
            <div key={c.id} className={styles.diffItem}>
              <div>{methodPrefix(c.to)}</div>
              {c.fields.map((f) => (
                <div key={f.field} className={styles.diffField}>
                  {f.field}: {JSON.stringify(f.from)} → {JSON.stringify(f.to)}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0 && (
        <div className={styles.empty}>No differences between these versions.</div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ panel

export function CollabPanel({ targetType, targetId, collectionId, projectId, title }: CollabPanelProps) {
  const resolvedCollectionId = collectionId ?? (targetType === 'collection' ? targetId : null);

  return (
    <div className={styles.root} data-testid="collab-panel">
      <div className={styles.header}>
        <h2 className={styles.title}>{title || 'Collaboration'}</h2>
        <span className={styles.subtle}>
          {targetType === 'collection' ? 'Collection' : 'Request'} · <span className={styles.mono}>{targetId}</span>
        </span>
      </div>

      <CommentsSection targetType={targetType} targetId={targetId} />

      {resolvedCollectionId && <ReviewSection collectionId={resolvedCollectionId} projectId={projectId} />}
      {resolvedCollectionId && <VersionsSection collectionId={resolvedCollectionId} />}
    </div>
  );
}

export default CollabPanel;

// ============================================================================
// CollabView — the route-level wrapper. /collab renders <AppShell /> and the
// coordinator maps the 'collab' nav view to this component. It reads the
// target identity from the URL so the panel is refresh/back-stable:
//   /collab?targetType=request|collection&targetId=<uuid>
//           [&collectionId=<uuid>][&projectId=<uuid>]
// ============================================================================
export function CollabView() {
  const searchParams = useSearchParams();
  const targetType: CollabTargetType =
    searchParams.get('targetType') === 'collection' ? 'collection' : 'request';
  const targetId = searchParams.get('targetId') ?? '';
  const collectionId = searchParams.get('collectionId');
  const projectId = searchParams.get('projectId');

  if (!targetId) {
    return (
      <main className="admin-main" data-testid="collab-view">
        <div className={styles.empty}>Open a request or collection to start collaborating.</div>
      </main>
    );
  }

  return (
    <main className="admin-main" data-testid="collab-view">
      <CollabPanel
        targetType={targetType}
        targetId={targetId}
        collectionId={collectionId}
        projectId={projectId}
      />
    </main>
  );
}

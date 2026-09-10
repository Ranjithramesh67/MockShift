'use strict';

// ============================================================================
// Collection review flow (E5/P5) — request a review on a collection, then a
// reviewer approves or requests changes with a comment.
//
// Mount point (coordinator seam in backend/src/api/server.js):
//   app.use('/api', require('./routes/reviews'));
//
// Endpoints:
//   GET  /api/reviews?collectionId=<uuid>          -> { reviews, status }
//   GET  /api/reviews/collections/:collectionId/status
//   POST /api/reviews { collectionId, reviewerId?, comment? }
//   POST /api/reviews/:reviewId/decision { decision, comment? }
//
// The collection's current status is derived from the newest review row:
//   none | pending | approved | changes_requested
// At most one pending review per collection (partial unique index enforces it;
// the route returns 409 before touching the DB).
//
// Access: listing/status requires any project access; requesting a review
// requires EDITOR+; deciding is limited to the assigned reviewer or EDITOR+.
// ============================================================================

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, getProjectAccess, roleAtLeast } = require('../access');
const { logAudit } = require('../audit');

const router = Router();
router.use(requireAuth);

const DECISIONS = ['approved', 'changes_requested'];
const MAX_COMMENT = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

async function collectionInfo(collectionId) {
  const { rows } = await query(
    `SELECT c.id, c.name, c.project_id, p.workspace_id
       FROM collections c
       JOIN projects p ON p.id = c.project_id
      WHERE c.id = $1`,
    [collectionId]
  );
  const r = rows[0];
  return r
    ? { id: r.id, name: r.name, projectId: r.project_id, workspaceId: r.workspace_id }
    : null;
}

async function projectAccess(userId, projectId) {
  return getProjectAccess(userId, projectId);
}

async function canWrite(userId, projectId) {
  const access = await projectAccess(userId, projectId);
  return Boolean(access && roleAtLeast(access.level, 'EDITOR'));
}

async function notifyUser({ userId, title, body, kind, link }) {
  if (!userId) return;
  try {
    await query(
      `INSERT INTO notifications (user_id, title, body, kind, link, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, title, body || null, kind || 'info', link || null, JSON.stringify({ source: 'review' })]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[reviews] notification insert failed:', err.message);
  }
}

const REVIEW_ROW_SQL = `
  SELECT r.id, r.collection_id, r.status, r.request_comment, r.decision_comment,
         r.requested_by, r.reviewer_id, r.created_at, r.updated_at, r.decided_at,
         rb.name AS requested_by_name,
         rv.name AS reviewer_name
    FROM collection_reviews r
    JOIN users rb ON rb.id = r.requested_by
    LEFT JOIN users rv ON rv.id = r.reviewer_id`;

function serializeReview(row) {
  return {
    id: row.id,
    collectionId: row.collection_id,
    status: row.status,
    requestComment: row.request_comment ?? null,
    decisionComment: row.decision_comment ?? null,
    requestedBy: { id: row.requested_by, name: row.requested_by_name ?? null },
    reviewer: row.reviewer_id ? { id: row.reviewer_id, name: row.reviewer_name ?? null } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at ?? null,
  };
}

async function reviewRow(reviewId) {
  const { rows } = await query(`${REVIEW_ROW_SQL} WHERE r.id = $1`, [reviewId]);
  return rows[0] || null;
}

async function latestReview(collectionId) {
  const { rows } = await query(
    `${REVIEW_ROW_SQL} WHERE r.collection_id = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
    [collectionId]
  );
  return rows[0] || null;
}

// GET /api/reviews?collectionId= -> { reviews, status, current }
router.get('/reviews', async (req, res, next) => {
  try {
    const collectionId = String(req.query.collectionId || '');
    if (!isUuid(collectionId)) return res.status(400).json({ error: 'collectionId must be a valid uuid' });
    const collection = await collectionInfo(collectionId);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    if (!(await projectAccess(req.user.id, collection.projectId))) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    const { rows } = await query(
      `${REVIEW_ROW_SQL} WHERE r.collection_id = $1 ORDER BY r.created_at DESC, r.id DESC`,
      [collectionId]
    );
    const reviews = rows.map(serializeReview);
    res.json({ reviews, status: reviews[0]?.status ?? 'none', current: reviews[0] || null });
  } catch (err) {
    next(err);
  }
});

// GET /api/reviews/collections/:collectionId/status -> { status, review }
router.get('/reviews/collections/:collectionId/status', async (req, res, next) => {
  try {
    const { collectionId } = req.params;
    if (!isUuid(collectionId)) return res.status(404).json({ error: 'Collection not found' });
    const collection = await collectionInfo(collectionId);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    if (!(await projectAccess(req.user.id, collection.projectId))) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    const row = await latestReview(collectionId);
    res.json({ status: row?.status ?? 'none', review: row ? serializeReview(row) : null });
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews {collectionId, reviewerId?, comment?} -> 201 {review, status}
router.post('/reviews', async (req, res, next) => {
  try {
    const { collectionId, reviewerId, comment } = req.body || {};
    if (!isUuid(collectionId)) return res.status(400).json({ error: 'collectionId must be a valid uuid' });
    const requestComment =
      comment === undefined || comment === null ? null : String(comment).trim() || null;
    if (requestComment && requestComment.length > MAX_COMMENT) {
      return res.status(400).json({ error: `comment must be at most ${MAX_COMMENT} characters` });
    }

    const collection = await collectionInfo(collectionId);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    if (!(await canWrite(req.user.id, collection.projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }

    let resolvedReviewerId = null;
    if (reviewerId !== undefined && reviewerId !== null && reviewerId !== '') {
      if (!isUuid(reviewerId)) return res.status(400).json({ error: 'reviewerId must be a valid uuid' });
      const { rows } = await query(`SELECT id, name FROM users WHERE id = $1`, [reviewerId]);
      if (rows.length === 0) return res.status(404).json({ error: 'Reviewer not found' });
      if (!(await projectAccess(reviewerId, collection.projectId))) {
        return res.status(400).json({ error: 'Reviewer has no access to this project' });
      }
      resolvedReviewerId = reviewerId;
    }

    const pending = await query(
      `SELECT id FROM collection_reviews WHERE collection_id = $1 AND status = 'pending' LIMIT 1`,
      [collectionId]
    );
    if (pending.rows.length > 0) {
      return res.status(409).json({ error: 'A review is already pending for this collection' });
    }

    const created = await query(
      `INSERT INTO collection_reviews
         (collection_id, workspace_id, project_id, requested_by, reviewer_id, status, request_comment)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING id`,
      [collectionId, collection.workspaceId, collection.projectId, req.user.id, resolvedReviewerId, requestComment]
    );
    const row = await reviewRow(created.rows[0].id);

    if (resolvedReviewerId && resolvedReviewerId !== req.user.id) {
      await notifyUser({
        userId: resolvedReviewerId,
        title: `${req.user.name || 'Someone'} requested your review`,
        body: requestComment ? requestComment.slice(0, 200) : `Collection: ${collection.name}`,
        kind: 'info',
        link: `/collab?targetType=collection&targetId=${collectionId}`,
      });
    }

    await logAudit({
      actorId: req.user.id,
      entityType: 'collection',
      entityId: collectionId,
      action: 'request_review',
      detail: { reviewId: row.id, reviewerId: resolvedReviewerId },
      ip: req.ip,
    });

    res.status(201).json({ review: serializeReview(row), status: row.status });
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews/:reviewId/decision {decision, comment?} -> {review, status}
router.post('/reviews/:reviewId/decision', async (req, res, next) => {
  try {
    const { reviewId } = req.params;
    if (!isUuid(reviewId)) return res.status(404).json({ error: 'Review not found' });
    const decision = String((req.body || {}).decision || '').toLowerCase();
    if (!DECISIONS.includes(decision)) {
      return res.status(400).json({ error: `decision must be one of ${DECISIONS.join(', ')}` });
    }
    const comment = (req.body || {}).comment;
    const decisionComment =
      comment === undefined || comment === null ? null : String(comment).trim() || null;
    if (decisionComment && decisionComment.length > MAX_COMMENT) {
      return res.status(400).json({ error: `comment must be at most ${MAX_COMMENT} characters` });
    }

    const review = await reviewRow(reviewId);
    if (!review) return res.status(404).json({ error: 'Review not found' });
    if (review.status !== 'pending') {
      return res.status(409).json({ error: 'This review has already been decided' });
    }
    const collection = await collectionInfo(review.collection_id);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });

    const isAssigned = review.reviewer_id === req.user.id;
    if (!isAssigned && !(await canWrite(req.user.id, collection.projectId))) {
      return res.status(403).json({ error: 'Only the assigned reviewer or an editor can decide this review' });
    }

    const updated = await query(
      `UPDATE collection_reviews
          SET status = $1, decision_comment = $2, decided_at = now(), updated_at = now(), reviewer_id = COALESCE(reviewer_id, $3)
        WHERE id = $4
        RETURNING id`,
      [decision, decisionComment, req.user.id, reviewId]
    );
    const row = await reviewRow(updated.rows[0].id);

    if (row.requested_by !== req.user.id) {
      await notifyUser({
        userId: row.requested_by,
        title: `${req.user.name || 'Someone'} ${decision === 'approved' ? 'approved' : 'requested changes on'} your review`,
        body: decisionComment ? decisionComment.slice(0, 200) : `Collection: ${collection.name}`,
        kind: decision === 'approved' ? 'success' : 'info',
        link: `/collab?targetType=collection&targetId=${row.collection_id}`,
      });
    }

    await logAudit({
      actorId: req.user.id,
      entityType: 'collection',
      entityId: row.collection_id,
      action: 'decide_review',
      detail: { reviewId: row.id, decision },
      ip: req.ip,
    });

    res.json({ review: serializeReview(row), status: row.status });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

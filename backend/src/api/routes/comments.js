'use strict';

// ============================================================================
// Collaboration comments (E5/P5) — threaded comments on a request or a
// collection.
//
// Mount point (coordinator seam in backend/src/api/server.js):
//   app.use('/api', require('./routes/comments'));
//
// Endpoints:
//   GET    /api/comments?targetType=request|collection&targetId=<uuid>
//   POST   /api/comments { targetType, targetId, body, parentId? }
//   POST   /api/comments/:commentId/resolve
//   POST   /api/comments/:commentId/unresolve
//   DELETE /api/comments/:commentId
//
// Access follows content.js: reads require any project access; mutations
// (resolve/unresolve/delete) require the thread author or EDITOR+ on the
// owning project. Replies are one level deep (a reply targets a thread root).
// ============================================================================

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, getProjectAccess, roleAtLeast } = require('../access');
const { logAudit } = require('../audit');

const router = Router();
router.use(requireAuth);

const TARGET_TYPES = ['request', 'collection'];
const MAX_BODY = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Resolve a polymorphic target to its owning project/workspace (or null).
async function resolveTarget(targetType, targetId) {
  if (targetType === 'request') {
    const { rows } = await query(
      `SELECT ar.id, ar.name, c.project_id, p.workspace_id
         FROM api_requests ar
         JOIN collections c ON c.id = ar.collection_id
         JOIN projects p ON p.id = c.project_id
        WHERE ar.id = $1`,
      [targetId]
    );
    const r = rows[0];
    return r
      ? { targetType, targetId, name: r.name, projectId: r.project_id, workspaceId: r.workspace_id }
      : null;
  }
  if (targetType === 'collection') {
    const { rows } = await query(
      `SELECT c.id, c.name, c.project_id, p.workspace_id
         FROM collections c
         JOIN projects p ON p.id = c.project_id
        WHERE c.id = $1`,
      [targetId]
    );
    const r = rows[0];
    return r
      ? { targetType, targetId, name: r.name, projectId: r.project_id, workspaceId: r.workspace_id }
      : null;
  }
  return null;
}

async function projectAccess(userId, projectId) {
  return getProjectAccess(userId, projectId);
}

async function canWrite(userId, projectId) {
  const access = await projectAccess(userId, projectId);
  return Boolean(access && roleAtLeast(access.level, 'EDITOR'));
}

// Best-effort in-app notification; never breaks the primary request.
async function notifyUser({ userId, title, body, kind, link }) {
  if (!userId) return;
  try {
    await query(
      `INSERT INTO notifications (user_id, title, body, kind, link, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, title, body || null, kind || 'info', link || null, JSON.stringify({ source: 'collab' })]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[collab] notification insert failed:', err.message);
  }
}

function serializeComment(row) {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    parentId: row.parent_id ?? null,
    body: row.body,
    author: { id: row.author_id, name: row.author_name ?? null },
    resolved: Boolean(row.resolved),
    resolvedBy: row.resolved_by ? { id: row.resolved_by, name: row.resolved_by_name ?? null } : null,
    resolvedAt: row.resolved_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    replies: [],
  };
}

const COMMENT_ROW_SQL = `
  SELECT c.id, c.target_type, c.target_id, c.parent_id, c.body, c.author_id,
         c.resolved, c.resolved_by, c.resolved_at, c.created_at, c.updated_at,
         a.name AS author_name,
         rb.name AS resolved_by_name
    FROM collab_comments c
    JOIN users a ON a.id = c.author_id
    LEFT JOIN users rb ON rb.id = c.resolved_by`;

async function commentRow(commentId) {
  const { rows } = await query(`${COMMENT_ROW_SQL} WHERE c.id = $1`, [commentId]);
  return rows[0] || null;
}

// GET /api/comments?targetType=&targetId= -> { comments: [thread, ...] }
router.get('/comments', async (req, res, next) => {
  try {
    const targetType = String(req.query.targetType || '').toLowerCase();
    const targetId = String(req.query.targetId || '');
    if (!TARGET_TYPES.includes(targetType)) {
      return res.status(400).json({ error: 'targetType must be request or collection' });
    }
    if (!isUuid(targetId)) return res.status(400).json({ error: 'targetId must be a valid uuid' });

    const target = await resolveTarget(targetType, targetId);
    if (!target) return res.status(404).json({ error: 'Comment target not found' });
    if (!(await projectAccess(req.user.id, target.projectId))) {
      return res.status(403).json({ error: 'No access to this project' });
    }

    const { rows } = await query(
      `${COMMENT_ROW_SQL}
        WHERE c.target_type = $1 AND c.target_id = $2
        ORDER BY c.created_at ASC, c.id ASC`,
      [targetType, targetId]
    );
    const roots = [];
    const byId = new Map();
    for (const row of rows.filter((r) => !r.parent_id)) {
      const thread = serializeComment(row);
      byId.set(thread.id, thread);
      roots.push(thread);
    }
    for (const row of rows.filter((r) => r.parent_id)) {
      const parent = byId.get(row.parent_id);
      if (parent) parent.replies.push(serializeComment(row));
    }
    const total = roots.reduce((n, t) => n + 1 + t.replies.length, 0);
    res.json({ comments: roots, count: total });
  } catch (err) {
    next(err);
  }
});

// POST /api/comments {targetType,targetId,body,parentId?} -> 201 {comment}
router.post('/comments', async (req, res, next) => {
  try {
    const { targetType, targetId, body, parentId } = req.body || {};
    const type = String(targetType || '').toLowerCase();
    if (!TARGET_TYPES.includes(type)) {
      return res.status(400).json({ error: 'targetType must be request or collection' });
    }
    if (!isUuid(targetId)) return res.status(400).json({ error: 'targetId must be a valid uuid' });
    const text = body === undefined || body === null ? '' : String(body).trim();
    if (!text) return res.status(400).json({ error: 'body is required' });
    if (text.length > MAX_BODY) {
      return res.status(400).json({ error: `body must be at most ${MAX_BODY} characters` });
    }

    const target = await resolveTarget(type, targetId);
    if (!target) return res.status(404).json({ error: 'Comment target not found' });
    if (!(await projectAccess(req.user.id, target.projectId))) {
      return res.status(403).json({ error: 'No access to this project' });
    }

    let resolvedParentId = null;
    if (parentId !== undefined && parentId !== null && parentId !== '') {
      if (!isUuid(parentId)) return res.status(400).json({ error: 'parentId must be a valid uuid' });
      const parent = await commentRow(parentId);
      if (!parent) return res.status(404).json({ error: 'Parent comment not found' });
      if (parent.target_type !== type || parent.target_id !== targetId) {
        return res.status(400).json({ error: 'Parent comment belongs to a different target' });
      }
      if (parent.parent_id) {
        return res.status(400).json({ error: 'Replies are limited to one level' });
      }
      resolvedParentId = parent.id;
    }

    const created = await query(
      `INSERT INTO collab_comments
         (workspace_id, project_id, target_type, target_id, parent_id, body, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [target.workspaceId, target.projectId, type, targetId, resolvedParentId, text, req.user.id]
    );
    const row = await commentRow(created.rows[0].id);

    if (resolvedParentId) {
      const parent = await commentRow(resolvedParentId);
      if (parent && parent.author_id !== req.user.id) {
        await notifyUser({
          userId: parent.author_id,
          title: `${req.user.name || 'Someone'} replied to your comment`,
          body: text.slice(0, 200),
          kind: 'info',
          link: `/collab?targetType=${type}&targetId=${targetId}`,
        });
      }
    }

    await logAudit({
      actorId: req.user.id,
      entityType: 'comment',
      entityId: row.id,
      action: 'create_comment',
      detail: { targetType: type, targetId, parentId: resolvedParentId },
      ip: req.ip,
    });

    res.status(201).json({ comment: serializeComment(row) });
  } catch (err) {
    next(err);
  }
});

// Shared handler for resolve/unresolve: normalizes a reply to its thread root.
async function setResolved(req, res, next, resolved) {
  try {
    const { commentId } = req.params;
    if (!isUuid(commentId)) return res.status(404).json({ error: 'Comment not found' });
    const comment = await commentRow(commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    let root = comment;
    if (comment.parent_id) {
      const { rows } = await query(`${COMMENT_ROW_SQL} WHERE c.id = $1`, [comment.parent_id]);
      if (rows[0]) root = rows[0];
    }

    const target = await resolveTarget(root.target_type, root.target_id);
    if (!target) return res.status(404).json({ error: 'Comment target not found' });
    const isAuthor = root.author_id === req.user.id;
    if (!isAuthor && !(await canWrite(req.user.id, target.projectId))) {
      return res.status(403).json({ error: 'Only the author or an editor can resolve this thread' });
    }

    const updated = await query(
      `UPDATE collab_comments
          SET resolved = $1,
              resolved_by = $2,
              resolved_at = $3,
              updated_at = now()
        WHERE id = $4
        RETURNING id`,
      [resolved, resolved ? req.user.id : null, resolved ? new Date() : null, root.id]
    );
    const row = await commentRow(updated.rows[0].id);

    await logAudit({
      actorId: req.user.id,
      entityType: 'comment',
      entityId: root.id,
      action: resolved ? 'resolve_comment' : 'unresolve_comment',
      detail: { targetType: root.target_type, targetId: root.target_id },
      ip: req.ip,
    });

    res.json({ comment: serializeComment(row) });
  } catch (err) {
    next(err);
  }
}

router.post('/comments/:commentId/resolve', (req, res, next) => setResolved(req, res, next, true));
router.post('/comments/:commentId/unresolve', (req, res, next) => setResolved(req, res, next, false));

// DELETE /api/comments/:commentId — author or editor+.
router.delete('/comments/:commentId', async (req, res, next) => {
  try {
    const { commentId } = req.params;
    if (!isUuid(commentId)) return res.status(404).json({ error: 'Comment not found' });
    const comment = await commentRow(commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    const target = await resolveTarget(comment.target_type, comment.target_id);
    if (!target) return res.status(404).json({ error: 'Comment target not found' });
    const isAuthor = comment.author_id === req.user.id;
    if (!isAuthor && !(await canWrite(req.user.id, target.projectId))) {
      return res.status(403).json({ error: 'Only the author or an editor can delete this comment' });
    }
    await query(`DELETE FROM collab_comments WHERE id = $1`, [commentId]);
    await logAudit({
      actorId: req.user.id,
      entityType: 'comment',
      entityId: commentId,
      action: 'delete_comment',
      detail: { targetType: comment.target_type, targetId: comment.target_id },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

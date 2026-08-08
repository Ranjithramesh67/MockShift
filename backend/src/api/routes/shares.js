'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, getProjectAccess, roleAtLeast } = require('../access');
const { logAudit } = require('../audit');

const router = Router();

// Header keys whose values are credentials and must never leak on a public
// share (both request-side and response-side).
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-auth',
  'x-access-token',
  'apikey',
  'api-key',
]);

function redactHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '••••••••' : value;
  }
  return out;
}

function redactKvArray(kvs) {
  if (!Array.isArray(kvs)) return [];
  return kvs.map((kv) => {
    if (!kv || typeof kv !== 'object') return kv;
    const { key, value, enabled } = kv;
    return { key, value: SENSITIVE_HEADERS.has(String(key).toLowerCase()) ? '••••••••' : value, enabled };
  });
}

async function canEditProject(userId, projectId) {
  const access = await getProjectAccess(userId, projectId);
  return Boolean(access && roleAtLeast(access.level, 'EDITOR'));
}

async function projectOfRequest(requestId) {
  const { rows } = await query(
    `SELECT c.project_id
       FROM api_requests ar
       JOIN collections c ON c.id = ar.collection_id
      WHERE ar.id = $1`,
    [requestId]
  );
  return rows[0]?.project_id ?? null;
}

// ---------------------------------------------------------------- Create
// POST /api/requests/:requestId/share — idempotent: returns the existing share
// for the request when one already exists.
router.post('/requests/:requestId/share', requireAuth, async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const projectId = await projectOfRequest(requestId);
    if (!projectId) return res.status(404).json({ error: 'Request not found' });
    if (!(await canEditProject(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }

    let { rows } = await query(`SELECT id, token, created_at FROM request_shares WHERE request_id = $1`, [requestId]);
    let share = rows[0];
    if (!share) {
      ({ rows } = await query(
        `INSERT INTO request_shares (request_id, token, created_by)
         VALUES ($1, $2, $3)
         RETURNING id, token, created_at`,
        [requestId, crypto.randomUUID(), req.user.id]
      ));
      share = rows[0];
      await logAudit({
        actorId: req.user.id,
        entityType: 'request',
        entityId: requestId,
        action: 'share_request',
        detail: { shareId: share.id },
        ip: req.ip,
      });
    }

    res.status(201).json({ share: { token: share.token, createdAt: share.created_at } });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Read
// GET /api/shares/:token — PUBLIC (no auth by design). Anyone holding the
// link sees a read-only snapshot of the request + its latest run response,
// with credentials redacted.
router.get('/shares/:token', async (req, res, next) => {
  try {
    const token = req.params.token;
    const { rows } = await query(
      `SELECT rs.id, rs.created_at, ar.id AS request_id, ar.name, ar.method, ar.url,
              ar.headers, ar.query_params, ar.body_type, ar.body_json, ar.body_text, ar.api_type
         FROM request_shares rs
         JOIN api_requests ar ON ar.id = rs.request_id
        WHERE rs.token = $1`,
      [token]
    );
    const share = rows[0];
    if (!share) return res.status(404).json({ error: 'Share link not found' });

    const { rows: runs } = await query(
      `SELECT status, response_snapshot, started_at, finished_at
         FROM run_history
        WHERE request_id = $1
        ORDER BY started_at DESC
        LIMIT 1`,
      [share.request_id]
    );
    const lastRun = runs[0] || null;
    let lastRunPayload = null;
    if (lastRun && lastRun.response_snapshot) {
      const snap = lastRun.response_snapshot;
      lastRunPayload = {
        status: snap.status,
        statusText: snap.statusText,
        headers: redactHeaders(snap.headers),
        body: snap.body,
        bodyEncoding: snap.bodyEncoding || 'utf8',
        durationMs: snap.durationMs,
        startedAt: lastRun.started_at,
      };
    }

    res.json({
      share: {
        token,
        createdAt: share.created_at,
        request: {
          id: share.request_id,
          name: share.name,
          method: share.method,
          url: share.url,
          headers: redactKvArray(share.headers),
          queryParams: share.query_params || [],
          bodyType: share.body_type,
          bodyJson: share.body_json ?? null,
          bodyText: share.body_text ?? null,
          apiType: share.api_type,
        },
        lastRun: lastRunPayload,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Revoke
router.delete('/shares/:token', requireAuth, async (req, res, next) => {
  try {
    const token = req.params.token;
    const { rows } = await query(
      `SELECT rs.id, rs.created_by, ar.id AS request_id
         FROM request_shares rs
         JOIN api_requests ar ON ar.id = rs.request_id
        WHERE rs.token = $1`,
      [token]
    );
    const share = rows[0];
    if (!share) return res.status(404).json({ error: 'Share link not found' });

    const projectId = await projectOfRequest(share.request_id);
    const isOwner = share.created_by === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';
    if (!isOwner && !isAdmin && !(await canEditProject(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Only the owner or an editor can revoke this link' });
    }

    await query(`DELETE FROM request_shares WHERE id = $1`, [share.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

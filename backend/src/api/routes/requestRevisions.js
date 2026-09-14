'use strict';

// ============================================================================
// Request edit history (per-request revisions) + rollback.
//
//   GET  /api/requests/:requestId/revisions
//        -> { revisions: [meta] }                       (any project reader)
//   GET  /api/requests/:requestId/revisions/:revisionId
//        -> { revision: { ...meta, snapshot } }         (any project reader)
//   POST /api/requests/:requestId/revisions/:revisionId/rollback
//        -> { request, revision }                       (EDITOR+)
//
// Revisions are written by content.js on create/update; this router reads them
// and performs rollback (which writes a new 'rollback' revision and publishes
// entity:updated so every open editor reloads).
// ============================================================================

const { Router } = require('express');
const { query, pool } = require('../db');
const { requireAuth, canReadProject, canWriteProject } = require('../access');
const { REQUEST_SELECT, serializeRequest } = require('../requestSnapshot');
const { changedFields } = require('../collabDiff');
const { publish, roomKey } = require('../realtime');

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const REVISION_META_SQL = `
  SELECT r.id, r.request_id, r.revision_number, r.change_kind, r.changed_fields,
         r.rolled_back_from, r.created_by, r.created_at, u.name AS created_by_name
    FROM request_revisions r
    JOIN users u ON u.id = r.created_by`;

function serializeRevisionMeta(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    revisionNumber: row.revision_number,
    changeKind: row.change_kind,
    changedFields: row.changed_fields || [],
    rolledBackFrom: row.rolled_back_from ?? null,
    createdBy: { id: row.created_by, name: row.created_by_name ?? null },
    createdAt: row.created_at,
  };
}

// Resolve a request's project + workspace + collection in one read.
async function scopeOfRequest(requestId) {
  const { rows } = await query(
    `SELECT ar.collection_id, c.project_id, p.workspace_id
       FROM api_requests ar
       JOIN collections c ON c.id = ar.collection_id
       JOIN projects p ON p.id = c.project_id
      WHERE ar.id = $1`,
    [requestId]
  );
  return rows[0] || null;
}

async function revisionRow(requestId, revisionId) {
  const { rows } = await query(
    `${REVISION_META_SQL} WHERE r.id = $1 AND r.request_id = $2`,
    [revisionId, requestId]
  );
  return rows[0] || null;
}

// GET list
router.get('/requests/:requestId/revisions', async (req, res, next) => {
  try {
    const { requestId } = req.params;
    if (!isUuid(requestId)) return res.status(404).json({ error: 'Request not found' });
    const scope = await scopeOfRequest(requestId);
    if (!scope) return res.status(404).json({ error: 'Request not found' });
    if (!(await canReadProject(req.user.id, scope.project_id))) {
      return res.status(403).json({ error: 'No access to this request' });
    }
    const { rows } = await query(
      `${REVISION_META_SQL} WHERE r.request_id = $1 ORDER BY r.revision_number DESC`,
      [requestId]
    );
    res.json({ revisions: rows.map(serializeRevisionMeta) });
  } catch (err) {
    next(err);
  }
});

// GET detail
router.get('/requests/:requestId/revisions/:revisionId', async (req, res, next) => {
  try {
    const { requestId, revisionId } = req.params;
    if (!isUuid(requestId) || !isUuid(revisionId)) {
      return res.status(404).json({ error: 'Revision not found' });
    }
    const scope = await scopeOfRequest(requestId);
    if (!scope) return res.status(404).json({ error: 'Request not found' });
    if (!(await canReadProject(req.user.id, scope.project_id))) {
      return res.status(403).json({ error: 'No access to this request' });
    }
    const row = await revisionRow(requestId, revisionId);
    if (!row) return res.status(404).json({ error: 'Revision not found' });
    const { rows } = await query(`SELECT snapshot FROM request_revisions WHERE id = $1`, [revisionId]);
    res.json({ revision: { ...serializeRevisionMeta(row), snapshot: rows[0]?.snapshot ?? null } });
  } catch (err) {
    next(err);
  }
});

const APPLY_SNAPSHOT_SQL = `
  UPDATE api_requests
     SET name = $2, method = $3, url = $4, headers = $5::jsonb, query_params = $6::jsonb,
         body_type = $7, body_json = $8::jsonb, body_text = $9, body_parts = $10::jsonb,
         api_type = $11, folder_id = $12, formula = $13, assertions = $14::jsonb
   WHERE id = $1`;

function snapshotParams(requestId, s) {
  return [
    requestId,
    s.name,
    s.method,
    s.url,
    JSON.stringify(s.headers ?? []),
    JSON.stringify(s.queryParams ?? []),
    s.bodyType,
    s.bodyJson === null || s.bodyJson === undefined ? null : JSON.stringify(s.bodyJson),
    s.bodyText ?? null,
    JSON.stringify(s.bodyParts ?? []),
    s.apiType,
    s.folderId ?? null,
    s.formula ?? '',
    JSON.stringify(s.assertions ?? []),
  ];
}

// POST rollback
router.post('/requests/:requestId/revisions/:revisionId/rollback', async (req, res, next) => {
  try {
    const { requestId, revisionId } = req.params;
    if (!isUuid(requestId) || !isUuid(revisionId)) {
      return res.status(404).json({ error: 'Revision not found' });
    }
    const scope = await scopeOfRequest(requestId);
    if (!scope) return res.status(404).json({ error: 'Request not found' });
    if (!(await canWriteProject(req.user.id, scope.project_id))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const target = await revisionRow(requestId, revisionId);
    if (!target) return res.status(404).json({ error: 'Revision not found' });
    const targetRow = (await query(`SELECT snapshot FROM request_revisions WHERE id = $1`, [revisionId])).rows[0];
    if (!targetRow) return res.status(404).json({ error: 'Revision not found' });
    const targetSnap = targetRow.snapshot;

    const client = await pool.connect();
    let before;
    let after;
    let changed;
    let newRevision;
    try {
      await client.query('BEGIN');
      const { rows: pre } = await client.query(
        `SELECT ${REQUEST_SELECT} FROM api_requests WHERE id = $1 FOR UPDATE`,
        [requestId]
      );
      if (!pre[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Request not found' });
      }
      before = serializeRequest(pre[0]);
      let snapshot = targetSnap;
      if (snapshot && snapshot.folderId) {
        const folderCheck = await client.query(
          'SELECT 1 FROM folders WHERE id = $1 AND collection_id = $2',
          [snapshot.folderId, scope.collection_id]
        );
        if (!folderCheck.rows[0]) snapshot = { ...snapshot, folderId: null };
      }
      await client.query(APPLY_SNAPSHOT_SQL, snapshotParams(requestId, snapshot));
      const { rows: post } = await client.query(`SELECT ${REQUEST_SELECT} FROM api_requests WHERE id = $1`, [requestId]);
      after = serializeRequest(post[0]);
      changed = changedFields(before, after);
      const { rows: inserted } = await client.query(
        `INSERT INTO request_revisions
           (request_id, collection_id, workspace_id, project_id, revision_number,
            change_kind, snapshot, changed_fields, rolled_back_from, created_by)
         SELECT $1, $2, $3, $4, COALESCE(MAX(revision_number), 0) + 1,
                'rollback', $5::jsonb, $6::jsonb, $7, $8
           FROM request_revisions
          WHERE request_id = $1
         RETURNING id, request_id, revision_number, change_kind, changed_fields, rolled_back_from, created_by, created_at`,
        [
          requestId,
          scope.collection_id,
          scope.workspace_id,
          scope.project_id,
          JSON.stringify(after),
          JSON.stringify(changed),
          revisionId,
          req.user.id,
        ]
      );
      newRevision = { ...inserted[0], created_by_name: req.user.name || null };
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }

    publish(roomKey('request', requestId), {
      type: 'entity:updated',
      entityType: 'request',
      entityId: requestId,
      by: { id: req.user.id, name: req.user.name || null },
    });

    res.json({
      request: { id: requestId, name: after.name },
      revision: serializeRevisionMeta(newRevision),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

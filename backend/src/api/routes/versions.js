'use strict';

// ============================================================================
// Collection version snapshots + diff (E5/P5).
//
// Mount point (coordinator seam in backend/src/api/server.js):
//   app.use('/api', require('./routes/versions'));
//
// Endpoints:
//   GET  /api/versions?collectionId=<uuid>            -> { versions: [meta] }
//   POST /api/versions { collectionId, label? }       -> 201 { version: meta }
//   GET  /api/versions/diff?collectionId=&from=&to=   -> { from, to, diff }
//   GET  /api/versions/:versionId                     -> { version: {..., snapshot} }
//
// Saving a version serializes the collection and every request it holds into a
// JSON snapshot (collection_versions.snapshot). version_number is 1-based per
// collection; the insert runs in a transaction that locks the collection row so
// concurrent saves cannot collide on the (collection_id, version_number) key.
// The pure comparison lives in ../collabDiff.js.
//
// Access: reading versions/diffs requires any project access; saving a version
// requires EDITOR+.
// ============================================================================

const { Router } = require('express');
const { query, pool } = require('../db');
const { requireAuth, getProjectAccess, roleAtLeast } = require('../access');
const { logAudit } = require('../audit');
const { diffSnapshots } = require('../collabDiff');

const router = Router();
router.use(requireAuth);

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

function serializeRequestRow(r) {
  return {
    id: r.id,
    name: r.name,
    method: r.method,
    url: r.url,
    headers: r.headers || [],
    queryParams: r.query_params || [],
    bodyType: r.body_type,
    bodyJson: r.body_json ?? null,
    bodyText: r.body_text ?? null,
    bodyParts: r.body_parts || [],
    apiType: r.api_type,
    folderId: r.folder_id ?? null,
    formula: r.formula || '',
    assertions: r.assertions || [],
  };
}

function serializeVersionMeta(row) {
  return {
    id: row.id,
    collectionId: row.collection_id,
    versionNumber: row.version_number,
    label: row.label ?? null,
    requestCount: Number(row.request_count ?? 0),
    createdBy: { id: row.created_by, name: row.created_by_name ?? null },
    createdAt: row.created_at,
  };
}

const VERSION_META_SQL = `
  SELECT v.id, v.collection_id, v.version_number, v.label, v.created_by, v.created_at,
         COALESCE(jsonb_array_length(v.snapshot->'requests'), 0) AS request_count,
         u.name AS created_by_name
    FROM collection_versions v
    JOIN users u ON u.id = v.created_by`;

async function versionRow(versionId) {
  const { rows } = await query(`${VERSION_META_SQL} WHERE v.id = $1`, [versionId]);
  return rows[0] || null;
}

// Read the collection + requests and build the snapshot object.
async function buildSnapshot(collectionId, exec) {
  const { rows: colRows } = await exec(
    `SELECT id, name, project_id FROM collections WHERE id = $1`,
    [collectionId]
  );
  const collection = colRows[0];
  if (!collection) return null;
  const { rows } = await exec(
    `SELECT id, name, method, url, headers, query_params, body_type, body_json,
            body_text, body_parts, api_type, folder_id, formula, assertions
       FROM api_requests
      WHERE collection_id = $1
      ORDER BY name ASC, id ASC`,
    [collectionId]
  );
  return {
    collection: { id: collection.id, name: collection.name, projectId: collection.project_id },
    requests: rows.map(serializeRequestRow),
  };
}

// GET /api/versions?collectionId= -> { versions: [meta] }
router.get('/versions', async (req, res, next) => {
  try {
    const collectionId = String(req.query.collectionId || '');
    if (!isUuid(collectionId)) return res.status(400).json({ error: 'collectionId must be a valid uuid' });
    const collection = await collectionInfo(collectionId);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    if (!(await projectAccess(req.user.id, collection.projectId))) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    const { rows } = await query(
      `${VERSION_META_SQL} WHERE v.collection_id = $1 ORDER BY v.version_number DESC`,
      [collectionId]
    );
    res.json({ versions: rows.map(serializeVersionMeta) });
  } catch (err) {
    next(err);
  }
});

// GET /api/versions/diff?collectionId=&from=&to= -> { from, to, diff }
// Declared before /:versionId so "diff" is never read as an id.
router.get('/versions/diff', async (req, res, next) => {
  try {
    const collectionId = String(req.query.collectionId || '');
    const fromId = String(req.query.from || '');
    const toId = String(req.query.to || '');
    if (!isUuid(collectionId)) return res.status(400).json({ error: 'collectionId must be a valid uuid' });
    if (!isUuid(fromId) || !isUuid(toId)) {
      return res.status(400).json({ error: 'from and to must be valid version uuids' });
    }
    const collection = await collectionInfo(collectionId);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    if (!(await projectAccess(req.user.id, collection.projectId))) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    const { rows } = await query(
      `SELECT id, collection_id, snapshot FROM collection_versions
        WHERE id = ANY($1::uuid[])`,
      [[fromId, toId]]
    );
    const fromRow = rows.find((r) => r.id === fromId);
    const toRow = rows.find((r) => r.id === toId);
    if (!fromRow || !toRow) return res.status(404).json({ error: 'Version not found' });
    if (fromRow.collection_id !== collectionId || toRow.collection_id !== collectionId) {
      return res.status(400).json({ error: 'Both versions must belong to the requested collection' });
    }

    const [fromMeta, toMeta] = await Promise.all([versionRow(fromId), versionRow(toId)]);
    res.json({
      from: serializeVersionMeta(fromMeta),
      to: serializeVersionMeta(toMeta),
      diff: diffSnapshots(fromRow.snapshot, toRow.snapshot),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/versions/:versionId -> { version: { ..., snapshot } }
router.get('/versions/:versionId', async (req, res, next) => {
  try {
    const { versionId } = req.params;
    if (!isUuid(versionId)) return res.status(404).json({ error: 'Version not found' });
    const row = await versionRow(versionId);
    if (!row) return res.status(404).json({ error: 'Version not found' });
    const collection = await collectionInfo(row.collection_id);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    if (!(await projectAccess(req.user.id, collection.projectId))) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    const { rows } = await query(`SELECT snapshot FROM collection_versions WHERE id = $1`, [versionId]);
    res.json({ version: { ...serializeVersionMeta(row), snapshot: rows[0]?.snapshot ?? null } });
  } catch (err) {
    next(err);
  }
});

// POST /api/versions {collectionId, label?} -> 201 {version: meta}
router.post('/versions', async (req, res, next) => {
  try {
    const { collectionId, label } = req.body || {};
    if (!isUuid(collectionId)) return res.status(400).json({ error: 'collectionId must be a valid uuid' });
    const versionLabel = label === undefined || label === null ? null : String(label).trim() || null;
    if (versionLabel && versionLabel.length > 200) {
      return res.status(400).json({ error: 'label must be at most 200 characters' });
    }

    const collection = await collectionInfo(collectionId);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    if (!(await canWrite(req.user.id, collection.projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }

    const client = await pool.connect();
    let versionId;
    try {
      await client.query('BEGIN');
      const exec = (sql, params) => client.query(sql, params);
      // Lock the collection so concurrent saves serialize on version_number.
      await exec(`SELECT id FROM collections WHERE id = $1 FOR UPDATE`, [collectionId]);
      const snapshot = await buildSnapshot(collectionId, exec);
      if (!snapshot) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Collection not found' });
      }
      const { rows } = await exec(
        `INSERT INTO collection_versions
           (collection_id, workspace_id, project_id, version_number, label, snapshot, created_by)
         SELECT $1, $2, $3,
                COALESCE(MAX(version_number), 0) + 1,
                $4, $5::jsonb, $6
           FROM collection_versions
          WHERE collection_id = $1
         RETURNING id`,
        [collectionId, collection.workspaceId, collection.projectId, versionLabel, JSON.stringify(snapshot), req.user.id]
      );
      versionId = rows[0].id;
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

    const row = await versionRow(versionId);
    await logAudit({
      actorId: req.user.id,
      entityType: 'collection',
      entityId: collectionId,
      action: 'create_version',
      detail: { versionId, versionNumber: row.version_number, label: versionLabel },
      ip: req.ip,
    });
    res.status(201).json({ version: serializeVersionMeta(row) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

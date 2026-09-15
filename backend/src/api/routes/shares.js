'use strict';

// ============================================================================
// Login-gated read-only share links.
//
//   POST   /api/shares                     { itemType, itemId } (EDITOR+)
//   POST   /api/requests/:requestId/share  (back-compat wrapper)
//   GET    /api/shares/:token              (any authenticated user)
//   GET    /api/shares/:token/revisions    (request shares only)
//   DELETE /api/shares/:token              (owner or EDITOR+)
//
// A share exposes a redacted snapshot of the item to any signed-in user
// holding the token. Viewing never requires a paid plan and does not require
// sharing an organization/workspace with the owner. Anonymous visitors get
// 401 and are sent to the login screen by the web client.
// ============================================================================

const crypto = require('crypto');
const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, getProjectAccess, getWorkspaceRole, roleAtLeast } = require('../access');
const { logAudit } = require('../audit');
const { checkPublicSharingGate, orgOfProject } = require('../entitlements');
const { redactSnapshot, redactRequestRecord } = require('../redact');

const router = Router();

const ITEM_TYPES = ['request', 'folder', 'collection', 'project', 'workspace'];

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

// Resolve an item's name + owning project/workspace for access checks.
async function itemContext(itemType, itemId) {
  let sql;
  switch (itemType) {
    case 'request':
      sql = `SELECT ar.name, c.project_id, p.workspace_id
               FROM api_requests ar
               JOIN collections c ON c.id = ar.collection_id
               JOIN projects p ON p.id = c.project_id
              WHERE ar.id = $1`;
      break;
    case 'folder':
      sql = `SELECT f.name, c.project_id, p.workspace_id
               FROM folders f
               JOIN collections c ON c.id = f.collection_id
               JOIN projects p ON p.id = c.project_id
              WHERE f.id = $1`;
      break;
    case 'collection':
      sql = `SELECT c.name, c.project_id, p.workspace_id
               FROM collections c
               JOIN projects p ON p.id = c.project_id
              WHERE c.id = $1`;
      break;
    case 'project':
      sql = `SELECT p.name, p.id AS project_id, p.workspace_id FROM projects p WHERE p.id = $1`;
      break;
    case 'workspace':
      sql = `SELECT w.name, NULL::uuid AS project_id, w.id AS workspace_id FROM workspaces w WHERE w.id = $1`;
      break;
    default:
      return null;
  }
  const { rows } = await query(sql, [itemId]);
  return rows[0] || null;
}

async function canShareItem(user, ctx) {
  if (ctx.project_id) {
    const access = await getProjectAccess(user.id, ctx.project_id);
    return Boolean(access && roleAtLeast(access.level, 'EDITOR'));
  }
  if (user.role === 'ADMIN') return true;
  const role = await getWorkspaceRole(user.id, ctx.workspace_id);
  return Boolean(role && roleAtLeast(role, 'EDITOR'));
}

async function orgOfItem(ctx) {
  if (ctx.project_id) return orgOfProject(ctx.project_id);
  const { rows } = await query(`SELECT organization_id FROM workspaces WHERE id = $1`, [
    ctx.workspace_id,
  ]);
  return rows[0]?.organization_id ?? null;
}

// ---------------------------------------------------------------- Create
async function createShare(req, res, next, itemType, itemId) {
  try {
    if (!ITEM_TYPES.includes(itemType)) {
      return res
        .status(400)
        .json({ error: 'itemType must be one of: request, folder, collection, project, workspace' });
    }
    if (!itemId) return res.status(400).json({ error: 'itemId is required' });

    const ctx = await itemContext(itemType, itemId);
    if (!ctx) return res.status(404).json({ error: 'Item not found' });
    if (!(await canShareItem(req.user, ctx))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }

    let { rows } = await query(
      `SELECT token, created_at FROM item_shares WHERE item_type = $1 AND item_id = $2`,
      [itemType, itemId]
    );
    let share = rows[0];
    if (!share) {
      // Plan gate still applies to *creating* links; viewing them is free.
      const gate = await checkPublicSharingGate({ userId: req.user.id, orgId: await orgOfItem(ctx) });
      if (gate) return res.status(403).json(gate);
      // Upsert on the natural key: a concurrent create (e.g. React StrictMode's
      // double effect) races the SELECT above, so settle any conflict instead of
      // surfacing a duplicate-key 500. DO NOTHING returns no row on conflict, so
      // re-read the winner's token.
      const inserted = await query(
        `INSERT INTO item_shares (item_type, item_id, token, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (item_type, item_id) DO NOTHING
         RETURNING token, created_at`,
        [itemType, itemId, crypto.randomUUID(), req.user.id]
      );
      if (inserted.rows[0]) {
        share = inserted.rows[0];
        await logAudit({
          actorId: req.user.id,
          entityType: itemType,
          entityId: itemId,
          action: 'share_item',
          detail: { itemType, shareId: share.token },
          ip: req.ip,
        });
      } else {
        ({ rows } = await query(
          `SELECT token, created_at FROM item_shares WHERE item_type = $1 AND item_id = $2`,
          [itemType, itemId]
        ));
        share = rows[0];
      }
    }

    res.status(201).json({
      share: { token: share.token, createdAt: share.created_at, itemType },
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/shares — create (or return) a share link for any item.
router.post('/shares', requireAuth, (req, res, next) => {
  const { itemType, itemId } = req.body || {};
  return createShare(req, res, next, itemType, itemId);
});

// Back-compat: request share links were previously minted here.
router.post('/requests/:requestId/share', requireAuth, (req, res, next) =>
  createShare(req, res, next, 'request', req.params.requestId)
);

// ------------------------------------------------------------- Resolution
async function resolveShare(token) {
  const { rows } = await query(
    `SELECT item_type, item_id, created_at, created_by FROM item_shares WHERE token = $1`,
    [token]
  );
  if (rows[0]) return rows[0];
  // Legacy tokens written before item_shares existed.
  const legacy = await query(
    `SELECT request_id, created_at, created_by FROM request_shares WHERE token = $1`,
    [token]
  );
  if (legacy.rows[0]) {
    return {
      item_type: 'request',
      item_id: legacy.rows[0].request_id,
      created_at: legacy.rows[0].created_at,
      created_by: legacy.rows[0].created_by,
    };
  }
  return null;
}

// ------------------------------------------------------------------ Read
async function requestSharePayload(token, requestId, createdAt) {
  const { rows } = await query(
    `SELECT ar.id AS request_id, ar.name, ar.method, ar.url,
            ar.headers, ar.query_params, ar.body_type, ar.body_json, ar.body_text, ar.body_parts, ar.api_type
       FROM api_requests ar
      WHERE ar.id = $1`,
    [requestId]
  );
  const share = rows[0];
  if (!share) return null;

  const { rows: runs } = await query(
    `SELECT status, response_snapshot, started_at, finished_at
       FROM run_history
      WHERE request_id = $1
      ORDER BY started_at DESC
      LIMIT 1`,
    [requestId]
  );
  const lastRun = runs[0] || null;
  let lastRunPayload = null;
  if (lastRun && lastRun.response_snapshot) {
    lastRunPayload = redactSnapshot(lastRun.response_snapshot, {});
  }
  if (lastRunPayload) lastRunPayload.startedAt = lastRun.started_at;

  const safeRequest = redactRequestRecord(
    {
      id: share.request_id,
      name: share.name,
      method: share.method,
      url: share.url,
      headers: share.headers,
      query_params: share.query_params || [],
      body_type: share.body_type,
      body_json: share.body_json ?? null,
      body_text: share.body_text ?? null,
      body_parts: share.body_parts || [],
      api_type: share.api_type,
    },
    {}
  );

  return {
    token,
    createdAt,
    itemType: 'request',
    request: {
      id: safeRequest.id,
      name: safeRequest.name,
      method: safeRequest.method,
      url: safeRequest.url,
      headers: safeRequest.headers || [],
      queryParams: safeRequest.query_params || [],
      bodyType: safeRequest.body_type,
      bodyJson: safeRequest.body_json ?? null,
      bodyText: safeRequest.body_text ?? null,
      bodyParts: Array.isArray(safeRequest.body_parts) ? safeRequest.body_parts : [],
      apiType: safeRequest.api_type,
    },
    lastRun: lastRunPayload,
  };
}

function redactTreeRequest(r) {
  const safe = redactRequestRecord(r, {});
  return {
    id: safe.id,
    name: safe.name,
    method: safe.method,
    url: safe.url,
    apiType: safe.api_type,
    headers: safe.headers || [],
    queryParams: safe.query_params || [],
    bodyType: safe.body_type,
    bodyJson: safe.body_json ?? null,
    bodyText: safe.body_text ?? null,
    bodyParts: Array.isArray(safe.body_parts) ? safe.body_parts : [],
  };
}

// Build a read-only collection/folder/request tree scoped to the shared item.
async function buildItemTree(itemType, itemId) {
  let projectIds = [];
  let collectionFilter = null;
  let folderRoot = null;

  if (itemType === 'workspace') {
    projectIds = (await query(`SELECT id FROM projects WHERE workspace_id = $1 ORDER BY name`, [itemId])).rows.map((r) => r.id);
  } else if (itemType === 'project') {
    projectIds = [itemId];
  } else if (itemType === 'collection') {
    collectionFilter = itemId;
    const c = (await query(`SELECT project_id FROM collections WHERE id = $1`, [itemId])).rows[0];
    projectIds = c ? [c.project_id] : [];
  } else if (itemType === 'folder') {
    folderRoot = itemId;
    const c = (await query(`SELECT collection_id FROM folders WHERE id = $1`, [itemId])).rows[0];
    if (c) {
      collectionFilter = c.collection_id;
      const p = (await query(`SELECT project_id FROM collections WHERE id = $1`, [c.collection_id])).rows[0];
      projectIds = p ? [p.project_id] : [];
    }
  }

  const projects = projectIds.length
    ? (await query(`SELECT id, name FROM projects WHERE id = ANY($1::uuid[]) ORDER BY name`, [projectIds])).rows
    : [];

  let collections = [];
  if (projectIds.length) {
    collections = (
      await query(
        `SELECT id, name, project_id FROM collections
          WHERE project_id = ANY($1::uuid[]) ${collectionFilter ? 'AND id = $2' : ''}
          ORDER BY name`,
        collectionFilter ? [projectIds, collectionFilter] : [projectIds]
      )
    ).rows;
  }
  const collectionIds = collections.map((c) => c.id);

  let folders = [];
  let requests = [];
  if (collectionIds.length) {
    folders = (
      await query(
        `SELECT id, name, collection_id, parent_id FROM folders
          WHERE collection_id = ANY($1::uuid[]) ORDER BY name`,
        [collectionIds]
      )
    ).rows;
    requests = (
      await query(
        `SELECT id, name, method, url, api_type, headers, query_params, body_type,
                body_json, body_text, body_parts, folder_id, collection_id
           FROM api_requests WHERE collection_id = ANY($1::uuid[]) ORDER BY name`,
        [collectionIds]
      )
    ).rows;
  }

  if (folderRoot) {
    const subtree = new Set([folderRoot]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of folders) {
        if (f.parent_id && subtree.has(f.parent_id) && !subtree.has(f.id)) {
          subtree.add(f.id);
          changed = true;
        }
      }
    }
    folders = folders.filter((f) => subtree.has(f.id));
    requests = requests.filter((r) => r.folder_id && subtree.has(r.folder_id));
  }

  const requestsByFolder = new Map();
  const rootRequestsByCollection = new Map();
  for (const r of requests) {
    const bucket = r.folder_id ? requestsByFolder : rootRequestsByCollection;
    const key = r.folder_id || r.collection_id;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key).push(redactTreeRequest(r));
  }

  const foldersByParent = new Map();
  for (const f of folders) {
    const key = `${f.collection_id}:${f.parent_id || 'root'}`;
    if (!foldersByParent.has(key)) foldersByParent.set(key, []);
    foldersByParent.get(key).push(f);
  }
  const folderNode = (f) => ({
    type: 'folder',
    id: f.id,
    name: f.name,
    folders: (foldersByParent.get(`${f.collection_id}:${f.id}`) || []).map(folderNode),
    requests: requestsByFolder.get(f.id) || [],
  });

  const collectionsByProject = new Map();
  for (const c of collections) {
    if (!collectionsByProject.has(c.project_id)) collectionsByProject.set(c.project_id, []);
    collectionsByProject.get(c.project_id).push({
      id: c.id,
      name: c.name,
      folders: (foldersByParent.get(`${c.id}:root`) || []).map(folderNode),
      requests: rootRequestsByCollection.get(c.id) || [],
    });
  }

  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    collections: collectionsByProject.get(p.id) || [],
  }));
}

async function itemSharePayload(share) {
  const ctx = await itemContext(share.item_type, share.item_id);
  if (!ctx) return null;
  const projects = await buildItemTree(share.item_type, share.item_id);
  return {
    token: share.token,
    createdAt: share.created_at,
    itemType: share.item_type,
    item: {
      type: share.item_type,
      id: share.item_id,
      name: ctx.name,
      projects,
    },
  };
}

// GET /api/shares/:token — authenticated (login required), plan-free.
router.get('/shares/:token', requireAuth, async (req, res, next) => {
  try {
    const token = req.params.token;
    const share = await resolveShare(token);
    if (!share) return res.status(404).json({ error: 'Share link not found' });

    if (share.item_type === 'request') {
      const payload = await requestSharePayload(token, share.item_id, share.created_at);
      if (!payload) return res.status(404).json({ error: 'Share link not found' });
      return res.json({ share: payload });
    }
    const payload = await itemSharePayload({ ...share, token });
    if (!payload) return res.status(404).json({ error: 'Share link not found' });
    return res.json({ share: payload });
  } catch (err) {
    next(err);
  }
});

// GET /api/shares/:token/revisions — request change history for a share.
router.get('/shares/:token/revisions', requireAuth, async (req, res, next) => {
  try {
    const share = await resolveShare(req.params.token);
    if (!share) return res.status(404).json({ error: 'Share link not found' });
    if (share.item_type !== 'request') return res.json({ revisions: [] });
    const { rows } = await query(
      `${REVISION_META_SQL} WHERE r.request_id = $1 ORDER BY r.revision_number DESC`,
      [share.item_id]
    );
    res.json({ revisions: rows.map(serializeRevisionMeta) });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Revoke
router.delete('/shares/:token', requireAuth, async (req, res, next) => {
  try {
    const token = req.params.token;
    const share = await resolveShare(token);
    if (!share) return res.status(404).json({ error: 'Share link not found' });

    const ctx = await itemContext(share.item_type, share.item_id);
    const isAdmin = req.user.role === 'ADMIN';
    const isOwner = share.created_by === req.user.id;
    if (!isAdmin && !isOwner && !(ctx && (await canShareItem(req.user, ctx)))) {
      return res.status(403).json({ error: 'Only the owner or an editor can revoke this link' });
    }

    await query(`DELETE FROM item_shares WHERE token = $1`, [token]);
    await query(`DELETE FROM request_shares WHERE token = $1`, [token]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

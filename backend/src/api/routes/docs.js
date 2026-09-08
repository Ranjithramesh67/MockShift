'use strict';

// ============================================================================
// Docs — a Confluence-style documentation feature for a workspace (and,
// optionally, one of its projects). Also hosts the workspace-access-request
// flow (request access -> admin approves/denies -> requester becomes a VIEWER).
//
// Mount point (coordinator seam in backend/src/api/server.js):
//   app.use('/api/docs', require('./routes/docs'));
//
// Access model mirrors access.js:
//   read    -> canReadWorkspace(workspaceId) OR platform MANAGER/ADMIN
//   edit    -> page author OR workspace role >= EDITOR OR platform
//              MANAGER/ADMIN  ("canEdit")
//   delete  -> page author OR workspace role >= ADMIN OR platform
//              MANAGER/ADMIN
//   review workspace-access-requests -> workspace role >= ADMIN OR platform
//              MANAGER/ADMIN
//
// Page bodies are a flat position-ordered block list; PUT /docs/:pageId/blocks
// replaces the whole list (positions reassigned 0..n-1 server-side). Blocks
// the client references by id but that are not children of the page are
// pruned rather than created.
// ============================================================================

const { Router } = require('express');
const { query, pool } = require('../db');
const {
  requireAuth,
  roleAtLeast,
  getWorkspaceRole,
  getProjectAccess,
  canReadWorkspace,
} = require('../access');
const { logAudit } = require('../audit');

const router = Router();
router.use(requireAuth);

// Workspace-access-request routes live on their own sub-router mounted at
// /workspace-access-requests so the single-segment routes (:pageId, ...) can
// never shadow them regardless of declaration order.
const accessRequestRouter = Router();
accessRequestRouter.use(requireAuth);

// Mount before any single-segment page route (:pageId) so these dedicated
// paths can never be shadowed by a page lookup.
router.use('/workspace-access-requests', accessRequestRouter);

const BLOCK_TYPES = ['heading', 'text', 'code', 'payload', 'response', 'schema', 'list'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Platform MANAGER/ADMIN users act as workspace admins everywhere.
function isGlobalHigh(user) {
  return Boolean(user) && roleAtLeast(user.role, 'MANAGER');
}

// Effective workspace access for the caller:
//   { role: 'ADMIN'|'MANAGER'|'EDITOR'|'VIEWER'|null, readable: boolean }
// readable follows access.js canReadWorkspace (direct/team/org-admin
// membership, PUBLIC visibility within an org, project grants) or the platform
// MANAGER/ADMIN bypass.
async function workspaceAccessFor(user, workspaceId) {
  if (isGlobalHigh(user)) return { role: 'ADMIN', readable: true };
  const role = await getWorkspaceRole(user.id, workspaceId);
  const readable = Boolean(role) || (await canReadWorkspace(user.id, workspaceId));
  return { role, readable };
}

async function pageRow(pageId) {
  const { rows } = await query(
    `SELECT p.id, p.workspace_id, p.project_id, p.title, p.created_by, p.updated_by,
            p.created_at, p.updated_at
       FROM doc_pages p WHERE p.id = $1`,
    [pageId]
  );
  return rows[0] || null;
}

// ----------------------------------------------------------- Serialization
// Page summary: {id,title,workspaceId,workspaceName,projectId,projectName,
// createdBy:{id,name},updatedBy:null|{id,name},createdAt,updatedAt,blockCount}
async function serializePageSummary(row) {
  const { rows } = await query(
    `SELECT w.name AS workspace_name, pr.name AS project_name,
            cb.name AS created_by_name, ub.name AS updated_by_name,
            (SELECT count(*)::int FROM doc_blocks db WHERE db.page_id = p.id) AS block_count
       FROM doc_pages p
       JOIN workspaces w ON w.id = p.workspace_id
       LEFT JOIN projects pr ON pr.id = p.project_id
       JOIN users cb ON cb.id = p.created_by
       LEFT JOIN users ub ON ub.id = p.updated_by
      WHERE p.id = $1`,
    [row.id]
  );
  const s = rows[0];
  return {
    id: row.id,
    title: row.title,
    workspaceId: row.workspace_id,
    workspaceName: s.workspace_name,
    projectId: row.project_id ?? null,
    projectName: s.project_name ?? null,
    createdBy: { id: row.created_by, name: s.created_by_name },
    updatedBy: row.updated_by ? { id: row.updated_by, name: s.updated_by_name } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    blockCount: s.block_count,
  };
}

// canEdit = author OR workspace role >= EDITOR OR platform MANAGER/ADMIN.
async function canEditPage(user, page) {
  if (page.created_by === user.id) return true;
  const access = await workspaceAccessFor(user, page.workspace_id);
  return roleAtLeast(access.role, 'EDITOR');
}

async function canDeletePage(user, page) {
  if (page.created_by === user.id) return true;
  const access = await workspaceAccessFor(user, page.workspace_id);
  return roleAtLeast(access.role, 'ADMIN');
}

// Mention: {id,type,refId,ref:{...}}. User refs resolve to {id,name,email};
// api refs to {id,name,method,collectionId,workspaceId,projectId,access:{read}}.
async function serializeMention(row, viewer) {
  const base = {
    id: row.id,
    type: row.mention_type,
    refId: row.ref_id,
  };
  if (row.mention_type === 'user') {
    const { rows } = await query(`SELECT id, name, email FROM users WHERE id = $1`, [row.ref_id]);
    const u = rows[0];
    return { ...base, ref: u ? { id: u.id, name: u.name, email: u.email } : { id: row.ref_id, name: null, email: null } };
  }
  const { rows } = await query(
    `SELECT ar.id, ar.name, ar.method, ar.collection_id, c.project_id, p.workspace_id
       FROM api_requests ar
       JOIN collections c ON c.id = ar.collection_id
       JOIN projects p ON p.id = c.project_id
      WHERE ar.id = $1`,
    [row.ref_id]
  );
  const api = rows[0];
  if (!api) return { ...base, ref: null };
  const access = await getProjectAccess(viewer.id, api.project_id);
  return {
    ...base,
    ref: {
      id: api.id,
      name: api.name,
      method: api.method,
      collectionId: api.collection_id,
      workspaceId: api.workspace_id,
      projectId: api.project_id,
      access: { read: Boolean(access) },
    },
  };
}

// ------------------------------------------------ Block content validation
// Each block_type requires its content keys; anything else is a 400.
function blockContentError(type, content) {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) {
    return 'content must be an object';
  }
  switch (type) {
    case 'heading':
    case 'text':
      if (typeof content.text !== 'string') return `${type} content requires text`;
      return null;
    case 'code':
      if (typeof content.language !== 'string') return 'code content requires language';
      if (typeof content.code !== 'string') return 'code content requires code';
      return null;
    case 'payload':
      if (typeof content.method !== 'string' || !('contentType' in content) || !('body' in content)) {
        return 'payload content requires method, contentType and body';
      }
      return null;
    case 'response':
      if (typeof content.status !== 'number' || !('body' in content)) {
        return 'response content requires status and body';
      }
      return null;
    case 'schema':
      if (typeof content.language !== 'string' || !('definition' in content)) {
        return 'schema content requires language and definition';
      }
      return null;
    case 'list':
      if (!['bullet', 'number'].includes(content.style)) {
        return 'list content style must be bullet or number';
      }
      if (!Array.isArray(content.items) || content.items.some((i) => typeof i !== 'string')) {
        return 'list content items must be an array of strings';
      }
      return null;
    default:
      return `block_type must be one of ${BLOCK_TYPES.join(', ')}`;
  }
}

async function notifyUser({ userId, title, body, kind }) {
  try {
    await query(
      `INSERT INTO notifications (user_id, title, body, kind) VALUES ($1, $2, $3, $4)`,
      [userId, title, body || null, kind || 'info']
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[docs] notification insert failed:', err.message);
  }
}

// ================================================================ Pages

// GET /docs?workspaceId=<uuid>[&projectId=<uuid>][&q=text] -> 200 {pages:[...]}
// Caller must be able to read the workspace.
router.get('/', async (req, res, next) => {
  try {
    const { workspaceId, projectId, q } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    if (!isUuid(workspaceId)) return res.status(400).json({ error: 'workspaceId must be a valid uuid' });
    if (projectId && !isUuid(projectId)) {
      return res.status(400).json({ error: 'projectId must be a valid uuid' });
    }
    const access = await workspaceAccessFor(req.user, workspaceId);
    if (!access.readable) return res.status(403).json({ error: 'No access to this workspace' });

    const { rows } = await query(
      `SELECT p.id, p.title, p.workspace_id, w.name AS workspace_name, p.project_id,
              pr.name AS project_name, p.created_by, cb.name AS created_by_name,
              p.updated_by, ub.name AS updated_by_name, p.created_at, p.updated_at,
              (SELECT count(*)::int FROM doc_blocks db WHERE db.page_id = p.id) AS block_count
         FROM doc_pages p
         JOIN workspaces w ON w.id = p.workspace_id
         LEFT JOIN projects pr ON pr.id = p.project_id
         JOIN users cb ON cb.id = p.created_by
         LEFT JOIN users ub ON ub.id = p.updated_by
        WHERE p.workspace_id = $1
          AND ($2::uuid IS NULL OR p.project_id = $2)
          AND ($3::text IS NULL OR p.title ILIKE '%' || $3 || '%')
        ORDER BY p.updated_at DESC`,
      [workspaceId, projectId || null, (q && String(q).trim()) || null]
    );
    const pages = rows.map((r) => ({
      id: r.id,
      title: r.title,
      workspaceId: r.workspace_id,
      workspaceName: r.workspace_name,
      projectId: r.project_id ?? null,
      projectName: r.project_name ?? null,
      createdBy: { id: r.created_by, name: r.created_by_name },
      updatedBy: r.updated_by ? { id: r.updated_by, name: r.updated_by_name } : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      blockCount: r.block_count,
    }));
    res.json({ pages });
  } catch (err) {
    next(err);
  }
});

// POST /docs {workspaceId, projectId?, title} -> 201 {page}
// Requires workspace read + role >= EDITOR. Auto-creates the leading heading
// block (content {text: title}).
router.post('/', async (req, res, next) => {
  try {
    const { workspaceId, projectId, title } = req.body || {};
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    if (!isUuid(workspaceId)) return res.status(400).json({ error: 'workspaceId must be a valid uuid' });
    const cleanTitle = title === undefined || title === null ? '' : String(title).trim();
    if (!cleanTitle) return res.status(400).json({ error: 'title is required' });

    const ws = await query(`SELECT id FROM workspaces WHERE id = $1`, [workspaceId]);
    if (ws.rows.length === 0) return res.status(404).json({ error: 'Workspace not found' });
    const access = await workspaceAccessFor(req.user, workspaceId);
    if (!access.readable) return res.status(403).json({ error: 'No access to this workspace' });
    if (!roleAtLeast(access.role, 'EDITOR')) {
      return res.status(403).json({ error: 'Editor or admin access required' });
    }

    let resolvedProjectId = null;
    if (projectId) {
      if (!isUuid(projectId)) return res.status(400).json({ error: 'projectId must be a valid uuid' });
      const proj = await query(`SELECT id FROM projects WHERE id = $1 AND workspace_id = $2`, [
        projectId,
        workspaceId,
      ]);
      if (proj.rows.length === 0) {
        return res.status(400).json({ error: 'Project does not belong to this workspace' });
      }
      resolvedProjectId = projectId;
    }

    const created = await query(
      `INSERT INTO doc_pages (workspace_id, project_id, title, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, workspace_id, project_id, title, created_by, updated_by, created_at, updated_at`,
      [workspaceId, resolvedProjectId, cleanTitle, req.user.id]
    );
    const page = created.rows[0];
    await query(
      `INSERT INTO doc_blocks (page_id, position, block_type, content) VALUES ($1, 0, 'heading', $2)`,
      [page.id, JSON.stringify({ text: cleanTitle })]
    );
    const summary = await serializePageSummary(page);
    res.status(201).json({ page: { ...summary, canEdit: true } });
  } catch (err) {
    next(err);
  }
});

// GET /docs/:pageId -> 200 {page:{...(summary),canEdit},blocks:[Block],mentions:[Mention]}
// 404 for unknown pages or when the caller cannot read the page's workspace.
router.get('/:pageId', async (req, res, next) => {
  try {
    const { pageId } = req.params;
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    const access = await workspaceAccessFor(req.user, page.workspace_id);
    if (!access.readable) return res.status(404).json({ error: 'Page not found' });

    const [summary, blocks, mentions] = await Promise.all([
      serializePageSummary(page),
      query(
        `SELECT id, position, block_type, content FROM doc_blocks
          WHERE page_id = $1 ORDER BY position`,
        [pageId]
      ),
      query(
        `SELECT id, page_id, mention_type, ref_id, created_by, created_at
           FROM doc_mentions WHERE page_id = $1 ORDER BY created_at, id`,
        [pageId]
      ),
    ]);
    const canEdit =
      page.created_by === req.user.id || roleAtLeast(access.role, 'EDITOR');
    const mentionList = [];
    for (const m of mentions.rows) mentionList.push(await serializeMention(m, req.user));
    res.json({
      page: { ...summary, canEdit },
      blocks: blocks.rows.map((b) => ({ id: b.id, position: b.position, type: b.block_type, content: b.content })),
      mentions: mentionList,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /docs/:pageId {title} -> 200 {page}. canEdit required.
router.put('/:pageId', async (req, res, next) => {
  try {
    const { pageId } = req.params;
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canEditPage(req.user, page))) {
      return res.status(403).json({ error: 'Editor or admin access required' });
    }
    const { title } = req.body || {};
    const cleanTitle = title === undefined || title === null ? '' : String(title).trim();
    if (!cleanTitle) return res.status(400).json({ error: 'title is required' });

    const updated = await query(
      `UPDATE doc_pages
          SET title = $1, updated_by = $2, updated_at = now()
        WHERE id = $3
        RETURNING id, workspace_id, project_id, title, created_by, updated_by, created_at, updated_at`,
      [cleanTitle, req.user.id, pageId]
    );
    const summary = await serializePageSummary(updated.rows[0]);
    res.json({ page: { ...summary, canEdit: true } });
  } catch (err) {
    next(err);
  }
});

// DELETE /docs/:pageId -> 204. Author OR workspace role >= ADMIN OR platform
// MANAGER/ADMIN.
router.delete('/:pageId', async (req, res, next) => {
  try {
    const { pageId } = req.params;
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canDeletePage(req.user, page))) {
      return res.status(403).json({ error: 'Workspace admin or author access required' });
    }
    await query(`DELETE FROM doc_pages WHERE id = $1`, [pageId]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- Blocks

// PUT /docs/:pageId/blocks {blocks:[{id:string|null,type,content}]} -> 200
// {blocks:[Block]}. canEdit required. The page's block list is replaced: blocks
// with a child id are updated in place, blocks without id are inserted,
// positions are reassigned 0..n-1, and any existing child not referenced is
// removed. Provided ids that are not children of the page are pruned.
router.put('/:pageId/blocks', async (req, res, next) => {
  let client = null;
  try {
    const { pageId } = req.params;
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canEditPage(req.user, page))) {
      return res.status(403).json({ error: 'Editor or admin access required' });
    }

    const incoming = (req.body || {}).blocks;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ error: 'blocks must be an array' });
    }

    // Validate every entry up front (a single malformed block rejects the call).
    const plan = [];
    for (const item of incoming) {
      if (item === null || typeof item !== 'object') {
        return res.status(400).json({ error: 'each block must be an object' });
      }
      const type = item.type;
      if (!BLOCK_TYPES.includes(type)) {
        return res.status(400).json({ error: `block_type must be one of ${BLOCK_TYPES.join(', ')}` });
      }
      const err = blockContentError(type, item.content);
      if (err) return res.status(400).json({ error: err });
      plan.push({ id: item.id && isUuid(item.id) ? item.id : null, type, content: item.content });
    }

    const { rows: existing } = await query(
      `SELECT id FROM doc_blocks WHERE page_id = $1`,
      [pageId]
    );
    const childIds = new Set(existing.map((b) => b.id));
    const usedChildIds = new Set();
    const kept = [];
    for (const item of plan) {
      if (item.id && childIds.has(item.id) && !usedChildIds.has(item.id)) {
        usedChildIds.add(item.id);
        kept.push({ op: 'update', id: item.id, type: item.type, content: item.content });
      } else if (item.id && childIds.has(item.id)) {
        // Duplicate reference to the same child block: pruned.
        continue;
      } else if (item.id) {
        // Reference to a block that is not a child of this page: pruned.
        continue;
      } else {
        kept.push({ op: 'insert', id: null, type: item.type, content: item.content });
      }
    }

    client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Move the retained children far out of the way first so the inserts
      // below can take low positions without tripping the (page_id, position)
      // unique constraint; the retained rows keep their ids for in-place
      // update. The +1e9 offset is unique-preserving because the source
      // positions were already unique.
      const keptChildIds = [...usedChildIds];
      if (keptChildIds.length > 0) {
        await client.query(
          `UPDATE doc_blocks SET position = position + 1000000000
            WHERE page_id = $1 AND id = ANY($2::uuid[])`,
          [pageId, keptChildIds]
        );
        await client.query(`DELETE FROM doc_blocks WHERE page_id = $1 AND id <> ALL($2::uuid[])`, [
          pageId,
          keptChildIds,
        ]);
      } else {
        await client.query(`DELETE FROM doc_blocks WHERE page_id = $1`, [pageId]);
      }
      let position = 0;
      for (const item of kept) {
        const content = JSON.stringify(item.content);
        if (item.op === 'update') {
          await client.query(
            `UPDATE doc_blocks SET position = $1, block_type = $2, content = $3
              WHERE id = $4 AND page_id = $5`,
            [position, item.type, content, item.id, pageId]
          );
        } else {
          await client.query(
            `INSERT INTO doc_blocks (page_id, position, block_type, content)
             VALUES ($1, $2, $3, $4)`,
            [pageId, position, item.type, content]
          );
        }
        position += 1;
      }
      await client.query(
        `UPDATE doc_pages SET updated_by = $1, updated_at = now() WHERE id = $2`,
        [req.user.id, pageId]
      );
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
      client = null;
    }

    const { rows } = await query(
      `SELECT id, position, block_type, content FROM doc_blocks
        WHERE page_id = $1 ORDER BY position`,
      [pageId]
    );
    res.json({ blocks: rows.map((b) => ({ id: b.id, position: b.position, type: b.block_type, content: b.content })) });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      client.release();
    }
    next(err);
  }
});

// --------------------------------------------------------------- Mentions

// POST /docs/:pageId/mentions {type:'user'|'api', refId} -> 201 {mention}.
// canEdit required. user: refId must hold a workspace_members row in the page's
// workspace; api: refId must be an api_requests row whose collection belongs to
// the page's workspace. Existing (page,type,refId) -> 409.
router.post('/:pageId/mentions', async (req, res, next) => {
  try {
    const { pageId } = req.params;
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canEditPage(req.user, page))) {
      return res.status(403).json({ error: 'Editor or admin access required' });
    }

    const { type, refId } = req.body || {};
    if (!['user', 'api'].includes(type)) {
      return res.status(400).json({ error: 'type must be user or api' });
    }
    if (!refId) return res.status(400).json({ error: 'refId is required' });

    const dup = await query(
      `SELECT id FROM doc_mentions WHERE page_id = $1 AND mention_type = $2 AND ref_id = $3`,
      [pageId, type, refId]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'This mention already exists on the page' });
    }

    if (type === 'user') {
      if (!isUuid(refId)) {
        return res.status(404).json({ error: 'User is not a member of this workspace' });
      }
      const member = await query(
        `SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
        [page.workspace_id, refId]
      );
      if (member.rows.length === 0) {
        return res.status(404).json({ error: 'User is not a member of this workspace' });
      }
    } else {
      if (!isUuid(refId)) {
        return res.status(404).json({ error: 'API request not found in this workspace' });
      }
      const api = await query(
        `SELECT ar.id FROM api_requests ar
           JOIN collections c ON c.id = ar.collection_id
           JOIN projects p ON p.id = c.project_id
          WHERE ar.id = $1 AND p.workspace_id = $2`,
        [refId, page.workspace_id]
      );
      if (api.rows.length === 0) {
        return res.status(404).json({ error: 'API request not found in this workspace' });
      }
    }

    const created = await query(
      `INSERT INTO doc_mentions (page_id, mention_type, ref_id, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, page_id, mention_type, ref_id, created_by, created_at`,
      [pageId, type, refId, req.user.id]
    );
    await query(`UPDATE doc_pages SET updated_by = $1, updated_at = now() WHERE id = $2`, [
      req.user.id,
      pageId,
    ]);
    const mention = await serializeMention(created.rows[0], req.user);
    res.status(201).json({ mention });
  } catch (err) {
    next(err);
  }
});

// DELETE /docs/:pageId/mentions/:mentionId -> 204. canEdit required; 404 unknown.
router.delete('/:pageId/mentions/:mentionId', async (req, res, next) => {
  try {
    const { pageId, mentionId } = req.params;
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canEditPage(req.user, page))) {
      return res.status(403).json({ error: 'Editor or admin access required' });
    }
    if (!isUuid(mentionId)) return res.status(404).json({ error: 'Mention not found' });
    const del = await query(
      `DELETE FROM doc_mentions WHERE id = $1 AND page_id = $2`,
      [mentionId, pageId]
    );
    if (del.rowCount === 0) return res.status(404).json({ error: 'Mention not found' });
    await query(`UPDATE doc_pages SET updated_by = $1, updated_at = now() WHERE id = $2`, [
      req.user.id,
      pageId,
    ]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ================================================= Workspace access requests

// Request: {id,workspaceId,workspaceName,requesterId,requester:{id,name,email},
// reason,status,requestedAt,reviewedBy:null|{id,name},reviewedAt}
async function serializeAccessRequest(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    requesterId: row.user_id,
    requester: { id: row.user_id, name: row.requester_name, email: row.requester_email },
    reason: row.reason ?? null,
    status: row.status,
    requestedAt: row.requested_at,
    reviewedBy: row.reviewed_by
      ? { id: row.reviewed_by, name: row.reviewer_name }
      : null,
    reviewedAt: row.reviewed_at ?? null,
  };
}

async function loadAccessRequest(id) {
  const { rows } = await query(
    `SELECT war.*, w.name AS workspace_name,
            ru.name AS requester_name, ru.email AS requester_email,
            rb.name AS reviewer_name
       FROM workspace_access_requests war
       JOIN workspaces w ON w.id = war.workspace_id
       JOIN users ru ON ru.id = war.user_id
       LEFT JOIN users rb ON rb.id = war.reviewed_by
      WHERE war.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// POST /workspace-access-requests {workspaceId, reason?} -> 201 {request}.
// Any authenticated user; 409 if already a member or a PENDING request exists;
// 404 if the workspace does not exist.
accessRequestRouter.post('/', async (req, res, next) => {
  try {
    const { workspaceId, reason } = req.body || {};
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    if (!isUuid(workspaceId)) return res.status(400).json({ error: 'workspaceId must be a valid uuid' });
    const ws = await query(`SELECT id FROM workspaces WHERE id = $1`, [workspaceId]);
    if (ws.rows.length === 0) return res.status(404).json({ error: 'Workspace not found' });

    const existingRole = await getWorkspaceRole(req.user.id, workspaceId);
    if (existingRole) {
      return res.status(409).json({ error: 'You already have access to this workspace' });
    }
    const pending = await query(
      `SELECT id FROM workspace_access_requests
        WHERE workspace_id = $1 AND user_id = $2 AND status = 'PENDING'`,
      [workspaceId, req.user.id]
    );
    if (pending.rows.length > 0) {
      return res.status(409).json({ error: 'You already have a pending request for this workspace' });
    }

    const created = await query(
      `INSERT INTO workspace_access_requests (workspace_id, user_id, reason)
       VALUES ($1, $2, $3) RETURNING id`,
      [workspaceId, req.user.id, reason ? String(reason) : null]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'workspace_access_request',
      entityId: created.rows[0].id,
      action: 'request_access',
      detail: { workspaceId },
      ip: req.ip,
    });
    const row = await loadAccessRequest(created.rows[0].id);
    res.status(201).json({ request: await serializeAccessRequest(row) });
  } catch (err) {
    next(err);
  }
});

// GET /workspace-access-requests?workspaceId=<uuid>[&mine=1][&status=PENDING]
// mine=1: the caller's own rows (with workspaceName). Otherwise the caller must
// be a workspace admin (or platform MANAGER/ADMIN) of the given workspace.
accessRequestRouter.get('/', async (req, res, next) => {
  try {
    const { workspaceId, mine, status } = req.query;
    const mineMode = mine === '1' || mine === 'true';
    if (status !== undefined && status !== '' && !['PENDING', 'APPROVED', 'DENIED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({ error: 'status must be PENDING, APPROVED, DENIED or CANCELLED' });
    }

    if (mineMode) {
      const { rows } = await query(
        `SELECT war.*, w.name AS workspace_name,
                ru.name AS requester_name, ru.email AS requester_email,
                rb.name AS reviewer_name
           FROM workspace_access_requests war
           JOIN workspaces w ON w.id = war.workspace_id
           JOIN users ru ON ru.id = war.user_id
           LEFT JOIN users rb ON rb.id = war.reviewed_by
          WHERE war.user_id = $1
            AND ($2::uuid IS NULL OR war.workspace_id = $2)
            AND ($3::text IS NULL OR war.status = $3)
          ORDER BY war.requested_at DESC`,
        [req.user.id, (workspaceId && isUuid(workspaceId) && workspaceId) || null, status || null]
      );
      const requests = [];
      for (const r of rows) requests.push(await serializeAccessRequest(r));
      return res.json({ requests });
    }

    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    if (!isUuid(workspaceId)) return res.status(400).json({ error: 'workspaceId must be a valid uuid' });
    const access = await workspaceAccessFor(req.user, workspaceId);
    if (!roleAtLeast(access.role, 'ADMIN')) {
      return res.status(403).json({ error: 'Workspace admin access required' });
    }
    const { rows } = await query(
      `SELECT war.*, w.name AS workspace_name,
              ru.name AS requester_name, ru.email AS requester_email,
              rb.name AS reviewer_name
         FROM workspace_access_requests war
         JOIN workspaces w ON w.id = war.workspace_id
         JOIN users ru ON ru.id = war.user_id
         LEFT JOIN users rb ON rb.id = war.reviewed_by
        WHERE war.workspace_id = $1
          AND ($2::text IS NULL OR war.status = $2)
        ORDER BY war.requested_at DESC`,
      [workspaceId, status || null]
    );
    const requests = [];
    for (const r of rows) requests.push(await serializeAccessRequest(r));
    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

// POST /workspace-access-requests/:id/review {approve:boolean} -> 200
// {ok:true,status}. Reviewer gate = workspace role >= ADMIN (or platform
// MANAGER/ADMIN). 404 unknown; 409 not PENDING. Approve grants a VIEWER
// membership; both outcomes notify the requester and are audited.
accessRequestRouter.post('/:id/review', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { approve } = req.body || {};
    if (typeof approve !== 'boolean') {
      return res.status(400).json({ error: 'approve must be a boolean' });
    }
    if (!isUuid(id)) return res.status(404).json({ error: 'Access request not found' });
    const request = await loadAccessRequest(id);
    if (!request) return res.status(404).json({ error: 'Access request not found' });
    const access = await workspaceAccessFor(req.user, request.workspace_id);
    if (!roleAtLeast(access.role, 'ADMIN')) {
      return res.status(403).json({ error: 'Workspace admin access required' });
    }
    if (request.status !== 'PENDING') {
      return res.status(409).json({ error: 'This request has already been reviewed' });
    }

    const status = approve ? 'APPROVED' : 'DENIED';
    await query(
      `UPDATE workspace_access_requests
          SET status = $1, reviewed_by = $2, reviewed_at = now()
        WHERE id = $3`,
      [status, req.user.id, id]
    );
    if (approve) {
      await query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, granted_by)
         VALUES ($1, $2, 'VIEWER', $3)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [request.workspace_id, request.user_id, req.user.id]
      );
      await notifyUser({
        userId: request.user_id,
        title: 'Workspace access granted',
        body: `Your request to join "${request.workspace_name}" was approved.`,
        kind: 'success',
      });
      await logAudit({
        actorId: req.user.id,
        entityType: 'workspace_access_request',
        entityId: id,
        action: 'approve',
        detail: { workspaceId: request.workspace_id, userId: request.user_id },
        ip: req.ip,
      });
    } else {
      await notifyUser({
        userId: request.user_id,
        title: 'Workspace access denied',
        body: `Your request to join "${request.workspace_name}" was declined.`,
        kind: 'info',
      });
      await logAudit({
        actorId: req.user.id,
        entityType: 'workspace_access_request',
        entityId: id,
        action: 'deny',
        detail: { workspaceId: request.workspace_id, userId: request.user_id },
        ip: req.ip,
      });
    }
    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

// POST /workspace-access-requests/:id/cancel -> 200 {ok:true}. Creator only
// while PENDING (404 otherwise / 409 if not PENDING).
accessRequestRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Access request not found' });
    const request = await loadAccessRequest(id);
    if (!request || request.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Access request not found' });
    }
    if (request.status !== 'PENDING') {
      return res.status(409).json({ error: 'Only pending requests can be cancelled' });
    }
    await query(`UPDATE workspace_access_requests SET status = 'CANCELLED' WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

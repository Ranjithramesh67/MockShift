'use strict';

const { Router } = require('express');
const { query, pool } = require('../db');
const { requireAuth, roleAtLeast, getProjectAccess, canReadWorkspace } = require('../access');
const { runRequest, runInMemoryRequest, runTokenRequest } = require('../runner');
const { normalizeProvider, resolveAuthHeader } = require('../authToken');
const { fireWorkflowEvent } = require('../workflowService');

const router = Router();
router.use(requireAuth);

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const BODY_TYPES = ['NONE', 'JSON', 'FORM_URLENCODED', 'MULTIPART', 'RAW_TEXT', 'GRAPHQL'];
const API_TYPES = ['REST', 'SOAP', 'GRAPHQL', 'AUTH'];

async function workspaceOfCollection(collectionId) {
  const { rows } = await query(
    `SELECT p.workspace_id FROM collections c JOIN projects p ON p.id = c.project_id WHERE c.id = $1`,
    [collectionId]
  );
  return rows[0]?.workspace_id || null;
}

async function projectOfCollection(collectionId) {
  const { rows } = await query(
    `SELECT project_id FROM collections WHERE id = $1`,
    [collectionId]
  );
  return rows[0]?.project_id || null;
}

async function projectOfRequest(requestId) {
  const { rows } = await query(
    `SELECT c.project_id FROM api_requests ar
       JOIN collections c ON c.id = ar.collection_id
      WHERE ar.id = $1`,
    [requestId]
  );
  return rows[0]?.project_id || null;
}

async function collectionOfFolder(folderId) {
  const { rows } = await query(`SELECT collection_id FROM folders WHERE id = $1`, [folderId]);
  return rows[0]?.collection_id || null;
}

async function projectOfFolder(folderId) {
  const { rows } = await query(
    `SELECT c.project_id FROM folders f
       JOIN collections c ON c.id = f.collection_id
      WHERE f.id = $1`,
    [folderId]
  );
  return rows[0]?.project_id || null;
}

// Fire event-driven automations after a request run: ON_REQUEST on any run,
// ON_RUN_FAILURE when the run itself failed. Best-effort, never throws.
async function fireRequestRunEvents(requestId, projectId, result) {
  if (!projectId || !result) return;
  try {
    const context = {
      runId: result.runId,
      httpStatus: result.httpStatus,
      method: result.requestSnapshot?.method,
      url: result.requestSnapshot?.url,
    };
    await fireWorkflowEvent({
      type: 'ON_REQUEST',
      projectId,
      requestId,
      runId: result.runId,
      status: result.runStatus,
      context,
    });
    if (result.runStatus === 'FAILED') {
      await fireWorkflowEvent({
        type: 'ON_RUN_FAILURE',
        projectId,
        requestId,
        runId: result.runId,
        status: result.runStatus,
        context,
      });
    }
  } catch (err) {
    // Best-effort; never break the run response.
    // eslint-disable-next-line no-console
    console.error('[content] fireRequestRunEvents failed:', err.message);
  }
}

// True when the user can edit content inside a project: workspace editors
// and above, plus project managers and approved project members with
// EDITOR+ roles.
async function canWriteProjectContent(userId, projectId) {
  const access = await getProjectAccess(userId, projectId);
  return Boolean(access && roleAtLeast(access.level, 'EDITOR'));
}

// True when the user can read content inside a project.
async function canReadProjectContent(userId, projectId) {
  return Boolean(await getProjectAccess(userId, projectId));
}

async function requireCollectionWrite(req, res, next) {
  try {
    const collectionId = req.params.collectionId || req.body.collectionId;
    const projectId = await projectOfCollection(collectionId);
    if (!projectId) return res.status(404).json({ error: 'Collection not found' });
    if (!(await canWriteProjectContent(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const ws = await workspaceOfCollection(collectionId);
    if (ws) req.workspaceId = ws;
    req.projectId = projectId;
    next();
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------- Tree
router.get('/workspaces/:workspaceId/content', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    if (!(await canReadWorkspace(req.user.id, workspaceId))) {
      return res.status(403).json({ error: 'No access to this workspace' });
    }
    const { rows: projects } = await query(
      `SELECT id, name FROM projects WHERE workspace_id = $1 ORDER BY name`,
      [workspaceId]
    );
    const accessByProject = new Map();
    await Promise.all(
      projects.map(async (p) => {
        const [access, requests] = await Promise.all([
          getProjectAccess(req.user.id, p.id),
          query(
            `SELECT status FROM access_requests WHERE project_id = $1 AND user_id = $2`,
            [p.id, req.user.id]
          ),
        ]);
        accessByProject.set(p.id, {
          can_access: !!access,
          access_status: requests.rows[0]?.status ?? null,
        });
      })
    );
    const projectsWithAccess = projects.map((p) => ({
      ...p,
      can_access: accessByProject.get(p.id)?.can_access ?? false,
      access_status: accessByProject.get(p.id)?.access_status ?? null,
    }));
    const accessibleProjectIds = projectsWithAccess
      .filter((p) => p.can_access)
      .map((p) => p.id);
    let collections = [];
    let folders = [];
    let requests = [];
    if (accessibleProjectIds.length) {
      collections = (await query(
        `SELECT c.id, c.name, c.project_id,
                (SELECT ap.auth_type FROM auth_providers ap WHERE ap.collection_id = c.id) AS has_auth
           FROM collections c WHERE c.project_id = ANY($1::uuid[]) ORDER BY c.name`,
        [accessibleProjectIds]
      )).rows;
      const collectionIds = collections.map((c) => c.id);
      if (collectionIds.length) {
        folders = (await query(
          `SELECT id, name, collection_id, parent_id
             FROM folders WHERE collection_id = ANY($1::uuid[])
            ORDER BY name`,
          [collectionIds]
        )).rows;
        requests = (await query(
          `SELECT id, name, method, url, api_type, collection_id, folder_id
             FROM api_requests WHERE collection_id = ANY($1::uuid[]) ORDER BY name`,
          [collectionIds]
        )).rows;
      }
    }
    res.json({ workspaceId, projects: projectsWithAccess, collections, folders, requests });
  } catch (err) {
    next(err);
  }
});

router.post('/collections', async (req, res, next) => {
  try {
    const { projectId, name } = req.body || {};
    if (!projectId || !name) return res.status(400).json({ error: 'projectId and name are required' });
    if (!(await canWriteProjectContent(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const { rows } = await query(
      `INSERT INTO collections (project_id, name) VALUES ($1, $2) RETURNING id, name, project_id`,
      [projectId, String(name).trim()]
    );
    res.status(201).json({ collection: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- Folders
router.post('/folders', async (req, res, next) => {
  try {
    const { collectionId, name, parentId } = req.body || {};
    if (!collectionId || !name) return res.status(400).json({ error: 'collectionId and name are required' });
    const projectId = await projectOfCollection(collectionId);
    if (!projectId) return res.status(404).json({ error: 'Collection not found' });
    if (!(await canWriteProjectContent(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    if (parentId) {
      const parentCollection = await collectionOfFolder(parentId);
      if (parentCollection !== collectionId) {
        return res.status(400).json({ error: 'Parent folder must belong to the same collection' });
      }
    }
    const { rows } = await query(
      `INSERT INTO folders (collection_id, name, parent_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, collection_id, parent_id`,
      [collectionId, String(name).trim(), parentId || null]
    );
    res.status(201).json({ folder: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.put('/folders/:folderId', async (req, res, next) => {
  try {
    const { folderId } = req.params;
    const existing = await query(
      `SELECT collection_id FROM folders WHERE id = $1`,
      [folderId]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Folder not found' });
    const projectId = await projectOfFolder(folderId);
    if (!(await canWriteProjectContent(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }

    const b = req.body || {};
    const sets = [];
    const params = [folderId];
    if (b.name !== undefined) {
      params.push(String(b.name).trim());
      sets.push(`name = $${params.length}`);
    }
    if (b.parentId !== undefined) {
      const newParentId = b.parentId || null;
      if (newParentId === folderId) {
        return res.status(400).json({ error: 'A folder cannot be its own parent' });
      }
      if (newParentId) {
        const parentCollection = await collectionOfFolder(newParentId);
        if (parentCollection !== existing.rows[0].collection_id) {
          return res.status(400).json({ error: 'Parent folder must belong to the same collection' });
        }
        // Cycle guard: walk ancestors of the new parent.
        let cursor = newParentId;
        let guard = 0;
        while (cursor && guard < 1000) {
          if (cursor === folderId) {
            return res.status(400).json({ error: 'Cannot move a folder inside itself or its descendants' });
          }
          const parent = await query(`SELECT parent_id FROM folders WHERE id = $1`, [cursor]);
          cursor = parent.rows[0]?.parent_id || null;
          guard += 1;
        }
      }
      params.push(newParentId);
      sets.push(`parent_id = $${params.length}`);
    }
    if (sets.length) {
      await query(`UPDATE folders SET ${sets.join(', ')} WHERE id = $1`, params);
    }
    const fresh = await query(
      `SELECT id, name, collection_id, parent_id FROM folders WHERE id = $1`,
      [folderId]
    );
    res.json({ folder: fresh.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/folders/:folderId', async (req, res, next) => {
  try {
    const { folderId } = req.params;
    const existing = await query(`SELECT id FROM folders WHERE id = $1`, [folderId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Folder not found' });
    const projectId = await projectOfFolder(folderId);
    if (!(await canWriteProjectContent(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    // ON DELETE CASCADE removes nested sub-folders; requests in the folder
    // are un-folder'd (folder_id SET NULL) so nothing is lost.
    await query(`DELETE FROM folders WHERE id = $1`, [folderId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Deep-copy a folder and its whole subtree (nested folders + requests),
// re-parenting the copies to the NEW copied folder ids.
router.post('/folders/:folderId/duplicate', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { folderId } = req.params;
    const { rows: sourceRows } = await query(
      `SELECT id, name, collection_id, parent_id FROM folders WHERE id = $1`,
      [folderId]
    );
    const source = sourceRows[0];
    if (!source) return res.status(404).json({ error: 'Folder not found' });
    const projectId = await projectOfFolder(folderId);
    if (!(await canWriteProjectContent(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }

    // Collect the whole subtree from the folders table (self-reference).
    const { rows: allFolders } = await query(
      `SELECT id, name, collection_id, parent_id FROM folders WHERE collection_id = $1`,
      [source.collection_id]
    );
    const byParent = new Map();
    for (const f of allFolders) {
      const key = f.parent_id || null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(f);
    }
    const subtree = [];
    const seen = new Set([source.id]);
    const queue = [source];
    while (queue.length) {
      const current = queue.shift();
      subtree.push(current);
      for (const child of byParent.get(current.id) || []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        queue.push(child);
      }
    }

    await client.query('BEGIN');
    const idMap = new Map();
    const createdFolders = [];
    for (const folder of subtree) {
      const newParentId = folder.id === source.id ? source.parent_id : idMap.get(folder.parent_id) || null;
      const { rows } = await client.query(
        `INSERT INTO folders (collection_id, name, parent_id)
         VALUES ($1, $2, $3)
         RETURNING id, name, collection_id, parent_id`,
        [folder.collection_id, folder.name, newParentId]
      );
      idMap.set(folder.id, rows[0].id);
      createdFolders.push(rows[0]);
    }

    const { rows: folderRequests } = await client.query(
      `SELECT id, collection_id, name, method, url, headers, query_params, body_type, body_json,
              body_text, api_type, formula, assertions, folder_id
         FROM api_requests WHERE folder_id = ANY($1::uuid[])`,
      [[...seen]]
    );
    const createdRequests = [];
    for (const r of folderRequests) {
      const { rows } = await client.query(
        `INSERT INTO api_requests
           (collection_id, name, method, url, api_type, headers, query_params, body_type,
            body_json, body_text, formula, assertions, folder_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, name, method, url, api_type, collection_id, folder_id`,
        [
          r.collection_id,
          r.name,
          r.method,
          r.url,
          r.api_type,
          JSON.stringify(r.headers || []),
          JSON.stringify(r.query_params || []),
          r.body_type,
          r.body_json,
          r.body_text,
          r.formula,
          JSON.stringify(r.assertions || []),
          idMap.get(r.folder_id) || null,
        ]
      );
      createdRequests.push(rows[0]);
    }

    await client.query('COMMIT');
    res.status(201).json({ folders: createdFolders, requests: createdRequests });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    next(err);
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------- Requests
router.post('/requests', async (req, res, next) => {
  try {
    const { collectionId, name, method, url, apiType, folderId } = req.body || {};
    if (!collectionId || !name) return res.status(400).json({ error: 'collectionId and name are required' });
    const projectId = await projectOfCollection(collectionId);
    if (!projectId) return res.status(404).json({ error: 'Collection not found' });
    if (!(await canWriteProjectContent(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    if (folderId && (await collectionOfFolder(folderId)) !== collectionId) {
      return res.status(400).json({ error: 'Folder must belong to the same collection as the request' });
    }

    const { rows } = await query(
      `INSERT INTO api_requests
         (collection_id, name, method, url, api_type, headers, query_params, body_type, assertions, folder_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, method, url, api_type, collection_id, folder_id`,
      [
        collectionId,
        String(name).trim(),
        HTTP_METHODS.includes(method) ? method : 'GET',
        url || '',
        API_TYPES.includes(apiType) ? apiType : 'REST',
        JSON.stringify([]),
        JSON.stringify([]),
        'NONE',
        JSON.stringify([]),
        folderId || null,
      ]
    );
    res.status(201).json({ request: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/requests/:requestId', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, method, url, headers, query_params, body_type, body_json, body_text,
              api_type, collection_id, formula, assertions
         FROM api_requests WHERE id = $1`,
      [req.params.requestId]
    );
    const request = rows[0];
    if (!request) return res.status(404).json({ error: 'Request not found' });
    const projectId = await projectOfCollection(request.collection_id);
    if (!projectId || !(await canReadProjectContent(req.user.id, projectId))) {
      return res.status(403).json({ error: 'No access to this request' });
    }
    const ws = await workspaceOfCollection(request.collection_id);
    const access = await getProjectAccess(req.user.id, projectId);

    const provider = await query(
      `SELECT auth_type, token_request_id, token_path, header_key, header_prefix
         FROM auth_providers WHERE collection_id = $1`,
      [request.collection_id]
    );
    res.json({
      request: {
        id: request.id,
        name: request.name,
        method: request.method,
        url: request.url,
        headers: request.headers || [],
        queryParams: request.query_params || [],
        bodyType: request.body_type,
        bodyJson: request.body_json,
        bodyText: request.body_text,
        apiType: request.api_type,
        collectionId: request.collection_id,
        formula: request.formula || '',
        assertions: request.assertions || [],
        workspaceId: ws,
        workspaceRole: access ? access.level : null,
        authProvider: normalizeProvider(provider.rows[0]),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.put('/requests/:requestId', async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const existing = await query(
      `SELECT collection_id FROM api_requests WHERE id = $1`,
      [requestId]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const projectId = await projectOfCollection(existing.rows[0].collection_id);
    if (!(await canWriteProjectContent(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }

    const b = req.body || {};
    if (b.folderId !== undefined) {
      const folderId = b.folderId || null;
      if (folderId && (await collectionOfFolder(folderId)) !== existing.rows[0].collection_id) {
        return res.status(400).json({ error: 'Folder must belong to the same collection as the request' });
      }
    }
    const fields = {
      name: b.name,
      method: b.method,
      url: b.url,
      api_type: b.apiType,
      headers: b.headers,
      query_params: b.queryParams,
      body_type: b.bodyType,
      body_json: b.bodyJson,
      body_text: b.bodyText,
      formula: b.formula,
      assertions: b.assertions,
      folder_id: b.folderId === undefined ? undefined : b.folderId || null,
    };
    const sets = [];
    const params = [requestId];
    for (const [col, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (col === 'method' && !HTTP_METHODS.includes(value)) continue;
      if (col === 'api_type' && !API_TYPES.includes(value)) continue;
      if (col === 'body_type' && !BODY_TYPES.includes(value)) continue;
      if (col === 'headers' || col === 'query_params' || col === 'assertions') {
        params.push(JSON.stringify(value));
      } else {
        params.push(value);
      }
      sets.push(`${col} = $${params.length}`);
    }
    if (sets.length) {
      await query(`UPDATE api_requests SET ${sets.join(', ')} WHERE id = $1`, params);
    }
    const fresh = await query(
      `SELECT id, name, method, url, api_type, collection_id FROM api_requests WHERE id = $1`,
      [requestId]
    );
    res.json({ request: fresh.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/requests/:requestId', async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const existing = await query(
      `SELECT collection_id FROM api_requests WHERE id = $1`,
      [requestId]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const projectId = await projectOfCollection(existing.rows[0].collection_id);
    if (!(await canWriteProjectContent(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    await query(`DELETE FROM api_requests WHERE id = $1`, [requestId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Duplicate a request inside the same collection/folder, preserving all
// editor state verbatim (same name, no suffix).
router.post('/requests/:requestId/duplicate', async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { rows } = await query(
      `SELECT id, collection_id, name, method, url, headers, query_params, body_type, body_json,
              body_text, api_type, formula, assertions, folder_id
         FROM api_requests WHERE id = $1`,
      [requestId]
    );
    const source = rows[0];
    if (!source) return res.status(404).json({ error: 'Request not found' });
    const projectId = await projectOfCollection(source.collection_id);
    if (!(await canWriteProjectContent(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const { rows: created } = await query(
      `INSERT INTO api_requests
         (collection_id, name, method, url, api_type, headers, query_params, body_type,
          body_json, body_text, formula, assertions, folder_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, name, method, url, api_type, collection_id, folder_id`,
      [
        source.collection_id,
        source.name,
        source.method,
        source.url,
        source.api_type,
        JSON.stringify(source.headers || []),
        JSON.stringify(source.query_params || []),
        source.body_type,
        source.body_json,
        source.body_text,
        source.formula,
        JSON.stringify(source.assertions || []),
        source.folder_id,
      ]
    );
    res.status(201).json({ request: created[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/collections/:collectionId', async (req, res, next) => {
  try {
    const { collectionId } = req.params;
    const projectId = await projectOfCollection(collectionId);
    if (!projectId) return res.status(404).json({ error: 'Collection not found' });
    if (!(await canWriteProjectContent(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    await query(`DELETE FROM collections WHERE id = $1`, [collectionId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/requests/:requestId/run', async (req, res, next) => {  try {
    const { requestId } = req.params;
    const existing = await query(
      `SELECT id FROM api_requests WHERE id = $1`,
      [requestId]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const result = await runRequest(requestId, req.user.id);
    const projectId = await projectOfRequest(requestId);
    await fireRequestRunEvents(requestId, projectId, result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------ Ephemeral runs
router.post('/runs', async (req, res, next) => {
  try {
    const { collectionId } = req.body || {};
    if (collectionId) {
      const projectId = await projectOfCollection(collectionId);
      if (!projectId) return res.status(404).json({ error: 'Collection not found' });
      if (!(await canReadProjectContent(req.user.id, projectId))) {
        return res.status(403).json({ error: 'No access to this collection' });
      }
    }
    const result = await runInMemoryRequest(req.body || {}, req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------- Collection runner
router.post('/collections/:collectionId/run', async (req, res, next) => {
  try {
    const { collectionId } = req.params;
    const projectId = await projectOfCollection(collectionId);
    if (!projectId) return res.status(404).json({ error: 'Collection not found' });
    if (!(await canReadProjectContent(req.user.id, projectId))) {
      return res.status(403).json({ error: 'No access to this collection' });
    }
    const { rows } = await query(
      `SELECT id, name FROM api_requests WHERE collection_id = $1 ORDER BY name`,
      [collectionId]
    );
    const results = [];
    for (const r of rows) {
      try {
        const result = await runRequest(r.id, req.user.id);
        await fireRequestRunEvents(r.id, projectId, result);
        results.push({
          requestId: r.id,
          name: r.name,
          runStatus: result.runStatus,
          httpStatus: result.httpStatus,
          error: result.error,
          durationMs: result.response ? result.response.durationMs : null,
          assertions: result.testResults,
          assertionsPassed: result.assertionsPassed,
        });
      } catch (err) {
        results.push({
          requestId: r.id,
          name: r.name,
          runStatus: 'FAILED',
          httpStatus: 0,
          error: err.message,
          durationMs: null,
          assertions: [],
          assertionsPassed: false,
        });
      }
    }
    const total = results.length;
    const passed = results.filter((r) => r.runStatus === 'SUCCESS').length;
    const assertionsTotal = results.reduce((n, r) => n + (r.assertions?.length || 0), 0);
    const assertionsPassed = results.reduce(
      (n, r) => n + (r.assertions?.filter((a) => a.passed).length || 0),
      0
    );
    res.json({
      results,
      summary: {
        total,
        passed,
        failed: total - passed,
        assertionsTotal,
        assertionsPassed,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------ Auth provider
router.get('/collections/:collectionId/auth-provider', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT auth_type, token_request_id, token_path, header_key, header_prefix
         FROM auth_providers WHERE collection_id = $1`,
      [req.params.collectionId]
    );
    res.json({ authProvider: normalizeProvider(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.put('/collections/:collectionId/auth-provider', requireCollectionWrite, async (req, res, next) => {
  try {
    const { collectionId } = req.params;
    const b = req.body || {};
    const authType = ['NONE', 'BASIC', 'BEARER_TOKEN', 'OAUTH2'].includes(b.authType) ? b.authType : 'NONE';

    // The token request must exist and be flagged AUTH.
    let tokenRequestId = b.tokenRequestId || null;
    if (tokenRequestId && authType !== 'NONE') {
      const tr = await query(
        `SELECT api_type FROM api_requests WHERE id = $1 AND api_type = 'AUTH'`,
        [tokenRequestId]
      );
      if (tr.rows.length === 0) {
        return res.status(400).json({ error: 'tokenRequestId must reference an AUTH-type request' });
      }
    } else {
      tokenRequestId = null;
    }

    const { rows } = await query(
      `INSERT INTO auth_providers
         (collection_id, auth_type, token_request_id, token_path, header_key, header_prefix)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (collection_id) DO UPDATE SET
         auth_type = EXCLUDED.auth_type,
         token_request_id = EXCLUDED.token_request_id,
         token_path = EXCLUDED.token_path,
         header_key = EXCLUDED.header_key,
         header_prefix = EXCLUDED.header_prefix,
         updated_at = now()
       RETURNING auth_type, token_request_id, token_path, header_key, header_prefix`,
      [
        collectionId,
        authType,
        tokenRequestId,
        b.tokenPath || '',
        b.headerKey || 'Authorization',
        b.headerPrefix || 'Bearer',
      ]
    );
    res.json({ authProvider: normalizeProvider(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.post('/collections/:collectionId/auth-provider/test', requireCollectionWrite, async (req, res, next) => {
  try {
    const { collectionId } = req.params;
    const provider = await query(
      `SELECT auth_type, token_request_id, token_path, header_key, header_prefix
         FROM auth_providers WHERE collection_id = $1`,
      [collectionId]
    );
    const p = normalizeProvider(provider.rows[0]);
    if (!p || p.authType === 'NONE' || !p.tokenRequestId) {
      return res.status(400).json({ error: 'No token provider configured for this collection' });
    }
    const tokenRun = await runTokenRequest(p.tokenRequestId, req.user.id);
    if (tokenRun.status >= 400) {
      return res.status(502).json({ error: `Token request failed: HTTP ${tokenRun.status} ${tokenRun.body}` });
    }
    const resolved = resolveAuthHeader(p, tokenRun.parsed);
    res.json({
      tokenStatus: tokenRun.status,
      resolvedHeader: resolved,
      tokenResponse: tokenRun.body,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

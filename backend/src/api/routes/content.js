'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, roleAtLeast, getProjectAccess, canReadWorkspace } = require('../access');
const { runRequest, runTokenRequest } = require('../runner');
const { normalizeProvider, resolveAuthHeader } = require('../authToken');

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
        requests = (await query(
          `SELECT id, name, method, url, api_type, collection_id
             FROM api_requests WHERE collection_id = ANY($1::uuid[]) ORDER BY name`,
          [collectionIds]
        )).rows;
      }
    }
    res.json({ workspaceId, projects: projectsWithAccess, collections, requests });
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

// ---------------------------------------------------------------- Requests
router.post('/requests', async (req, res, next) => {
  try {
    const { collectionId, name, method, url, apiType } = req.body || {};
    if (!collectionId || !name) return res.status(400).json({ error: 'collectionId and name are required' });
    const projectId = await projectOfCollection(collectionId);
    if (!projectId) return res.status(404).json({ error: 'Collection not found' });
    if (!(await canWriteProjectContent(req.user.id, projectId))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }

    const { rows } = await query(
      `INSERT INTO api_requests
         (collection_id, name, method, url, api_type, headers, query_params, body_type, assertions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, method, url, api_type, collection_id`,
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

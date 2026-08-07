'use strict';

const { Router } = require('express');
const { query } = require('../db');
const {
  requireAuth,
  requireProjectRead,
  requireProjectWrite,
  canReadProject,
  canWriteProject,
} = require('../access');
const { logAudit } = require('../audit');

const router = Router();
router.use(requireAuth);

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MAX_DELAY_MS = 60000;

function validateRouteInput(input) {
  const method = String(input?.method || 'GET').toUpperCase();
  if (!HTTP_METHODS.includes(method)) {
    return { error: `Invalid method. Allowed: ${HTTP_METHODS.join(', ')}` };
  }
  const path = String(input?.path || '').trim();
  if (!path.startsWith('/')) return { error: 'Path must start with "/"' };
  if (/:([^/]+)\/\s*$/.test(path) || path.endsWith(':')) {
    return { error: 'Invalid path (empty parameter name)' };
  }
  const status = Number(input?.status ?? 200);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return { error: 'Status must be an integer between 100 and 599' };
  }
  let headers = {};
  if (input?.headers !== undefined) {
    if (typeof input.headers !== 'object' || input.headers === null || Array.isArray(input.headers)) {
      return { error: 'Headers must be an object' };
    }
    headers = input.headers;
  }
  const body = input?.body !== undefined ? String(input.body) : '';
  const delayMs = Math.max(0, Math.min(Number(input?.delayMs ?? 0) || 0, MAX_DELAY_MS));
  return { value: { method, path, status, headers, body, delayMs } };
}

// Partial validation for PATCH: only the provided fields are checked + merged.
function validateRoutePatch(input) {
  const errors = [];
  let method;
  if (input?.method !== undefined) {
    method = String(input.method).toUpperCase();
    if (!HTTP_METHODS.includes(method)) {
      return { error: `Invalid method. Allowed: ${HTTP_METHODS.join(', ')}` };
    }
  }
  let path;
  if (input?.path !== undefined) {
    path = String(input.path).trim();
    if (!path.startsWith('/')) return { error: 'Path must start with "/"' };
    if (/:([^/]+)\/\s*$/.test(path) || path.endsWith(':')) {
      return { error: 'Invalid path (empty parameter name)' };
    }
  }
  let status;
  if (input?.status !== undefined) {
    status = Number(input.status);
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      return { error: 'Status must be an integer between 100 and 599' };
    }
  }
  let headers;
  if (input?.headers !== undefined) {
    if (typeof input.headers !== 'object' || input.headers === null || Array.isArray(input.headers)) {
      return { error: 'Headers must be an object' };
    }
    headers = input.headers;
  }
  let body;
  if (input?.body !== undefined) body = String(input.body);
  let delayMs;
  if (input?.delayMs !== undefined) {
    delayMs = Math.max(0, Math.min(Number(input.delayMs) || 0, MAX_DELAY_MS));
  }
  if (errors.length > 0) return { error: errors[0] };
  return { value: { method, path, status, headers, body, delayMs } };
}

// ------------------------------------------------------------------ Get / create
// A project has at most one mock server (enforced by the UNIQUE(project_id)).
router.get('/projects/:projectId/mock-server', requireProjectRead, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, project_id, name, enabled, created_at
         FROM mock_servers WHERE project_id = $1`,
      [req.params.projectId]
    );
    res.json({ mockServer: rows[0] || null });
  } catch (err) {
    next(err);
  }
});

router.post('/projects/:projectId/mock-server', requireProjectWrite, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const name = String(req.body?.name || '').trim() || 'Mock Server';
    const enabled = req.body?.enabled !== false;
    const { rows } = await query(
      `INSERT INTO mock_servers (project_id, name, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id)
       DO UPDATE SET name = EXCLUDED.name, enabled = EXCLUDED.enabled
       RETURNING id, project_id, name, enabled, created_at`,
      [projectId, name, enabled]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'mock_server',
      entityId: rows[0].id,
      action: 'create_mock_server',
      detail: { projectId, name },
      ip: req.ip,
    });
    res.status(201).json({ mockServer: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------ Update / delete server
async function loadMockServer(id) {
  const { rows } = await query(
    `SELECT id, project_id, name, enabled, created_at FROM mock_servers WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

router.patch('/mock-servers/:id', async (req, res, next) => {
  try {
    const server = await loadMockServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Mock server not found' });
    if (!(await canWriteProject(req.user.id, server.project_id))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const sets = [];
    const params = [server.id];
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'Name is required' });
      sets.push(`name = $${params.length + 1}`);
      params.push(name);
    }
    if (req.body?.enabled !== undefined) {
      sets.push(`enabled = $${params.length + 1}`);
      params.push(req.body.enabled === true);
    }
    if (sets.length > 0) {
      await query(`UPDATE mock_servers SET ${sets.join(', ')} WHERE id = $1`, params);
    }
    const { rows } = await query(
      `SELECT id, project_id, name, enabled, created_at FROM mock_servers WHERE id = $1`,
      [server.id]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'mock_server',
      entityId: server.id,
      action: 'update_mock_server',
      detail: { projectId: server.project_id },
      ip: req.ip,
    });
    res.json({ mockServer: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/mock-servers/:id', async (req, res, next) => {
  try {
    const server = await loadMockServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Mock server not found' });
    if (!(await canWriteProject(req.user.id, server.project_id))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    await query(`DELETE FROM mock_servers WHERE id = $1`, [server.id]);
    await logAudit({
      actorId: req.user.id,
      entityType: 'mock_server',
      entityId: server.id,
      action: 'delete_mock_server',
      detail: { projectId: server.project_id },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Routes
async function canAccessMockServer(userId, serverId) {
  const server = await loadMockServer(serverId);
  if (!server) return { server: null };
  return { server, canRead: await canReadProject(userId, server.project_id) };
}

router.get('/mock-servers/:id/routes', async (req, res, next) => {
  try {
    const { server, canRead } = await canAccessMockServer(req.user.id, req.params.id);
    if (!server) return res.status(404).json({ error: 'Mock server not found' });
    if (!canRead) return res.status(403).json({ error: 'No access to this mock server' });
    const { rows } = await query(
      `SELECT id, mock_server_id, method, path, status, headers, body, delay_ms, sort_order
         FROM mock_routes
        WHERE mock_server_id = $1
        ORDER BY sort_order, created_at`,
      [server.id]
    );
    res.json({ routes: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/mock-servers/:id/routes', async (req, res, next) => {
  try {
    const { server, canRead } = await canAccessMockServer(req.user.id, req.params.id);
    if (!server) return res.status(404).json({ error: 'Mock server not found' });
    if (!canRead) return res.status(403).json({ error: 'No access to this mock server' });
    const parsed = validateRouteInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { method, path, status, headers, body, delayMs } = parsed.value;
    const { rows } = await query(
      `INSERT INTO mock_routes (mock_server_id, method, path, status, headers, body, delay_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, mock_server_id, method, path, status, headers, body, delay_ms, sort_order`,
      [server.id, method, path, status, headers, body, delayMs]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'mock_route',
      entityId: rows[0].id,
      action: 'create_mock_route',
      detail: { projectId: server.project_id, method, path },
      ip: req.ip,
    });
    res.status(201).json({ route: rows[0] });
  } catch (err) {
    next(err);
  }
});

async function loadMockRoute(routeId) {
  const { rows } = await query(
    `SELECT mr.*, ms.project_id
       FROM mock_routes mr JOIN mock_servers ms ON ms.id = mr.mock_server_id
      WHERE mr.id = $1`,
    [routeId]
  );
  return rows[0] || null;
}

router.patch('/mock-routes/:id', async (req, res, next) => {
  try {
    const route = await loadMockRoute(req.params.id);
    if (!route) return res.status(404).json({ error: 'Mock route not found' });
    if (!(await canWriteProject(req.user.id, route.project_id))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const parsed = validateRoutePatch(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { method, path, status, headers, body, delayMs } = parsed.value;
    const sets = [];
    const params = [route.id];
    if (method !== undefined) {
      sets.push(`method = $${params.length + 1}`);
      params.push(method);
    }
    if (path !== undefined) {
      sets.push(`path = $${params.length + 1}`);
      params.push(path);
    }
    if (status !== undefined) {
      sets.push(`status = $${params.length + 1}`);
      params.push(status);
    }
    if (headers !== undefined) {
      sets.push(`headers = $${params.length + 1}`);
      params.push(headers);
    }
    if (body !== undefined) {
      sets.push(`body = $${params.length + 1}`);
      params.push(body);
    }
    if (delayMs !== undefined) {
      sets.push(`delay_ms = $${params.length + 1}`);
      params.push(delayMs);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    const { rows } = await query(
      `UPDATE mock_routes SET ${sets.join(', ')} WHERE id = $1
        RETURNING id, mock_server_id, method, path, status, headers, body, delay_ms, sort_order`,
      params
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'mock_route',
      entityId: route.id,
      action: 'update_mock_route',
      detail: { projectId: route.project_id },
      ip: req.ip,
    });
    res.json({ route: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/mock-routes/:id', async (req, res, next) => {
  try {
    const route = await loadMockRoute(req.params.id);
    if (!route) return res.status(404).json({ error: 'Mock route not found' });
    if (!(await canWriteProject(req.user.id, route.project_id))) {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    await query(`DELETE FROM mock_routes WHERE id = $1`, [route.id]);
    await logAudit({
      actorId: req.user.id,
      entityType: 'mock_route',
      entityId: route.id,
      action: 'delete_mock_route',
      detail: { projectId: route.project_id },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

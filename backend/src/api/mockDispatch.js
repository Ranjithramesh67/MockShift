'use strict';

const { query } = require('./db');
const { matchRoutePath } = require('../mock/pathMatcher');

const MAX_DELAY_MS = 60000;

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  return headers;
}

function send(res, status, headers, body) {
  const h = { 'Content-Type': 'application/json', ...normalizeHeaders(headers) };
  res.writeHead(status, h);
  res.end(body === '' || body === undefined ? '' : body);
}

/**
 * Public per-project mock server dispatcher. Mounted at /mock/:projectId/*.
 * No auth by design — the mock server behaves like an external API that any
 * request (or webhook) can hit. Route matching is ordered by sort_order.
 */
async function mockDispatch(req, res, next) {
  try {
    const { projectId } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
      return res.status(404).json({ error: 'Mock server not found or disabled' });
    }
    const { rows } = await query(
      `SELECT id, project_id, name, enabled FROM mock_servers WHERE project_id = $1`,
      [projectId]
    );
    const server = rows[0];
    if (!server || !server.enabled) {
      return res.status(404).json({ error: 'Mock server not found or disabled' });
    }

    const method = String(req.method || 'GET').toUpperCase();
    const requestPath = req.path || '/';

    const { rows: routes } = await query(
      `SELECT id, method, path, status, headers, body, delay_ms
         FROM mock_routes
        WHERE mock_server_id = $1
        ORDER BY sort_order, created_at`,
      [server.id]
    );

    let matched = null;
    let params = null;
    for (const route of routes) {
      if (route.method !== '*' && route.method.toUpperCase() !== method) continue;
      const match = matchRoutePath(route.path, requestPath);
      if (!match) continue;
      matched = route;
      params = match.params;
      break;
    }

    if (!matched) {
      return res.status(404).json({ error: 'No matching mock route' });
    }

    let body = String(matched.body ?? '');
    if (params && Object.keys(params).length > 0) {
      body = body.replace(/\{\{([^}]+)\}\}/g, (raw, key) =>
        params[key.trim()] !== undefined ? params[key.trim()] : raw
      );
    }

    const delay = Math.max(0, Math.min(Number(matched.delay_ms) || 0, MAX_DELAY_MS));
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    send(res, matched.status, matched.headers, body);
  } catch (err) {
    next(err);
  }
}

module.exports = { mockDispatch };

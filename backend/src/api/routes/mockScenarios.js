'use strict';

// ============================================================================
// Mock scenarios & call logs (E3 / P3).
//
// This is a SEPARATE router so mockServers.js / server.js / mockDispatch.js
// stay frozen. It owns three capabilities on top of the base mock server:
//
//   1. Conditional responses — extra header / query / JSON-body matchers on a
//      route that select a response (status/headers/body/delayMs). Stored in
//      mock_route_responses keyed by mock_routes.id.
//   2. Named scenarios — groups of route-response overrides a client activates
//      with `X-Mock-Scenario: <name>` (or `?__scenario=` / `?scenario=`).
//   3. Stateful sequences — a route cycles/advances through ordered responses;
//      the cursor lives in mock_sequence_state so it survives across requests.
//
// It also captures a call log per inbound mock request and exposes a read API
// plus a replay action that re-issues the stored request against the mock.
//
// Coordinator wiring (server.js):
//   const mockScenarioRoutes = require('./routes/mockScenarios');
//   app.use('/api', mockScenarioRoutes);                       // CRUD + logs
//   // BEFORE mockDispatch so scenario/conditional responses win, and so the
//   // call-log hook observes responses served by the base dispatcher too:
//   app.use('/mock/:projectId', mockScenarioRoutes.createMockScenarioMiddleware());
//   app.use('/mock/:projectId', mockDispatch);
//
// Access is gated per project with getProjectAccess, mirroring docs.js /
// mockServers.js. These tables intentionally do not use RLS (like mock_servers).
// ============================================================================

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, getProjectAccess } = require('../access');
const { logAudit } = require('../audit');
const { matchRoutePath } = require('../../mock/pathMatcher');
const matcher = require('../mockMatcher');

const router = Router();
router.use(requireAuth);

const MAX_DELAY_MS = 60000;
// Retention: keep at most this many call logs per mock server; older rows are
// pruned opportunistically right after each insert.
const MAX_CALL_LOGS_PER_SERVER = 1000;
// Cap the stored request body so a large replay payload cannot bloat the log.
const MAX_CALL_BODY = 65536;
const REPLAY_TIMEOUT_MS = 10000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Header names whose values are never persisted or replayed.
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'x-mock-replay-from',
]);
// Headers that must not be forwarded on a replay (managed by fetch).
const HOP_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'accept-encoding',
  'x-mock-replay-from',
]);

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHeaders(headers) {
  if (!isPlainObject(headers)) return {};
  return headers;
}

function clampDelay(value) {
  return Math.max(0, Math.min(Number(value) || 0, MAX_DELAY_MS));
}

function truncate(text, max) {
  const value = String(text === undefined || text === null ? '' : text);
  return value.length > max ? value.slice(0, max) : value;
}

function substituteParams(body, params) {
  if (!params || Object.keys(params).length === 0) return body;
  return body.replace(/\{\{([^}]+)\}\}/g, (raw, key) =>
    params[key.trim()] !== undefined ? params[key.trim()] : raw
  );
}

// --------------------------------------------------------------- DB loaders

async function loadMockServer(id) {
  const { rows } = await query(
    `SELECT id, project_id, name, enabled, created_at FROM mock_servers WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function loadEnabledServerByProject(projectId) {
  const { rows } = await query(
    `SELECT id, project_id, name, enabled FROM mock_servers WHERE project_id = $1 AND enabled = true`,
    [projectId]
  );
  return rows[0] || null;
}

async function loadScenario(id) {
  const { rows } = await query(
    `SELECT id, project_id, mock_server_id, name, description, created_at, updated_at
       FROM mock_scenarios WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function loadRouteWithServer(routeId) {
  const { rows } = await query(
    `SELECT mr.id, mr.mock_server_id, mr.method, mr.path, ms.project_id
       FROM mock_routes mr JOIN mock_servers ms ON ms.id = mr.mock_server_id
      WHERE mr.id = $1`,
    [routeId]
  );
  return rows[0] || null;
}

async function loadResponseWithServer(responseId) {
  const { rows } = await query(
    `SELECT rr.*, mr.mock_server_id, ms.project_id
       FROM mock_route_responses rr
       JOIN mock_routes mr ON mr.id = rr.route_id
       JOIN mock_servers ms ON ms.id = mr.mock_server_id
      WHERE rr.id = $1`,
    [responseId]
  );
  return rows[0] || null;
}

async function loadCallLog(id) {
  const { rows } = await query(`SELECT * FROM mock_call_logs WHERE id = $1`, [id]);
  return rows[0] || null;
}

const RESPONSE_COLUMNS = `id, route_id, scenario_id, name, priority, conditions, status,
                          headers, body, delay_ms, sequence_index, sequence_mode, created_at`;

// --------------------------------------------------------------- validation

function validateScenarioInput(input, { partial = false } = {}) {
  const body = input || {};
  const value = {};
  if (!partial || body.name !== undefined) {
    const name = body.name === undefined ? '' : String(body.name).trim();
    if (!name) return { error: 'name is required' };
    if (name.length > 100) return { error: 'name must be at most 100 characters' };
    value.name = name;
  }
  if (!partial || body.description !== undefined) {
    value.description = body.description === undefined ? '' : String(body.description);
  }
  return { value };
}

function validateResponseInput(input, { partial = false } = {}) {
  const body = input || {};
  const value = {};

  if (!partial || body.name !== undefined) {
    value.name = body.name === undefined ? '' : String(body.name).trim();
  }
  if (!partial || body.priority !== undefined) {
    const priority = body.priority === undefined ? 0 : Number(body.priority);
    if (!Number.isInteger(priority)) return { error: 'priority must be an integer' };
    value.priority = priority;
  }
  if (!partial || body.conditions !== undefined) {
    const parsed = matcher.normalizeConditions(body.conditions === undefined ? [] : body.conditions);
    if (parsed.error) return { error: parsed.error };
    value.conditions = parsed.value;
  }
  if (!partial || body.status !== undefined) {
    const status = body.status === undefined ? 200 : Number(body.status);
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      return { error: 'Status must be an integer between 100 and 599' };
    }
    value.status = status;
  }
  if (!partial || body.headers !== undefined) {
    if (body.headers === undefined) value.headers = {};
    else if (!isPlainObject(body.headers)) return { error: 'Headers must be an object' };
    else value.headers = body.headers;
  }
  if (!partial || body.body !== undefined) {
    value.body = body.body === undefined ? '' : String(body.body);
  }
  if (!partial || body.delayMs !== undefined) {
    value.delay_ms = clampDelay(body.delayMs === undefined ? 0 : body.delayMs);
  }
  if (!partial || body.sequenceIndex !== undefined) {
    if (body.sequenceIndex === undefined || body.sequenceIndex === null) {
      value.sequence_index = null;
    } else {
      const index = Number(body.sequenceIndex);
      if (!Number.isInteger(index) || index < 0) {
        return { error: 'sequenceIndex must be a non-negative integer or null' };
      }
      value.sequence_index = index;
    }
  }
  if (!partial || body.sequenceMode !== undefined) {
    const mode = body.sequenceMode === undefined ? 'cycle' : String(body.sequenceMode);
    if (!['cycle', 'advance'].includes(mode)) {
      return { error: 'sequenceMode must be cycle or advance' };
    }
    value.sequence_mode = mode;
  }
  if (body.scenarioId !== undefined) {
    if (body.scenarioId === null) {
      value.scenario_id = null;
    } else {
      if (!isUuid(body.scenarioId)) return { error: 'scenarioId must be a valid uuid' };
      value.scenario_id = body.scenarioId;
    }
  } else if (!partial) {
    value.scenario_id = null;
  }
  return { value };
}

// Map a validated value bag to insert columns (jsonb fields serialized).
function responseInsertParts(value) {
  const map = {
    scenario_id: 'scenario_id',
    name: 'name',
    priority: 'priority',
    conditions: 'conditions',
    status: 'status',
    headers: 'headers',
    body: 'body',
    delay_ms: 'delay_ms',
    sequence_index: 'sequence_index',
    sequence_mode: 'sequence_mode',
  };
  const cols = [];
  const params = [];
  for (const key of Object.keys(value)) {
    cols.push(map[key]);
    params.push(key === 'conditions' || key === 'headers' ? JSON.stringify(value[key]) : value[key]);
  }
  return { cols, params };
}

// ------------------------------------------------------------ call logging

function sanitizeRequestHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[redacted]' : value;
  }
  return out;
}

function requestBodyText(req) {
  if (typeof req.body === 'string') return req.body;
  if (isPlainObject(req.body)) {
    return Object.keys(req.body).length === 0 ? '' : JSON.stringify(req.body);
  }
  return '';
}

async function recordCall({
  server,
  req,
  status,
  route,
  response,
  scenario,
  source,
  durationMs,
  replayedFrom,
}) {
  const headers = sanitizeRequestHeaders(req && req.headers);
  const body = truncate(requestBodyText(req), MAX_CALL_BODY);
  const inserted = await query(
    `INSERT INTO mock_call_logs
       (project_id, mock_server_id, method, path, query, request_headers, request_body,
        matched_route_id, matched_route_path, matched_response_id, matched_scenario_id,
        scenario_name, status, duration_ms, source, replayed_from)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      server.project_id,
      server.id,
      String((req && req.method) || 'GET').toUpperCase(),
      String((req && req.path) || '/'),
      JSON.stringify((req && req.query) || {}),
      JSON.stringify(headers),
      body,
      route ? route.id : null,
      route ? route.path : null,
      response ? response.id : null,
      scenario ? scenario.id : null,
      scenario ? scenario.name : null,
      Number.isFinite(Number(status)) ? Number(status) : null,
      Math.max(0, Math.floor(Number(durationMs) || 0)),
      ['scenario', 'static', 'unmatched'].includes(source) ? source : 'unmatched',
      replayedFrom || null,
    ]
  );
  // Opportunistic retention: keep only the newest N rows for this server.
  await query(
    `DELETE FROM mock_call_logs
      WHERE mock_server_id = $1
        AND id NOT IN (
          SELECT id FROM mock_call_logs
           WHERE mock_server_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT $2
        )`,
    [server.id, MAX_CALL_LOGS_PER_SERVER]
  );
  return inserted.rows[0];
}

// Wrap res.end so EVERY mock response (scenario-served, base-dispatched or
// 404) is logged with its final status + body. The real end is deferred until
// the insert settles so a caller that immediately reads the call log (the
// integration tests and the replay endpoint) always sees the row.
function installCallLogHook(req, res, server, startedAt) {
  const originalEnd = res.end;
  let logged = false;
  res.end = function patchedEnd(chunk, encoding, callback) {
    if (logged) return originalEnd.call(this, chunk, encoding, callback);
    logged = true;
    let body = '';
    try {
      if (typeof chunk === 'string') body = chunk;
      else if (Buffer.isBuffer(chunk)) body = chunk.toString('utf8');
    } catch {
      body = '';
    }
    const match = req._mockMatch || {};
    const finish = () => originalEnd.call(res, chunk, encoding, callback);
    recordCall({
      server,
      req,
      status: res.statusCode,
      route: match.route || null,
      response: match.response || null,
      scenario: match.scenario || null,
      source: match.source || 'static',
      durationMs: Date.now() - startedAt,
      replayedFrom: match.replayedFrom || null,
    }).then(finish, (err) => {
      // eslint-disable-next-line no-console
      console.error('[mockScenarios] call log insert failed:', err.message);
      finish();
    });
    return res;
  };
}

// ----------------------------------------------------------- setup middleware

async function findMatchedRoute(serverId, method, requestPath) {
  const { rows } = await query(
    `SELECT id, method, path, status, headers, body, delay_ms, sort_order
       FROM mock_routes WHERE mock_server_id = $1 ORDER BY sort_order, created_at`,
    [serverId]
  );
  for (const route of rows) {
    if (route.method !== '*' && route.method.toUpperCase() !== method) continue;
    const match = matchRoutePath(route.path, requestPath);
    if (!match) continue;
    return { route, params: match.params };
  }
  return { route: null, params: null };
}

async function advanceSequence(routeId, scenarioId) {
  const { rows } = await query(
    `INSERT INTO mock_sequence_state (route_id, scenario_id, cursor)
     VALUES ($1, $2, 1)
     ON CONFLICT (route_id, scenario_id)
     DO UPDATE SET cursor = mock_sequence_state.cursor + 1, updated_at = now()
     RETURNING cursor`,
    [routeId, scenarioId]
  );
  return rows[0] ? Number(rows[0].cursor) : 1;
}

/**
 * Express middleware factory for the public mock dispatch. Mount it on
 * `/mock/:projectId` BEFORE the base `mockDispatch`:
 *
 *   app.use('/mock/:projectId', createMockScenarioMiddleware());
 *   app.use('/mock/:projectId', mockDispatch);
 *
 * It serves a scenario/conditional/sequence response when one is selected and
 * otherwise calls next(), letting the base dispatcher handle the static route
 * (its response is still captured by the call-log hook).
 */
function createMockScenarioMiddleware() {
  return async function mockScenarioMiddleware(req, res, next) {
    try {
      const projectId = req.params && req.params.projectId;
      if (!isUuid(projectId)) return next();
      const server = await loadEnabledServerByProject(projectId);
      if (!server) return next();

      const startedAt = Date.now();
      installCallLogHook(req, res, server, startedAt);

      const replayHeader = (req.headers && req.headers['x-mock-replay-from']) || null;
      const method = String(req.method || 'GET').toUpperCase();
      const requestPath = req.path || '/';
      const { route: matchedRoute, params } = await findMatchedRoute(server.id, method, requestPath);

      if (!matchedRoute) {
        req._mockMatch = { route: null, response: null, scenario: null, source: 'unmatched', replayedFrom: replayHeader };
        return next();
      }

      const scenarioName = matcher.scenarioFromRequest(req);
      let scenario = null;
      if (scenarioName) {
        const { rows } = await query(
          `SELECT id, name FROM mock_scenarios WHERE mock_server_id = $1 AND btrim(name) = $2`,
          [server.id, scenarioName]
        );
        scenario = rows[0] || null;
      }

      const { rows: responses } = await query(
        `SELECT ${RESPONSE_COLUMNS} FROM mock_route_responses WHERE route_id = $1`,
        [matchedRoute.id]
      );
      const context = matcher.requestContext(req, params);
      const pick = matcher.pickResponse(responses, scenario ? scenario.id : null, context);

      if (!pick) {
        req._mockMatch = { route: matchedRoute, response: null, scenario, source: 'static', replayedFrom: replayHeader };
        return next();
      }

      let chosen;
      if (pick.kind === 'conditional') {
        chosen = pick.response;
      } else {
        const stateKey = scenario ? scenario.id : matcher.DEFAULT_SCENARIO_ID;
        const cursor = await advanceSequence(matchedRoute.id, stateKey);
        const index = matcher.sequenceIndexFor(cursor, pick.responses.length, pick.mode);
        chosen = pick.responses[index];
      }

      const body = substituteParams(String(chosen.body ?? ''), params);
      const delay = clampDelay(chosen.delay_ms);
      req._mockMatch = { route: matchedRoute, response: chosen, scenario, source: 'scenario', replayedFrom: replayHeader };
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      res.writeHead(chosen.status, { 'Content-Type': 'application/json', ...normalizeHeaders(chosen.headers) });
      res.end(body);
    } catch (err) {
      next(err);
    }
  };
}

// =============================================================== Scenarios API

// GET /api/mock-scenarios?mockServerId=<uuid> -> 200 { scenarios: [...] }
router.get('/mock-scenarios', async (req, res, next) => {
  try {
    const { mockServerId } = req.query;
    if (!isUuid(mockServerId)) return res.status(400).json({ error: 'mockServerId must be a valid uuid' });
    const server = await loadMockServer(mockServerId);
    if (!server) return res.status(404).json({ error: 'Mock server not found' });
    if (!(await getProjectAccess(req.user.id, server.project_id))) {
      return res.status(403).json({ error: 'No access to this mock server' });
    }
    const { rows } = await query(
      `SELECT id, project_id, mock_server_id, name, description, created_at, updated_at
         FROM mock_scenarios WHERE mock_server_id = $1 ORDER BY name`,
      [server.id]
    );
    res.json({ scenarios: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/mock-scenarios { mockServerId, name, description? } -> 201 { scenario }
router.post('/mock-scenarios', async (req, res, next) => {
  try {
    const { mockServerId } = req.body || {};
    if (!isUuid(mockServerId)) return res.status(400).json({ error: 'mockServerId must be a valid uuid' });
    const server = await loadMockServer(mockServerId);
    if (!server) return res.status(404).json({ error: 'Mock server not found' });
    const access = await getProjectAccess(req.user.id, server.project_id);
    if (!access) return res.status(403).json({ error: 'No access to this mock server' });
    if (access.level !== 'ADMIN' && access.level !== 'MANAGER' && access.level !== 'EDITOR') {
      return res.status(403).json({ error: 'Editor, manager or admin access required' });
    }
    const parsed = validateScenarioInput(req.body, { partial: false });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { name, description } = parsed.value;
    const { rows } = await query(
      `INSERT INTO mock_scenarios (project_id, mock_server_id, name, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (mock_server_id, btrim(name)) DO NOTHING
       RETURNING id, project_id, mock_server_id, name, description, created_at, updated_at`,
      [server.project_id, server.id, name, description]
    );
    if (rows.length === 0) {
      return res.status(409).json({ error: 'A scenario with that name already exists' });
    }
    await logAudit({
      actorId: req.user.id,
      entityType: 'mock_scenario',
      entityId: rows[0].id,
      action: 'create_mock_scenario',
      detail: { projectId: server.project_id, mockServerId: server.id, name },
      ip: req.ip,
    });
    res.status(201).json({ scenario: rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/mock-scenarios/:id { name?, description? } -> 200 { scenario }
router.patch('/mock-scenarios/:id', async (req, res, next) => {
  try {
    const scenario = await loadScenario(req.params.id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    const access = await getProjectAccess(req.user.id, scenario.project_id);
    if (!access) return res.status(403).json({ error: 'No access to this mock server' });
    if (access.level === 'VIEWER') return res.status(403).json({ error: 'Editor, manager or admin access required' });
    const parsed = validateScenarioInput(req.body, { partial: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const sets = [];
    const params = [scenario.id];
    if (parsed.value.name !== undefined) {
      sets.push(`name = $${params.length + 1}`);
      params.push(parsed.value.name);
    }
    if (parsed.value.description !== undefined) {
      sets.push(`description = $${params.length + 1}`);
      params.push(parsed.value.description);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    sets.push('updated_at = now()');
    const { rows } = await query(
      `UPDATE mock_scenarios SET ${sets.join(', ')} WHERE id = $1
        RETURNING id, project_id, mock_server_id, name, description, created_at, updated_at`,
      params
    );
    res.json({ scenario: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'A scenario with that name already exists' });
    }
    next(err);
  }
});

// DELETE /api/mock-scenarios/:id -> 200 { ok: true }
router.delete('/mock-scenarios/:id', async (req, res, next) => {
  try {
    const scenario = await loadScenario(req.params.id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    const access = await getProjectAccess(req.user.id, scenario.project_id);
    if (!access) return res.status(403).json({ error: 'No access to this mock server' });
    if (access.level === 'VIEWER') return res.status(403).json({ error: 'Editor, manager or admin access required' });
    await query(`DELETE FROM mock_scenarios WHERE id = $1`, [scenario.id]);
    await logAudit({
      actorId: req.user.id,
      entityType: 'mock_scenario',
      entityId: scenario.id,
      action: 'delete_mock_scenario',
      detail: { projectId: scenario.project_id, mockServerId: scenario.mock_server_id },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ================================================== Conditional responses API

// GET /api/mock-routes/:routeId/responses -> 200 { responses, sequenceState, scenarios }
router.get('/mock-routes/:routeId/responses', async (req, res, next) => {
  try {
    const route = await loadRouteWithServer(req.params.routeId);
    if (!route) return res.status(404).json({ error: 'Mock route not found' });
    if (!(await getProjectAccess(req.user.id, route.project_id))) {
      return res.status(403).json({ error: 'No access to this mock server' });
    }
    const [responses, sequenceState, scenarios] = await Promise.all([
      query(
        `SELECT ${RESPONSE_COLUMNS} FROM mock_route_responses WHERE route_id = $1
          ORDER BY sequence_index NULLS LAST, priority DESC, created_at`,
        [route.id]
      ),
      query(
        `SELECT scenario_id, cursor, updated_at FROM mock_sequence_state WHERE route_id = $1`,
        [route.id]
      ),
      query(
        `SELECT id, name FROM mock_scenarios WHERE mock_server_id = $1 ORDER BY name`,
        [route.mock_server_id]
      ),
    ]);
    res.json({
      responses: responses.rows,
      sequenceState: sequenceState.rows,
      scenarios: scenarios.rows,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/mock-routes/:routeId/responses -> 201 { response }
router.post('/mock-routes/:routeId/responses', async (req, res, next) => {
  try {
    const route = await loadRouteWithServer(req.params.routeId);
    if (!route) return res.status(404).json({ error: 'Mock route not found' });
    const access = await getProjectAccess(req.user.id, route.project_id);
    if (!access) return res.status(403).json({ error: 'No access to this mock server' });
    if (access.level === 'VIEWER') return res.status(403).json({ error: 'Editor, manager or admin access required' });

    const parsed = validateResponseInput(req.body, { partial: false });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (parsed.value.scenario_id) {
      const scenario = await loadScenario(parsed.value.scenario_id);
      if (!scenario || scenario.mock_server_id !== route.mock_server_id) {
        return res.status(400).json({ error: 'scenarioId must belong to the same mock server' });
      }
    }

    const { cols, params } = responseInsertParts(parsed.value);
    const placeholders = ['$1', ...params.map((_, i) => `$${i + 2}`)].join(', ');
    const { rows } = await query(
      `INSERT INTO mock_route_responses (route_id, ${cols.join(', ')})
       VALUES (${placeholders})
       RETURNING ${RESPONSE_COLUMNS}`,
      [route.id, ...params]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'mock_route_response',
      entityId: rows[0].id,
      action: 'create_mock_route_response',
      detail: { projectId: route.project_id, routeId: route.id },
      ip: req.ip,
    });
    res.status(201).json({ response: rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/mock-responses/:id -> 200 { response }
router.patch('/mock-responses/:id', async (req, res, next) => {
  try {
    const existing = await loadResponseWithServer(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Mock response not found' });
    const access = await getProjectAccess(req.user.id, existing.project_id);
    if (!access) return res.status(403).json({ error: 'No access to this mock server' });
    if (access.level === 'VIEWER') return res.status(403).json({ error: 'Editor, manager or admin access required' });

    const parsed = validateResponseInput(req.body, { partial: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (parsed.value.scenario_id) {
      const scenario = await loadScenario(parsed.value.scenario_id);
      if (!scenario || scenario.mock_server_id !== existing.mock_server_id) {
        return res.status(400).json({ error: 'scenarioId must belong to the same mock server' });
      }
    }
    const sets = [];
    const params = [existing.id];
    for (const [key, value] of Object.entries(parsed.value)) {
      sets.push(`${key} = $${params.length + 1}`);
      params.push(key === 'conditions' || key === 'headers' ? JSON.stringify(value) : value);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    const { rows } = await query(
      `UPDATE mock_route_responses SET ${sets.join(', ')} WHERE id = $1 RETURNING ${RESPONSE_COLUMNS}`,
      params
    );
    res.json({ response: rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/mock-responses/:id -> 200 { ok: true }
router.delete('/mock-responses/:id', async (req, res, next) => {
  try {
    const existing = await loadResponseWithServer(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Mock response not found' });
    const access = await getProjectAccess(req.user.id, existing.project_id);
    if (!access) return res.status(403).json({ error: 'No access to this mock server' });
    if (access.level === 'VIEWER') return res.status(403).json({ error: 'Editor, manager or admin access required' });
    await query(`DELETE FROM mock_route_responses WHERE id = $1`, [existing.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/mock-routes/:routeId/sequence/reset { scenarioId? } -> { ok, cursor }
router.post('/mock-routes/:routeId/sequence/reset', async (req, res, next) => {
  try {
    const route = await loadRouteWithServer(req.params.routeId);
    if (!route) return res.status(404).json({ error: 'Mock route not found' });
    const access = await getProjectAccess(req.user.id, route.project_id);
    if (!access) return res.status(403).json({ error: 'No access to this mock server' });
    if (access.level === 'VIEWER') return res.status(403).json({ error: 'Editor, manager or admin access required' });

    const rawScenarioId = req.body && req.body.scenarioId;
    let stateKey = matcher.DEFAULT_SCENARIO_ID;
    if (rawScenarioId) {
      if (!isUuid(rawScenarioId)) return res.status(400).json({ error: 'scenarioId must be a valid uuid' });
      const scenario = await loadScenario(rawScenarioId);
      if (!scenario || scenario.mock_server_id !== route.mock_server_id) {
        return res.status(400).json({ error: 'scenarioId must belong to the same mock server' });
      }
      stateKey = scenario.id;
    }
    await query(`DELETE FROM mock_sequence_state WHERE route_id = $1 AND scenario_id = $2`, [
      route.id,
      stateKey,
    ]);
    res.json({ ok: true, cursor: 0 });
  } catch (err) {
    next(err);
  }
});

// ============================================================== Call log API

// GET /api/mock-call-logs?mockServerId=&limit=&offset= -> { logs, total }
router.get('/mock-call-logs', async (req, res, next) => {
  try {
    const { mockServerId } = req.query;
    if (!isUuid(mockServerId)) return res.status(400).json({ error: 'mockServerId must be a valid uuid' });
    const server = await loadMockServer(mockServerId);
    if (!server) return res.status(404).json({ error: 'Mock server not found' });
    if (!(await getProjectAccess(req.user.id, server.project_id))) {
      return res.status(403).json({ error: 'No access to this mock server' });
    }
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const [logs, total] = await Promise.all([
      query(
        `SELECT * FROM mock_call_logs WHERE mock_server_id = $1
          ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [server.id, limit, offset]
      ),
      query(`SELECT count(*)::int AS count FROM mock_call_logs WHERE mock_server_id = $1`, [server.id]),
    ]);
    res.json({ logs: logs.rows, total: total.rows[0] ? total.rows[0].count : 0 });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/mock-call-logs?mockServerId=<uuid> -> { ok: true, cleared }
router.delete('/mock-call-logs', async (req, res, next) => {
  try {
    const { mockServerId } = req.query;
    if (!isUuid(mockServerId)) return res.status(400).json({ error: 'mockServerId must be a valid uuid' });
    const server = await loadMockServer(mockServerId);
    if (!server) return res.status(404).json({ error: 'Mock server not found' });
    const access = await getProjectAccess(req.user.id, server.project_id);
    if (!access) return res.status(403).json({ error: 'No access to this mock server' });
    if (access.level === 'VIEWER') return res.status(403).json({ error: 'Editor, manager or admin access required' });
    const removed = await query(`DELETE FROM mock_call_logs WHERE mock_server_id = $1 RETURNING id`, [server.id]);
    res.json({ ok: true, cleared: removed.rowCount });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------- replay

function replayBaseUrl() {
  const configured = process.env.MOCK_REPLAY_BASE_URL;
  if (configured) return String(configured).replace(/\/+$/, '');
  return `http://127.0.0.1:${process.env.PORT || 3001}`;
}

function buildReplayUrl(log) {
  const path = String(log.path || '/');
  const search = new URLSearchParams();
  const q = log.query && typeof log.query === 'object' ? log.query : {};
  for (const [key, value] of Object.entries(q)) {
    if (Array.isArray(value)) value.forEach((v) => search.append(key, String(v)));
    else search.append(key, String(value));
  }
  const qs = search.toString();
  return `${replayBaseUrl()}/mock/${log.project_id}${path.startsWith('/') ? '' : '/'}${path}${qs ? `?${qs}` : ''}`;
}

function replayHeaders(stored) {
  const out = {};
  for (const [key, value] of Object.entries(stored || {})) {
    if (HOP_HEADERS.has(key.toLowerCase())) continue;
    if (value === '[redacted]') continue;
    out[key] = value;
  }
  return out;
}

// POST /api/mock-call-logs/:id/replay -> { replay: {status,headers,body}, log }
// Re-issues the stored request against the same mock and returns the live
// response. The re-issued call is itself captured by the dispatch hook (linked
// back to this log via X-Mock-Replay-From).
router.post('/mock-call-logs/:id/replay', async (req, res, next) => {
  try {
    const log = await loadCallLog(req.params.id);
    if (!log) return res.status(404).json({ error: 'Call log not found' });
    if (!(await getProjectAccess(req.user.id, log.project_id))) {
      return res.status(403).json({ error: 'No access to this mock server' });
    }
    const method = String(log.method || 'GET').toUpperCase();
    const headers = replayHeaders(log.request_headers);
    headers['X-Mock-Replay-From'] = log.id;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REPLAY_TIMEOUT_MS);
    let replay;
    try {
      const response = await fetch(buildReplayUrl(log), {
        method,
        headers,
        body: !['GET', 'HEAD'].includes(method) && log.request_body ? log.request_body : undefined,
        redirect: 'manual',
        signal: controller.signal,
      });
      const body = await response.text();
      replay = {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      };
    } finally {
      clearTimeout(timer);
    }

    const { rows } = await query(
      `SELECT * FROM mock_call_logs WHERE replayed_from = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [log.id]
    );
    res.json({ replay, log: rows[0] || null });
  } catch (err) {
    if (err && err.name === 'AbortError') return res.status(504).json({ error: 'Replay timed out' });
    next(err);
  }
});

// The router doubles as a carrier for the dispatch middleware factory so the
// coordinator can import both from one module:
//   const mockScenarios = require('./routes/mockScenarios');
//   app.use('/api', mockScenarios);
//   app.use('/mock/:projectId', mockScenarios.createMockScenarioMiddleware());
router.createMockScenarioMiddleware = createMockScenarioMiddleware;

module.exports = router;
